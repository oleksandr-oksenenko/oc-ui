import type { FileDiffInfo, SessionInfo } from "@opencode-ai/client";
import { useAtomValue } from "@effect/atom-solid";
import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
} from "solid-js";

import type { WorkspaceOwner } from "../../../../workspace-owner.ts";

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
  readonly diffs: Pick<ConnectedRuntime["diffs"], "state" | "sync" | "refresh" | "poll">;
};

export type WorkspaceChangesInput = {
  readonly runtime: WorkspaceChangesRuntime;
  readonly effects: WorkspaceOwner;
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
  const { effects } = input;
  const mode = Atom.make<VcsDiffMode>("working");
  effects.mount(mode);
  const diffMode = useAtomValue(() => mode);
  const setDiffMode = (value: VcsDiffMode): void => effects.registry.set(mode, value);
  const syncVcs = Effect.fn("WorkspaceChanges.syncVcs")(function* (
    location: NonNullable<SessionInfo["location"]>,
  ) {
    yield* effects
      .request(() => input.runtime.data.location.vcs.sync(location))
      .pipe(
        Effect.catchTag("WorkspaceRequestError", (error) =>
          Effect.logWarning("VCS information could not be loaded", error),
        ),
      );
  });

  const selectedLocation = createMemo(() => input.selectedSession()?.location);
  const [visible, setVisible] = createSignal(document.visibilityState !== "hidden");
  const [focus, setFocus] = createSignal(0);
  const visibilityChanged = () => setVisible(document.visibilityState !== "hidden");
  const focused = () => setFocus((value) => value + 1);
  document.addEventListener("visibilitychange", visibilityChanged);
  window.addEventListener("focus", focused);
  const polling = effects.latest<never>();
  onCleanup(() => {
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("focus", focused);
    polling.cancel();
  });
  createEffect(() => {
    const location = selectedLocation();
    const comparison = diffMode();
    focus();
    if (
      !location ||
      !input.bootstrapped() ||
      !input.connected() ||
      !input.panelOpen() ||
      !visible()
    ) {
      polling.cancel();
      return;
    }
    // The workspace retains any in-flight read until settlement when polling stops.
    untrack(() => polling.run(input.runtime.diffs.poll(location, comparison)));
  });
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
    if (
      !location ||
      !input.bootstrapped() ||
      !input.connected() ||
      !input.panelOpen() ||
      !visible()
    ) {
      return;
    }

    const snapshot = input.runtime.diffs.state(location, diffMode());
    if (snapshot.status === "idle" || (snapshot.status === "ready" && snapshot.stale)) {
      effects.runFork(input.runtime.diffs.sync(location, diffMode()));
    }
  });

  createEffect(() => {
    const location = selectedLocation();
    if (location && input.bootstrapped() && input.connected() && input.panelOpen() && visible()) {
      effects.runFork(syncVcs(location));
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

  const files = createMemo<readonly FileDiffInfo[]>(() => diffSnapshot()?.files ?? EMPTY_FILES);

  const diff = createMemo<DiffViewProps>(() => {
    const location = selectedLocation();
    const snapshot = diffSnapshot();
    const branch = location && input.runtime.data.location.vcs.info(location)?.branch;
    const defaultBranch = branch?.default;
    const currentFiles = files();
    const review = reviewView();

    if (!location || !snapshot) {
      return {
        files: currentFiles,
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
      files: currentFiles,
      loading: snapshot.status === "loading",
      error: snapshot.error,
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
      onRetry: () => {
        effects.runFork(input.runtime.diffs.refresh(location, diffMode()));
      },
      review,
    };
  });

  return { reviewKey, view: diff };
}
