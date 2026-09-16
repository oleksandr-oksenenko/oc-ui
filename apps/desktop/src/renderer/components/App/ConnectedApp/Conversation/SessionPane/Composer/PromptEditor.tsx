import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { List, type ListRef } from "@opencode/ui/list";
import { baseKeymap, splitBlock } from "prosemirror-commands";
import { closeHistory, history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Slice } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
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
import type { ComposerProps } from "../Composer.tsx";
import { fromDraft, schema, slashQuery, toDraft } from "./PromptEditor/document.ts";
import "prosemirror-view/style/prosemirror.css";
import "./PromptEditor/PromptEditor.css";

type EditorProps = Pick<
  ComposerProps,
  "value" | "skills" | "catalog" | "sessionID" | "onInput" | "onPasteFiles"
> & {
  placeholder: string;
  onKeyDown: (event: KeyboardEvent) => void;
  ref: (element: HTMLDivElement) => void;
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

/** ProseMirror owns editing; Solid owns suggestions and each skill's node view. */
export function PromptEditor(props: EditorProps) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let list: ListRef | undefined;
  let sessionID = props.sessionID;
  const [query, setQuery] = createSignal<ReturnType<typeof slashQuery>>();
  const [selectable, setSelectable] = createSignal(false);
  const close = () => {
    setQuery(undefined);
    setSelectable(false);
  };
  const plugins = [
    history(),
    keymap({ "Mod-z": undo, "Shift-Mod-z": redo, "Mod-y": redo, "Shift-Enter": splitBlock }),
    keymap(baseKeymap),
  ];
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
  createEffect(() => {
    if (!listMounted()) setSelectable(false);
  });
  const insert = (suggestion: Suggestion | undefined) => {
    const range = query();
    if (
      !suggestion ||
      !range ||
      !view ||
      !items().some((candidate) => candidate.key === suggestion.key)
    ) {
      return;
    }
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
          setQuery(instance.composing ? undefined : slashQuery(instance.state));
          if (tr.docChanged) {
            const draft = toDraft(instance.state.doc);
            batch(() => props.onInput(draft.text, draft.skills));
          }
        },
        handleKeyDown(editor, event) {
          if (editor.composing || event.isComposing || event.keyCode === 229) return false;
          if (query()) {
            if (event.key === "Escape") {
              close();
              return true;
            }
            if (!event.shiftKey) {
              if (
                (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                listMounted() &&
                items().length > 0
              ) {
                list?.onKeyDown(event);
                return true;
              }
              if (event.key === "Enter" && listMounted() && selectable()) {
                list?.onKeyDown(event);
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
        handlePaste(editor, event) {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length && props.onPasteFiles) {
            props.onPasteFiles(files);
            return true;
          }
          const text = event.clipboardData?.getData("text/plain");
          if (text === undefined) return false;
          editor.dispatch(
            editor.state.tr.replaceSelection(new Slice(fromDraft(text, []).content, 1, 1)),
          );
          return true;
        },
        clipboardTextSerializer: (slice) =>
          slice.content.textBetween(0, slice.content.size, "\n", (node) => node.attrs.name),
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
    createEffect(() => {
      instance.dom.dataset.placeholder = props.placeholder;
      instance.dom.dataset.empty = String(props.value.length === 0);
      const doc = fromDraft(props.value, props.skills ?? []);
      const changedSession = sessionID !== props.sessionID;
      sessionID = props.sessionID;
      if (!changedSession && doc.eq(instance.state.doc)) return;
      instance.updateState(EditorState.create({ schema, doc, plugins }));
      close();
    });
  });
  onCleanup(() => view?.destroy());
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
              onMove={(suggestion) => setSelectable(suggestion !== undefined)}
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
