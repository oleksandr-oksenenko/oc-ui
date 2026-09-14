import { createEffect, createRoot, createSignal, type Accessor } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createTranscriptMaterialization } from "./transcriptMaterialization.ts";

const message = (id: string) => ({ id });

function sequence(prefix: string, count: number, offset = 0): { id: string }[] {
  return Array.from({ length: count }, (_, index) => message(`${prefix}${index + offset}`));
}

function stubFrames() {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++next;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
  return {
    pending: () => frames.size,
    runNext: () => {
      const entry = [...frames.entries()][0];
      if (entry === undefined) throw new Error("No pending frame");
      frames.delete(entry[0]);
      entry[1](0);
    },
    runAll: () => {
      let guard = 0;
      while (frames.size > 0) {
        if (++guard > 1000) throw new Error("frame loop did not settle");
        const entry = [...frames.entries()][0]!;
        frames.delete(entry[0]);
        entry[1](0);
      }
    },
  };
}

function mountMaterialization(initial: {
  sessionID: Accessor<string>;
  messages: Accessor<readonly { id: string }[]>;
}) {
  return createRoot((dispose) => ({
    materialization: createTranscriptMaterialization({
      sessionID: initial.sessionID,
      messages: initial.messages,
    }),
    dispose,
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("createTranscriptMaterialization", () => {
  it("reveals the newest suffix and prepends batches until the whole list is rendered", () => {
    const frames = stubFrames();
    const [sessionID] = createSignal("session");
    const [messages] = createSignal(sequence("m", 170));
    const result = mountMaterialization({ sessionID, messages });
    try {
      expect(result.materialization.startIndex()).toBe(150);
      expect(result.materialization.materializing()).toBe(true);
      expect(frames.pending()).toBe(1);

      frames.runNext();
      expect(result.materialization.startIndex()).toBe(100);
      frames.runNext();
      expect(result.materialization.startIndex()).toBe(50);
      frames.runNext();

      expect(result.materialization.startIndex()).toBe(0);
      expect(result.materialization.materializing()).toBe(false);
      expect(frames.pending()).toBe(0);
    } finally {
      result.dispose();
    }
  });

  it("keeps a valid frontier at index zero instead of resetting it", () => {
    const frames = stubFrames();
    const [sessionID] = createSignal("session");
    const [messages, setMessages] = createSignal(sequence("m", 20));
    const result = mountMaterialization({ sessionID, messages });
    try {
      expect(result.materialization.startIndex()).toBe(0);
      expect(result.materialization.materializing()).toBe(false);

      // Appending to a complete, index-0 frontier must not restart batching.
      setMessages([...messages(), ...sequence("new", 5, 20)]);
      expect(result.materialization.startIndex()).toBe(0);
      expect(result.materialization.materializing()).toBe(false);
      expect(frames.pending()).toBe(0);
    } finally {
      result.dispose();
    }
  });

  it("batches when an empty session later receives a large list", () => {
    const frames = stubFrames();
    const [sessionID] = createSignal("session");
    const [messages, setMessages] = createSignal<readonly { id: string }[]>([]);
    const result = mountMaterialization({ sessionID, messages });
    try {
      expect(result.materialization.startIndex()).toBe(0);
      expect(result.materialization.materializing()).toBe(false);

      setMessages(sequence("m", 70));
      expect(result.materialization.startIndex()).toBe(50);
      expect(result.materialization.materializing()).toBe(true);

      frames.runAll();
      expect(result.materialization.startIndex()).toBe(0);
      expect(result.materialization.materializing()).toBe(false);
    } finally {
      result.dispose();
    }
  });

  it("batches again when a completed history is replaced", () => {
    const frames = stubFrames();
    const [sessionID] = createSignal("session");
    const [messages, setMessages] = createSignal(sequence("m", 40));
    const result = mountMaterialization({ sessionID, messages });
    try {
      frames.runAll();
      expect(result.materialization.startIndex()).toBe(0);
      expect(result.materialization.materializing()).toBe(false);

      setMessages(sequence("replacement", 70));
      expect(result.materialization.startIndex()).toBe(50);
      expect(result.materialization.materializing()).toBe(true);
    } finally {
      result.dispose();
    }
  });

  it("keeps rendered rows when older rows are removed under the frontier", () => {
    const frames = stubFrames();
    const [sessionID] = createSignal("session");
    const [messages, setMessages] = createSignal(sequence("m", 170));
    const result = mountMaterialization({ sessionID, messages });
    try {
      frames.runNext();
      frames.runNext();
      expect(result.materialization.startIndex()).toBe(50);
      expect(messages()[result.materialization.startIndex()]?.id).toBe("m50");

      // Drop the oldest 50 messages: the frontier is now index 0.
      setMessages(messages().slice(50));
      expect(result.materialization.startIndex()).toBe(0);
      expect(result.materialization.materializing()).toBe(false);
      expect(messages()[0]?.id).toBe("m50");
    } finally {
      result.dispose();
    }
  });

  it("clears the frontier and cancels the pending batch when the list empties", () => {
    const frames = stubFrames();
    const [sessionID] = createSignal("session");
    const [messages, setMessages] = createSignal(sequence("m", 170));
    const result = mountMaterialization({ sessionID, messages });
    try {
      frames.runNext();
      expect(result.materialization.startIndex()).toBe(100);
      expect(frames.pending()).toBe(1);

      setMessages([]);
      expect(result.materialization.startIndex()).toBe(0);
      expect(result.materialization.materializing()).toBe(false);
      expect(frames.pending()).toBe(0);
    } finally {
      result.dispose();
    }
  });

  it("resets the frontier id across session changes with the same numeric index", () => {
    const frames = stubFrames();
    const [sessionID, setSessionID] = createSignal("first");
    const [messages, setMessages] = createSignal(sequence("a", 60));
    const result = mountMaterialization({ sessionID, messages });
    try {
      expect(result.materialization.startIndex()).toBe(40);
      expect(messages()[40]?.id).toBe("a40");

      setSessionID("second");
      setMessages(sequence("b", 60));
      expect(result.materialization.startIndex()).toBe(40);
      expect(messages()[40]?.id).toBe("b40");
      expect(frames.pending()).toBe(1);
    } finally {
      result.dispose();
    }
  });

  it("notifies materializing only when the range starts or completes", () => {
    const frames = stubFrames();
    const [sessionID] = createSignal("session");
    const [messages] = createSignal(sequence("m", 80));
    const result = createRoot((dispose) => {
      const materialization = createTranscriptMaterialization({ sessionID, messages });
      const seen: boolean[] = [];
      createEffect(() => seen.push(materialization.materializing()));
      return { seen, dispose };
    });
    try {
      expect(result.seen).toEqual([true]);
      frames.runNext();
      // Still materializing, so dependents are not notified between batches.
      expect(result.seen).toEqual([true]);
      frames.runAll();
      expect(result.seen).toEqual([true, false]);
    } finally {
      result.dispose();
    }
  });

  it("keeps the frontier across appends and prepends and settles all frames", () => {
    const frames = stubFrames();
    const [sessionID] = createSignal("session");
    const initial = sequence("m", 170);
    const [messages, setMessages] = createSignal(initial);
    const result = mountMaterialization({ sessionID, messages });
    try {
      frames.runNext();
      expect(result.materialization.startIndex()).toBe(100);

      setMessages([...messages(), ...sequence("new", 5, 170)]);
      expect(result.materialization.startIndex()).toBe(100);

      setMessages([...sequence("old", 10, -10), ...messages()]);
      expect(result.materialization.startIndex()).toBe(110);
      expect(messages()[110]?.id).toBe(initial[100]?.id);

      frames.runAll();
      expect(result.materialization.startIndex()).toBe(0);
      expect(result.materialization.materializing()).toBe(false);
      expect(frames.pending()).toBe(0);
    } finally {
      result.dispose();
    }
  });
});
