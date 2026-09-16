/* oxlint-disable effecttsgo/any-unknown-in-error-context -- The public client erases errors to unknown. createSession narrows them once at the workflow boundary; no unknown failure escapes. */
import type { Plugin } from "@opencode/plugin/effect";
import { Agent } from "@opencode/schema/agent";
import { Location } from "@opencode/schema/location";
import { Model } from "@opencode/schema/model";
import { Provider } from "@opencode/schema/provider";
import { Project } from "@opencode/schema/project";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { Tool } from "@opencode/schema/tool";
import { Worktree } from "@opencode/schema/worktree";
import { Effect, Fiber, Schema, Scope, Schedule } from "effect";

const Text = Schema.String.check(Schema.isNonEmpty(), Schema.isPattern(/\S/));

export const Input = Schema.Struct({
  prompt: Text,
  worktree: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        create: Schema.Struct({ baseRef: Schema.optionalKey(Text) }),
        existing: Schema.optionalKey(Schema.Never),
      }),
      Schema.Struct({
        existing: Schema.Struct({
          directory: Text.check(Schema.isPattern(/^(?:\/|[A-Za-z]:[\\/]|\\\\)/)),
        }),
        create: Schema.optionalKey(Schema.Never),
      }),
    ]),
  ),
  agent: Schema.optionalKey(Text),
  model: Schema.optionalKey(Schema.Struct({ providerID: Text, modelID: Text })),
  variant: Schema.optionalKey(Text),
});

const Output = Schema.Struct({
  sessionID: Session.ID,
  location: Location.Ref,
  promptAccepted: Schema.Literal(true),
});

// The host validates Standard Schema outputs by decoding them, so the value the
// tool returns must be valid on the encoded (JSON) side. The wrapper also keeps
// parsing in this plugin instead of the host's own Effect copy, which the
// standalone CLI embeds.
const ToolInput = {
  "~standard": Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(Input))["~standard"],
};
const ToolOutput = {
  "~standard": Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(Output))["~standard"],
};

type Client = {
  session: Pick<Plugin.Context["session"], "get" | "context" | "create" | "prompt">;
  worktree: Pick<Plugin.Context["worktree"], "refresh" | "list" | "create">;
  agent: Pick<Plugin.Context["agent"], "list">;
  catalog: { model: Pick<Plugin.Context["catalog"]["model"], "list"> };
};
type Stage = "validation" | "worktree" | "destination" | "session" | "prompt";

const requestLocation = (location: Location.Ref) => ({
  directory: location.directory,
  workspace: location.workspaceID,
});

// Resolve server paths and wait for location-owned agent transforms in one place.
const resolveLocation = Effect.fn("SessionTools.resolveLocation")(function* (
  ctx: Client,
  location: Location.Ref,
  projectID: Project.ID,
  agent: Agent.ID,
) {
  const result = yield* ctx.agent.list({ location: requestLocation(location) }).pipe(
    Effect.repeat({
      while: (catalog) => catalog.data.length === 0,
      times: 50,
      schedule: Schedule.spaced("100 millis"),
    }),
  );
  if (result.location.project.id !== projectID || result.location.workspaceID)
    return yield* new Tool.Error({
      message: "The location must belong to the calling session's Git project.",
    });
  if (!result.data.some((item) => item.id === agent))
    return yield* new Tool.Error({
      message: "The selected agent is unavailable at this location.",
    });
  return result.location;
});

const selections = Effect.fn("SessionTools.selections")(function* (
  ctx: Client,
  input: typeof Input.Type,
  caller: Session.Info,
  tool: Tool.Context,
) {
  let inherited = caller.model;
  if (!inherited) {
    // A session using the server default may have no explicit model selection.
    const messages = yield* ctx.session.context({ sessionID: caller.id });
    const active = messages.find((message) => message.id === tool.messageID);
    if (active?.type === "assistant") inherited = active.model;
  }
  if (!inherited)
    return yield* new Tool.Error({ message: "The calling session's model could not be resolved." });
  const model = Model.Ref.make({
    id: input.model ? Model.ID.make(input.model.modelID) : inherited.id,
    providerID: input.model ? Provider.ID.make(input.model.providerID) : inherited.providerID,
    variant: input.variant ? Model.VariantID.make(input.variant) : inherited.variant,
  });
  const available = yield* ctx.catalog.model.list();
  const selected = available.data.find(
    (item) => item.id === model.id && item.providerID === model.providerID,
  );
  if (!selected) return yield* new Tool.Error({ message: "The selected model is unavailable." });
  if (model.variant && !selected.variants.some((variant) => variant.id === model.variant))
    return yield* new Tool.Error({
      message: `Variant ${model.variant} is unavailable for the selected model.`,
    });
  const agent = input.agent ? Agent.ID.make(input.agent) : (caller.agent ?? tool.agent);
  return { agent, model };
});

