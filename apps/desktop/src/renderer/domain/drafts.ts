import type { PromptSkillAttachment } from "@opencode/client";
import { useAtomValue } from "@effect/atom-solid";
import { Atom } from "effect/unstable/reactivity";
import type { WorkspaceOwner } from "../workspace-owner.ts";

type SessionDraftStore = {
  /** Returns the current draft, or an empty string when none exists. */
  readonly get: (sessionID: string) => string;
  readonly skills: (sessionID: string) => readonly PromptSkillAttachment[];
  readonly set: (
    sessionID: string,
    text: string,
    skills?: readonly PromptSkillAttachment[],
  ) => void;
  /**
   * Clears a draft only when it still equals the submitted text. This keeps
   * edits made while prompt admission is in flight.
   */
  readonly clearIfUnchanged: (
    sessionID: string,
    submittedText: string,
    skills?: readonly PromptSkillAttachment[],
  ) => boolean;
  readonly clear: (sessionID: string) => void;
};

/** Creates an in-memory, reactive draft store keyed by session ID. */
export function createSessionDraftStore(effects: WorkspaceOwner): SessionDraftStore {
  const state = Atom.make<
    Record<string, { text: string; skills: readonly PromptSkillAttachment[] } | undefined>
  >({});
  effects.mount(state);
  const drafts = useAtomValue(() => state);
  const setDraft = (
    sessionID: string,
    draft: { text: string; skills: readonly PromptSkillAttachment[] } | undefined,
  ): void => {
    effects.registry.set(state, { ...effects.registry.get(state), [sessionID]: draft });
  };

  const clear = (sessionID: string): void => {
    setDraft(sessionID, undefined);
  };

  return {
    get: (sessionID) => drafts()[sessionID]?.text ?? "",
    skills: (sessionID) => drafts()[sessionID]?.skills ?? [],
    set: (sessionID, text, skills = []) => {
      setDraft(sessionID, { text, skills });
    },
    clearIfUnchanged: (sessionID, submittedText, skills = []) => {
      if (
        effects.registry.get(state)[sessionID]?.text !== submittedText ||
        JSON.stringify(effects.registry.get(state)[sessionID]?.skills ?? []) !==
          JSON.stringify(skills)
      ) {
        return false;
      }

      clear(sessionID);
      return true;
    },
    clear,
  };
}
