import { describe, expect, it, vi } from "vite-plus/test";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { EditorView, type DirectEditorProps } from "prosemirror-view";

import { fromDraft, pasteContent, schema, toDraft } from "./document.ts";
import { promptPlugins } from "./plugins.ts";

/** A stand-in for the app's `handleKeyDown` view prop. */
type AppKeyHandler = (view: EditorView, event: KeyboardEvent) => boolean;

/**
 * Mounts the composer editor and drives it like a keyboard and a browser. The
 * optional handler stands in for the app's `handleKeyDown` view prop, which
 * the DOM guard must bypass during a composition.
 */
function editor(draft = "", appKeyDown?: AppKeyHandler) {
  const host = document.createElement("div");
  document.body.append(host);
  const doc = fromDraft(draft);
  const directProps: DirectEditorProps = {
    state: EditorState.create({
      schema,
      doc,
      selection: TextSelection.atEnd(doc),
      plugins: promptPlugins(),
    }),
  };
  if (appKeyDown !== undefined) directProps.handleKeyDown = appKeyDown;
  const view = new EditorView({ mount: host }, directProps);
  const type = (text: string) => {
    for (const character of text) {
      const { from, to } = view.state.selection;
      const insert = () => view.state.tr.insertText(character, from, to);
      const handled = view.someProp("handleTextInput", (handler) =>
        handler(view, from, to, character, insert),
      );
      if (!handled) view.dispatch(insert());
    }
  };
  const press = (key: string, modifiers: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });
    return view.someProp("handleKeyDown", (handler) => handler(view, event)) === true;
  };
  const select = (from: number, to: number) =>
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  // Dispatches on the editable DOM, where ProseMirror's own listeners and the
  // composition guard run, instead of calling a handler prop directly. The
  // legacy `keyCode` is applied before dispatch; engines that predate
  // `isComposing` report it on the event the handlers see.
  const domPress = (key: string, modifiers: KeyboardEventInit & { keyCode?: number } = {}) => {
    const { keyCode, ...init } = modifiers;
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    if (keyCode !== undefined) {
      Object.defineProperty(event, "keyCode", { value: keyCode, configurable: true });
    }
    view.dom.dispatchEvent(event);
    return event;
  };
  return {
    view,
    type,
    press,
    domPress,
    select,
    draft: () => toDraft(view.state.doc),
    block: () => view.state.doc.firstChild?.type.name ?? "",
    marksOf: (value: string) => {
      let marks: string[] | undefined;
      view.state.doc.descendants((node: Node) => {
        if (node.isText && node.text === value)
          marks = node.marks.map((mark) => mark.type.name).toSorted();
        return true;
      });
      return marks;
    },
    dispose: () => {
      view.destroy();
      host.remove();
    },
  };
}

/** The platform decides whether Mod is Meta or Ctrl, exactly as the keymap does. */
const primaryModifier = (): KeyboardEventInit =>
  /Mac|iP(hone|[oa]d)/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };

/** The mark names on a paragraph's second child, where the code mark can land. */
function secondChildMarks(doc: Node): string[] {
  const paragraph = doc.firstChild!;
  return paragraph.child(1).marks.map((mark) => mark.type.name);
}

