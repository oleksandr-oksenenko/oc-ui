import { it } from "@effect/vitest";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { SessionList } from "@opencode/schema/session-list";
import { Tool } from "@opencode/schema/tool";
import { Agent } from "@opencode/schema/agent";
import { SessionInbox } from "@opencode/schema/session-inbox";
import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, vi } from "vite-plus/test";

import { sessionTools } from "./session-tools.js";

class HostError extends Schema.TaggedError<HostError>()("HostError", { message: Schema.String }) {}

const caller = Schema.decodeSync(Session.Info)({
  id: Session.ID.create(),
  projectID: "project",
  location: { directory: "/project" },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
});
const context: Tool.Context = {
  sessionID: caller.id,
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.create(),
  id: Tool.CallID.make("reads"),
  progress: () => Effect.void,
};

function fixture(scope: Scope.Scope) {
  const get = vi.fn((input: { sessionID: Session.ID }) =>
    Effect.succeed({ ...caller, id: input.sessionID }),
  );
  const list = vi.fn(() =>
    Effect.succeed({
      data: [caller],
      cursor: { next: Schema.decodeSync(SessionList.Cursor)("next"), previous: undefined },
    }),
  );
  const messages = vi.fn(() => Effect.succeed({ data: [], cursor: {} }));
  const prompt = vi.fn(
    (input: Parameters<Parameters<typeof sessionTools>[0]["session"]["prompt"]>[0]) =>
      Effect.succeed(
        Schema.decodeSync(SessionInbox.User)({
          id: input.id ?? SessionMessage.ID.create(),
          sessionID: input.sessionID,
          timeCreated: 1,
          type: "user",
          delivery: input.delivery ?? "steer",
          payload: { text: input.text },
        }),
      ),
  );
  const wait = vi.fn(() => Effect.void);
  const interrupt = vi.fn(() => Effect.succeed({ interrupted: true }));
  const remove = vi.fn(() => Effect.void);
  const client = {
    session: { get, list, prompt, wait, interrupt, remove },
    message: { list: messages },
  };
  const tools = sessionTools(client, scope);
  return { get, list, messages, prompt, wait, interrupt, remove, client, tools };
}

function named(tools: Tool.Info[], name: string): Tool.Info {
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`Missing ${name}`);
  return tool;
}

describe("session reads", () => {
  it.effect(
    "preserves project filters on the first page and uses the server cursor on later pages",
    () =>
      Effect.gen(function* () {
        const f = fixture(yield* Scope.Scope);
        const list = named(f.tools, "list");
        const result = yield* list.execute({ search: "Task" }, context);
        expect(f.list).toHaveBeenCalledWith({
          project: caller.projectID,
          search: "Task",
          limit: 50,
        });
        expect(result.output).toMatchObject({
          data: [{ time: { created: 1, updated: 2 } }],
          cursor: { next: "next" },
        });
        expect(result.output.data[0].location).toEqual({ directory: "/project" });
        expect(result.output.cursor).not.toHaveProperty("previous");
        yield* list.execute({ cursor: "next", limit: 2 }, context);
        expect(f.list).toHaveBeenLastCalledWith({ cursor: "next", limit: 2 });
        expect(f.get).toHaveBeenCalledOnce();
      }),
  );

  it.effect("uses the caller for omitted message targets and forwards opaque cursors", () =>
    Effect.gen(function* () {
      const f = fixture(yield* Scope.Scope);
      const messages = named(f.tools, "messages");
      yield* messages.execute({}, context);
      expect(f.messages).toHaveBeenCalledWith({ sessionID: caller.id, limit: 50 });
      const target = Session.ID.create();
      yield* messages.execute({ sessionID: target, cursor: "next", limit: 3 }, context);
      expect(f.messages).toHaveBeenLastCalledWith({ sessionID: target, cursor: "next", limit: 3 });
    }),
  );

  it.effect("cancels the native read when its invocation is interrupted", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let released = false;
      const read = Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined);
        return yield* Effect.never;
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            released = true;
          }),
        ),
      );
      const scope = yield* Scope.Scope;
      const f = fixture(scope);
      const tools = sessionTools(
        {
          session: { ...f.client.session, list: () => read },
          message: { list: f.messages },
        },
        scope,
      );
      const running = yield* named(tools, "list").execute({}, context).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(running);
      expect(released).toBe(true);
    }),
  );
});

