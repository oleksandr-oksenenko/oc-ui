import type { CommandInfo, PromptSkillAttachment, SkillInfo } from "@opencode/client";
import { ContextMenu as KobalteContextMenu } from "@kobalte/core/context-menu";
import { PromptEditor } from "./Composer/PromptEditor.tsx";
import type { PromptEditorControl } from "./Composer/PromptEditor.tsx";
import { Button } from "@opencode/ui/button";
import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { Loader } from "@opencode/ui/loader";
import { Tooltip } from "@opencode/ui/tooltip";
import { For, Show, createEffect, createSignal, on, onCleanup, onMount, type JSX } from "solid-js";

import { collectTransferFiles, isFileTransfer } from "../../../../../opencode/attachments.ts";
import { ImagePreview, isImageFile } from "../../../../../ui/ImagePreview.tsx";
import "./Composer/Composer.css";
import { AgentPicker } from "./Composer/AgentPicker.tsx";
import type { AgentPickerOption } from "./Composer/AgentPicker.tsx";
import { ContextMeter } from "./Composer/ContextMeter.tsx";
import type { ContextUsage } from "./Composer/context-usage.ts";
import { ModelPicker } from "./Composer/ModelPicker.tsx";
import type { ModelPickerOption } from "./Composer/ModelPicker.tsx";
import { VariantPicker } from "./Composer/VariantPicker.tsx";
import type { VariantPickerOption } from "./Composer/VariantPicker.tsx";
import { readClipboardFiles, readClipboardText } from "./Composer/pasteClipboard.ts";
import { classifyPaste, TEXT_ATTACHMENT_LIMIT } from "./Composer/pasteRoute.ts";

export type ComposerReview = {
  readonly count: number;
  readonly onDiscard: (opener: HTMLButtonElement) => void;
};

/** Source text retained by the attachment owner when a paste could not attach. */
export type ComposerPasteRecovery = {
  readonly message: string;
  /** Returns the retained source text once, so the composer can insert it literally. */
  readonly take: () => string | undefined;
  readonly dismiss: () => void;
};

type ComposerAnnotations = {
  readonly ref?: (button: HTMLButtonElement) => void;
  readonly count: number;
  readonly onOpen: (opener: HTMLButtonElement) => void;
  readonly onDiscard: (opener: HTMLButtonElement) => void;
};

type ComposerCatalogSection<T> = {
  readonly state: "loading" | "ready" | "failed";
  readonly items: readonly T[];
};

export type ComposerCatalog = {
  readonly commands: ComposerCatalogSection<Pick<CommandInfo, "name" | "description">>;
  readonly skills: ComposerCatalogSection<Pick<SkillInfo, "id" | "name" | "description">>;
  readonly onRetry: () => void;
};

/** The renderer marks the document with its platform before mounting (mount-app.tsx). */
const isMacPlatform = () => document.documentElement.dataset.platform === "macos";

/**
 * The explicit literal-paste gesture. Electron's default menu has no
 * paste-and-match-style accelerator and the runtime denies web clipboard
 * permissions, so the chord initiates the literal paste through the host
 * clipboard capability instead of a native paste event.
 */
const isLiteralPasteChord = (event: KeyboardEvent): boolean => {
  const modifier = isMacPlatform() ? event.metaKey : event.ctrlKey;
  return (
    modifier && event.shiftKey && !event.altKey && event.key.toLowerCase() === "v" && !event.repeat
  );
};

const HTML_TOO_LARGE_NOTICE =
  "The copied content is too large or too deeply nested to inspect, so it was not inserted. Copy a smaller part and paste again.";

const UNSUPPORTED_HTML_NOTICE =
  "That copied content has no text this editor can hold. Copy it as plain text and paste again.";

const CLIPBOARD_UNAVAILABLE_NOTICE =
  "Clipboard access is unavailable in this app. Press the paste shortcut instead.";

const LITERAL_TOO_LARGE_NOTICE =
  "That paste is too large to insert here. Copy a smaller part and paste again.";

