/* oxlint-disable effecttsgo/any-unknown-in-error-context -- Public plugin operations erase failures. The tool boundary turns them into Tool.Error; defects remain visible. */
import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { SessionList } from "@opencode/schema/session-list";
import { optional } from "@opencode/schema/schema";
import { SessionInbox } from "@opencode/schema/session-inbox";
import { Tool } from "@opencode/schema/tool";
import { Effect, Fiber, Option, Schema, Scope, Semaphore } from "effect";

import { standardSchema } from "./standard-schema.js";

const Limit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }));
const Cursor = Schema.Struct({
  previous: Schema.String.pipe(optional),
  next: Schema.String.pipe(optional),
});
type Client = {
  session: Pick<
    Plugin.Context["session"],
    "get" | "list" | "prompt" | "wait" | "interrupt" | "remove"
  >;
  message: Pick<Plugin.Context["message"], "list">;
};

/** Reads belong to the invocation; mutations are supplied with plugin-scope ownership. */
function define<
  I extends Schema.ConstraintCodec<object, unknown>,
  O extends Schema.ConstraintCodec<unknown, unknown>,
>(
  name: string,
  description: string,
  input: I,
  output: O,
  read: (input: I["Type"], context: Tool.Context) => Effect.Effect<O["Type"], unknown>,
) {
  return {
    name,
    description,
    input: standardSchema(input),
    output: standardSchema(Schema.toEncoded(output)),
    options: { namespace: "session", codemode: true },
    execute: Effect.fn(`SessionTools.${name}`)(function* (value: I["Type"], context: Tool.Context) {
      const result = yield* read(value, context).pipe(
        Effect.mapError((error) =>
          Schema.is(Tool.Error)(error)
            ? error
            : new Tool.Error({
                message: error instanceof Error ? error.message : `Session ${name} failed.`,
                error,
              }),
        ),
      );
      const content = yield* Schema.encodeEffect(Schema.fromJsonString(output))(result).pipe(
        Effect.orDie,
      );
      const encoded = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(content).pipe(
        Effect.orDie,
      );
      return { output: encoded, content };
    }),
  } satisfies Tool.Info;
}

