import { describe, expect, it } from "vite-plus/test";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import { EditorView } from "prosemirror-view";

import { fromDraft, schema, toDraft } from "./document.ts";
import { promptPlugins } from "./plugins.ts";

/** Mounts the composer editor and drives it like a keyboard and a browser. */
function editor(draft = "") {
  const host = document.createElement("div");
  document.body.append(host);
  const doc = fromDraft(draft);
  const view = new EditorView(
    { mount: host },
    {
      state: EditorState.create({
        schema,
        doc,
        selection: TextSelection.atEnd(doc),
        plugins: promptPlugins(),
      }),
    },
  );
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
  return {
    view,
    type,
    press,
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
    expect(strike.draft().text).toBe("\\~~gone\\~\\~");
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