export type ComposerProps = {
  readonly value: string;
  readonly sessionID?: string;
  readonly skills?: readonly PromptSkillAttachment[];
  readonly catalog?: ComposerCatalog;
  readonly files?: readonly File[];
  readonly onAttachFiles?: (files: readonly File[]) => void;
  readonly onRemoveFile?: (file: File) => void;
  /**
   * The attachment owner's clipboard intent for a text paste too large to edit
   * inline. The owner captures the originating session and retains the result.
   */
  readonly onAttachText?: (text: string) => void;
  /** Retained source text from a rejected paste, for the selected session. */
  readonly pasteRecovery?: ComposerPasteRecovery;
  /**
   * Reads the system clipboard for the literal-paste escape hatch. The host
   * owns this because web clipboard permissions are denied; an unavailable
   * read resolves to `undefined` and the composer explains it.
   */
  readonly readClipboardText?: () => Promise<string | undefined>;
  /** Session execution and prompt admission state. */
  readonly action: "send" | "sending" | "running";
  /** Disables submission. Omit onStop when stopping is unavailable. */
  readonly disabled: boolean;
  readonly error?: string;
  /** A recognized command invocation that leaves comments for the next message. */
  readonly command?: string;
  /** Omitted review state is equivalent to an empty review attachment. */
  readonly review?: ComposerReview;
  /** Omitted annotations state is equivalent to an empty annotation attachment. */
  readonly annotations?: ComposerAnnotations;
  /** Omitted context usage hides the context meter. */
  readonly contextUsage?: ContextUsage;
  readonly modelSelection: {
    readonly state: "loading" | "ready" | "failed";
    readonly switching: boolean;
    readonly disabled: boolean;
    readonly models: readonly ModelPickerOption[];
    readonly selectedModelID?: string;
    readonly variants: readonly VariantPickerOption[];
    readonly selectedVariantID?: string;
    readonly error?: string;
    readonly onSelectModel: (id: string) => void;
    readonly onSelectVariant: (id: string) => void;
  };
  readonly agentSelection: {
    readonly state: "loading" | "ready" | "failed";
    readonly switching: boolean;
    readonly disabled: boolean;
    readonly agents: readonly AgentPickerOption[];
    readonly selectedAgentID?: string;
    readonly error?: string;
    readonly onSelectAgent: (id: string) => void;
  };
  readonly onInput: (value: string, skills?: readonly PromptSkillAttachment[]) => void;
  readonly onSubmit: () => void;
  /** When supplied, Mod+Enter submits with queued delivery. */
  readonly onQueue?: () => void;
  readonly onStop?: () => void;
};

function selectionControls(
  props: Pick<ComposerProps, "action" | "agentSelection" | "modelSelection" | "contextUsage">,
  attachButton: JSX.Element,
) {
  return (
    <div class="composer-picker-row">
      {attachButton}
      <Show when={props.contextUsage}>{(usage) => <ContextMeter usage={usage()} />}</Show>
      {props.agentSelection.state === "ready" ? (
        <AgentPicker
          placeholder="Default agent"
          unavailableLabel={
            props.agentSelection.selectedAgentID === undefined ? "No agents" : "Agent unavailable"
          }
          options={props.agentSelection.agents}
          selectedID={props.agentSelection.selectedAgentID}
          disabled={
            props.agentSelection.disabled ||
            props.agentSelection.switching ||
            props.modelSelection.switching ||
            props.action === "sending"
          }
          onSelect={props.agentSelection.onSelectAgent}
        />
      ) : (
        <span class="composer-picker composer-picker--unavailable" aria-disabled="true">
          {props.agentSelection.state === "loading" ? "Loading agents…" : "Agents unavailable"}
        </span>
      )}
      {props.modelSelection.state === "ready" ? (
        <>
          <ModelPicker
            options={props.modelSelection.models}
            selectedID={props.modelSelection.selectedModelID}
            disabled={
              props.modelSelection.disabled ||
              props.agentSelection.switching ||
              props.modelSelection.switching ||
              props.action === "sending"
            }
            onSelect={props.modelSelection.onSelectModel}
          />
          <VariantPicker
            placeholder="Select variant"
            unavailableLabel={
              props.modelSelection.selectedModelID === undefined
                ? "Variant unavailable"
                : "No variants"
            }
            options={props.modelSelection.variants}
            selectedID={props.modelSelection.selectedVariantID}
            disabled={
              props.modelSelection.disabled ||
              props.agentSelection.switching ||
              props.modelSelection.switching ||
              props.action === "sending"
            }
            onSelect={props.modelSelection.onSelectVariant}
          />
        </>
      ) : (
        <>
          <span class="composer-picker composer-picker--unavailable" aria-disabled="true">
            {props.modelSelection.state === "loading" ? "Loading models…" : "Models unavailable"}
          </span>
          <span class="composer-picker composer-picker--unavailable" aria-disabled="true">
            {props.modelSelection.state === "loading"
              ? "Loading variants…"
              : "Variants unavailable"}
          </span>
        </>
      )}
    </div>
  );
}

