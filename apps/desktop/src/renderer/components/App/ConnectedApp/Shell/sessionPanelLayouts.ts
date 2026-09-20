import { useAtomValue } from "@effect/atom-solid";
import { Effect, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";

import type { WorkspaceOwner } from "../../../../workspace-owner.ts";

export type ContextView = "diff" | "browser";

export type SessionPanelLayout = {
  readonly open: boolean;
  readonly view: ContextView;
};

/** A session without a remembered layout starts with the context panel closed. */
export const DEFAULT_SESSION_PANEL_LAYOUT: SessionPanelLayout = Object.freeze({
  open: false,
  view: "diff",
});

/**
 * One record per session so a write never touches another session's layout.
 * Reads, writes, and key enumeration throw when storage is denied; a missing
 * key reads as null. Change notifications cover other documents only and carry
 * the changed key (null after a full clear).
 */
export type SessionPanelStorage = {
  readonly read: (key: string) => string | null;
  readonly write: (key: string, value: string) => void;
  readonly keys: () => readonly string[];
  readonly onExternalChange: (listener: (key: string | null) => void) => () => void;
};

export type SessionPanelLayouts = {
  readonly layout: (sessionID: string) => SessionPanelLayout;
  readonly remember: (sessionID: string, patch: Partial<SessionPanelLayout>) => void;
};

/** v2 moved from one whole-map record to one record per session. */
const STORAGE_PREFIX = "ocui.session-panels.v2.";

/** The localStorage key that holds one session's context panel layout. */
export function sessionPanelStorageKey(sessionID: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(sessionID)}`;
}

function sessionIDFromKey(key: string): string | undefined {
  if (!key.startsWith(STORAGE_PREFIX)) return undefined;
  try {
    return decodeURIComponent(key.slice(STORAGE_PREFIX.length));
  } catch {
    return undefined;
  }
}

const StoredLayoutSchema = Schema.Struct({
  open: Schema.Boolean,
  view: Schema.Literals(["diff", "browser"]),
});
const isStoredLayout = Schema.is(StoredLayoutSchema);

function parseSessionPanelLayout(raw: string): SessionPanelLayout | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isStoredLayout(value)) return undefined;
  return { open: value.open, view: value.view };
}

/** Storage is accessed per call: denied or full storage must not break the shell. */
const browserSessionPanelStorage: SessionPanelStorage = {
  read: (key) => window.localStorage.getItem(key),
  write: (key, value) => {
    window.localStorage.setItem(key, value);
  },
  keys: () => {
    const storage = window.localStorage;
    const keys: string[] = [];
    // Enumeration is best effort, not an atomic snapshot. The change
    // subscription reconciles subsequent changes to notified keys.
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) keys.push(key);
    }
    return keys;
  },
  onExternalChange: (listener) => {
    const handler = (event: StorageEvent): void => {
      try {
        if (event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      listener(event.key);
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
};

type SessionPanelLoad = {
  readonly layouts: ReadonlyMap<string, SessionPanelLayout>;
  /** Records whose current value could not be established. */
  readonly unreadable: ReadonlySet<string>;
};

/**
 * Reads every record. Returns undefined when the storage cannot be enumerated;
 * records that cannot be read are reported instead of treated as absent.
 */
function loadSessionPanelLayouts(storage: SessionPanelStorage): SessionPanelLoad | undefined {
  let keys: readonly string[];
  try {
    keys = storage.keys();
  } catch {
    return undefined;
  }
  const layouts = new Map<string, SessionPanelLayout>();
  const unreadable = new Set<string>();
  for (const key of keys) {
    const sessionID = sessionIDFromKey(key);
    if (sessionID === undefined) continue;
    try {
      const raw = storage.read(key);
      if (raw === null) continue;
      const layout = parseSessionPanelLayout(raw);
      if (layout === undefined) unreadable.add(sessionID);
      else layouts.set(sessionID, layout);
    } catch {
      // An unreadable record is not a confirmed removal.
      unreadable.add(sessionID);
    }
  }
  return { layouts, unreadable };
}

/**
 * Workspace-owned per-session context panel records. Each session has its own
 * storage key, so a stale document can only replace the layout of a session it
 * explicitly changes. Changes from other documents are read back into the atom.
 */
export function createSessionPanelLayouts(input: {
  readonly effects: WorkspaceOwner;
  readonly storage?: SessionPanelStorage | null;
}): SessionPanelLayouts {
  const storage = input.storage === undefined ? browserSessionPanelStorage : input.storage;
  const state = Atom.make<ReadonlyMap<string, SessionPanelLayout>>(new Map());
  input.effects.mount(state);
  const values = useAtomValue(() => state);
  const replace = (next: ReadonlyMap<string, SessionPanelLayout>): void => {
    input.effects.registry.set(state, next);
  };

  const applyExternalChange = (key: string | null): void => {
    if (storage === null) return;
    const current = input.effects.registry.get(state);
    if (key === null) {
      // A full clear in another document; mirror it only when storage is readable.
      const reloaded = loadSessionPanelLayouts(storage);
      if (reloaded === undefined) return;
      const next = new Map(reloaded.layouts);
      // A denied or unreadable record is not a confirmed removal.
      for (const [sessionID, layout] of current) {
        if (reloaded.unreadable.has(sessionID) && !next.has(sessionID)) {
          next.set(sessionID, layout);
        }
      }
      replace(next);
      return;
    }
    const sessionID = sessionIDFromKey(key);
    if (sessionID === undefined) return;
    let raw: string | null;
    try {
      raw = storage.read(key);
    } catch {
      // Denied storage must not erase a usable in-memory record.
      return;
    }
    const existing = current.get(sessionID);
    if (raw === null) {
      if (existing === undefined) return;
      const next = new Map(current);
      next.delete(sessionID);
      replace(next);
      return;
    }
    const layout = parseSessionPanelLayout(raw);
    if (layout === undefined) return;
    if (existing !== undefined && existing.open === layout.open && existing.view === layout.view) {
      return;
    }
    const next = new Map(current);
    next.set(sessionID, layout);
    replace(next);
  };

  // Subscribe before the initial scan so a change arriving during construction
  // is reconciled instead of being missed. Reads never write back.
  let unsubscribe: (() => void) | undefined;
  if (storage !== null) {
    try {
      unsubscribe = storage.onExternalChange(applyExternalChange);
    } catch {
      unsubscribe = undefined;
    }
    input.effects.runSync(
      Effect.addFinalizer(() =>
        Effect.sync(() => {
          try {
            unsubscribe?.();
          } catch {
            // A failing unsubscribe must not fail workspace teardown.
          }
        }),
      ),
    );
  }

  const loaded = storage === null ? new Map() : loadSessionPanelLayouts(storage)?.layouts;
  if (loaded !== undefined) replace(loaded);

  return {
    layout: (sessionID) => values().get(sessionID) ?? DEFAULT_SESSION_PANEL_LAYOUT,
    remember: (sessionID, patch) => {
      // Read untracked so a caller effect cannot subscribe to its own write.
      const current = input.effects.registry.get(state);
      const existing = current.get(sessionID) ?? DEFAULT_SESSION_PANEL_LAYOUT;
      const next: SessionPanelLayout = {
        open: patch.open ?? existing.open,
        view: patch.view ?? existing.view,
      };
      if (next.open !== existing.open || next.view !== existing.view) {
        const updated = new Map(current);
        updated.set(sessionID, next);
        replace(updated);
      }
      if (storage === null) return;
      // Persist on every explicit change, even an unchanged patch, so a failed
      // write is retried instead of being suppressed forever.
      try {
        storage.write(sessionPanelStorageKey(sessionID), JSON.stringify(next));
      } catch {
        // Retried by the next explicit change to this session.
      }
    },
  };
}
