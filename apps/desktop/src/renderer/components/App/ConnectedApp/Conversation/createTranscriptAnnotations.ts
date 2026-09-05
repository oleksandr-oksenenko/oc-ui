import type { SessionMessageInfo } from "@opencode-ai/client";
import { batch, createEffect, createMemo, createSignal, untrack, type Accessor } from "solid-js";
import { unwrap } from "solid-js/store";

import type {
  AnnotationDraftStore,
  TranscriptAnnotation,
} from "../../../../domain/annotation-drafts.ts";
import { readSessionPromptMetadata } from "../../../../opencode/session-prompt.ts";
import {
  createAnnotationHighlights,
  digestAnnotationText,
  type AnnotationSelection,
} from "./createAnnotationHighlights.ts";

type Comment = {
  readonly key: string;
  readonly annotation: TranscriptAnnotation;
  readonly readonly: boolean;
};
type Interaction =
  | { readonly kind: "closed" }
  | {
      readonly kind: "selected" | "opening";
      readonly selection: AnnotationSelection;
      readonly error?: string;
    }
  | {
      readonly kind: "comments";
      readonly keys: readonly string[];
      readonly anchor: DOMRect;
      readonly editingID?: string;
    };

export type AnnotationPopoverController = ReturnType<typeof createTranscriptAnnotations>;

