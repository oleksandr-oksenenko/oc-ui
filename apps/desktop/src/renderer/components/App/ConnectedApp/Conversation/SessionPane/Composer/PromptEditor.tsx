import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { List, type ListRef } from "@opencode/ui/list";
import { closeHistory } from "prosemirror-history";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { render } from "solid-js/web";
import type { PromptSkillAttachment } from "@opencode/client";
import type { ComposerProps } from "../Composer.tsx";
import {
  fromDraft,
  pasteContent,
  pastePlainText,
  promptPlugins,
  schema,
  serializeSlice,
  slashQuery,
  sliceHasInsertableContent,
  toDraft,
} from "@oc-ui/prompt-editor";
import "prosemirror-view/style/prosemirror.css";
import { sanitizePastedHtml } from "./pasteHtml.ts";
import { textFallbackRoute, type PasteRoute } from "./pasteRoute.ts";
import "./PromptEditor/PromptEditor.css";

/** One already-classified paste the composer hands to the editor to apply. */
type PromptPasteInsert = {
  /** The composer owns the attachment and no-op routes; only these reach the editor. */
  readonly route: Exclude<PasteRoute, "attachment-files" | "attachment-text" | "noop">;
  readonly text: string;
  readonly html?: string;
  /** The originating paste event, forwarded to ProseMirror's pipeline. */
  readonly event?: ClipboardEvent;
};

export type PromptEditorControl = {
  /** Moves focus into the editor without changing the selection. */
  focus: () => void;
  /** Whether the caret currently sits inside a code block. */
  inCodeBlock: () => boolean;
  /** Whether an IME composition currently owns the document. */
  composing: () => boolean;
  /**
   * Applies one classified paste to the current selection, dispatching at most
   * one transaction. `unsupported` means the HTML flavor produced nothing
   * insertable and there was no text fallback; the selection is unchanged.
   */
  applyPaste: (input: PromptPasteInsert) => "inserted" | "unsupported";
};

type EditorProps = Pick<ComposerProps, "value" | "skills" | "catalog" | "sessionID" | "onInput"> & {
  placeholder: string;
  onKeyDown: (event: KeyboardEvent) => void;
  ref: (element: HTMLDivElement) => void;
  control?: (control: PromptEditorControl | undefined) => void;
};

type Suggestion =
  | {
      readonly kind: "command";
      readonly key: string;
      readonly name: string;
      readonly description?: string;
    }
  | {
      readonly kind: "skill";
      readonly key: string;
      readonly id: string;
      readonly name: string;
      readonly description?: string;
    };

type SuggestionSection = {
  readonly label: "Commands" | "Skills";
  readonly state: "loading" | "ready" | "failed";
  readonly items: readonly Suggestion[];
};

