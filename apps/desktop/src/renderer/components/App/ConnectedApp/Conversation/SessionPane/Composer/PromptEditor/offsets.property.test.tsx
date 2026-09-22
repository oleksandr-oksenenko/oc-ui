import type { PromptSkillAttachment } from "@opencode/client";
import type { Mark, Node as PMNode } from "prosemirror-model";
import { describe, expect, it } from "vite-plus/test";

import { fromDraft, schema, toDraft } from "@oc-ui/prompt-editor";
import type { SentReviewComment } from "../../../../../../../opencode/code-review.ts";
import {
  createSessionPrompt,
  readSessionPromptMetadata,
  type SessionPrompt,
} from "../../../../../../../opencode/session-prompt.ts";
import { mount } from "../../../../../../../test/mount.ts";
import { renderMarkdownCached } from "../../TranscriptView/AssistantMessage/Markdown/markdown.ts";
import { UserMessage } from "../../TranscriptView/UserMessage.tsx";

/**
 * Offset robustness harness for the skill-chip pipeline:
 *
 *   authored draft ──fromDraft──▶ doc ──toDraft──▶ canonical draft
 *        │                                              │
 *        └────────────── send path (createSessionPrompt) ┘
 *                              │
 *                              ▼
 *                       transcript chips
 *
 * Every offset is a UTF-16 code-unit range into a JavaScript string; the
 * invariants are (1) `text.slice(start, end) === name`, (2) ranges are
 * ordered and non-overlapping, (3) canonical drafts are fixed points of
 * fromDraft -> toDraft, (4) the send-path trim shifts offsets with the text,
 * and (5) transcript chips sit exactly where the mention ranges were.
 */

type Draft = {
  readonly text: string;
  readonly skills: readonly PromptSkillAttachment[];
};

type Piece =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "skill"; readonly id: string; readonly name: string };

/** Deterministic PRNG so every run explores the same cases. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  return values[Math.floor(random() * values.length)]!;
}

const authoredFragments = [
  "hello ",
  "world. ",
  "🙂 ",
  "👨‍👩‍👧‍👦 ",
  "🇺🇸 ",
  "e\u0301\u0327 ",
  "𝄞 ",
  "é ",
  "&#65; ",
  "&#x41; ",
  "&#xE000;00&#xE000; ",
  "&#128512; ",
  "&#9999999; ",
  "&#xD800; ",
  "\\*literal\\* ",
  "\\`tick\\` ",
  "\\\\ ",
  "*em* ",
  "**strong** ",
  "_under_ ",
  "`code` ",
  "``a`b`` ",
  "[link](https://x.dev/a) ",
  "[link](https://x.dev/a(b)) ",
  "<https://x.dev> ",
  "<Widget> ",
  "&amp; ",
  "<!-- comment --> ",
  "\\# no heading ",
  "# heading\n",
  "## heading\n",
  "- item ",
  "* item ",
  "+ item ",
  "1. item ",
  "1) item ",
  "> quote ",
  "```\ncode\n```\n",
  "~~~\ntilde\n~~~\n",
  "---\n",
  "===\n",
  "    indented\n",
  "\n",
  "\n\n",
  "a\nb ",
  "line  \nbreak ",
  "tab\there ",
  "\u00a0 ",
  "\u2028 ",
  "\u2063 ",
  "review ",
  " review",
  "a",
  "aa",
  "ab",
  "x7",
];

/** Adversarial but shape-plausible catalog names, including duplicates. */
const skillNames = [
  "review",
  "review",
  "review",
  "Review",
  "a",
  "aa",
  "ab",
  "code-review",
  "run tests",
  "docs",
  "pr",
  "plan",
  "*bold*",
  "a_b",
  "`tick`",
  "[x]",
  "#1",
  "1. item",
  "line\nbreak",
  "emoji🙂",
  "e\u0301",
  "&#xE000;mark",
  "\\slash",
  "a``b",
  "a``b",
];

function generatePieces(random: () => number, limit: number): Piece[] {
  const count = 3 + Math.floor(random() * 10);
  const pieces: Piece[] = [];
  for (let index = 0; index < count; index += 1) {
    if (random() < 0.3) {
      const name = pick(random, skillNames);
      pieces.push({ kind: "skill", id: `sk-${index}-${Math.floor(random() * 1e6)}`, name });
    } else {
      const parts = 1 + Math.floor(random() * 3);
      let value = "";
      for (let part = 0; part < parts; part += 1) value += pick(random, authoredFragments);
      pieces.push({ kind: "text", value: value.slice(0, limit) });
    }
  }
  return pieces;
}

