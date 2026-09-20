import type { SessionPanelStorage } from "../components/App/ConnectedApp/Shell/sessionPanelLayouts.ts";

export type MemorySessionPanelStorage = {
  readonly storage: SessionPanelStorage;
  readonly values: Map<string, string>;
  /** Simulates a change made by another document. */
  readonly emit: (key: string | null) => void;
  readonly listenerCount: () => number;
};

/**
 * Keyed in-memory storage that several stores can share, plus a way to emit the
 * cross-document change notifications the browser delivers to other tabs.
 */
export function createMemorySessionPanelStorage(
  values: Map<string, string> = new Map(),
): MemorySessionPanelStorage {
  const listeners = new Set<(key: string | null) => void>();
  return {
    storage: {
      read: (key) => values.get(key) ?? null,
      write: (key, value) => {
        values.set(key, value);
      },
      keys: () => [...values.keys()],
      onExternalChange: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    values,
    emit: (key) => {
      for (const listener of listeners) listener(key);
    },
    listenerCount: () => listeners.size,
  };
}