describe("prompt editor plugins", () => {
  it("applies Markdown block shortcuts while typing", () => {
    const bullet = editor();
    bullet.type("- item");
    expect(bullet.block()).toBe("bullet_list");
    expect(bullet.draft().text).toBe("- item");
    bullet.dispose();

    const ordered = editor();
    ordered.type("1. item");
    expect(ordered.block()).toBe("ordered_list");
    expect(ordered.draft().text).toBe("1. item");
    ordered.dispose();

    const parenOrdered = editor();
    parenOrdered.type("1) item");
    expect(parenOrdered.block()).toBe("ordered_list");
    expect(parenOrdered.draft().text).toBe("1. item");
    parenOrdered.dispose();

    const quote = editor();
    quote.type("> quote");
    expect(quote.block()).toBe("blockquote");
    expect(quote.draft().text).toBe("> quote");
    quote.dispose();

    const heading = editor();
    heading.type("# title");
    expect(heading.block()).toBe("heading");
    expect(heading.draft().text).toBe("# title");
    heading.dispose();

    const code = editor();
    code.type("```ts ");
    expect(code.block()).toBe("code_block");
    code.type("const a = 1;");
    expect(code.draft().text).toBe("```ts\nconst a = 1;\n```");
    code.dispose();

    const emptyCode = editor();
    emptyCode.type("``` ");
    expect(emptyCode.block()).toBe("code_block");
    // An empty fence has no content line.
    expect(emptyCode.draft().text).toBe("```\n```");
    emptyCode.dispose();
  });

  it("leaves the code mark when typing after a code span", () => {
    const instance = editor();
    instance.type("`code`");
    expect(instance.marksOf("code")).toEqual(["code"]);
    // The mark is inclusive while the run is being typed; typing at the end of
    // a completed span leaves it instead of trapping the cursor.
    instance.type("plain");
    expect(instance.marksOf("plain")).toEqual([]);
    expect(instance.draft().text).toBe("`code`plain");
    instance.dispose();
  });

  it("applies Markdown inline shortcuts without losing content or marks", () => {
    const strong = editor();
    strong.type("**bold**");
    expect(strong.draft().text).toBe("**bold**");
    expect(strong.marksOf("bold")).toEqual(["strong"]);
    strong.dispose();

    const underscoreStrong = editor();
    underscoreStrong.type("__bold__");
    expect(underscoreStrong.draft().text).toBe("**bold**");
    underscoreStrong.dispose();

    const em = editor();
    em.type("a *b* c");
    expect(em.draft().text).toBe("a *b* c");
    expect(em.marksOf("b")).toEqual(["em"]);
    em.dispose();

    const underscoreEm = editor();
    underscoreEm.type("a _b_ c");
    expect(underscoreEm.draft().text).toBe("a *b* c");
    underscoreEm.dispose();

    const code = editor();
    code.type("use `code` here");
    expect(code.draft().text).toBe("use `code` here");
    expect(code.marksOf("code")).toEqual(["code"]);
    code.dispose();

    const strike = editor();
    strike.type("~~gone~~");
    // Strikethrough is not one of the composer's marks, so the tildes stay
    // literal text and the draft escapes them, since the transcript renders
    // GFM strikethrough.
    expect(strike.view.state.doc.textContent).toBe("~~gone~~");
    expect(strike.marksOf("gone")).toBeUndefined();
    expect(strike.draft().text).toBe("\\~\\~gone\\~\\~");
    strike.dispose();

    const link = editor();
    link.type("[text](https://x.dev)");
    expect(link.draft().text).toBe("[text](https://x.dev)");
    expect(link.marksOf("text")).toEqual(["link"]);
    link.dispose();

    const nested = editor();
    nested.type("**bold *italic* bold**");
    expect(nested.draft().text).toBe("**bold *italic* bold**");
    expect(nested.marksOf("italic")).toEqual(["em", "strong"]);
    nested.dispose();
  });

  it("leaves ordinary text alone", () => {
    const snake = editor();
    snake.type("some_file_name");
    expect(snake.view.state.doc.textContent).toBe("some_file_name");
    snake.dispose();

    const math = editor();
    math.type("2 * 3 * 4");
    expect(math.view.state.doc.textContent).toBe("2 * 3 * 4");
    math.dispose();

    const unclosed = editor();
    unclosed.type("*left open");
    unclosed.press("Enter", { shiftKey: true });
    unclosed.type("next");
    expect(unclosed.draft().text).toBe("\\*left open\nnext");
    unclosed.dispose();
  });

  it("keeps Markdown delimiters literal inside code", () => {
    const code = editor();
    code.type("``` ");
    code.type("**x** and *y*");
    expect(code.draft().text).toBe("```\n**x** and *y*\n```");
    expect(code.marksOf("x")).toBeUndefined();
    code.dispose();

    const span = editor();
    span.type("`**x**`");
    expect(span.draft().text).toBe("`**x**`");
    expect(span.marksOf("**x**")).toEqual(["code"]);
    span.dispose();

    const toggled = editor();
    toggled.press("e", primaryModifier());
    toggled.type("**x**");
    expect(toggled.draft().text).toBe("`**x**`");
    toggled.dispose();

    // A run-delimited span is left as literal text rather than consuming its
    // content as formatting.
    const multi = editor();
    multi.type("``**x**``");
    expect(multi.view.state.doc.textContent).toBe("``**x**``");
    expect(multi.marksOf("**x**")).toBeUndefined();
    expect(fromDraft(multi.draft().text).textContent).toBe("``**x**``");
    multi.dispose();
  });

  it("keeps escaped delimiters literal while typing", () => {
    const escaped = editor();
    escaped.type("\\*literal\\*");
    expect(escaped.view.state.doc.textContent).toBe("\\*literal\\*");
    const draft = escaped.draft();
    const restored = fromDraft(draft.text);
    restored.check();
    expect(restored.eq(escaped.view.state.doc)).toBe(true);
    expect(restored.textContent).toBe("\\*literal\\*");
    escaped.dispose();
  });

  it("keeps literal line starts after a line break", () => {
    const line = editor();
    line.type("first");
    line.press("Enter", { shiftKey: true });
    line.type("- not a list");
    expect(line.view.state.doc.textContent).toBe("first- not a list");
    expect(line.draft().text).toBe("first\n\\- not a list");
    line.dispose();
  });

  it("leaves a heading for a paragraph on Shift+Enter", () => {
    const heading = editor();
    heading.type("# Title");
    heading.press("Enter", { shiftKey: true });
    heading.type("body");
    expect(heading.draft().text).toBe("# Title\n\nbody");
    heading.dispose();
  });

  it("continues lists and code on Shift+Enter and breaks lines elsewhere", () => {
    const list = editor();
    list.type("- first");
    expect(list.press("Enter", { shiftKey: true })).toBe(true);
    list.type("second");
    expect(list.draft().text).toBe("- first\n- second");
    list.dispose();

    const paragraph = editor();
    paragraph.type("first");
    expect(paragraph.press("Enter", { shiftKey: true })).toBe(true);
    paragraph.type("second");
    expect(paragraph.draft().text).toBe("first\nsecond");
    paragraph.dispose();

    const code = editor();
    code.type("``` ");
    code.type("first");
    expect(code.press("Enter", { shiftKey: true })).toBe(true);
    code.type("second");
    expect(code.draft().text).toBe("```\nfirst\nsecond\n```");
    code.dispose();

    const leave = editor();
    leave.type("- first");
    leave.press("Enter", { shiftKey: true });
    leave.type("second");
    leave.press("Enter", { shiftKey: true });
    leave.press("Enter", { shiftKey: true });
    leave.type("plain");
    expect(leave.draft().text).toBe("- first\n- second\n\nplain");
    leave.dispose();
  });

  it("starts a new paragraph on an empty line so block rules can begin", () => {
    const quote = editor();
    quote.type("intro");
    quote.press("Enter", { shiftKey: true });
    quote.press("Enter", { shiftKey: true });
    quote.type("> quoted");
    expect(quote.draft().text).toBe("intro\n\n> quoted");
    quote.dispose();

    const list = editor();
    list.type("steps:");
    list.press("Enter", { shiftKey: true });
    list.press("Enter", { shiftKey: true });
    list.type("- one");
    expect(list.draft().text).toBe("steps:\n\n- one");
    list.dispose();
  });

  it("toggles marks from the keyboard", () => {
    const bold = editor();
    bold.type("abc");
    bold.select(1, 4);
    expect(bold.press("b", primaryModifier())).toBe(true);
    expect(bold.draft().text).toBe("**abc**");
    bold.dispose();
  });

  it("writes a code mark across a line break as separate code spans", () => {
    // Mod-e over a selection that spans a hard break.
    const toggled = editor();
    toggled.type("a");
    toggled.press("Enter", { shiftKey: true });
    toggled.type("b");
    toggled.select(1, toggled.view.state.doc.firstChild!.nodeSize - 1);
    expect(toggled.press("e", primaryModifier())).toBe(true);
    // The toggle marks the break too: this is the document that made the
    // serializer throw before it learned to split the span.
    expect(toggled.view.state.doc.firstChild!.child(1).type.name).toBe("hard_break");
    expect(secondChildMarks(toggled.view.state.doc)).toEqual(["code"]);
    const draft = toggled.draft();
    expect(draft.text).toBe("`a`\n`b`");
    toggled.dispose();

    // Shift+Enter while the code mark is active.
    const active = editor();
    active.press("e", primaryModifier());
    active.type("a");
    expect(active.press("Enter", { shiftKey: true })).toBe(true);
    active.type("b");
    expect(active.marksOf("a")).toEqual(["code"]);
    expect(active.marksOf("b")).toEqual(["code"]);
    expect(secondChildMarks(active.view.state.doc)).toEqual(["code"]);
    expect(active.draft().text).toBe("`a`\n`b`");
    active.dispose();

    // A transaction that adds the code mark directly, as paste or another
    // command would.
    const direct = editor("a\nb");
    direct.view.dispatch(
      direct.view.state.tr.addMark(
        1,
        direct.view.state.doc.firstChild!.nodeSize - 1,
        schema.marks.code!.create(),
      ),
    );
    expect(secondChildMarks(direct.view.state.doc)).toEqual(["code"]);
    expect(direct.draft().text).toBe("`a`\n`b`");
    direct.dispose();

    // The draft round-trips: text and break survive, and the code mark stays
    // on the text runs. The break itself has no code form on the wire.
    const restored = fromDraft(draft.text, draft.skills);
    restored.check();
    expect(restored.textContent).toBe("ab");
    const paragraph = restored.firstChild!;
    expect(paragraph.childCount).toBe(3);
    expect(paragraph.child(1).type.name).toBe("hard_break");
    expect(paragraph.child(0).marks.map((mark) => mark.type.name)).toEqual(["code"]);
    expect(paragraph.child(2).marks.map((mark) => mark.type.name)).toEqual(["code"]);
  });

  it("writes a code mark across an image as separate code spans", () => {
    const pasted = editor();
    pasted.type("a");
    pasted.view.dispatch(pasteContent(pasted.view.state, "![alt](x.png)"));
    pasted.type("b");
    pasted.select(1, pasted.view.state.doc.firstChild!.nodeSize - 1);
    expect(pasted.press("e", primaryModifier())).toBe(true);
    // The toggle marks the image, which is what used to throw.
    expect(secondChildMarks(pasted.view.state.doc)).toEqual(["code"]);
    const draft = pasted.draft();
    expect(draft.text).toBe("`a`![alt](x.png)`b`");
    pasted.dispose();

    const restored = fromDraft(draft.text, draft.skills);
    restored.check();
    expect(restored.textContent).toBe("ab");
    const paragraph = restored.firstChild!;
    expect(paragraph.childCount).toBe(3);
    expect(paragraph.child(1).type.name).toBe("image");
    expect(paragraph.child(0).marks.map((mark) => mark.type.name)).toEqual(["code"]);
    expect(paragraph.child(2).marks.map((mark) => mark.type.name)).toEqual(["code"]);
  });

  it("undoes an input rule with Backspace", () => {
    const undone = editor();
    undone.type("- ");
    expect(undone.block()).toBe("bullet_list");
    expect(undone.press("Backspace")).toBe(true);
    expect(undone.block()).toBe("paragraph");
    // The trailing space is written as a character reference: a plain one
    // would be stripped from the end of the paragraph when parsed again.
    expect(undone.draft().text).toBe("\\-&#x20;");
    undone.dispose();
  });
});

