import { createData } from "@opencode/client/solid";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";

const sessionID = "ses_inbox";
const item = {
  id: "msg_inbox",
  sessionID,
  timeCreated: 1,
  type: "user",
  delivery: "queue",
  payload: { text: "Pending task" },
};

function fixture() {
  const requests = [];
  let emit;
  let dispose;
  let setConnection;
  const list = vi.fn((input, options = {}) => {
    const response = Promise.withResolvers();
    requests.push({ ...response, sessionID: input.sessionID, signal: options.signal });
    // Deliberately ignore abort: a boundary may already have received a response.
    return response.promise;
  });
  const data = createRoot((cleanup) => {
    dispose = cleanup;
    const [status, setStatus] = createSignal("connected");
    setConnection = setStatus;
    return createData({
      api: () => ({ session: { inbox: { list }, prompt: async () => item } }),
      directory: "/inbox-fixture",
      connection: { status },
      event: {
        on: () => () => {},
        listen: (handler) => {
          emit = (type, payload) =>
            handler({ name: type, details: { type, id: "evt_inbox", created: 2, data: payload } });
          return () => {};
        },
      },
    });
  });
  const enqueue = (value = item) =>
    emit("session.inbox.enqueued", {
      sessionID: value.sessionID,
      inboxID: value.id,
      item: { type: value.type, delivery: value.delivery, payload: value.payload },
    });
  return { data, requests, list, enqueue, emit, dispose, setConnection };
}