function authoredDraft(pieces: readonly Piece[]): Draft {
  let text = "";
  const skills: PromptSkillAttachment[] = [];
  for (const piece of pieces) {
    if (piece.kind === "text") {
      text += piece.value;
      continue;
    }
    const start = text.length;
    text += piece.name;
    skills.push({
      id: piece.id,
      name: piece.name,
      mention: { start, end: text.length, text: piece.name },
    });
  }
  return { text, skills };
}

/** The canonical draft of generated pieces: parse then serialize. */
function canonicalOf(pieces: readonly Piece[]): Draft {
  const authored = authoredDraft(pieces);
  return toDraft(fromDraft(authored.text, authored.skills));
}

/** The transcript's inline-skill filter, shared by the user message views. */
function inlineSkills(
  text: string,
  skills: readonly PromptSkillAttachment[],
): PromptSkillAttachment[] {
  let end = 0;
  return skills.filter((skill) => {
    const mention = skill.mention;
    if (!mention || mention.start < end || text.slice(mention.start, mention.end) !== skill.name)
      return false;
    end = mention.end;
    return true;
  });
}

function mentionViolation(label: string, draft: Draft): string | undefined {
  let end = 0;
  for (const skill of draft.skills) {
    const mention = skill.mention;
    if (!mention) return `${label}: missing mention for ${JSON.stringify(skill)}`;
    if (mention.end < mention.start) return `${label}: inverted range ${JSON.stringify(skill)}`;
    if (mention.start < end) return `${label}: unordered/overlapping ${JSON.stringify(skill)}`;
    const slice = draft.text.slice(mention.start, mention.end);
    if (slice !== skill.name)
      return `${label}: range does not index the name ${JSON.stringify({ skill, slice })}`;
    if (mention.text !== skill.name)
      return `${label}: mention.text disagrees ${JSON.stringify(skill)}`;
    end = mention.end;
  }
  return undefined;
}

function skillNamesOf(doc: PMNode): string[] {
  const names: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "skill") names.push(String(node.attrs.name));
    return true;
  });
  return names;
}

type ParsedDraft =
  | { readonly ok: true; readonly doc: PMNode }
  | { readonly ok: false; readonly message: string };

/** `fromDraft` can return a document the schema rejects; report it instead of crashing. */
function parseChecked(text: string, skills: readonly PromptSkillAttachment[]): ParsedDraft {
  const doc = fromDraft(text, skills);
  try {
    doc.check();
  } catch (error) {
    return { ok: false, message: `invalid document: ${String(error)}` };
  }
  return { ok: true, doc };
}

/** Parse -> serialize twice: the canonical draft must already be a fixed point. */
function canonicalViolation(draft: Draft): string | undefined {
  const again = toDraft(fromDraft(draft.text, draft.skills));
  if (JSON.stringify(again) !== JSON.stringify(draft))
    return `canonical: not a fixed point ${JSON.stringify({ draft, again })}`;
  return undefined;
}

/** Offset invariants only: schema validity of the parsed document is pinned separately. */
function authoredOffsetsViolation(pieces: readonly Piece[]): string | undefined {
  const authored = authoredDraft(pieces);
  const doc = fromDraft(authored.text, authored.skills);
  const draft = toDraft(doc);
  const mention = mentionViolation("authored", draft);
  if (mention) return mention;
  return canonicalViolation(draft);
}

const builtTextFragments = [
  "plain",
  "🙂",
  "e\u0301",
  "𝄞",
  "&#65;",
  "&amp;",
  "<tag>",
  "\\*",
  "*star*",
  "**bold**",
  "`code`",
  "``a`b``",
  "[l](https://x.dev)",
  "a b",
  "x",
  "review",
  "a",
  "aa",
  "ab",
];

const builtBlockNames = [
  "paragraph",
  "heading",
  "bullet_list",
  "blockquote",
  "code_block",
] as const;