function selectionStatus(
  props: Pick<ComposerProps, "agentSelection" | "error" | "modelSelection">,
) {
  return (
    <>
      {props.error ? (
        <p class="composer-status composer-status--error" role="alert">
          {props.error}
        </p>
      ) : null}
      {props.agentSelection.switching ? (
        <p class="composer-status" role="status">
          Switching agent…
        </p>
      ) : null}
      {props.modelSelection.switching ? (
        <p class="composer-status" role="status">
          Switching selection…
        </p>
      ) : null}
      {props.modelSelection.error ? (
        <p class="composer-status composer-status--error" role="alert">
          {props.modelSelection.error}
        </p>
      ) : null}
      {props.agentSelection.error ? (
        <p class="composer-status composer-status--error" role="alert">
          {props.agentSelection.error}
        </p>
      ) : null}
    </>
  );
}

export function Composer(props: ComposerProps) {
  let editor: HTMLDivElement | undefined;
  let form: HTMLFormElement | undefined;
  let fileInput: HTMLInputElement | undefined;
  let editorControl: PromptEditorControl | undefined;
  let pickerSessionID: string | undefined;
  let dragDepth = 0;
  /**
   * The latest literal-clipboard read. Every read captures the session and the
   * generation that started it; a newer gesture, a session change, an emptied
   * draft, or disposal invalidates the pending insertion, so clipboard text can
   * never land in a draft it did not originate from.
   */
  let literalRead = 0;
  const [dropping, setDropping] = createSignal(false);
  const [pasteNotice, setPasteNotice] = createSignal<string | undefined>();
  const canAttach = () => props.onAttachFiles !== undefined;
  const review = () => props.review;
  const annotations = () => ((props.annotations?.count ?? 0) > 0 ? props.annotations : undefined);
  const sendable = () =>
    review() !== undefined ||
    annotations() !== undefined ||
    props.value.trim() !== "" ||
    (props.files?.length ?? 0) > 0;

  const stopping = () => props.action === "running" && !sendable();

  const canSubmit = () =>
    !props.disabled &&
    props.action !== "sending" &&
    !props.modelSelection.switching &&
    !props.agentSelection.switching &&
    sendable();

  const submit = (event?: Event) => {
    event?.preventDefault();
    if (!canSubmit()) return;
    // A successful submission resets the draft, so a pending literal read must
    // not land in the next one. This is the lifecycle boundary the parent's
    // `clearIfUnchanged` is invisible at for empty-text, attachment-only sends.
    literalRead += 1;
    props.onSubmit();
  };

  // The queue chord and its label follow the platform marker.
  const queueChord = (event: KeyboardEvent) => (isMacPlatform() ? event.metaKey : event.ctrlKey);

  const sendTooltip = () => {
    if (stopping()) return "Stop";
    if (props.onQueue) {
      const steer = props.action === "running" ? "Enter to steer" : "Enter to send";
      return `${steer} · ${isMacPlatform() ? "⌘" : "Ctrl"} Enter to queue · Shift Enter for a new line`;
    }
    return props.action === "running" ? "Send steering message (Enter)" : "Send";
  };

  const keyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || event.key !== "Enter" || event.shiftKey)
      return;
    event.preventDefault();
    if (queueChord(event)) {
      // The queue gesture never falls through to send, even when queueing is
      // unavailable or the draft is not eligible for submission.
      if (props.onQueue && canSubmit()) {
        // Queueing resets the draft like sending does; a pending literal read
        // must not land in the next draft.
        literalRead += 1;
        props.onQueue();
      }
      return;
    }
    submit();
  };

  const attach = (incoming: readonly File[]) => {
    if (!canAttach() || incoming.length === 0) return;
    props.onAttachFiles?.(incoming);
  };

  const openPicker = () => {
    if (!canAttach()) return;
    pickerSessionID = props.sessionID;
    fileInput?.click();
  };

  const onPickerChange = (event: Event & { currentTarget: HTMLInputElement }) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    // Reset so choosing the same file again re-fires the change event.
    input.value = "";
    const sessionID = pickerSessionID;
    pickerSessionID = undefined;
    // A selection made for one session must not attach to another.
    if (sessionID !== props.sessionID) return;
    attach(files);
  };

  const dragEnter = (event: DragEvent) => {
    if (!isFileTransfer(event.dataTransfer)) return;
    // Always cancel native navigation; only advertise an attachable drag.
    event.preventDefault();
    if (!canAttach()) return;
    dragDepth += 1;
    setDropping(true);
  };

  const dragOver = (event: DragEvent) => {
    if (!isFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = canAttach() ? "copy" : "none";
    }
  };

  const dragLeave = () => {
    if (dragDepth === 0) return;
    dragDepth -= 1;
    if (dragDepth === 0) setDropping(false);
  };

  const drop = (event: DragEvent) => {
    if (!isFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    setDropping(false);
    if (!canAttach()) return;
    attach(collectTransferFiles(event.dataTransfer));
  };

  /**
   * The explicit literal-paste gesture. The host clipboard read owns the
   * payload; preventing the keydown default also stops a platform that maps the
   * chord to its own paste-and-match-style from inserting a second time.
   */
  const literalChord = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (!isLiteralPasteChord(event)) return;
    event.preventDefault();
    pasteAsPlainText();
  };

  /**
   * The routing owner. One capture-phase listener decides the handling for the
   * whole payload, consumes the event it owns, and never lets ProseMirror or
   * native paste process the same paste twice.
   */
  const paste = (event: ClipboardEvent) => {
    const data = event.clipboardData;
    if (data === null) return;
    const control = editorControl;
    const files = readClipboardFiles(data);
    // An IME owns the document during a composition; text paste stays with the
    // browser and the IME, exactly as ProseMirror's own handler leaves it.
    if (files.length === 0 && control?.composing() === true) return;
    const codeBlock = control?.inCodeBlock() ?? false;
    const read = readClipboardText(data, { codeBlock });
    const decision = classifyPaste({
      files,
      text: read.text,
      html: read.html,
      htmlOversize: read.htmlOversize,
      codeBlock,
    });
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    switch (decision.route) {
      case "noop":
        consume();
        setPasteNotice(
          decision.reason === "html-inspection-limit"
            ? HTML_TOO_LARGE_NOTICE
            : decision.reason === "unsupported-html"
              ? UNSUPPORTED_HTML_NOTICE
              : undefined,
        );
        return;
      case "attachment-files":
        // Without an attachment owner the payload stays with native paste.
        if (!canAttach()) return;
        consume();
        setPasteNotice(undefined);
        attach(files);
        return;
      case "attachment-text":
        if (props.onAttachText === undefined) return;
        consume();
        setPasteNotice(undefined);
        props.onAttachText(read.text);
        return;
      default: {
        if (control === undefined) return;
        consume();
        const outcome = control.applyPaste({
          route: decision.route,
          text: read.text,
          html: read.html,
          event,
        });
        setPasteNotice(outcome === "unsupported" ? UNSUPPORTED_HTML_NOTICE : undefined);
        return;
      }
    }
  };

  /**
   * The context-menu escape hatch, also used by the keyboard chord. It uses the
   * same literal insertion, keeps focus in the editor, and explains when the
   * clipboard cannot be read instead of failing silently.
   */
  const pasteAsPlainText = () => {
    const readClipboard = props.readClipboardText;
    if (readClipboard === undefined) {
      setPasteNotice(CLIPBOARD_UNAVAILABLE_NOTICE);
      editorControl?.focus();
      return;
    }
    const sessionID = props.sessionID;
    literalRead += 1;
    const generation = literalRead;
    void readClipboard().then((text) => {
      // Only the latest read may insert, and only into the session that
      // started it. A -> B -> A still invalidates, because the session change
      // advanced the generation.
      if (generation !== literalRead || sessionID !== props.sessionID) return undefined;
      // The composer may have become unavailable while the host read was in
      // flight, and an IME owns the document during a composition.
      if (props.disabled || props.action === "sending") return undefined;
      if (editorControl?.composing() === true) return undefined;
      if (text === undefined) {
        setPasteNotice(CLIPBOARD_UNAVAILABLE_NOTICE);
        editorControl?.focus();
        return undefined;
      }
      // Even the explicit literal gesture must not insert an enormous payload;
      // it becomes a text attachment like the automatic route.
      if (text.length >= TEXT_ATTACHMENT_LIMIT) {
        if (props.onAttachText !== undefined) {
          setPasteNotice(undefined);
          props.onAttachText(text);
        } else {
          setPasteNotice(LITERAL_TOO_LARGE_NOTICE);
        }
        editorControl?.focus();
        return undefined;
      }
      if (text !== "") editorControl?.applyPaste({ route: "literal", text });
      editorControl?.focus();
      setPasteNotice(undefined);
      return undefined;
    });
  };

  const restorePaste = () => {
    const control = editorControl;
    // Restoring must not consume the retained source when no editor can
    // receive it; the recovery stays available for another attempt.
    if (control === undefined) return;
    const text = props.pasteRecovery?.take();
    if (text === undefined) return;
    control.applyPaste({ route: "literal", text });
    control.focus();
  };

  onMount(() => {
    const element = form;
    if (element === undefined) return;
    // Capture phase so files and text are routed before ProseMirror handles
    // the event; Solid does not delegate drag or paste events.
    element.addEventListener("dragenter", dragEnter, true);
    element.addEventListener("dragover", dragOver, true);
    element.addEventListener("dragleave", dragLeave, true);
    element.addEventListener("drop", drop, true);
    element.addEventListener("paste", paste, true);
    element.addEventListener("keydown", literalChord, true);
    onCleanup(() => {
      // Disposal invalidates a literal read that is still in flight.
      literalRead += 1;
      element.removeEventListener("dragenter", dragEnter, true);
      element.removeEventListener("dragover", dragOver, true);
      element.removeEventListener("dragleave", dragLeave, true);
      element.removeEventListener("drop", drop, true);
      element.removeEventListener("paste", paste, true);
      element.removeEventListener("keydown", literalChord, true);
    });
  });

  createEffect(
    on(
      () => props.sessionID,
      () => {
        // A drag, an open chooser, a paste notice, or a pending literal read
        // does not survive a session change.
        literalRead += 1;
        dragDepth = 0;
        setDropping(false);
        pickerSessionID = undefined;
        setPasteNotice(undefined);
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.value,
      (value) => {
        // A clear or a completed send empties the draft a pending literal read
        // was bound to; the read must not recreate it.
        if (value === "") literalRead += 1;
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    // Hide the drop state if attachment capability disappears mid-drag.
    if (canAttach()) return;
    dragDepth = 0;
    setDropping(false);
  });

  const attachButton = () => (
    <IconButton
      class="composer-attach"
      type="button"
      size="small"
      variant="ghost-muted"
      disabled={!canAttach()}
      aria-label="Add images and files"
      title="Add images and files"
      icon={<Icon name="plus" size="small" aria-hidden="true" />}
      onClick={openPicker}
    />
  );

  return (
    <>
      <form
        ref={(element) => {
          form = element;
        }}
        class="composer oc-focus-container"
        aria-label="Message composer"
        data-dropping={dropping() ? "true" : undefined}
        onSubmit={submit}
      >
        <input
          ref={(element) => {
            fileInput = element;
          }}
          class="composer-file-input"
          type="file"
          multiple
          hidden
          onChange={onPickerChange}
        />
        {review() ? (
          <div class="composer-review-row">
            <span class="composer-review-label">
              Code review · {review()!.count} {review()!.count === 1 ? "comment" : "comments"}
            </span>
            <IconButton
              class="composer-review-discard"
              type="button"
              size="small"
              variant="ghost-muted"
              aria-label={`Discard ${review()!.count} code review comments`}
              title={`Discard ${review()!.count} code review comments`}
              icon={<Icon name="close" size="small" aria-hidden="true" />}
              onClick={(event) => {
                review()?.onDiscard(event.currentTarget);
              }}
            />
          </div>
        ) : null}
        <Show when={annotations()}>
          {(annotation) => (
            <div class="composer-annotation-row">
              <Button
                class="composer-annotation-count"
                ref={annotation().ref}
                type="button"
                size="small"
                variant="ghost-muted"
                onClick={(event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
                  annotation().onOpen(event.currentTarget);
                }}
              >
                Annotations · {annotation().count}{" "}
                {annotation().count === 1 ? "comment" : "comments"}
              </Button>
              <IconButton
                class="composer-annotation-discard"
                disabled={props.disabled || props.action === "sending"}
                type="button"
                size="small"
                variant="ghost-muted"
                aria-label={`Discard ${annotation().count} annotations`}
                title={`Discard ${annotation().count} annotations`}
                icon={<Icon name="close" size="small" aria-hidden="true" />}
                onClick={(event) => {
                  annotation().onDiscard(event.currentTarget);
                }}
              />
            </div>
          )}
        </Show>
        <Show
          when={
            props.command !== undefined && (review() !== undefined || annotations() !== undefined)
          }
        >
          <p class="composer-status composer-kept-notice" role="status">
            Review comments and annotations stay attached for your next message.
          </p>
        </Show>
        <Show when={(props.files?.length ?? 0) > 0}>
          <ul class="composer-files" aria-label="Images and files">
            <For each={props.files ?? []}>
              {(file) => (
                <li class="composer-file">
                  <Show
                    when={isImageFile(file)}
                    fallback={
                      <span class="composer-file-name" title={file.name || "Pasted file"}>
                        {file.name || "Pasted file"}
                      </span>
                    }
                  >
                    <ImagePreview
                      file={file}
                      alt={file.name || "Pasted image"}
                      class="composer-file-preview"
                    />
                  </Show>
                  <IconButton
                    class="composer-file-remove"
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    aria-label={`Remove ${file.name || "Pasted file"}`}
                    icon={<Icon name="close" size="small" aria-hidden="true" />}
                    onClick={() => {
                      props.onRemoveFile?.(file);
                      editor?.focus();
                    }}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={props.pasteRecovery}>
          {(recovery) => (
            <div class="composer-paste-recovery" role="alert">
              <span class="composer-paste-recovery-message">{recovery().message}</span>
              <Button type="button" size="small" variant="ghost-muted" onClick={restorePaste}>
                Restore text
              </Button>
              <Button
                type="button"
                size="small"
                variant="ghost-muted"
                onClick={() => recovery().dismiss()}
              >
                Dismiss
              </Button>
            </div>
          )}
        </Show>
        <Show when={pasteNotice()}>
          <p class="composer-status composer-status--error" role="alert">
            {pasteNotice()}
          </p>
        </Show>
        <KobalteContextMenu
          onOpenChange={(open) => {
            // The menu is anchored to the editor: closing it, whatever the
            // reason, returns focus to the prompt without moving the caret.
            if (!open) editorControl?.focus();
          }}
        >
          <KobalteContextMenu.Trigger as="div" class="composer-editor-row">
            <PromptEditor
              ref={(element) => {
                editor = element;
              }}
              control={(value) => {
                editorControl = value;
              }}
              value={props.value}
              skills={props.skills}
              catalog={props.catalog}
              sessionID={props.sessionID}
              onInput={props.onInput}
              onKeyDown={keyDown}
              placeholder={
                props.action === "running" ? "Draft your next prompt…" : "Send a message…"
              }
            />
          </KobalteContextMenu.Trigger>
          <KobalteContextMenu.Portal>
            <KobalteContextMenu.Content class="composer-paste-menu">
              <KobalteContextMenu.Item
                class="composer-paste-menu-item"
                onSelect={() => {
                  pasteAsPlainText();
                }}
              >
                <KobalteContextMenu.ItemLabel>Paste as plain text</KobalteContextMenu.ItemLabel>
              </KobalteContextMenu.Item>
            </KobalteContextMenu.Content>
          </KobalteContextMenu.Portal>
        </KobalteContextMenu>

        <div class="composer-controls-row">
          {selectionControls(props, attachButton())}
          <Tooltip class="composer-action-tooltip" value={sendTooltip()}>
            <button
              class="composer-action"
              type={stopping() ? "button" : "submit"}
              aria-label={stopping() ? "Stop" : "Send"}
              disabled={stopping() ? props.onStop === undefined : !canSubmit()}
              onClick={(event) => {
                if (!stopping()) return;
                // Stopping may synchronously turn this same button into a submit button.
                event.preventDefault();
                props.onStop?.();
              }}
            >
              {stopping() ? (
                <Icon name="stop" size="small" aria-hidden="true" />
              ) : (
                <span class="composer-action-icon" aria-hidden="true">
                  {props.action === "sending" ? (
                    <Loader width={16} height={16} />
                  ) : (
                    <Icon name="arrow-up" />
                  )}
                </span>
              )}
            </button>
          </Tooltip>
        </div>

        {selectionStatus(props)}

        <Show when={dropping()}>
          <div class="composer-drop-overlay" aria-hidden="true">
            Drop files to add
          </div>
        </Show>
      </form>
    </>
  );
}