describe("pinned SDK inbox snapshot reconciliation", () => {
  it.each(["enqueue", "cancel", "deliver", "steer", "revert"])(
    "discards an older snapshot after %s without regressing live state",
    async (change) => {
      const f = fixture();
      try {
        if (change !== "enqueue") f.enqueue();
        const reading = f.data.session.pending.sync(sessionID);
        if (change === "enqueue") f.enqueue();
        else if (change === "revert")
          f.emit("session.revert.committed", { sessionID, to: item.id });
        else
          f.emit(
            change === "steer"
              ? "session.inbox.delivery.changed"
              : change === "deliver"
                ? "session.inbox.delivered"
                : "session.inbox.cancelled",
            { sessionID, inboxID: item.id, delivery: "steer" },
          );
        const live = f.data.session.pending.list(sessionID).map((row) => ({ ...row }));
        f.requests[0].resolve(change === "enqueue" ? [] : [item]);
        await vi.waitFor(() => expect(f.list).toHaveBeenCalledTimes(2));
        expect(f.data.session.pending.list(sessionID)).toEqual(live);
        f.requests[1].resolve(live);
        await reading;
        expect(f.data.session.pending.list(sessionID)).toEqual(live);
        if (change === "enqueue") expect(f.data.session.input.has(sessionID, item.id)).toBe(true);
        if (change === "cancel" || change === "revert")
          expect(f.data.session.message.list(sessionID)).toEqual([]);
      } finally {
        f.dispose();
      }
    },
  );

  it("coalesces callers and commits one unchanged snapshot", async () => {
    const f = fixture();
    try {
      const first = f.data.session.pending.sync(sessionID);
      const second = f.data.session.pending.sync(sessionID);
      expect(f.list).toHaveBeenCalledTimes(1);
      f.requests[0].resolve([item]);
      await Promise.all([first, second]);
      expect(f.data.session.pending.list(sessionID)).toEqual([item]);
      await f.data.session.pending.sync(sessionID);
      expect(f.list).toHaveBeenCalledTimes(1);
    } finally {
      f.dispose();
    }
  });

  it("rereads multiple dirty rounds without publishing intermediate snapshots", async () => {
    const f = fixture();
    try {
      const reading = f.data.session.pending.sync(sessionID);
      f.enqueue();
      f.requests[0].resolve([]);
      await vi.waitFor(() => expect(f.list).toHaveBeenCalledTimes(2));
      f.emit("session.inbox.delivery.changed", { sessionID, inboxID: item.id, delivery: "steer" });
      f.requests[1].resolve([item]);
      await vi.waitFor(() => expect(f.list).toHaveBeenCalledTimes(3));
      expect(f.data.session.pending.list(sessionID)[0].delivery).toBe("steer");
      f.requests[2].resolve([{ ...item, delivery: "steer" }]);
      await reading;
      expect(f.data.session.pending.list(sessionID)[0].delivery).toBe("steer");
    } finally {
      f.dispose();
    }
  });

  it("preserves live state after a replacement failure and permits retry", async () => {
    const f = fixture();
    try {
      const reading = f.data.session.pending.sync(sessionID);
      const rejected = expect(reading).rejects.toThrow("read failed");
      f.enqueue();
      f.requests[0].resolve([]);
      await vi.waitFor(() => expect(f.list).toHaveBeenCalledTimes(2));
      f.requests[1].reject(new Error("read failed"));
      await rejected;
      expect(f.data.session.input.has(sessionID, item.id)).toBe(true);
      const retry = f.data.session.pending.sync(sessionID);
      f.requests[2].resolve([item]);
      await retry;
      expect(f.list).toHaveBeenCalledTimes(3);
    } finally {
      f.dispose();
    }
  });

  it.each(["success", "failure"])(
    "owns a fresh read during failed-read settlement and preserves its %s",
    async (outcome) => {
      const f = fixture();
      try {
        let firstSettled = false;
        let freshSettled = false;
        const firstError = new Error("First read failed");
        const freshError = new Error("Fresh read failed");
        const first = f.data.session.pending.sync(sessionID).catch((error) => {
          firstSettled = true;
          return error;
        });
        const started = Promise.withResolvers();
        void f.requests[0].promise.catch(() => {
          // Enter after createSync's failed entry is removed, before the
          // public read's outer token-cleanup reaction. No clock delay is used.
          queueMicrotask(() =>
            queueMicrotask(() => {
              const result = f.data.session.pending.sync(sessionID).then(
                () => {
                  freshSettled = true;
                  return { status: "success" };
                },
                (error) => {
                  freshSettled = true;
                  return { status: "failure", error };
                },
              );
              started.resolve({ result, firstSettled });
            }),
          );
        });
        f.requests[0].reject(firstError);
        const fresh = await started.promise;
        expect(f.list).toHaveBeenCalledTimes(2);
        expect(fresh.firstSettled).toBe(false);
        expect(await first).toBe(firstError);
        expect(freshSettled).toBe(false);
        if (outcome === "success") f.requests[1].resolve([item]);
        else f.requests[1].reject(freshError);
        expect(await fresh.result).toEqual(
          outcome === "success" ? { status: "success" } : { status: "failure", error: freshError },
        );
        expect(f.data.session.pending.list(sessionID)).toEqual(outcome === "success" ? [item] : []);
      } finally {
        f.dispose();
      }
    },
  );

  it("retains unacknowledged optimistic admission across a read", async () => {
    const f = fixture();
    try {
      const reading = f.data.session.pending.sync(sessionID);
      await f.data.session.prompt({ sessionID, id: item.id, text: item.payload.text });
      f.requests[0].resolve([]);
      await reading;
      expect(f.data.session.input.has(sessionID, item.id)).toBe(true);
      expect(f.list).toHaveBeenCalledTimes(1);
    } finally {
      f.dispose();
    }
  });

  it("retires an invalidated GET and serializes its requested replacement", async () => {
    const f = fixture();
    try {
      const first = f.data.session.pending.sync(sessionID);
      f.data.session.pending.invalidate(sessionID);
      const replacement = f.data.session.pending.sync(sessionID);
      expect(f.requests[0].signal.aborted).toBe(true);
      expect(f.list).toHaveBeenCalledTimes(1);
      f.requests[0].resolve([item]);
      await first;
      await vi.waitFor(() => expect(f.list).toHaveBeenCalledTimes(2));
      expect(f.data.session.pending.list(sessionID)).toEqual([]);
      f.requests[1].resolve([]);
      await replacement;
    } finally {
      f.dispose();
    }
  });

  it.each(
    ["evict", "delete", "disconnect", "dispose"].flatMap((retirement) =>
      [false, true].map((queued) => ({ retirement, queued })),
    ),
  )(
    "retires reads on $retirement (queued replacement: $queued)",
    async ({ retirement, queued }) => {
      const f = fixture();
      try {
        const first = f.data.session.pending.sync(sessionID);
        if (queued) f.data.session.pending.invalidate(sessionID);
        const replacement = queued ? f.data.session.pending.sync(sessionID) : undefined;
        if (retirement === "evict") f.data.session.evict(sessionID);
        else if (retirement === "delete") f.emit("session.deleted", { sessionID });
        else if (retirement === "disconnect") f.setConnection("reconnecting");
        else f.dispose();
        expect(f.requests[0].signal.aborted).toBe(true);
        f.requests[0].resolve([item]);
        await Promise.all([first, replacement]);
        expect(f.list).toHaveBeenCalledTimes(1);
        expect(f.data.session.pending.list(sessionID)).toEqual([]);
        expect(f.data.session.message.list(sessionID)).toEqual([]);
        if (retirement !== "dispose") {
          f.setConnection("connected");
          const next = f.data.session.pending.sync(sessionID);
          expect(f.list).toHaveBeenCalledTimes(2);
          f.requests[1].resolve([]);
          await next;
        }
      } finally {
        f.dispose();
      }
    },
  );

  it("settles an aborted boundary without swallowing a genuine read failure", async () => {
    const f = fixture();
    try {
      const retired = f.data.session.pending.sync(sessionID);
      f.data.session.pending.invalidate(sessionID);
      f.requests[0].reject(f.requests[0].signal.reason);
      await retired;
      const next = f.data.session.pending.sync(sessionID);
      const rejected = expect(next).rejects.toThrow("server failed");
      f.requests[1].reject(new Error("server failed"));
      await rejected;
    } finally {
      f.dispose();
    }
  });

  it.each(["invalidate", "reconnect"])(
    "a fresh caller cannot join a retired queued loader after %s",
    async (retirement) => {
      const f = fixture();
      try {
        const first = f.data.session.pending.sync(sessionID);
        f.data.session.pending.invalidate(sessionID);
        const queued = f.data.session.pending.sync(sessionID);
        if (retirement === "invalidate") f.data.session.pending.invalidate(sessionID);
        else {
          f.setConnection("reconnecting");
          f.setConnection("connected");
        }
        let settled = false;
        const fresh = f.data.session.pending.sync(sessionID).then(() => {
          settled = true;
          return undefined;
        });
        expect(f.list).toHaveBeenCalledTimes(1);
        f.requests[0].resolve([]);
        await Promise.all([first, queued]);
        await vi.waitFor(() => expect(f.list).toHaveBeenCalledTimes(2));
        expect(settled).toBe(false);
        f.requests[1].resolve([item]);
        await fresh;
        expect(f.data.session.pending.list(sessionID)).toEqual([item]);
      } finally {
        f.dispose();
      }
    },
  );

  it("does not dirty an unrelated session's snapshot", async () => {
    const f = fixture();
    try {
      const reading = f.data.session.pending.sync("ses_other");
      f.enqueue();
      f.requests[0].resolve([]);
      await reading;
      expect(f.list).toHaveBeenCalledTimes(1);
      expect(f.data.session.input.has(sessionID, item.id)).toBe(true);
    } finally {
      f.dispose();
    }
  });
});
