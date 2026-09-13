import { describe, expect, it } from "vite-plus/test";
import { EditorState, TextSelection } from "prosemirror-state";
import { fromDraft, schema, slashQuery, toDraft } from "./document.ts";

describe("prompt document", () => {
  it("preserves blank lines and UTF-16 mention offsets across repeated skills", () => {
    const text = "🙂\n\nreview and review\n";
    const skills = [4, 15].map((start) => ({
      id: "review",
      name: "review",
      mention: { start, end: start + 6, text: "review" },
    }));
    expect(toDraft(fromDraft(text, skills))).toEqual({ text, skills });
  });

  it("leaves stale and overlapping mentions as ordinary text", () => {
    const valid = { id: "review", name: "review", mention: { start: 0, end: 6, text: "review" } };
    expect(toDraft(fromDraft("review", [valid, valid, { ...valid, name: "other" }]))).toEqual({
      text: "review",
      skills: [valid],
    });
  });

  it("uses model positions after an atomic skill and respects word boundaries", () => {
    const skill = { id: "review", name: "review", mention: { start: 0, end: 6, text: "review" } };
    const doc = fromDraft("review /te", [skill]);
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 6) });
    expect(slashQuery(state)).toEqual({ text: "te", from: 3, to: 6 });
    const path = fromDraft("src/re", []);
    expect(
      slashQuery(
        EditorState.create({ schema, doc: path, selection: TextSelection.create(path, 7) }),
      ),
    ).toBeUndefined();
    expect(
      slashQuery(state.apply(state.tr.setSelection(TextSelection.create(doc, 3, 6)))),
    ).toBeUndefined();
  });
});
