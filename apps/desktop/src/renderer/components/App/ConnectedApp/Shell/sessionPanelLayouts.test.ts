import { Effect, Exit, Scope } from "effect";
import { createEffect } from "solid-js";
import { describe, expect, it } from "vite-plus/test";

import { withTestWorkspace } from "../../../../test/workspace.ts";
import { createMemorySessionPanelStorage } from "../../../../test/session-panel-storage.ts";
import {
  createSessionPanelLayouts,
  DEFAULT_SESSION_PANEL_LAYOUT,
  sessionPanelStorageKey,
  type SessionPanelStorage,
} from "./sessionPanelLayouts.ts";

const layout = (open: boolean, view: string): string => JSON.stringify({ open, view });

describe("session panel layouts", () => {
  it("pins the encoded storage key format", () => {
    expect(sessionPanelStorageKey("ses/a b%c")).toBe("ocui.session-panels.v2.ses%2Fa%20b%25c");
  });

  it("loads valid records and drops malformed entries", () => {
    const memory = createMemorySessionPanelStorage();
    memory.values.set(
      sessionPanelStorageKey("a"),
      JSON.stringify({ open: true, view: "browser", extra: "ignored" }),
    );
    memory.values.set(sessionPanelStorageKey("b"), JSON.stringify({ open: "yes", view: "diff" }));
    memory.values.set(
      sessionPanelStorageKey("c"),
      JSON.stringify({ open: false, view: "sidebar" }),
    );
    memory.values.set(sessionPanelStorageKey("d"), "null");
    memory.values.set(sessionPanelStorageKey("e"), layout(false, "diff"));
    // The pre-per-key record and unrelated keys are ignored.
    memory.values.set("ocui.session-panels.v1", JSON.stringify({ version: 1, layouts: {} }));
    memory.values.set("unrelated", "value");

    const layouts = withTestWorkspace((effects) =>
      createSessionPanelLayouts({ effects, storage: memory.storage }),
    );

    expect(layouts.layout("a")).toEqual({ open: true, view: "browser" });
    expect(layouts.layout("e")).toEqual({ open: false, view: "diff" });
    for (const invalid of ["b", "c", "d", "missing"]) {
      expect(layouts.layout(invalid)).toEqual(DEFAULT_SESSION_PANEL_LAYOUT);
    }
  });

  it("round-trips prototype-shaped session ids without polluting prototypes", () => {
    const memory = createMemorySessionPanelStorage();
    const first = withTestWorkspace((effects) =>
      createSessionPanelLayouts({ effects, storage: memory.storage }),
    );
    first.remember("__proto__", { open: true, view: "browser" });

    const second = withTestWorkspace((effects) =>
      createSessionPanelLayouts({ effects, storage: memory.storage }),
    );
    expect(second.layout("__proto__")).toEqual({ open: true, view: "browser" });
    expect("open" in {}).toBe(false);
  });

  it("isolates records between stale stores sharing one storage", () => {
    const values = new Map<string, string>();
    const first = createMemorySessionPanelStorage(values);
    const second = createMemorySessionPanelStorage(values);
    const a = withTestWorkspace((effects) =>
      createSessionPanelLayouts({ effects, storage: first.storage }),
    );
    const b = withTestWorkspace((effects) =>
      createSessionPanelLayouts({ effects, storage: second.storage }),
    );

    // Both stores loaded before any write, so each has a stale snapshot.
    a.remember("one", { open: true, view: "browser" });
    b.remember("two", { open: true });
    a.remember("one", { view: "diff" });

    const reloaded = withTestWorkspace((effects) =>
      createSessionPanelLayouts({
        effects,
        storage: createMemorySessionPanelStorage(values).storage,
      }),
    );
    expect(reloaded.layout("one")).toEqual({ open: true, view: "diff" });
    expect(reloaded.layout("two")).toEqual({ open: true, view: "diff" });
  });

  it("preserves records beyond the former cap", () => {
    const values = new Map<string, string>();
    for (let index = 0; index < 105; index += 1) {
      values.set(sessionPanelStorageKey(`s${index}`), layout(true, "browser"));
    }
    const memory = createMemorySessionPanelStorage(values);
    const layouts = withTestWorkspace((effects) =>
      createSessionPanelLayouts({ effects, storage: memory.storage }),
    );

    expect(layouts.layout("s0")).toEqual({ open: true, view: "browser" });
    layouts.remember("fresh", { open: true });
    expect(layouts.layout("s0")).toEqual({ open: true, view: "browser" });
    expect(values.size).toBe(106);
  });

  it("contains storage read, write, and enumeration failures", () => {
    const throwing: SessionPanelStorage = {
      read: () => {
        throw new Error("denied");
      },
      write: () => {
        throw new Error("denied");
      },
      keys: () => {
        throw new Error("denied");
      },
      onExternalChange: () => () => undefined,
    };
    const layouts = withTestWorkspace((effects) =>
      createSessionPanelLayouts({ effects, storage: throwing }),
    );

    expect(layouts.layout("a")).toEqual(DEFAULT_SESSION_PANEL_LAYOUT);
    expect(() => layouts.remember("a", { open: true })).not.toThrow();
    expect(layouts.layout("a")).toEqual({ open: true, view: "diff" });
  });

  it("retries only the touched session after a failed write", () => {
    const writes: Array<{ readonly key: string; readonly value: string }> = [];
    let failing = true;
    const storage: SessionPanelStorage = {
      read: () => null,
      write: (key, value) => {
        if (failing) return;
        writes.push({ key, value });
      },
      keys: () => [],
      onExternalChange: () => () => undefined,
    };
    const layouts = withTestWorkspace((effects) => createSessionPanelLayouts({ effects, storage }));

    layouts.remember("a", { open: true });
    layouts.remember("b", { open: true });
    expect(writes).toHaveLength(0);

    failing = false;
    layouts.remember("a", { open: true });
    expect(writes).toEqual([{ key: sessionPanelStorageKey("a"), value: layout(true, "diff") }]);
  });

  it("notifies readers when a record changes", () => {
    const memory = createMemorySessionPanelStorage();
    const fixture = withTestWorkspace((effects) => {
      const store = createSessionPanelLayouts({ effects, storage: memory.storage });
      const seen: boolean[] = [];
      createEffect(() => seen.push(store.layout("a").open));
      return { store, seen };
    });

    fixture.store.remember("a", { open: true });
    expect(fixture.seen).toEqual([false, true]);
  });

  it("does not notify readers when an external value is unchanged", () => {
    const memory = createMemorySessionPanelStorage();
    const fixture = withTestWorkspace((effects) => {
      const store = createSessionPanelLayouts({ effects, storage: memory.storage });
      const seen: number[] = [];
      createEffect(() => seen.push(store.layout("a").open ? 1 : 0));
      return { store, seen };
    });
    fixture.store.remember("a", { open: true });
    expect(fixture.seen).toEqual([0, 1]);

    // Another document writes the same value; the atom must not notify again.
    memory.values.set(sessionPanelStorageKey("a"), layout(true, "diff"));
    memory.emit(sessionPanelStorageKey("a"));
    expect(fixture.seen).toEqual([0, 1]);
  });

  it("applies external changes by re-reading the key and never writes back", () => {
    const memory = createMemorySessionPanelStorage();
    const writes: string[] = [];
    const storage: SessionPanelStorage = {
      read: (key) => memory.storage.read(key),
      write: (key, value) => {
        writes.push(key);
        memory.storage.write(key, value);
      },
      keys: () => memory.storage.keys(),
      onExternalChange: (listener) => memory.storage.onExternalChange(listener),
    };
    const layouts = withTestWorkspace((effects) => createSessionPanelLayouts({ effects, storage }));

    // Another document changed the record after any earlier notification.
    memory.values.set(sessionPanelStorageKey("a"), layout(true, "browser"));
    memory.emit(sessionPanelStorageKey("a"));
    expect(layouts.layout("a")).toEqual({ open: true, view: "browser" });

    // Unrelated keys and malformed values leave the atom untouched.
    memory.values.set("unrelated", "value");
    memory.emit("unrelated");
    memory.values.set(sessionPanelStorageKey("b"), "not json");
    memory.emit(sessionPanelStorageKey("b"));
    expect(layouts.layout("b")).toEqual(DEFAULT_SESSION_PANEL_LAYOUT);

    // Removal and a full clear are mirrored.
    memory.values.delete(sessionPanelStorageKey("a"));
    memory.emit(sessionPanelStorageKey("a"));
    expect(layouts.layout("a")).toEqual(DEFAULT_SESSION_PANEL_LAYOUT);
    memory.values.set(sessionPanelStorageKey("a"), layout(true, "diff"));
    memory.emit(sessionPanelStorageKey("a"));
    expect(layouts.layout("a")).toEqual({ open: true, view: "diff" });
    memory.values.clear();
    memory.emit(null);
    expect(layouts.layout("a")).toEqual(DEFAULT_SESSION_PANEL_LAYOUT);

    expect(writes).toEqual([]);
  });

  it("loads readable records when one record cannot be read", () => {
    const memory = createMemorySessionPanelStorage();
    memory.values.set(sessionPanelStorageKey("a"), layout(true, "browser"));
    memory.values.set(sessionPanelStorageKey("b"), layout(true, "diff"));
    const storage: SessionPanelStorage = {
      read: (key) => {
        if (key === sessionPanelStorageKey("b")) throw new Error("denied");
        return memory.storage.read(key);
      },
      write: (key, value) => memory.storage.write(key, value),
      keys: () => memory.storage.keys(),
      onExternalChange: (listener) => memory.storage.onExternalChange(listener),
    };
    const layouts = withTestWorkspace((effects) => createSessionPanelLayouts({ effects, storage }));

    expect(layouts.layout("a")).toEqual({ open: true, view: "browser" });
    expect(layouts.layout("b")).toEqual(DEFAULT_SESSION_PANEL_LAYOUT);
  });

  it("round-trips escaped session ids and ignores malformed suffixes", () => {
    const memory = createMemorySessionPanelStorage();
    const sessionID = "ses/100% Ünïcode";
    const first = withTestWorkspace((effects) =>
      createSessionPanelLayouts({ effects, storage: memory.storage }),
    );
    first.remember(sessionID, { open: true, view: "browser" });
    // A suffix that cannot be decoded is ignored instead of throwing.
    memory.values.set(`${sessionPanelStorageKey("a")}%`, layout(true, "diff"));

    const second = withTestWorkspace((effects) =>
      createSessionPanelLayouts({ effects, storage: memory.storage }),
    );
    expect(second.layout(sessionID)).toEqual({ open: true, view: "browser" });
    expect(second.layout("a")).toEqual(DEFAULT_SESSION_PANEL_LAYOUT);
  });

  it("keeps unreadable records when a clear notification arrives", () => {
    const memory = createMemorySessionPanelStorage();
    let failing = false;
    const storage: SessionPanelStorage = {
      read: (key) => {
        if (failing) throw new Error("denied");
        return memory.storage.read(key);
      },
      write: (key, value) => memory.storage.write(key, value),
      keys: () => memory.storage.keys(),
      onExternalChange: (listener) => memory.storage.onExternalChange(listener),
    };
    const layouts = withTestWorkspace((effects) => createSessionPanelLayouts({ effects, storage }));
    layouts.remember("a", { open: true });

    // Enumeration still lists the key, but its value cannot be read.
    failing = true;
    memory.emit(null);
    expect(layouts.layout("a")).toEqual({ open: true, view: "diff" });

    // A readable clear confirms the removal.
    failing = false;
    memory.values.clear();
    memory.emit(null);
    expect(layouts.layout("a")).toEqual(DEFAULT_SESSION_PANEL_LAYOUT);
  });

  it("keeps in-memory records when a change notification cannot be read", () => {
    const memory = createMemorySessionPanelStorage();
    let failing = false;
    const storage: SessionPanelStorage = {
      read: (key) => {
        if (failing) throw new Error("denied");
        return memory.storage.read(key);
      },
      write: (key, value) => memory.storage.write(key, value),
      keys: () => memory.storage.keys(),
      onExternalChange: (listener) => memory.storage.onExternalChange(listener),
    };
    const layouts = withTestWorkspace((effects) => createSessionPanelLayouts({ effects, storage }));
    layouts.remember("a", { open: true });

    failing = true;
    memory.values.set(sessionPanelStorageKey("a"), layout(false, "diff"));
    memory.emit(sessionPanelStorageKey("a"));
    expect(layouts.layout("a")).toEqual({ open: true, view: "diff" });
  });

  it("unsubscribes when the workspace scope closes", async () => {
    const memory = createMemorySessionPanelStorage();
    const mounted = withTestWorkspace((effects) => ({
      layouts: createSessionPanelLayouts({ effects, storage: memory.storage }),
      effects,
    }));

    expect(memory.listenerCount()).toBe(1);
    await Effect.runPromise(Scope.close(mounted.effects.scope, Exit.void));
    expect(memory.listenerCount()).toBe(0);
  });
});