/** Dispatches a composition boundary event on the editor's editable DOM. */
function composition(view: EditorView, type: "compositionstart" | "compositionend") {
  const event = new CompositionEvent(type, { bubbles: true, cancelable: true, data: "" });
  view.dom.dispatchEvent(event);
  return event;
}

describe("prompt editor composition", () => {
  it("holds input rules while a composition is active", () => {
    const composing = editor();
    composition(composing.view, "compositionstart");
    composing.type("**bold**");
    expect(composing.marksOf("bold")).toBeUndefined();
    expect(composing.view.state.doc.textContent).toBe("**bold**");
    composing.dispose();
  });

  it("keeps keymaps, formatting and app handlers out of a composition at the DOM boundary", () => {
    const appKeys = vi.fn<AppKeyHandler>(() => false);
    const composed = editor("- one\n- two", appKeys);
    composition(composed.view, "compositionstart");
    const doc = composed.view.state.doc.toJSON();
    const selection = composed.view.state.selection.toJSON();
    const events = [
      composed.domPress("Tab"),
      composed.domPress("Enter"),
      composed.domPress("Enter", { shiftKey: true }),
      composed.domPress("b", primaryModifier()),
      composed.domPress("Backspace"),
    ];
    // The guard stops ProseMirror's handling without preventing the browser
    // default, so the input method still receives the key.
    for (const event of events) expect(event.defaultPrevented).toBe(false);
    expect(composed.view.state.doc.toJSON()).toEqual(doc);
    expect(composed.view.state.selection.toJSON()).toEqual(selection);
    expect(appKeys).not.toHaveBeenCalled();
    composed.dispose();

    // Control: without a composition the same key reaches the keymap and the
    // app handler.
    const plain = editor("- one\n- two", appKeys);
    const plainDoc = plain.view.state.doc.toJSON();
    plain.domPress("Tab");
    expect(plain.view.state.doc.toJSON()).not.toEqual(plainDoc);
    expect(appKeys).toHaveBeenCalled();
    plain.dispose();
  });

  it("consumes keydowns that only claim a composition through the payload", () => {
    for (const signal of ["isComposing", "keyCode229"]) {
      const appKeys = vi.fn<AppKeyHandler>(() => false);
      const harness = editor("- one\n- two", appKeys);
      const doc = harness.view.state.doc.toJSON();
      const selection = harness.view.state.selection.toJSON();
      const event =
        signal === "isComposing"
          ? harness.domPress("Tab", { isComposing: true })
          : harness.domPress("Tab", { keyCode: 229 });
      expect(event.defaultPrevented).toBe(false);
      expect(harness.view.state.doc.toJSON()).toEqual(doc);
      expect(harness.view.state.selection.toJSON()).toEqual(selection);
      expect(appKeys).not.toHaveBeenCalled();
      harness.dispose();
    }
  });

  // Two composition behaviors are deliberately not asserted here.
  //
  // D5: `prosemirror-inputrules` re-runs input rules 0 ms after
  // `compositionend` over IME-committed text, so a committed `**bold**`
  // becomes bold just after the commit. That is upstream behavior the plan
  // defers; the native protocol covers what a real input method commits.
  //
  // D4: on Safari-like engines ProseMirror drops the first keydown within
  // 500 ms of `compositionend`, so the guard must not be blamed for a lost
  // key. Electron on macOS is Chromium; the native protocol records the
  // platform behavior before any grace guard is considered.
});
