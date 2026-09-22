import type { PromptSkillAttachment } from "@opencode/client";
import type { Mark, Node as PMNode } from "prosemirror-model";
import { describe, expect, it } from "vite-plus/test";

import { fromDraft, schema, toDraft } from "@oc-ui/prompt-editor";
import type { SentReviewComment } from "../../../../../../../opencode/code-review.ts";
import {
  createSessionPrompt,
  readSessionPromptMetadata,
} from "../../../../../../../opencode/session-prompt.ts";

/**
 * Deterministic offset table for the skill-chip pipeline.
 *
 * Authored drafts and directly constructed documents go through the codec:
 * every mention range is bounded, ordered and non-overlapping, indexes exactly
 * its name, agrees with `mention.text`, and survives as a fixed point of
 * `fromDraft` -> `toDraft`. The send path is checked separately: a plain send
 * keeps offsets, and a send with review metadata subtracts exactly the leading
 * trim from every range.
 *
 * Every case is a row; adding coverage means adding a row, never a generator.
 */

type Draft = {
  readonly text: string;
  readonly skills: readonly PromptSkillAttachment[];
};

const mention = (name: string, start: number, id = name): PromptSkillAttachment => ({
  id,
  name,
  mention: { start, end: start + name.length, text: name },
});

const text = (value: string, marks: readonly Mark[] = []) => schema.text(value, marks);
const skill = (id: string, name: string, marks: readonly Mark[] = []) =>
  schema.node("skill", { id, name }, undefined, marks);
const paragraph = (content: readonly PMNode[]) => schema.node("paragraph", null, content);
const documentOf = (content: readonly PMNode[]) => schema.node("doc", null, content);

const skillNamesOf = (doc: PMNode): string[] => {
  const names: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "skill") names.push(String(node.attrs.name));
    return true;
  });
  return names;
};

/** Every invariant the transcript and the send path rely on. */
function expectOffsets(draft: Draft, label: string) {
  let end = 0;
  for (const entry of draft.skills) {
    const range = entry.mention;
    expect(range, `${label}: ${entry.id} has no mention`).toBeDefined();
    if (range === undefined) continue;
    expect(
      range.start,
      `${label}: ${entry.id} starts after the previous mention`,
    ).toBeGreaterThanOrEqual(end);
    expect(range.end, `${label}: ${entry.id} ends after it starts`).toBeGreaterThanOrEqual(
      range.start,
    );
    expect(range.end, `${label}: ${entry.id} stays inside the text`).toBeLessThanOrEqual(
      draft.text.length,
    );
    expect(draft.text.slice(range.start, range.end), `${label}: ${entry.id} range`).toBe(
      entry.name,
    );
    expect(range.text, `${label}: ${entry.id} mention text`).toBe(entry.name);
    end = range.end;
  }
  const parsed = fromDraft(draft.text, draft.skills);
  parsed.check();
  expect(toDraft(parsed), `${label}: canonical fixed point`).toEqual(draft);
}

const reviewComment: SentReviewComment = {
  path: "src/app.ts",
  selection: { start: 1, end: 2 },
  selectedCode: "value",
  body: "Handle the empty value.",
};

