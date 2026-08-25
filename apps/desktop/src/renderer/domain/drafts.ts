import { createStore } from "solid-js/store";

type SessionDraftStore = {
  /** Returns the current draft, or an empty string when none exists. */
  readonly get: (sessionID: string) => string;
  readonly set: (sessionID: string, text: string) => void;
  /**
   * Clears a draft only when it still equals the submitted text. This keeps
   * edits made while prompt admission is in flight.
   */
  readonly clearIfUnchanged: (sessionID: string, submittedText: string) => boolean;
  readonly clear: (sessionID: string) => void;
  readonly clearAll: () => void;
};

/** Creates an in-memory, reactive draft store keyed by session ID. */
export function createSessionDraftStore(): SessionDraftStore {
  const [drafts, setDrafts] = createStore<Record<string, string | undefined>>({});

  const clear = (sessionID: string): void => {
    setDrafts(sessionID, undefined);
  };

  return {
    get: (sessionID) => drafts[sessionID] ?? "",
    set: (sessionID, text) => {
      setDrafts(sessionID, text);
    },
    clearIfUnchanged: (sessionID, submittedText) => {
      if (drafts[sessionID] !== submittedText) {
        return false;
      }

      clear(sessionID);
      return true;
    },
    clear,
    clearAll: () => {
      setDrafts({});
    },
  };
}
