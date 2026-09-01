import type { FileDiffInfo, SessionInfo } from "@opencode-ai/client";
import { createEffect, createMemo, createSignal, type Accessor } from "solid-js";

import type { ReviewDraftKey, ReviewDraftStore } from "../../../../domain/review-drafts.ts";
import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import type { VcsDiffMode } from "../../../../opencode/vcs-diff.ts";

import type { DiffReviewView, DiffViewProps } from "./ContextPanel/DiffView.tsx";

const EMPTY_FILES: readonly FileDiffInfo[] = [];

export type WorkspaceChangesRuntime = {
  readonly data: {
    readonly location: {
      readonly vcs: Pick<ConnectedRuntime["data"]["location"]["vcs"], "info" | "sync">;
    };
  };
  readonly diffs: Pick<ConnectedRuntime["diffs"], "state" | "sync" | "refresh">;
};

export type WorkspaceChangesInput = {
  readonly runtime: WorkspaceChangesRuntime;
  readonly selectedSession: Accessor<SessionInfo | undefined>;
  readonly bootstrapped: Accessor<boolean>;
  readonly connected: Accessor<boolean>;
  readonly panelOpen: Accessor<boolean>;
  readonly reviewDrafts: ReviewDraftStore;
  readonly requestRemoveComment: (
    key: ReviewDraftKey,
    commentID: string,
    opener: HTMLElement,
  ) => void;
};

export type WorkspaceChangesController = {
  readonly reviewKey: Accessor<ReviewDraftKey | undefined>;
  readonly view: Accessor<DiffViewProps>;
};

export function createWorkspaceChanges(input: WorkspaceChangesInput): WorkspaceChangesController {
  const [diffMode, setDiffMode] = createSignal<VcsDiffMode>("working");

  const selectedLocation = createMemo(() => input.selectedSession()?.location);
  const reviewKey = createMemo<ReviewDraftKey | undefined>(() => {
    const sessionID = input.selectedSession()?.id;
    return sessionID === undefined ? undefined : { sessionID, comparison: diffMode() };
  });

  const changeDiffMode = (value: string): void => {
    if (value === "working" || value === "branch") setDiffMode(value);
  };

  const diffComparisonOptions = createMemo<
    readonly { readonly value: VcsDiffMode; readonly label: string }[]
  >(() => {
    const location = selectedLocation();
    const branch = location && input.runtime.data.location.vcs.info(location)?.branch;
    if (branch?.current && branch.default && branch.current !== branch.default) {
      return [
        { value: "working", label: "Working changes" },
        { value: "branch", label: `Changes vs ${branch.default}` },
      ];
    }
    return [{ value: "working", label: "Working changes" }];
  });

  createEffect(() => {
    if (
      diffMode() === "branch" &&
      !diffComparisonOptions().some((option) => option.value === "branch")
    ) {
      setDiffMode("working");
    }
  });

  const diffSnapshot = createMemo(() => {
    const location = selectedLocation();
    return location ? input.runtime.diffs.state(location, diffMode()) : undefined;
  });

  createEffect(() => {
    const location = selectedLocation();
    if (!location || !input.bootstrapped() || !input.connected() || !input.panelOpen()) {
      return;
    }

    void input.runtime.data.location.vcs.sync(location).catch(() => undefined);
    const snapshot = input.runtime.diffs.state(location, diffMode());
    if (snapshot.status === "idle" || (snapshot.status === "ready" && snapshot.stale)) {
      void input.runtime.diffs.sync(location, diffMode());
    }
  });

  const reviewView = (): DiffReviewView | undefined => {
    const key = reviewKey();
    if (key === undefined) return undefined;
    const draft = input.reviewDrafts.get(key);
    const editingComment = draft.comments.find((comment) => comment.id === draft.editingCommentID);
    const selectedLines = editingComment
      ? { path: editingComment.path, range: editingComment.selection }
      : null;
    const commentFor = (commentID: string) =>
      input.reviewDrafts.get(key).comments.find((comment) => comment.id === commentID);
    return {
      comments: draft.comments,
      editingCommentID: draft.editingCommentID,
      selectedLines,
      onBeginComment: (path, selection, selectedCode) =>
        input.reviewDrafts.begin(key, path, selection, selectedCode),
      onUpdateCommentBody: (commentID, body) => input.reviewDrafts.updateBody(key, commentID, body),
      onEditComment: (commentID) => input.reviewDrafts.edit(key, commentID),
      onFinishComment: (commentID) => {
        const comment = commentFor(commentID);
        if (!comment) return;
        if (comment.body.trim() === "") input.reviewDrafts.remove(key, commentID);
        else input.reviewDrafts.edit(key);
      },
      onRemoveComment: (commentID, opener) => {
        const comment = commentFor(commentID);
        if (!comment) return;
        if (comment.body.trim() === "") {
          input.reviewDrafts.remove(key, commentID);
          return;
        }
        input.requestRemoveComment(key, commentID, opener);
      },
    };
  };

  const rawFiles = createMemo<readonly FileDiffInfo[]>(() => diffSnapshot()?.files ?? EMPTY_FILES);
  const mappedFiles = createMemo(() =>
    rawFiles().map((file) => ({
      path: file.file,
      patch: file.patch,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status,
    })),
  );

  const diff = createMemo<DiffViewProps>(() => {
    const location = selectedLocation();
    const snapshot = diffSnapshot();
    const branch = location && input.runtime.data.location.vcs.info(location)?.branch;
    const defaultBranch = branch?.default;
    const files = mappedFiles();
    const review = reviewView();

    if (!location || !snapshot) {
      return {
        files,
        loading: false,
        emptyMessage: "Select a session to view changes",
        emptyDescription: "The Diff panel follows the selected session's workspace location.",
        comparison: diffMode(),
        comparisonOptions: diffComparisonOptions(),
        onComparisonChange: changeDiffMode,
        review,
      };
    }

    return {
      files,
      loading: snapshot.status === "loading",
      error: snapshot.status === "failed" ? snapshot.error : undefined,
      stale: snapshot.stale,
      emptyMessage:
        diffMode() === "branch" && defaultBranch
          ? `No changes against ${defaultBranch}`
          : "No working tree changes",
      emptyDescription:
        diffMode() === "branch" && defaultBranch
          ? `The working copy matches its merge base with ${defaultBranch}.`
          : "The working copy matches HEAD.",
      comparison: diffMode(),
      comparisonOptions: diffComparisonOptions(),
      onComparisonChange: changeDiffMode,
      onRetry: () => void input.runtime.diffs.refresh(location, diffMode()),
      review,
    };
  });

  return { reviewKey, view: diff };
}
