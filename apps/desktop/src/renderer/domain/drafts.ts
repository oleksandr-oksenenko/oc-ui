import { useAtomValue } from "@effect/atom-solid";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../workspace-owner.ts";

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
};

/** Creates an in-memory, reactive draft store keyed by session ID. */
export function createSessionDraftStore(effects: WorkspaceOwner): SessionDraftStore {
  const state = Atom.make<Record<string, string | undefined>>({});
  effects.mount(state);
  const drafts = useAtomValue(() => state);
  const setDraft = (sessionID: string, text: string | undefined): void => {
    effects.registry.set(state, { ...effects.registry.get(state), [sessionID]: text });
  };

  const clear = (sessionID: string): void => {
    setDraft(sessionID, undefined);
  };

  return {
    get: (sessionID) => drafts()[sessionID] ?? "",
    set: (sessionID, text) => {
      setDraft(sessionID, text);
    },
    clearIfUnchanged: (sessionID, submittedText) => {
      if (effects.registry.get(state)[sessionID] !== submittedText) {
        return false;
      }

      clear(sessionID);
      return true;
    },
    clear,
  };
}