describe("skill mention offsets", () => {
  it("holds for authored drafts", () => {
    const drafts: ReadonlyArray<readonly [string, Draft]> = [
      ["plain text before a mention", { text: "Use review now", skills: [mention("review", 4)] }],
      [
        "adjacent chips with surrounding text",
        {
          text: "Use reviewtesting tail",
          skills: [mention("review", 4, "sk-a"), mention("testing", 10, "sk-b")],
        },
      ],
      [
        "repeated names with distinct ids",
        {
          text: "review and review",
          skills: [mention("review", 0, "sk-a"), mention("review", 11, "sk-b")],
        },
      ],
      ["astral characters", { text: "🙂 review", skills: [mention("review", 3)] }],
      ["combining sequences", { text: "e\u0301 review", skills: [mention("review", 3)] }],
      ["ZWJ emoji", { text: "👨‍👩‍👧 review", skills: [mention("review", 9)] }],
      ["markdown-significant names", { text: "use *bold* now", skills: [mention("*bold*", 4)] }],
    ];
    for (const [label, draft] of drafts) {
      expect(draft.skills.length).toBeGreaterThan(0);
      expectOffsets(draft, label);
    }
  });

  it("holds for directly constructed documents", () => {
    const strong = schema.marks.strong!.create();
    const em = schema.marks.em!.create();
    const code = schema.marks.code!.create();
    const cases: ReadonlyArray<readonly [string, PMNode, readonly string[], readonly string[]]> = [
      [
        "adjacent chips",
        documentOf([paragraph([skill("sk-a", "review"), skill("sk-b", "testing"), text(" tail")])]),
        ["review", "testing"],
        ["sk-a", "sk-b"],
      ],
      [
        "mixed marked and unmarked skills",
        documentOf([
          paragraph([
            text("a ", [strong]),
            text("plain "),
            skill("sk-a", "one", [em]),
            text(" rest "),
            skill("sk-b", "two"),
          ]),
        ]),
        ["one", "two"],
        ["sk-a", "sk-b"],
      ],
      [
        "marked skill in a heading",
        documentOf([
          schema.node("heading", { level: 2 }, [
            text("Use "),
            skill("sk-a", "review", [em, code]),
            text(" now"),
          ]),
        ]),
        ["review"],
        ["sk-a"],
      ],
      [
        "skill in a list item",
        documentOf([
          schema.node("bullet_list", { tight: true }, [
            schema.node("list_item", null, [paragraph([text("Use "), skill("sk-a", "review")])]),
          ]),
        ]),
        ["review"],
        ["sk-a"],
      ],
      [
        "skill and break inside a blockquote",
        documentOf([
          schema.node("blockquote", null, [
            paragraph([skill("sk-a", "review"), schema.node("hard_break"), text(" "), text("b")]),
          ]),
        ]),
        ["review"],
        ["sk-a"],
      ],
      [
        "repeated names keep their ids",
        documentOf([
          paragraph([
            skill("sk-a", "review"),
            text(" and "),
            skill("sk-b", "review"),
            text(" done"),
          ]),
        ]),
        ["review", "review"],
        ["sk-a", "sk-b"],
      ],
    ];
    for (const [label, doc, names, ids] of cases) {
      doc.check();
      const draft = toDraft(doc);
      expectOffsets(draft, label);
      expect(
        draft.skills.map((entry) => entry.name),
        `${label}: names`,
      ).toEqual(names);
      expect(
        draft.skills.map((entry) => entry.id),
        `${label}: ids`,
      ).toEqual(ids);
      const reparsed = fromDraft(draft.text, draft.skills);
      expect(reparsed.eq(doc), `${label}: document survives`).toBe(true);
      expect(skillNamesOf(reparsed), `${label}: atoms in order`).toEqual(names);
    }
  });

  it("preserves offsets on a plain send and subtracts the leading trim with metadata", () => {
    const plain: Draft = {
      text: "Use review and testing now",
      skills: [mention("review", 4, "sk-a"), mention("testing", 15, "sk-b")],
    };
    expectOffsets(plain, "plain send input");
    const sent = createSessionPrompt({
      instruction: plain.text,
      skills: plain.skills,
      reviewComments: [],
      annotations: [],
    });
    expect(sent.text).toBe(plain.text);
    expect(sent.skills).toEqual(plain.skills);
    expect(sent.metadata).toBeUndefined();

    const instruction = "  review and review  ";
    const leading = instruction.length - instruction.trimStart().length;
    expect(leading).toBe(2);
    const authored: Draft = {
      text: instruction,
      skills: [mention("review", 2, "sk-a"), mention("review", 13, "sk-b")],
    };
    const withMetadata = createSessionPrompt({
      instruction: authored.text,
      skills: authored.skills,
      reviewComments: [reviewComment],
      annotations: [],
    });
    const metadata = readSessionPromptMetadata(withMetadata.metadata);
    expect(metadata?.instruction).toBe("review and review");
    const shifted = withMetadata.skills ?? [];
    expect(shifted.map((entry) => entry.id)).toEqual(["sk-a", "sk-b"]);
    for (const [index, entry] of shifted.entries()) {
      const before = authored.skills[index]!.mention!;
      const after = entry.mention!;
      expect(after.start).toBe(before.start - leading);
      expect(after.end).toBe(before.end - leading);
      expect(metadata!.instruction.slice(after.start, after.end)).toBe(entry.name);
    }
  });
});