/** Compares the skill attachments that belong with a draft value. */
function sameSkills(
  left: readonly PromptSkillAttachment[],
  right: readonly PromptSkillAttachment[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((skill, index) => {
    const other = right[index];
    if (other === undefined || skill.id !== other.id || skill.name !== other.name) return false;
    const before = skill.mention;
    const after = other.mention;
    if (before === undefined || after === undefined) return before === after;
    return before.start === after.start && before.end === after.end;
  });
}

/** ProseMirror owns editing; Solid owns suggestions and each skill's node view. */
export function PromptEditor(props: EditorProps) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let list: ListRef | undefined;
  let sessionID = props.sessionID;
  // The draft the editor last emitted, so its own controlled echo never
  // reparses over live editing.
  let emitted: { text: string; skills: readonly PromptSkillAttachment[] } | undefined;
  const [query, setQuery] = createSignal<ReturnType<typeof slashQuery>>();
  // The query Escape dismissed. The menu stays closed while that query is
  // unchanged, so the transaction a caret move or a formatting toggle emits
  // cannot immediately reopen it.
  let dismissed: ReturnType<typeof slashQuery>;
  const close = () => {
    dismissed = undefined;
    setQuery(undefined);
  };
  const dismiss = () => {
    const current = query();
    dismissed = current === undefined ? undefined : { ...current };
    setQuery(undefined);
  };
  const refreshQuery = (next: ReturnType<typeof slashQuery>) => {
    if (next === undefined) {
      dismissed = undefined;
      setQuery(undefined);
      return;
    }
    if (dismissed !== undefined) {
      const same =
        dismissed.from === next.from && dismissed.to === next.to && dismissed.text === next.text;
      if (same) return;
    }
    dismissed = undefined;
    setQuery(next);
  };
  const plugins = promptPlugins();
  const sections = createMemo<SuggestionSection[]>(() => {
    const current = query();
    const result: SuggestionSection[] = [];
    const commands = props.catalog?.commands;
    // Commands only run at the start of the message, so they are suggested there.
    if (current !== undefined && current.from === 1) {
      const state = commands?.state ?? "ready";
      result.push({
        label: "Commands",
        state,
        items:
          state === "ready"
            ? (commands?.items ?? []).map((item) => ({
                kind: "command" as const,
                key: `command:${item.name}`,
                name: item.name,
                description: item.description,
              }))
            : [],
      });
    }
    const skills = props.catalog?.skills;
    const skillState = skills?.state ?? "ready";
    result.push({
      label: "Skills",
      state: skillState,
      items:
        skillState === "ready"
          ? (skills?.items ?? []).map((item) => ({
              kind: "skill" as const,
              key: `skill:${item.id}`,
              id: item.id,
              name: item.name,
              description: item.description,
            }))
          : [],
    });
    return result;
  });
  const items = createMemo(() => sections().flatMap((section) => section.items));
  const unavailable = createMemo(() => sections().filter((section) => section.state !== "ready"));
  const listMounted = createMemo(
    () => query() !== undefined && (items().length > 0 || unavailable().length === 0),
  );
  const insert = (suggestion: Suggestion | undefined) => {
    const range = query();
    // `List` only reports a selection it currently renders, so the value and
    // the open menu are guaranteed here; the checks narrow the callback's
    // optional contract for the type checker only.
    if (!suggestion || !range || !view) return;
    const tr = closeHistory(view.state.tr);
    if (suggestion.kind === "command") {
      tr.replaceWith(range.from, range.to, schema.text(`/${suggestion.name} `));
      tr.setSelection(TextSelection.create(tr.doc, range.from + suggestion.name.length + 2));
    } else {
      tr.replaceWith(range.from, range.to, [
        schema.node("skill", { id: suggestion.id, name: suggestion.name }),
        schema.text(" "),
      ]);
      tr.setSelection(TextSelection.create(tr.doc, range.from + 2));
    }
    view.dispatch(tr);
    view.focus();
    close();
  };
  onMount(() => {
    // Set only while `applyPaste` runs an HTML paste, so ProseMirror's own
    // pipeline can replace a parse that produced nothing insertable. `doPaste`
    // always calls the `handlePaste` hook before it returns.
    let pendingHtmlFallback: Transaction | undefined;
    const instance = new EditorView(
      { mount: host },
      {
        state: EditorState.create({
          schema,
          doc: fromDraft(props.value, props.skills ?? []),
          plugins,
        }),
        attributes: {
          class: "composer-input oc-focus-delegate prompt-editor-input",
          role: "textbox",
          "aria-label": "Prompt",
          "aria-multiline": "true",
          tabindex: "0",
        },
        dispatchTransaction(tr) {
          instance.updateState(instance.state.apply(tr));
          refreshQuery(instance.composing ? undefined : slashQuery(instance.state));
          if (tr.docChanged) {
            const draft = toDraft(instance.state.doc);
            emitted = { text: draft.text, skills: draft.skills };
            batch(() => props.onInput(draft.text, draft.skills));
          }
        },
        handleKeyDown(_editor, event) {
          if (query()) {
            if (event.key === "Escape") {
              dismiss();
              return true;
            }
            if (!event.shiftKey) {
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items().length > 0) {
                list?.onKeyDown(event);
                return true;
              }
              if (event.key === "Enter") {
                // The menu owns Enter while it is open, whatever its state.
                // A suggestion is selected when one exists; otherwise the key
                // is consumed so a no-match, loading, or failed menu cannot
                // send the draft behind it.
                if (items().length > 0) list?.onKeyDown(event);
                return true;
              }
            }
          }
          props.onKeyDown(event);
          return event.defaultPrevented;
        },
        handleDOMEvents: {
          compositionstart() {
            close();
            return false;
          },
          blur(editor, event) {
            if (
              !(event.relatedTarget instanceof Node) ||
              !editor.dom.closest("form")?.contains(event.relatedTarget)
            )
              close();
            return false;
          },
        },
        // Runs inside ProseMirror's clipboard pipeline for the HTML route the
        // composer asked for. A usable parse is left to the pipeline itself
        // (return false); otherwise the fallback transaction is dispatched
        // here, so success and fallback each insert exactly once.
        handlePaste(editor, _event, slice) {
          const fallback = pendingHtmlFallback;
          if (fallback === undefined) return false;
          if (sliceHasInsertableContent(slice)) return false;
          editor.dispatch(fallback);
          return true;
        },
        // Unsafe link and image URIs are dropped before the schema parser can
        // turn them into marks or nodes.
        transformPastedHTML: (html) => sanitizePastedHtml(html),
        clipboardTextSerializer: (slice) => serializeSlice(slice.content),
        nodeViews: {
          skill(node, editor, getPos) {
            const dom = document.createElement("span");
            dom.className = "prompt-skill-chip";
            dom.contentEditable = "false";
            const [attrs, setAttrs] = createSignal(node.attrs);
            const dispose = render(
              () => (
                <>
                  <span class="prompt-skill-label">{attrs().name}</span>
                  <IconButton
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    aria-label={"Remove " + attrs().name + " skill"}
                    title="Remove skill"
                    icon={<Icon name="close" size="small" aria-hidden="true" />}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      const pos = getPos();
                      if (pos === undefined) return;
                      const next = editor.state.doc.nodeAt(pos + node.nodeSize);
                      const end =
                        pos +
                        node.nodeSize +
                        (next?.isText && /^[ \u00a0]/.test(next.text ?? "") ? 1 : 0);
                      editor.dispatch(closeHistory(editor.state.tr).delete(pos, end));
                      editor.focus();
                    }}
                  />
                </>
              ),
              dom,
            );
            return {
              dom,
              update(next) {
                if (next.type !== node.type) return false;
                node = next;
                setAttrs(next.attrs);
                return true;
              },
              stopEvent: (event) =>
                event.target instanceof Element && !!event.target.closest("button"),
              ignoreMutation: () => true,
              destroy: dispose,
            };
          },
        },
      },
    );
    view = instance;

    /** Applies one routed paste; the composer consumes the event exactly once. */
    const applyHtmlPaste = (
      text: string,
      html: string,
      event: ClipboardEvent | undefined,
    ): "inserted" | "unsupported" => {
      const fallbackRoute = textFallbackRoute(text);
      if (fallbackRoute === "noop") {
        // Nothing to fall back to. Inserting the empty parse would delete the
        // selection, so the caller surfaces feedback instead.
        return "unsupported";
      }
      const state = instance.state;
      pendingHtmlFallback =
        fallbackRoute === "markdown-parse"
          ? pasteContent(state, text)
          : pastePlainText(state, text);
      try {
        instance.pasteHTML(
          html,
          // ProseMirror constructs a ClipboardEvent when none is given, which
          // some test environments do not provide; the originating event is
          // forwarded instead so the pipeline hook can see it.
          event,
        );
        return "inserted";
      } finally {
        pendingHtmlFallback = undefined;
      }
    };

    props.control?.({
      focus: () => instance.focus(),
      inCodeBlock: () => instance.state.selection.$from.parent.type.spec.code === true,
      composing: () => instance.composing,
      applyPaste: (input) => {
        switch (input.route) {
          case "literal":
          case "plain-text":
          case "rich-link":
            instance.dispatch(pastePlainText(instance.state, input.text));
            return "inserted";
          case "markdown-parse":
            instance.dispatch(pasteContent(instance.state, input.text));
            return "inserted";
          case "html-parse":
            return applyHtmlPaste(input.text, input.html ?? "", input.event);
          default: {
            const unreachable: never = input.route;
            return unreachable;
          }
        }
      },
    });
    createEffect(() => {
      instance.dom.dataset.placeholder = props.placeholder;
      const value = props.value;
      const skills = props.skills ?? [];
      instance.dom.dataset.empty = String(value.length === 0);
      const changedSession = sessionID !== props.sessionID;
      sessionID = props.sessionID;
      // The editor's own draft echoed through the composer is not an external
      // edit; reparsing it would replace live formatting and the caret.
      if (
        !changedSession &&
        emitted !== undefined &&
        value === emitted.text &&
        sameSkills(skills, emitted.skills)
      )
        return;
      const doc = fromDraft(value, skills);
      if (!changedSession && doc.eq(instance.state.doc)) {
        emitted = { text: value, skills };
        return;
      }
      emitted = { text: value, skills };
      instance.updateState(EditorState.create({ schema, doc, plugins }));
      close();
    });
  });
  onCleanup(() => {
    view?.destroy();
    view = undefined;
    props.control?.(undefined);
  });
  return (
    <div class="prompt-editor">
      <Show when={query() !== undefined}>
        <section class="prompt-suggestion-menu" aria-label="Suggestions">
          <Show when={listMounted()}>
            <List
              ref={(value) => {
                list = value;
              }}
              class="composer-model-list"
              items={[...items()]}
              key={(suggestion) => suggestion.key}
              filterKeys={["name", "description"]}
              filter={query()?.text ?? ""}
              search={false}
              groupBy={(suggestion) => (suggestion.kind === "command" ? "Commands" : "Skills")}
              sortGroupsBy={(left, right) => groupRank(left.category) - groupRank(right.category)}
              groupHeader={renderSuggestionGroupHeader}
              emptyMessage={
                items().length
                  ? "No matching commands or skills."
                  : "No commands or skills available for this project."
              }
              onSelect={insert}
            >
              {(suggestion) => (
                <span class="prompt-suggestion-option">
                  <span>/{suggestion.name}</span>
                  <span>{suggestion.description}</span>
                </span>
              )}
            </List>
          </Show>
          <Show when={unavailable().length > 0}>
            <div class="prompt-suggestion-status" role="status">
              <For each={unavailable()}>
                {(section) => (
                  <span>
                    {section.state === "loading"
                      ? `Loading ${section.label.toLowerCase()}…`
                      : `Couldn’t load ${section.label.toLowerCase()}.`}
                    <Show when={section.state === "failed"}>
                      <button
                        type="button"
                        onClick={() => {
                          props.catalog?.onRetry();
                          view?.focus();
                        }}
                      >
                        Try again
                      </button>
                    </Show>
                  </span>
                )}
              </For>
            </div>
          </Show>
          <div class="prompt-suggestion-footer">↑ ↓ navigate · Enter select · Esc close</div>
        </section>
      </Show>
      <div
        ref={(element) => {
          host = element;
          props.ref(element);
        }}
      />
    </div>
  );
}

const groupRank = (category: string): number => (category === "Commands" ? 0 : 1);

function renderSuggestionGroupHeader(group: { readonly category: string }): JSX.Element {
  return (
    <span class="prompt-suggestion-heading">
      <Icon
        name={group.category === "Commands" ? "terminal-active" : "post-skill"}
        size="small"
        aria-hidden="true"
      />
      {group.category}
    </span>
  );
}