function generateMarks(random: () => number): Mark[] {
  const marks: Mark[] = [];
  if (random() < 0.2) marks.push(schema.marks.strong!.create());
  if (random() < 0.15) marks.push(schema.marks.em!.create());
  if (random() < 0.15) marks.push(schema.marks.code!.create());
  if (random() < 0.1) marks.push(schema.marks.link!.create({ href: "https://x.dev/a" }));
  return marks;
}

/** A run that carries formatting: marked text or a skill atom. */
const isMarked = (node: PMNode | undefined): boolean =>
  node !== undefined && ((node.isText && node.marks.length > 0) || node.type.name === "skill");

function sameMarks(left: PMNode, right: PMNode): boolean {
  return (
    left.isText &&
    right.isText &&
    left.marks.length === right.marks.length &&
    left.marks.every((mark, index) => right.marks[index]!.eq(mark))
  );
}

/** Merges adjacent same-mark text and separates runs whose marks differ. */
function mergeInlineRuns(nodes: readonly PMNode[]): PMNode[] {
  const merged: PMNode[] = [];
  for (const node of nodes) {
    if (node.type.name === "hard_break") {
      if (merged.length === 0 || merged[merged.length - 1]!.type.name === "hard_break") continue;
      merged.push(node);
      continue;
    }
    const previous = merged[merged.length - 1];
    if (previous !== undefined && sameMarks(previous, node)) {
      merged[merged.length - 1] = schema.text(previous.text! + node.text!, previous.marks);
      continue;
    }
    if (previous !== undefined && (isMarked(previous) || isMarked(node)))
      merged.push(schema.text(" "));
    merged.push(node);
  }
  while (merged.length > 0 && merged[merged.length - 1]!.type.name === "hard_break") merged.pop();
  return merged;
}

/** Drops whitespace-only runs at a block edge or a line start, which are not representable. */
function trimInlineEdges(nodes: readonly PMNode[]): PMNode[] {
  const cleaned: PMNode[] = [];
  for (const node of nodes) {
    if (node.isText && /^[ \t]*$/.test(node.text ?? "")) {
      const previous = cleaned[cleaned.length - 1];
      if (previous === undefined || previous.type.name === "hard_break") continue;
    }
    cleaned.push(node);
  }
  while (cleaned.length > 0) {
    const last = cleaned[cleaned.length - 1]!;
    if (last.isText && /^[ \t]*$/.test(last.text ?? "")) cleaned.pop();
    else break;
  }
  return cleaned;
}

/**
 * Merges adjacent same-mark text and separates runs whose marks differ. The
 * separation keeps the serializer's delimiter runs from becoming ambiguous
 * (`**a***b*`), which is a known serializer limitation pinned by a repro test.
 */
function normalizeInline(nodes: readonly PMNode[]): PMNode[] {
  return trimInlineEdges(mergeInlineRuns(nodes));
}

function generateInline(random: () => number): PMNode[] {
  const count = 1 + Math.floor(random() * 6);
  const nodes: PMNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const roll = random();
    if (roll < 0.15 && nodes.length > 0 && nodes[nodes.length - 1]!.type.name !== "hard_break") {
      nodes.push(schema.node("hard_break"));
    } else if (roll < 0.4) {
      const name = pick(random, skillNames);
      // A code-marked name with a two-backtick run serializes to a fence that
      // would open a code block at line start; that case is out of scope here.
      const marks = generateMarks(random).filter(
        (mark) => !(name.includes("``") && mark.type.spec.code === true),
      );
      nodes.push(schema.node("skill", { id: `sk-${index}`, name }, undefined, marks));
    } else {
      nodes.push(schema.text(pick(random, builtTextFragments), generateMarks(random)));
    }
  }
  return normalizeInline(nodes);
}

/** The heading schema holds text and images only; no breaks or skill atoms. */
function generateHeadingInline(random: () => number): PMNode[] {
  const count = 1 + Math.floor(random() * 4);
  return normalizeInline(
    Array.from({ length: count }, () =>
      schema.text(pick(random, builtTextFragments), generateMarks(random)),
    ),
  );
}

