import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { List, type ListRef } from "@opencode/ui/list";
import { closeHistory } from "prosemirror-history";
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
import type { PromptSkillAttachment } from "@opencode/client";
import type { ComposerProps } from "../Composer.tsx";
import {
  fromDraft,
  pasteContent,
  promptPlugins,
  schema,
  serializeSlice,
  slashQuery,
  toDraft,
} from "@oc-ui/prompt-editor";
import "prosemirror-view/style/prosemirror.css";
import "./PromptEditor/PromptEditor.css";

type EditorProps = Pick<ComposerProps, "value" | "skills" | "catalog" | "sessionID" | "onInput"> & {
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
          refreshQuery(instance.composing ? undefined : slashQuery(instance.state));
          if (tr.docChanged) {
            const draft = toDraft(instance.state.doc);
            emitted = { text: draft.text, skills: draft.skills };
            batch(() => props.onInput(draft.text, draft.skills));
          }
        },
        handleKeyDown(editor, event) {
          if (editor.composing || event.isComposing || event.keyCode === 229) return false;
          if (query()) {
            if (event.key === "Escape") {
              dismiss();
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
              if (event.key === "Enter") {
                // The menu owns Enter while it is open, whatever its state.
                // A suggestion is selected when one exists; otherwise the key
                // is consumed so a no-match, loading, or failed menu cannot
                // send the draft behind it.
                if (listMounted() && items().length > 0) list?.onKeyDown(event);
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
          // Plain text stays the pasted representation. The policy itself is
          // owned by `pasteContent`: a code block takes it literally, and
          // anywhere else it is parsed as draft Markdown so pasted lists,
          // quotes and emphasis arrive as formatting. HTML-only payloads keep
          // ProseMirror's schema-based DOM handling. File payloads are owned
          // by the composer's capture listener; an absent format returns an
          // empty string, and treating it as text would replace the selection
          // with an empty slice and suppress ProseMirror's own URI handling.
          const text = event.clipboardData?.getData("text/plain");
          if (!text) return false;
          editor.dispatch(pasteContent(editor.state, text));
          return true;
        },
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