/** Coordinates selection, draft editing and viewing. The DOM helper owns disposable highlights. */
export function createTranscriptAnnotations(input: {
  readonly sessionID: Accessor<string | undefined>;
  readonly messages: Accessor<readonly SessionMessageInfo[]>;
  readonly drafts: AnnotationDraftStore;
  readonly enabled: Accessor<boolean>;
  readonly fallbackFocus?: () => HTMLElement | undefined;
}) {
  const [interaction, setInteraction] = createSignal<Interaction>({ kind: "closed" });
  let sessionID = input.sessionID();
  let opener: HTMLElement | undefined;
  let focusSource: Pick<TranscriptAnnotation["source"], "messageID" | "block"> | undefined;

  // Editing a draft does not decode the sent-message history again.
  const sentComments = createMemo((): readonly Comment[] =>
    input.messages().flatMap((message) => {
      if (message.type !== "user") return [];
      const metadata = message.metadata === undefined ? undefined : unwrap(message.metadata);
      return (readSessionPromptMetadata(metadata)?.annotations ?? []).map((annotation) => ({
        key: JSON.stringify([message.id, annotation.id]),
        annotation,
        readonly: true,
      }));
    }),
  );
  const comments = createMemo((): readonly Comment[] => {
    const id = input.sessionID();
    const drafts = id === undefined ? [] : input.drafts.get(id);
    return [
      ...drafts.map((annotation) => ({ key: annotation.id, annotation, readonly: false })),
      ...sentComments(),
    ];
  });
  const state = createMemo(() => {
    const current = interaction();
    switch (current.kind) {
      case "comments":
        return {
          kind: "comments" as const,
          anchor: current.anchor,
          editingID: current.editingID,
          comments: comments().filter((item) => current.keys.includes(item.key)),
        };
      default:
        return { kind: "closed" as const };
    }
  });

  function removeEmpty(id: string) {
    if (
      sessionID &&
      input.drafts.get(sessionID).some((item) => item.id === id && !item.body.trim())
    )
      input.drafts.remove(sessionID, id);
  }
  function close() {
    const current = interaction();
    batch(() => {
      setInteraction({ kind: "closed" });
      if (current.kind === "comments") current.keys.forEach(removeEmpty);
    });
  }
  function openComments(keys: readonly string[], target: HTMLElement, anchor: DOMRect) {
    if (!keys.length) return;
    close();
    opener = target;
    focusSource = comments().find((item) => item.key === keys[0])?.annotation.source;
    setInteraction({ kind: "comments", keys, anchor });
  }

  const highlights = createAnnotationHighlights({
    sources: () => comments().map(({ key, annotation }) => ({ key, source: annotation.source })),
    canSelect: () =>
      input.enabled() && (interaction().kind === "closed" || interaction().kind === "selected"),
    onSelection: (selection) =>
      setInteraction(selection ? { kind: "selected", selection } : { kind: "closed" }),
    onOpen: openComments,
    onDismiss: close,
  });

  async function openCandidate() {
    const current = interaction();
    const id = input.sessionID();
    if (
      current.kind !== "selected" ||
      !id ||
      !input.enabled() ||
      !highlights.validSelection(current.selection)
    )
      return;
    const opening = { ...current, kind: "opening" as const, error: undefined };
    setInteraction(opening);
    try {
      const textDigest = await digestAnnotationText(current.selection.text);
      if (interaction() !== opening) return;
      if (
        input.sessionID() !== id ||
        !input.enabled() ||
        !highlights.validSelection(current.selection)
      ) {
        close();
        return;
      }
      batch(() => {
        const key = input.drafts.add(id, {
          source: { ...current.selection.source, textDigest },
          quote: current.selection.quote,
          body: "",
        });
        opener = current.selection.block;
        focusSource = current.selection.source;
        window.getSelection()?.removeAllRanges();
        setInteraction({
          kind: "comments",
          keys: [key],
          anchor: current.selection.anchor,
          editingID: key,
        });
      });
    } catch {
      if (interaction() === opening)
        setInteraction({ ...current, error: "Could not prepare this annotation. Try again." });
    }
  }

  function edit(key: string) {
    const current = interaction();
    if (current.kind !== "comments" || !input.enabled()) return;
    if (
      !current.keys.includes(key) ||
      !comments().some((item) => item.key === key && !item.readonly)
    )
      return;
    setInteraction({ ...current, editingID: key });
  }

  function finishEditing(key: string) {
    const current = interaction();
    if (current.kind !== "comments" || current.editingID !== key) return;
    batch(() => {
      setInteraction({ ...current, editingID: undefined });
      removeEmpty(key);
    });
  }

  createEffect(() => {
    const selectedID = input.sessionID();
    const enabled = input.enabled();
    untrack(() => {
      if (selectedID !== sessionID || !enabled) close();
      sessionID = selectedID;
    });
  });
  createEffect(() => {
    const current = state();
    if (current.kind === "comments" && !current.comments.length) untrack(close);
  });

  return {
    state,
    selection: () => {
      const current = interaction();
      return current.kind === "selected" || current.kind === "opening"
        ? {
            anchor: current.selection.anchor,
            pending: current.kind === "opening",
            error: current.error,
          }
        : undefined;
    },
    disabled: () => !input.enabled(),
    focusTarget: () =>
      [
        opener,
        focusSource && highlights.findSource(focusSource),
        input.fallbackFocus?.(),
        highlights.root(),
      ].find(
        (element) =>
          element &&
          element.isConnected &&
          element.getClientRects().length > 0 &&
          !element.closest('[hidden],[aria-hidden="true"]'),
      ),
    close,
    attach: highlights.attach,
    openCandidate,
    edit,
    finishEditing,
    updateBody: (id: string, body: string) => {
      if (sessionID && input.enabled()) input.drafts.updateBody(sessionID, id, body);
    },
    remove: (id: string) => {
      if (sessionID && input.enabled()) input.drafts.remove(sessionID, id);
    },
    discard: () => {
      const id = sessionID;
      if (!id || !input.enabled()) return;
      batch(() => {
        close();
        input.drafts.clear(id);
      });
    },
    openDrafts: (target: HTMLButtonElement) =>
      openComments(
        comments()
          .filter((item) => !item.readonly)
          .map((item) => item.key),
        target,
        target.getBoundingClientRect(),
      ),
    openSent: (messageID: string, annotationID: string, target: HTMLElement) =>
      openComments(
        comments()
          .filter((item) => item.key === JSON.stringify([messageID, annotationID]))
          .map((item) => item.key),
        target,
        target.getBoundingClientRect(),
      ),
  };
}