const createSession = Effect.fn("SessionTools.createSession")(function* (
  ctx: Client,
  input: typeof Input.Type,
  tool: Tool.Context,
) {
  let stage: Stage = "validation";
  let location: Location.Ref | undefined;
  let sessionID: Session.ID | undefined;
  let uncertain = false;
  // The host records failure metadata inside a JSON event, which rejects
  // explicit undefined values, so omit fields that are not known yet.
  const metadata = () => {
    const base = { stage, uncertain };
    if (location === undefined) return base;
    return sessionID === undefined ? { ...base, location } : { ...base, location, sessionID };
  };

  const run = Effect.gen(function* () {
    const caller = yield* ctx.session.get({ sessionID: tool.sessionID });
    if (caller.location.workspaceID || caller.projectID === Project.ID.global)
      return yield* new Tool.Error({
        message: "Session worktrees require a local Git project on the server.",
      });
    const selected = yield* selections(ctx, input, caller, tool);
    const source = yield* resolveLocation(ctx, caller.location, caller.projectID, selected.agent);
    const sourceLocation = requestLocation(source);
    if (input.worktree?.existing) {
      location = Location.Ref.make({
        directory: Location.Ref.fields.directory.make(input.worktree.existing.directory),
      });
    } else {
      stage = "worktree";
      uncertain = true;
      const worktree = yield* ctx.worktree.create({
        location: sourceLocation,
        from: source.project.directory,
        strategy: Worktree.StrategyID.make("git"),
        branch: input.worktree?.create.baseRef ?? "HEAD",
      });
      location = Location.Ref.make({ directory: worktree.directory });
      uncertain = false;
    }

    stage = "destination";
    const destination = yield* resolveLocation(ctx, location, caller.projectID, selected.agent);
    if (input.worktree?.existing) {
      yield* ctx.worktree.refresh({ location: sourceLocation });
      const registered = yield* ctx.worktree.list({ location: sourceLocation });
      if (
        destination.directory === source.project.directory ||
        !registered.some(
          (item) =>
            item.directory === destination.directory &&
            (item.strategy === "git" || item.strategy === undefined),
        )
      )
        return yield* new Tool.Error({
          message: "Choose another Git worktree in the calling session's project.",
        });
    }
    location = Location.Ref.make({ directory: destination.directory });

    stage = "session";
    sessionID = Session.ID.create();
    uncertain = true;
    // Settle the database mutation before allowing owner shutdown to interrupt.
    const created = yield* ctx.session
      .create({
        id: sessionID,
        location,
        agent: selected.agent,
        model: selected.model,
      })
      .pipe(Effect.uninterruptible);
    uncertain = false;
    if (created.parentID || created.projectID !== caller.projectID)
      return yield* new Tool.Error({
        message: "The server did not create the requested independent session.",
      });
    // The host decodes Standard Schema outputs and records the result metadata
    // as JSON. The session store materializes `workspaceID: undefined`, which the
    // encoded schema and the JSON record both reject, so omit the key.
    const { directory, workspaceID } = created.location;
    location =
      workspaceID === undefined
        ? Location.Ref.make({ directory })
        : Location.Ref.make({ directory, workspaceID });

    stage = "prompt";
    uncertain = true;
    yield* ctx.session
      .prompt({
        sessionID: created.id,
        id: SessionMessage.ID.create(),
        text: input.prompt,
      })
      .pipe(Effect.uninterruptible);
    uncertain = false;
    const output = Output.make({ sessionID: created.id, location, promptAccepted: true });
    const content = yield* Schema.encodeEffect(Schema.fromJsonString(Output))(output).pipe(
      Effect.orDie,
    );
    return { output, content, metadata: output };
  });

  return yield* run.pipe(
    Effect.mapError(
      (error) =>
        new Tool.Error({
          message:
            (error instanceof Error ? error.message : "Session creation failed.") +
            (stage === "validation" ? "" : " Inspect retained resources before retrying."),
          error,
          metadata: metadata(),
        }),
    ),
    Effect.tapCause((cause) => Effect.logError("session_create failed", cause, metadata())),
    Effect.onInterrupt(() =>
      Effect.logWarning("session_create interrupted during server shutdown", metadata()),
    ),
  );
});

export const makeSessionTool = Effect.fn("SessionTools.makeSessionTool")(function* (ctx: Client) {
  const scope = yield* Scope.Scope;
  return {
    name: "session_create",
    description:
      "Create and start a fresh, independent session in another worktree of this project. " +
      "By default create a new worktree from the current checkout's HEAD and inherit the " +
      "current agent, model, and variant independently. No conversation or uncommitted " +
      "files are copied. Returns after the prompt is accepted; results are not sent back. " +
      "On failure inspect any reported session or worktree before retrying.",
    input: ToolInput,
    output: ToolOutput,
    options: { codemode: false },
    execute: (input, tool) =>
      createSession(ctx, input, tool).pipe(
        // Creation belongs to the plugin scope, not the caller's tool fiber.
        Effect.forkIn(scope),
        Effect.flatMap(Fiber.join),
      ),
  } satisfies Tool.Info<typeof ToolInput, typeof ToolOutput>;
});