describe("session management", () => {
  it.effect(
    "gets the caller with complete encoded metadata and sends durable queue admissions",
    () =>
      Effect.gen(function* () {
        const f = fixture(yield* Scope.Scope);
        expect((yield* named(f.tools, "get").execute({}, context)).output).toMatchObject({
          id: caller.id,
          time: { updated: 2 },
          location: { directory: "/project" },
        });
        const messageID = SessionMessage.ID.create();
        const sent = yield* named(f.tools, "send").execute(
          { text: "follow up", messageID },
          context,
        );
        expect(f.prompt).toHaveBeenCalledWith({
          sessionID: caller.id,
          id: messageID,
          text: "follow up",
          delivery: "queue",
        });
        expect(sent.output).toEqual({
          sessionID: caller.id,
          messageID,
          accepted: true,
        });
        yield* named(f.tools, "send").execute(
          { text: "steer", delivery: "steer", sessionID: Session.ID.create() },
          context,
        );
        expect(f.prompt.mock.calls[1]?.[0].delivery).toBe("steer");
        expect(f.prompt.mock.calls[1]?.[0].id).toBeDefined();
      }),
  );

  it.effect("bounds waits and cancels only the native waiter on timeout", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const f = fixture(scope);
      const started = yield* Deferred.make<void>();
      let released = false;
      const tools = sessionTools(
        {
          ...f.client,
          session: {
            ...f.client.session,
            wait: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.onInterrupt(() =>
                  Effect.sync(() => {
                    released = true;
                  }),
                ),
              ),
          },
        },
        scope,
      );
      const target = Session.ID.create();
      const running = yield* named(tools, "wait")
        .execute({ sessionID: target, timeoutSeconds: 1 }, context)
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust("1 second");
      expect((yield* Fiber.join(running)).output).toMatchObject({
        sessionID: target,
        settled: false,
      });
      expect(released).toBe(true);
      expect(f.interrupt).not.toHaveBeenCalled();
    }),
  );

  it.effect("rejects dependent waits and recursive deletion before mutations", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const f = fixture(scope);
      const parentID = Session.ID.create();
      const tools = sessionTools(
        {
          ...f.client,
          session: {
            ...f.client.session,
            get: (input) =>
              Effect.succeed({
                ...caller,
                id: input.sessionID,
                parentID: input.sessionID === caller.id ? parentID : undefined,
              }),
          },
        },
        scope,
      );
      for (const name of ["wait", "interrupt", "delete"]) {
        for (const sessionID of [caller.id, parentID]) {
          const error = yield* named(tools, name).execute({ sessionID }, context).pipe(Effect.flip);
          expect(error).toMatchObject({
            _tag: "Tool.Error",
            message: expect.stringContaining("ancestors"),
          });
        }
      }
      expect(f.remove).not.toHaveBeenCalled();
      expect(f.interrupt).not.toHaveBeenCalled();
      expect(f.wait).not.toHaveBeenCalled();
    }),
  );

  it.effect(
    "keeps an admission owned after caller interruption and orders later deletion behind it",
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const f = fixture(scope);
        const started = yield* Deferred.make<void>();
        const admission = yield* Deferred.make<void>();
        const target = Session.ID.create();
        const tools = sessionTools(
          {
            ...f.client,
            session: {
              ...f.client.session,
              prompt: (input) =>
                Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Deferred.await(admission)),
                  Effect.andThen(f.prompt(input)),
                ),
            },
          },
          scope,
        );
        const sending = yield* named(tools, "send")
          .execute({ sessionID: target, text: "work" }, context)
          .pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(sending);
        const deleting = yield* named(tools, "delete")
          .execute({ sessionID: target }, context)
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        expect(f.remove).not.toHaveBeenCalled();
        yield* Deferred.succeed(admission, undefined);
        expect((yield* Fiber.join(deleting)).output).toEqual({ sessionID: target, deleted: true });
        expect(f.prompt).toHaveBeenCalledOnce();
        expect(f.remove).toHaveBeenCalledOnce();
      }),
  );

  it.effect("returns a retry ID on failed admission and never retries partial deletion", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const f = fixture(scope);
      const remove = vi.fn(() => Effect.fail(new HostError({ message: "child removal failed" })));
      const tools = sessionTools(
        {
          ...f.client,
          session: {
            ...f.client.session,
            prompt: () => Effect.fail(new HostError({ message: "admission failed" })),
            remove,
          },
        },
        scope,
      );
      const target = Session.ID.create();
      const messageID = SessionMessage.ID.create();
      const send = yield* named(tools, "send")
        .execute({ sessionID: target, text: "work", messageID }, context)
        .pipe(Effect.flip);
      expect(send).toMatchObject({
        metadata: { sessionID: target, messageID, outcomeUncertain: true },
      });
      expect(send.message).toContain(target);
      expect(send.message).toContain(messageID);
      const deleted = yield* named(tools, "delete")
        .execute({ sessionID: target }, context)
        .pipe(Effect.flip);
      expect(deleted).toMatchObject({
        message: "child removal failed",
        metadata: { sessionID: target, outcomeUncertain: true },
      });
      expect(remove).toHaveBeenCalledOnce();
    }),
  );

  it.effect("awaits mutation cleanup and settles callers when the plugin scope closes", () =>
    Effect.gen(function* () {
      const owner = yield* Scope.make();
      const f = fixture(owner);
      const started = yield* Deferred.make<void>();
      const cleanup = yield* Deferred.make<void>();
      let cleaned = false;
      const tools = sessionTools(
        {
          ...f.client,
          session: {
            ...f.client.session,
            remove: () =>
              Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(
                  Deferred.await(cleanup).pipe(
                    Effect.andThen(
                      Effect.sync(() => {
                        cleaned = true;
                      }),
                    ),
                  ),
                ),
              ),
          },
        },
        owner,
      );
      const deleting = yield* named(tools, "delete")
        .execute({ sessionID: Session.ID.create() }, context)
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      const closing = yield* Scope.close(owner, Exit.succeed(undefined)).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(cleaned).toBe(false);
      yield* Deferred.succeed(cleanup, undefined);
      yield* Fiber.join(closing);
      expect(cleaned).toBe(true);
      const exit = yield* Fiber.await(deleting);
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
    }),
  );
});