function generateBlock(random: () => number): PMNode[] {
  const kind = pick(random, builtBlockNames);
  if (kind === "paragraph") return [schema.node("paragraph", null, generateInline(random))];
  if (kind === "heading")
    return [
      schema.node(
        "heading",
        { level: 1 + Math.floor(random() * 3) },
        generateHeadingInline(random),
      ),
    ];
  if (kind === "blockquote")
    return [
      schema.node("blockquote", null, [schema.node("paragraph", null, generateInline(random))]),
    ];
  if (kind === "bullet_list") {
    const items = 1 + Math.floor(random() * 3);
    return [
      schema.node(
        "bullet_list",
        { tight: true },
        Array.from({ length: items }, () =>
          schema.node("list_item", null, [schema.node("paragraph", null, generateInline(random))]),
        ),
      ),
    ];
  }
  return [
    schema.node("code_block", { params: "" }, [
      schema.text(pick(random, ["const a = 1;", "plain line", "``` inner", "&#65; code"])),
    ]),
  ];
}

const listTypes = new Set(["bullet_list", "ordered_list"]);

function generateDoc(random: () => number): PMNode {
  const count = 1 + Math.floor(random() * 3);
  const blocks: PMNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = generateBlock(random);
    const first = next[0]!;
    const previous = blocks[blocks.length - 1];
    // Adjacent lists of one type are a single list in Markdown; the serializer
    // intentionally merges them, so they are not a fidelity target here.
    if (
      previous !== undefined &&
      listTypes.has(first.type.name) &&
      previous.type.name === first.type.name
    )
      continue;
    blocks.push(...next);
  }
  if (blocks.length === 0) blocks.push(schema.node("paragraph", null, [schema.text("plain")]));
  return schema.node("doc", null, blocks);
}

/** Offset invariants for a composer-built document: ranges index names and atoms. */
function builtOffsetViolation(doc: PMNode): string | undefined {
  const draft = toDraft(doc);
  const mention = mentionViolation("built", draft);
  if (mention) return mention;
  const parsed = parseChecked(draft.text, draft.skills);
  if (!parsed.ok) return `built: ${parsed.message}`;
  const expected = skillNamesOf(doc);
  const actual = draft.skills.map((skill) => skill.name);
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    return `built: atoms and mentions disagree ${JSON.stringify({ expected, actual })}`;
  return undefined;
}

/**
 * Content-fidelity check (document equality and draft fixed point). The
 * generator avoids the known lossy shapes so this stays usable as a second
 * layer of evidence for representable documents.
 */
function builtFidelityViolation(doc: PMNode): string | undefined {
  const draft = toDraft(doc);
  const parsed = parseChecked(draft.text, draft.skills);
  if (!parsed.ok) return `built: ${parsed.message} ${JSON.stringify(draft)}`;
  if (!parsed.doc.eq(doc))
    return `built: document changed on round trip ${JSON.stringify({
      draft,
      before: doc.toJSON(),
      after: parsed.doc.toJSON(),
    })}`;
  const again = toDraft(parsed.doc);
  if (JSON.stringify(again) !== JSON.stringify(draft))
    return `built: not a fixed point ${JSON.stringify({ draft, again })}`;
  return undefined;
}

const reviewComment: SentReviewComment = {
  path: "src/app.ts",
  selection: { start: 1, end: 2 },
  selectedCode: "value",
  body: "Handle the empty value.",
};

/** Mirrors the composer's send path for a prompt with review comments. */
function sendPathViolation(draft: Draft): string | undefined {
  const plain = createSessionPrompt({
    instruction: draft.text,
    skills: draft.skills,
    reviewComments: [],
    annotations: [],
  });
  if (plain.text !== draft.text) return "send: plain text changed";
  if (JSON.stringify(plain.skills ?? []) !== JSON.stringify(draft.skills))
    return "send: plain skills changed";

  const sent = createSessionPrompt({
    instruction: draft.text,
    skills: draft.skills,
    reviewComments: [reviewComment],
    annotations: [],
  });
  const meta = readSessionPromptMetadata(sent.metadata);
  if (meta === undefined) return "send: metadata missing";
  const skills = sent.skills ?? [];
  if (skills.length !== draft.skills.length) return "send: skills dropped";
  const payloadViolation = mentionViolation("send:payload", { text: sent.text, skills });
  if (payloadViolation) return payloadViolation;
  const leading = draft.text.length - draft.text.trimStart().length;
  for (const [index, skill] of skills.entries()) {
    const before = draft.skills[index]!.mention!;
    const after = skill.mention!;
    if (after.start !== before.start - leading || after.end !== before.end - leading)
      return `send: shift is not the leading trim ${JSON.stringify({ before, after, leading })}`;
  }
  const instruction = meta.instruction;
  const inline = inlineSkills(instruction, skills);
  if (inline.length !== skills.length) return "send: transcript filter rejected skills";
  for (const skill of inline) {
    const mention = skill.mention!;
    if (instruction.slice(mention.start, mention.end) !== skill.name)
      return "send: transcript instruction disagrees with offsets";
  }
  return undefined;
}

