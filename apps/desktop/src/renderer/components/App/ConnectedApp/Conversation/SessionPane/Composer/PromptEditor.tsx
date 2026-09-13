import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { List, type ListRef } from "@opencode-ai/ui/list";
import { baseKeymap, splitBlock } from "prosemirror-commands";
import { closeHistory, history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Slice } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { batch, createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import type { ComposerProps } from "../Composer.tsx";
import { fromDraft, schema, slashQuery, toDraft } from "./PromptEditor/document.ts";
import "prosemirror-view/style/prosemirror.css";
import "./PromptEditor/PromptEditor.css";

type EditorProps = Pick<
  ComposerProps,
  "value" | "skills" | "skillCatalog" | "sessionID" | "onInput" | "onPasteFiles"
> & {
  placeholder: string;
  onKeyDown: (event: KeyboardEvent) => void;
  ref: (element: HTMLDivElement) => void;
};

/** ProseMirror owns editing; Solid owns suggestions and each skill's node view. */
export function PromptEditor(props: EditorProps) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  let list: ListRef | undefined;
  let sessionID = props.sessionID;
  const [query, setQuery] = createSignal<ReturnType<typeof slashQuery>>();
  const close = () => setQuery(undefined);
  const plugins = [
    history(),
    keymap({ "Mod-z": undo, "Shift-Mod-z": redo, "Mod-y": redo, "Shift-Enter": splitBlock }),
    keymap(baseKeymap),
  ];
  const insert = (skill: { id: string; name: string } | undefined) => {
    const range = query();
    if (!skill || !range || !view) return;
    const content = [schema.node("skill", skill), schema.text(" ")];
    const tr = closeHistory(view.state.tr).replaceWith(range.from, range.to, content);
    tr.setSelection(TextSelection.create(tr.doc, range.from + 2));
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
            if (["ArrowDown", "ArrowUp", "Enter"].includes(event.key) && !event.shiftKey) {
              if (!props.skillCatalog || props.skillCatalog.state === "ready")
                list?.onKeyDown(event);
              return true;
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
        <section class="prompt-skill-menu" aria-label="Skill suggestions">
          <div class="prompt-skill-heading">
            <Icon name="post-skill" size="small" />
            Skills
          </div>
          <Show
            when={!props.skillCatalog || props.skillCatalog.state === "ready"}
            fallback={
              <div class="prompt-skill-status" role="status">
                {props.skillCatalog?.state === "loading"
                  ? "Loading skills…"
                  : "Couldn’t load skills."}
                <Show when={props.skillCatalog?.state === "failed"}>
                  <button type="button" onClick={() => props.skillCatalog?.onRetry()}>
                    Try again
                  </button>
                </Show>
              </div>
            }
          >
            <List
              ref={(value) => {
                list = value;
              }}
              class="composer-model-list"
              items={[...(props.skillCatalog?.items ?? [])]}
              key={(skill) => skill.id}
              filterKeys={["name", "description"]}
              filter={query()?.text ?? ""}
              search={false}
              emptyMessage={
                props.skillCatalog?.items.length
                  ? "No matching skills."
                  : "No skills available for this project."
              }
              onSelect={insert}
            >
              {(skill) => (
                <span class="prompt-skill-option">
                  <span>/{skill.name}</span>
                  <span>{skill.description}</span>
                </span>
              )}
            </List>
          </Show>
          <div class="prompt-skill-heading">↑ ↓ navigate · Enter select · Esc close</div>
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
