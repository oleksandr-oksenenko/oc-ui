import { it } from "@effect/vitest";
import { Agent } from "@opencode-ai/schema/agent";
import { Location } from "@opencode-ai/schema/location";
import { Model } from "@opencode-ai/schema/model";
import { Provider } from "@opencode-ai/schema/provider";
import { Project } from "@opencode-ai/schema/project";
import { Session } from "@opencode-ai/schema/session";
import { SessionInbox } from "@opencode-ai/schema/session-inbox";
import { SessionMessage } from "@opencode-ai/schema/session-message";
import { Tool } from "@opencode-ai/schema/tool";
import { Workspace } from "@opencode-ai/schema/workspace";
import { Worktree } from "@opencode-ai/schema/worktree";
import { DateTime, Deferred, Effect, Exit, Fiber, Result, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, vi } from "vite-plus/test";

import { Input, makeSessionTool } from "./session-create.js";

type Client = Parameters<typeof makeSessionTool>[0];
const source = Schema.decodeSync(Location.Info)({
  directory: "/project",
  project: { id: "git-project", directory: "/project", canonical: "/project" },
});
const destination = new Location.Info({
  directory: Location.Ref.fields.directory.make("/worktrees/new"),
  project: { ...source.project, directory: Location.Ref.fields.directory.make("/worktrees/new") },
});
const model = Model.Ref.parse("test/model#high");
const caller = Schema.decodeSync(Session.Info)({
  id: Session.ID.create(),
  projectID: "git-project",
  agent: "build",
  model,
  location: { directory: "/project" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
});
const toolContext: Tool.Context = {
  sessionID: caller.id,
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.create(),
  id: Tool.CallID.make("call-create"),
  progress: () => Effect.void,
};

function fixture() {
  const agents = ["build", "plan"].map((name) => Agent.Info.default(Agent.ID.make(name)));
  const models = ["model", "alternate"].map((id) => ({
    ...Model.Info.default(Provider.ID.make("test"), Model.ID.make(id)),
    variants: [{ id: Model.VariantID.make("high") }, { id: Model.VariantID.make("low") }],
  }));
  const create = vi.fn<Client["session"]["create"]>((input) =>
    Effect.succeed({
      ...caller,
      id: input?.id ?? Session.ID.create(),
      // The server's session store materializes workspaceID even when undefined.
      location: Location.Ref.make({
        directory: input?.location?.directory ?? caller.location.directory,
        workspaceID: input?.location?.workspaceID,
      }),
      model: input?.model,
      agent: input?.agent,
    }),
  );
  const prompt = vi.fn<Client["session"]["prompt"]>((input) =>
    Effect.succeed(
      SessionInbox.User.make({
        id: input.id ?? SessionMessage.ID.create(),
        sessionID: input.sessionID,
        timeCreated: DateTime.makeUnsafe(0),
        delivery: "queue",
        payload: { text: input.text, files: [], agents: [], skills: [] },
      }),
    ),
  );
  const worktree = vi.fn<Client["worktree"]["create"]>(() =>
    Effect.succeed({ directory: destination.directory }),
  );
  const context = vi.fn<Client["session"]["context"]>(() => Effect.succeed([]));
  const ctx: Client = {
    session: { get: () => Effect.succeed(caller), context, create, prompt },
    worktree: {
      create: worktree,
      refresh: () => Effect.void,
      list: () =>
        Effect.succeed([
          { directory: source.directory },
          { directory: destination.directory, strategy: "git" },
        ]),
    },
    agent: {
      list: (input) =>
        Effect.succeed({
          location: input?.location?.directory === source.directory ? source : destination,
          data: agents,
        }),
    },
    catalog: { model: { list: () => Effect.succeed({ location: source, data: models }) } },
  };
  return { ctx, create, prompt, worktree, context };
}

describe("session_create", () => {
  it.effect("exposes Standard Schema without leaking Effect parser internals", () =>
    Effect.gen(function* () {
      const tool = yield* makeSessionTool(fixture().ctx);
      expect(Schema.isSchema(tool.input)).toBe(false);
      const parsed = yield* Effect.promise(() =>
        Promise.resolve(tool.input["~standard"].validate({ prompt: "Task" })),
      );
      expect(parsed).toEqual({ value: { prompt: "Task" } });
      expect(tool.input["~standard"].jsonSchema.input({ target: "draft-07" })).toHaveProperty(
        "properties.prompt",
      );
    }),
  );

  it.effect("returns the JSON location shape the host validates and records", () =>
    Effect.gen(function* () {
      const tool = yield* makeSessionTool(fixture().ctx);
      const result = yield* tool.execute({ prompt: "Task" }, toolContext);
      expect(Schema.isSchema(tool.output)).toBe(false);
      // The host's Standard Schema output branch decodes the execute result.
      const validated = yield* Effect.promise(() =>
        Promise.resolve(tool.output["~standard"].validate(result.output)),
      );
      expect(validated).toEqual({ value: result.output });
      expect(Object.hasOwn(result.output.location, "workspaceID")).toBe(false);
      expect(
        tool.output["~standard"].jsonSchema.output({ target: "draft-2020-12" }),
      ).toHaveProperty("properties.sessionID");
      // The host records the result metadata inside a JSON event.
      yield* Schema.encodeUnknownEffect(Schema.Record(Schema.String, Schema.Json))(
        result.metadata ?? {},
      );
    }),
  );

  it.effect("reports the server's location and preserves a defined workspace ID", () =>
    Effect.gen(function* () {
      const f = fixture();
      const directory = Location.Ref.fields.directory.make("/worktrees/canonical");
      const workspaceID = Workspace.ID.create();
      f.ctx.session = {
        ...f.ctx.session,
        create: (input) =>
          Effect.succeed({
            ...caller,
            id: input?.id ?? Session.ID.create(),
            location: Location.Ref.make({ directory, workspaceID }),
            model: input?.model,
            agent: input?.agent,
          }),
      };
      const tool = yield* makeSessionTool(f.ctx);
      const result = yield* tool.execute({ prompt: "Task" }, toolContext);
      expect(result.output.location).toEqual({ directory, workspaceID });
    }),
  );

  it.effect("waits for a new location's agents to initialize before creating its session", () =>
    Effect.gen(function* () {
      const f = fixture();
      const list = f.ctx.agent.list;
      let reads = 0;
      f.ctx.agent = {
        list: (input) =>
          Effect.suspend(() => {
            if (input?.location?.directory === destination.directory && reads++ === 0)
              return Effect.succeed({ location: destination, data: [] });
            // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- The fake upstream call succeeds; unexpected failures are test defects.
            return list(input).pipe(Effect.orDie);
          }),
      };
      const tool = yield* makeSessionTool(f.ctx);
      const running = yield* tool.execute({ prompt: "Task" }, toolContext).pipe(Effect.forkChild);
      yield* TestClock.adjust("200 millis");
      yield* Fiber.join(running);
      expect(reads).toBe(2);
      expect(f.worktree).toHaveBeenCalledOnce();
      expect(f.create).toHaveBeenCalledOnce();
    }),
  );

  it.effect(
    "creates from the caller's HEAD with independent selections and only the new prompt",
    () =>
      Effect.gen(function* () {
        const f = fixture();
        const tool = yield* makeSessionTool(f.ctx);
        const result = yield* tool.execute({ prompt: "New task" }, toolContext);
        expect(f.worktree).toHaveBeenCalledWith({
          location: { directory: source.directory, workspace: undefined },
          from: source.project.directory,
          strategy: Worktree.StrategyID.make("git"),
          branch: "HEAD",
        });
        expect(f.create).toHaveBeenCalledWith({
          id: result.output.sessionID,
          location: { directory: destination.directory },
          agent: caller.agent,
          model,
        });
        expect(f.prompt).toHaveBeenCalledOnce();
        expect(f.prompt.mock.calls[0]?.[0]).toMatchObject({
          sessionID: result.output.sessionID,
          text: "New task",
        });
        expect(result.output.promptAccepted).toBe(true);
      }),
  );

  it.effect("overrides agent without changing the inherited model or variant", () =>
    Effect.gen(function* () {
      const f = fixture();
      const tool = yield* makeSessionTool(f.ctx);
      yield* tool.execute(
        { prompt: "Review", agent: "plan", worktree: { create: { baseRef: "feature" } } },
        toolContext,
      );
      expect(f.create.mock.calls[0]?.[0]).toMatchObject({ agent: "plan", model });
      expect(f.worktree.mock.calls[0]?.[0]?.branch).toBe("feature");
    }),
  );

  it.effect("overrides model and variant independently in an existing worktree", () =>
    Effect.gen(function* () {
      const f = fixture();
      const tool = yield* makeSessionTool(f.ctx);
      yield* tool.execute(
        {
          prompt: "Review",
          model: { providerID: "test", modelID: "alternate" },
          worktree: { existing: { directory: destination.directory } },
        },
        toolContext,
      );
      expect(f.worktree).not.toHaveBeenCalled();
      expect(f.create.mock.calls[0]?.[0]).toMatchObject({
        agent: "build",
        model: { id: "alternate", variant: "high" },
      });
      yield* tool.execute({ prompt: "Review", variant: "low" }, toolContext);
      expect(f.create.mock.calls[1]?.[0]).toMatchObject({ model: { id: "model", variant: "low" } });
    }),
  );

  it.effect("rejects an incompatible variant before creating resources", () =>
    Effect.gen(function* () {
      const f = fixture();
      const tool = yield* makeSessionTool(f.ctx);
      const result = yield* tool
        .execute({ prompt: "Review", variant: "unsupported" }, toolContext)
        .pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(Object.hasOwn(result.failure.metadata ?? {}, "location")).toBe(false);
        expect(Object.hasOwn(result.failure.metadata ?? {}, "sessionID")).toBe(false);
        yield* Schema.encodeUnknownEffect(Schema.Record(Schema.String, Schema.Json))(
          result.failure.metadata ?? {},
        );
      }
      expect(f.worktree).not.toHaveBeenCalled();
      expect(f.create).not.toHaveBeenCalled();
    }),
  );

  it.effect("rejects another project and the caller's own checkout", () =>
    Effect.gen(function* () {
      for (const location of [
        source,
        new Location.Info({
          directory: destination.directory,
          project: { ...destination.project, id: Project.ID.make("other") },
        }),
      ]) {
        const f = fixture();
        f.ctx.agent = {
          list: (input) =>
            Effect.succeed({
              location: input?.location?.directory === source.directory ? source : location,
              data: [Agent.Info.default(Agent.ID.make("build"))],
            }),
        };
        const tool = yield* makeSessionTool(f.ctx);
        const result = yield* tool
          .execute(
            { prompt: "Task", worktree: { existing: { directory: location.directory } } },
            toolContext,
          )
          .pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(Object.hasOwn(result.failure.metadata ?? {}, "sessionID")).toBe(false);
          yield* Schema.encodeUnknownEffect(Schema.Record(Schema.String, Schema.Json))(
            result.failure.metadata ?? {},
          );
        }
        expect(f.create).not.toHaveBeenCalled();
      }
    }),
  );

  it.effect("reports retained resources when the initial prompt fails without retrying", () =>
    Effect.gen(function* () {
      const f = fixture();
      f.prompt.mockImplementation(() =>
        Effect.fail(new Tool.Error({ message: "prompt rejected" })),
      );
      const tool = yield* makeSessionTool(f.ctx);
      const result = yield* tool.execute({ prompt: "Task" }, toolContext).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.metadata).toMatchObject({
          stage: "prompt",
          uncertain: true,
          sessionID: f.create.mock.calls[0]?.[0]?.id,
          location: { directory: destination.directory },
        });
        yield* Schema.encodeUnknownEffect(Schema.Record(Schema.String, Schema.Json))(
          result.failure.metadata ?? {},
        );
      }
      expect(f.prompt).toHaveBeenCalledOnce();
      expect(f.create).toHaveBeenCalledOnce();
    }),
  );

  it.effect("reports an uncertain worktree failure and never creates a session", () =>
    Effect.gen(function* () {
      const f = fixture();
      f.worktree.mockImplementation(() =>
        Effect.fail(new Tool.Error({ message: "startup command failed" })),
      );
      const tool = yield* makeSessionTool(f.ctx);
      const result = yield* tool.execute({ prompt: "Task" }, toolContext).pipe(Effect.result);
      if (Result.isFailure(result)) {
        expect(result.failure.metadata).toMatchObject({ stage: "worktree", uncertain: true });
        expect(Object.hasOwn(result.failure.metadata ?? {}, "sessionID")).toBe(false);
        yield* Schema.encodeUnknownEffect(Schema.Record(Schema.String, Schema.Json))(
          result.failure.metadata ?? {},
        );
      } else throw new Error("Expected failure");
      expect(f.create).not.toHaveBeenCalled();
    }),
  );

  it.effect("finishes owned creation after the caller is interrupted", () =>
    Effect.gen(function* () {
      const f = fixture();
      const started = yield* Deferred.make<void>();
      const ready = yield* Deferred.make<void>();
      const prompted = yield* Deferred.make<void>();
      f.worktree.mockImplementation(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(ready)),
          Effect.as({ directory: destination.directory }),
        ),
      );
      f.ctx.session = {
        ...f.ctx.session,
        prompt: (input) =>
          // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- This success-only fake shares the upstream signature; unexpected failures are defects in this test.
          f.prompt(input).pipe(
            Effect.orDie,
            Effect.tap(() => Deferred.succeed(prompted, undefined)),
          ),
      };
      const tool = yield* makeSessionTool(f.ctx);
      const callerFiber = yield* tool
        .execute({ prompt: "Task" }, toolContext)
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(callerFiber);
      expect(f.create).not.toHaveBeenCalled();
      yield* Deferred.succeed(ready, undefined);
      yield* Deferred.await(prompted);
      expect(f.create).toHaveBeenCalledOnce();
    }),
  );

  it.effect("settles worktree cleanup on plugin shutdown without starting a session", () =>
    Effect.gen(function* () {
      const f = fixture();
      const scope = yield* Scope.make();
      const started = yield* Deferred.make<void>();
      const cleaned = yield* Deferred.make<void>();
      f.worktree.mockImplementation(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(cleaned, undefined)),
        ),
      );
      const tool = yield* makeSessionTool(f.ctx).pipe(Scope.provide(scope));
      const running = yield* tool.execute({ prompt: "Task" }, toolContext).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Scope.close(scope, Exit.void);
      expect(yield* Deferred.isDone(cleaned)).toBe(true);
      expect(Exit.isFailure(yield* Fiber.await(running))).toBe(true);
      expect(f.create).not.toHaveBeenCalled();
    }),
  );

  it("rejects conflicting worktree choices, blank prompts and relative destinations", () => {
    for (const input of [
      { prompt: " " },
      { prompt: "Task", worktree: { existing: { directory: "relative" } } },
      { prompt: "Task", worktree: { create: {}, existing: { directory: "/project" } } },
    ])
      expect(() => Schema.decodeUnknownSync(Input)(input)).toThrow();
  });
});