/**
 * Renders the sent message and proves each chip replaces exactly its mention
 * range: the DOM, with chips rewritten back to unique tokens, must equal a
 * reference render of the instruction with the same tokens substituted.
 */
function transcriptViolation(sent: SessionPrompt): string | undefined {
  const instruction = readSessionPromptMetadata(sent.metadata)?.instruction;
  if (instruction === undefined) return "transcript: instruction missing";
  const skills = sent.skills ?? [];
  const valid = inlineSkills(instruction, skills);
  if (valid.length === 0) return undefined;
  const tokens = valid.map((_, index) => `\u0001${index}\u0001`);
  let reference = "";
  let end = 0;
  valid.forEach((skill, index) => {
    const mention = skill.mention!;
    reference += instruction.slice(end, mention.start) + tokens[index];
    end = mention.end;
  });
  reference += instruction.slice(end);

  const { host, dispose } = mount(() => (
    <UserMessage
      message={{
        id: "offset-property",
        type: "user",
        time: { created: 1 },
        text: sent.text,
        skills: [...skills],
        metadata: sent.metadata,
      }}
    />
  ));
  try {
    const bubble = host.querySelector<HTMLElement>(".transcript-user-bubble");
    if (bubble === null) return "transcript: instruction bubble missing";
    const instructionRoot = bubble.querySelector<HTMLElement>(".transcript-user-instruction");
    if (instructionRoot === null) return "transcript: instruction render missing";
    const chips = [...host.querySelectorAll<HTMLElement>(".transcript-skill-chip")];
    if (chips.length !== valid.length)
      return `transcript: ${chips.length} chips for ${valid.length} mentions`;
    const chipNames = chips.map((chip) => chip.textContent);
    const expectedNames = valid.map((skill) => skill.name);
    if (JSON.stringify(chipNames) !== JSON.stringify(expectedNames))
      return `transcript: chips out of order ${JSON.stringify({ chipNames, expectedNames })}`;
    const clone = instructionRoot.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return "transcript: instruction clone missing";
    [...clone.querySelectorAll<HTMLElement>(".transcript-skill-chip")].forEach((chip, index) => {
      chip.replaceWith(clone.ownerDocument.createTextNode(tokens[index]!));
    });
    const referenceHost = document.createElement("div");
    referenceHost.innerHTML = renderMarkdownCached(reference);
    if (clone.textContent !== referenceHost.textContent)
      return `transcript: chips sit at the wrong ranges ${JSON.stringify({ actual: clone.textContent, reference: referenceHost.textContent })}`;
    return undefined;
  } finally {
    dispose();
  }
}

function minimize(
  pieces: readonly Piece[],
  fails: (candidate: readonly Piece[]) => boolean,
): Piece[] {
  let current = [...pieces];
  let reduced = true;
  while (reduced) {
    reduced = false;
    for (let index = 0; index < current.length; index += 1) {
      const candidate = [...current.slice(0, index), ...current.slice(index + 1)];
      if (candidate.length > 0 && fails(candidate)) {
        current = candidate;
        reduced = true;
        break;
      }
    }
  }
  return current;
}

const SENT_WITH_COMMENTS = {
  reviewComments: [reviewComment],
  annotations: [] as const,
};

const mention = (name: string, start: number, id = name): PromptSkillAttachment => ({
  id,
  name,
  mention: { start, end: start + name.length, text: name },
});