export function sessionTools(ctx: Client, scope: Scope.Scope): Tool.Info[] {
  // Serialize this plugin's conflicting mutations, without holding the permit during waits.
  // Native Session owns target execution and recursive removal. Scope shutdown interrupts
  // our callers and awaits owned fibers; no mutation is retried or rolled back here.
  const mutations = Semaphore.makeUnsafe(1);
  const owned = <A>(operation: Effect.Effect<A, unknown>, sessionID: Session.ID) =>
    operation.pipe(
      Effect.mapError((error) =>
        Schema.is(Tool.Error)(error)
          ? error
          : new Tool.Error({
              message:
                error instanceof Error
                  ? error.message
                  : "Session mutation failed; inspect the target before retrying.",
              error,
              metadata: { sessionID, outcomeUncertain: true },
            }),
      ),
      mutations.withPermits(1),
      Effect.onInterrupt(() =>
        Effect.logWarning("Session mutation interrupted during plugin shutdown", {
          sessionID,
          outcomeUncertain: true,
        }),
      ),
      Effect.forkIn(scope),
      Effect.flatMap(Fiber.join),
    );
  const independentTarget = Effect.fn("SessionTools.independentTarget")(function* (
    sessionID: Session.ID,
    context: Tool.Context,
  ) {
    let current: Session.ID | undefined = context.sessionID;
    const seen = new Set<Session.ID>();
    while (current !== undefined && !seen.has(current)) {
      if (current === sessionID)
        return yield* new Tool.Error({
          message: "Cannot wait for, interrupt, or delete the caller or its ancestors.",
        });
      seen.add(current);
      current = (yield* ctx.session.get({ sessionID: current })).parentID;
    }
    return yield* ctx.session.get({ sessionID });
  });
  return [
    define(
      "get",
      "Inspect a session's location, selections, parent, and last outcome. Omit sessionID for the caller.",
      Schema.Struct({ sessionID: Schema.optionalKey(Session.ID) }),
      Session.Info,
      (input, context) => ctx.session.get({ sessionID: input.sessionID ?? context.sessionID }),
    ),
    define(
      "send",
      "Send a user message to a session. Queue delivery is the default; steer delivers at the next safe step boundary. " +
        "Returns durable admission, not completion. Reuse messageID for a retry: the first accepted text and delivery win. " +
        "Omit sessionID for the caller; its queued message runs after the current work.",
      Schema.Struct({
        sessionID: Schema.optionalKey(Session.ID),
        text: Schema.String.check(Schema.isPattern(/\S/)),
        messageID: Schema.optionalKey(SessionMessage.ID),
        delivery: Schema.optionalKey(SessionInbox.Delivery),
      }),
      Schema.Struct({
        sessionID: Session.ID,
        messageID: SessionMessage.ID,
        accepted: Schema.Literal(true),
      }),
      (input, context) => {
        const sessionID = input.sessionID ?? context.sessionID;
        const messageID = input.messageID ?? SessionMessage.ID.create();
        return owned(
          ctx.session
            .prompt({
              sessionID,
              id: messageID,
              text: input.text,
              delivery: input.delivery ?? "queue",
            })
            .pipe(
              Effect.map((admission) => ({
                sessionID: admission.sessionID,
                messageID: admission.id,
                accepted: true as const,
              })),
              Effect.mapError(
                (error) =>
                  new Tool.Error({
                    message: `Message admission failed for session ${sessionID} (messageID: ${messageID}). Retry with this messageID or inspect the target.`,
                    error,
                    metadata: { sessionID, messageID, outcomeUncertain: true },
                  }),
              ),
            ),
          sessionID,
        );
      },
    ),
    define(
      "wait",
      "Wait for a different session to become idle, up to timeoutSeconds (default 30, maximum 300). " +
        "settled=false means the wait expired; timeout or cancellation does not interrupt the target. " +
        "A settled session may have failed or been interrupted; inspect its outcome. Rejects the caller and its ancestors.",
      Schema.Struct({
        sessionID: Session.ID,
        timeoutSeconds: Schema.optionalKey(
          Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 300 })),
        ),
      }),
      Schema.Struct({ sessionID: Session.ID, settled: Schema.Boolean, session: Session.Info }),
      Effect.fn("SessionTools.wait")(function* (input, context) {
        yield* independentTarget(input.sessionID, context);
        const result = yield* ctx.session
          .wait({ sessionID: input.sessionID })
          .pipe(Effect.timeoutOption(`${input.timeoutSeconds ?? 30} seconds`));
        const session = yield* ctx.session.get({ sessionID: input.sessionID });
        return { sessionID: input.sessionID, settled: Option.isSome(result), session };
      }),
    ),
    define(
      "interrupt",
      "Request interruption of a different session. Returns acknowledgment before cleanup finishes; use wait to observe settlement. " +
        "Pending queued prompts are retained. Rejects the caller and its ancestors.",
      Schema.Struct({ sessionID: Session.ID }),
      Schema.Struct({ sessionID: Session.ID, interrupted: Schema.Boolean }),
      (input, context) =>
        owned(
          Effect.gen(function* () {
            yield* independentTarget(input.sessionID, context);
            const result = yield* ctx.session.interrupt({
              sessionID: input.sessionID,
              continue: false,
            });
            return { sessionID: input.sessionID, interrupted: result.interrupted };
          }),
          input.sessionID,
        ),
    ),
    define(
      "delete",
      "Stop a different session, await its cleanup, and recursively delete it and its child sessions. " +
        "Keeps worktrees and files. Rejects the caller and its ancestors. On failure inspect remaining sessions before retrying.",
      Schema.Struct({ sessionID: Session.ID }),
      Schema.Struct({ sessionID: Session.ID, deleted: Schema.Literal(true) }),
      (input, context) =>
        owned(
          Effect.gen(function* () {
            yield* independentTarget(input.sessionID, context);
            yield* ctx.session.remove({ sessionID: input.sessionID });
            return { sessionID: input.sessionID, deleted: true as const };
          }),
          input.sessionID,
        ),
    ),
    define(
      "list",
      "Find sessions in the caller's project by title, parent, and update order. Defaults to 50 newest sessions. " +
        "Use the returned cursor.next or cursor.previous to page; a cursor preserves the original filters.",
      Schema.Struct({
        limit: Schema.optionalKey(Limit),
        order: Schema.optionalKey(Schema.Literals(["asc", "desc"])),
        search: Schema.optionalKey(Schema.String),
        parentID: Schema.optionalKey(Schema.NullOr(Session.ID)),
        cursor: Schema.optionalKey(SessionList.Cursor),
      }),
      Schema.Struct({ data: Schema.Array(Session.Info), cursor: Cursor }),
      Effect.fn("SessionTools.list")(function* (input, context) {
        if (input.cursor !== undefined) return yield* ctx.session.list(input);
        const caller = yield* ctx.session.get({ sessionID: context.sessionID });
        return yield* ctx.session.list({
          ...input,
          project: caller.projectID,
          limit: input.limit ?? 50,
        });
      }),
    ),
    define(
      "messages",
      "Read persisted messages from a session, including tool activity. Omit sessionID for the caller. " +
        "Defaults to 50 messages. Page with the returned cursor; omit order when using a cursor.",
      Schema.Struct({
        sessionID: Schema.optionalKey(Session.ID),
        limit: Schema.optionalKey(Limit),
        order: Schema.optionalKey(Schema.Literals(["asc", "desc"])),
        cursor: Schema.optionalKey(Schema.String),
      }),
      Schema.Struct({ data: Schema.Array(SessionMessage.Info), cursor: Cursor }),
      (input, context) =>
        ctx.message.list({
          ...input,
          sessionID: input.sessionID ?? context.sessionID,
          limit: input.limit ?? 50,
        }),
    ),
  ];
}
