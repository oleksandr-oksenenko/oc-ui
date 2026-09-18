import type { SessionInboxUser } from "@opencode/client";
import { Effect, Exit, Scope } from "effect";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";
import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createSessionReads } from "../../../../opencode/session-reads.ts";
import { createSessionInbox } from "./createSessionInbox.ts";

type Input = Parameters<typeof createSessionInbox>[0];
const message: SessionInboxUser = {
  id: "message",
  sessionID: "session",
  timeCreated: 1,
  type: "user",
  delivery: "queue",
  payload: { text: "Next task" },
};
function setup(mutate: Input["api"]["session"]["inbox"]["cancel"] = async () => undefined) {
  return withTestWorkspace((effects) => {
    const [selectedID, select] = createSignal<string | undefined>("session");
    const [items, setItems] = createSignal<readonly SessionInboxUser[]>([message]);
    const [connected, connect] = createSignal(true);
    const cancel = vi.fn<typeof mutate>(mutate);
    const steer = vi.fn<typeof mutate>(mutate);
    const sync = vi.fn<Input["data"]["session"]["pending"]["sync"]>(async () => undefined);
    const invalidate = vi.fn<(id: string) => void>();
    const inbox = createSessionInbox({
      effects,
      selectedID,
      connected,
      reads: createSessionReads(),
      data: {
        session: {
          pending: {
            list: (id) => items().filter((item) => item.sessionID === id),
            sync,
            invalidate,
          },
        },
      },
      api: {
        session: { inbox: { cancel, steer, list: async () => [], queue: async () => undefined } },
      },
    });
    return { effects, inbox, select, setItems, connect, cancel, steer, sync, invalidate };
  });
}
describe("session inbox actions", () => {
  it("keeps the captured session through selection changes and suppresses conflicting actions", async () => {
    let finish!: () => void;
    const root = setup(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const request = root.inbox.steer(message.id);
    await vi.waitFor(() => expect(root.steer).toHaveBeenCalledOnce());
    await root.inbox.cancel(message.id);
    expect(root.cancel).not.toHaveBeenCalled();
    root.select("other");
    expect(root.inbox.messages()).toEqual([]);
    finish();
    await request;
    expect(root.steer.mock.calls[0]?.[0]).toEqual({ sessionID: "session", inboxID: message.id });
    expect(root.sync).toHaveBeenCalledWith("session");
    expect(root.inbox.busy()).toBe(false);
    root.select("session");
    expect(root.inbox.messages()[0]?.delivery).toBe("queue");
    root.setItems([{ ...message, delivery: "steer" }]);
    expect(root.inbox.messages()[0]?.delivery).toBe("steer");
  });
  it("refreshes after a delivery conflict without retrying or locally removing the message", async () => {
    const root = setup(async () => {
      throw new Error("already delivered");
    });
    root.sync.mockImplementation(async () => {
      root.setItems([]);
    });
    await root.inbox.cancel(message.id);
    expect(root.cancel).toHaveBeenCalledOnce();
    expect(root.invalidate).toHaveBeenCalledWith("session");
    expect(root.inbox.messages()).toEqual([]);
    expect(root.inbox.error()).toContain("may already have been delivered");
    root.select("other");
    expect(root.inbox.error()).toBeUndefined();
  });
  it("recovers a failed refresh and rejects disconnected or obsolete actions", async () => {
    const root = setup();
    root.sync.mockRejectedValueOnce(new Error("offline"));
    await root.inbox.steer(message.id);
    expect(root.inbox.error()).toContain("Couldn't refresh");
    await root.inbox.refresh();
    expect(root.inbox.error()).toBeUndefined();
    root.connect(false);
    await root.inbox.cancel(message.id);
    root.connect(true);
    root.setItems([]);
    await root.inbox.cancel(message.id);
    expect(root.cancel).not.toHaveBeenCalled();
  });
  it("aborts external work and retains the workspace until it settles during shutdown", async () => {
    let finish!: () => void;
    let signal: AbortSignal | undefined;
    const root = setup((_input, options) => {
      signal = options?.signal;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const request = root.inbox.cancel(message.id).catch(() => undefined);
    await vi.waitFor(() => expect(signal).toBeDefined());
    let closed = false;
    const closing = Effect.runPromise(Scope.close(root.effects.scope, Exit.void)).then(() => {
      closed = true;
      return undefined;
    });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(closed).toBe(false);
    finish();
    await closing;
    await request;
    expect(closed).toBe(true);
    expect(root.sync).not.toHaveBeenCalled();
  });
});