describe("skill mention offsets", () => {
  it("holds for adversarial authored drafts across parse, serialize and send", () => {
    const random = mulberry32(0xc0ffee);
    const violations: string[] = [];
    for (let index = 0; index < 600; index += 1) {
      const pieces = generatePieces(random, 60);
      const violation = authoredOffsetsViolation(pieces);
      if (violation !== undefined) {
        const minimal = minimize(
          pieces,
          (candidate) => authoredOffsetsViolation(candidate) !== undefined,
        );
        violations.push(
          `case ${index}: ${violation}\nminimal pieces: ${JSON.stringify(minimal)}\nminimal draft: ${JSON.stringify(authoredDraft(minimal))}`,
        );
        continue;
      }

      if (index % 5 !== 0) continue;
      const draft = canonicalOf(pieces);
      const send = sendPathViolation(draft);
      if (send !== undefined) {
        const minimal = minimize(
          pieces,
          (candidate) => sendPathViolation(canonicalOf(candidate)) !== undefined,
        );
        violations.push(`case ${index}: ${send}\nminimal pieces: ${JSON.stringify(minimal)}`);
        continue;
      }
      const sent = createSessionPrompt({
        instruction: draft.text,
        skills: draft.skills,
        ...SENT_WITH_COMMENTS,
      });
      const transcript = transcriptViolation(sent);
      if (transcript !== undefined) {
        violations.push(
          `case ${index}: ${transcript}\ndraft: ${JSON.stringify({ instruction: draft.text, skills: draft.skills })}`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it("holds for documents built as the composer builds them", () => {
    const random = mulberry32(0xdeadbeef);
    for (let index = 0; index < 300; index += 1) {
      const doc = generateDoc(random);
      doc.check();
      const offsetViolation = builtOffsetViolation(doc);
      expect(offsetViolation, `case ${index}: ${JSON.stringify(doc.textContent)}`).toBeUndefined();
      const fidelityViolation = builtFidelityViolation(doc);
      expect(
        fidelityViolation,
        `case ${index}: ${JSON.stringify(doc.textContent)}`,
      ).toBeUndefined();
    }
  });

  /**
   * The remaining known content-fidelity failure found by this harness. It is
   * not mention-offset drift: the ranges stay correct and the skill atom
   * survives; only the emphasis formatting is lost. The authoritative record
   * is the package corpus case `emphasis adjacent to skill`
   * (`packages/prompt-editor/src/markdown-corpus.test.ts`).
   */
  it("records the emphasis-adjacent-skill loss with its surviving skill offsets", () => {
    // `*a`b`*aa` cannot close the emphasis run before the skill name: the
    // closing `*` follows a code span and precedes a letter, so CommonMark
    // leaves it literal and the emphasis mark is lost. The draft text, the
    // skill identity and the mention offsets must survive — a worse regression
    // (a dropped atom or a leaked placeholder) fails before the expected loss.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("a", [schema.marks.em!.create()]),
        schema.text("b", [schema.marks.em!.create(), schema.marks.code!.create()]),
        schema.node("skill", { id: "aa", name: "aa" }),
      ]),
    ]);
    const draft = toDraft(doc);
    expect(draft.text).toBe("*a`b`*aa");
    expect(draft.skills).toEqual([mention("aa", 6)]);
    expect(mentionViolation("known-loss", draft)).toBeUndefined();

    const reparsed = fromDraft(draft.text, draft.skills);
    expect(skillNamesOf(reparsed)).toEqual(["aa"]);
    expect(reparsed.textContent).toBe("*ab*");
    expect(mentionViolation("known-loss", toDraft(reparsed))).toBeUndefined();

    // The expected formatting loss: the round trip is not document-equal.
    expect(reparsed.eq(doc)).toBe(false);
    expect(reparsed.firstChild!.firstChild!.marks).toEqual([]);
  });

  it("admits a mention inside a heading as a schema-valid skill atom", () => {
    // The bundled heading schema allows only text and images; the composer's
    // schema admits the skill atom, so a mention in a heading stays valid.
    const doc = fromDraft("# review\n", [mention("review", 2)]);
    doc.check();
    expect(doc.firstChild?.type.name).toBe("heading");
    expect(skillNamesOf(doc)).toEqual(["review"]);
    expect(mentionViolation("heading", toDraft(doc))).toBeUndefined();
  });

  it("keeps a space after a hard break inside a blockquote", () => {
    // `> a\n>  b` used to lose the second space to the blockquote marker
    // padding, so the parsed line started at `b`.
    const doc = schema.node("doc", null, [
      schema.node("blockquote", null, [
        schema.node("paragraph", null, [
          schema.text("a"),
          schema.node("hard_break"),
          schema.text(" "),
          schema.text("b"),
        ]),
      ]),
    ]);
    const draft = toDraft(doc);
    expect(fromDraft(draft.text, draft.skills).eq(doc)).toBe(true);
  });
});
