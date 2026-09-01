import { createStore } from "solid-js/store";
import type { SelectedLineRange } from "@pierre/diffs";

type ReviewComparison = "working" | "branch";

export type ReviewDraftKey = {
  readonly sessionID: string;
  readonly comparison: ReviewComparison;
};

export type ReviewComment = {
  readonly id: string;
  readonly path: string;
  readonly selection: SelectedLineRange;
  readonly selectedCode: string;
  readonly body: string;
};

type ReviewDraft = {
  readonly comments: readonly ReviewComment[];
  readonly editingCommentID?: string;
};

type ReviewDraftSnapshot = {
  readonly key: ReviewDraftKey;
  readonly revision: number;
  readonly comments: readonly ReviewComment[];
};

export type ReviewDraftStore = {
  readonly get: (key: ReviewDraftKey) => ReviewDraft;
  readonly begin: (
    key: ReviewDraftKey,
    path: string,
    selection: SelectedLineRange,
    selectedCode: string,
  ) => string;
  readonly updateBody: (key: ReviewDraftKey, id: string, body: string) => void;
  readonly edit: (key: ReviewDraftKey, id?: string) => void;
  readonly remove: (key: ReviewDraftKey, id: string) => void;
  readonly capture: (key: ReviewDraftKey) => ReviewDraftSnapshot;
  readonly clearIfUnchanged: (snapshot: ReviewDraftSnapshot) => boolean;
  readonly clear: (key: ReviewDraftKey) => void;
  readonly clearSession: (sessionID: string) => void;
};

type StoredDraft = {
  comments: ReviewComment[];
  editingCommentID?: string;
  revision: number;
};

type ReviewSessionDrafts = Partial<Record<ReviewComparison, StoredDraft>>;
type ReviewStoreState = { sessions: Record<string, ReviewSessionDrafts> };
const EMPTY_DRAFT: ReviewDraft = { comments: [] };

/** Creates reactive, in-memory review drafts isolated by session and comparison. */
export function createReviewDraftStore(): ReviewDraftStore {
  const [state, setState] = createStore<ReviewStoreState>({ sessions: {} });
  let nextCommentID = 1;

  const readStored = (key: ReviewDraftKey): StoredDraft | undefined =>
    state.sessions[key.sessionID]?.[key.comparison];

  const read = (key: ReviewDraftKey): ReviewDraft => {
    const draft = readStored(key);
    if (!draft) return EMPTY_DRAFT;
    if (draft.editingCommentID === undefined) return { comments: draft.comments };
    return { comments: draft.comments, editingCommentID: draft.editingCommentID };
  };

  const write = (key: ReviewDraftKey, draft: StoredDraft): void => {
    if (state.sessions[key.sessionID] === undefined) {
      setState("sessions", key.sessionID, { [key.comparison]: draft });
    } else {
      setState("sessions", key.sessionID, key.comparison, draft);
    }
  };

  const revisionOf = (key: ReviewDraftKey): number => readStored(key)?.revision ?? 0;

  const clear = (key: ReviewDraftKey): void => {
    const draft = readStored(key);
    if (draft === undefined) return;
    write(key, { comments: [], revision: draft.revision + 1 });
  };

  return {
    get: read,

    begin: (key, path, selection, selectedCode) => {
      const previous = readStored(key);
      const id = `review-comment-${nextCommentID++}`;
      const comments = (previous?.comments ?? []).filter((comment) => comment.body.trim() !== "");
      comments.push({
        id,
        path,
        selection,
        selectedCode,
        body: "",
      });
      write(key, {
        comments,
        editingCommentID: id,
        revision: (previous?.revision ?? 0) + 1,
      });
      return id;
    },

    updateBody: (key, id, body) => {
      const previous = readStored(key);
      if (previous === undefined) return;
      const index = previous.comments.findIndex((comment) => comment.id === id);
      if (index < 0 || previous.comments[index]!.body === body) return;
      const comments = previous.comments.map((comment, commentIndex) =>
        commentIndex === index ? { ...comment, body } : comment,
      );
      write(key, { ...previous, comments, revision: previous.revision + 1 });
    },

    edit: (key, id) => {
      const previous = readStored(key);
      if (id !== undefined && !previous?.comments.some((comment) => comment.id === id)) return;
      if (previous?.editingCommentID === id) return;
      if (previous === undefined) return;
      write(key, { ...previous, editingCommentID: id });
    },

    remove: (key, id) => {
      const previous = readStored(key);
      if (previous === undefined || !previous.comments.some((comment) => comment.id === id)) return;
      const next: StoredDraft = {
        comments: previous.comments.filter((comment) => comment.id !== id),
        revision: previous.revision + 1,
      };
      if (previous.editingCommentID !== undefined && previous.editingCommentID !== id) {
        next.editingCommentID = previous.editingCommentID;
      }
      write(key, next);
    },

    capture: (key) => {
      const draft = readStored(key);
      return {
        key,
        revision: draft?.revision ?? 0,
        comments: draft?.comments.filter((comment) => comment.body.trim() !== "") ?? [],
      };
    },

    clearIfUnchanged: (snapshot) => {
      if (revisionOf(snapshot.key) !== snapshot.revision) return false;
      clear(snapshot.key);
      return true;
    },

    clear,

    clearSession: (sessionID) => {
      setState("sessions", sessionID, {});
    },
  };
}
