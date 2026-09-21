import type { PromptSkillAttachment } from "@opencode/client";
import { createEffect } from "solid-js";

import { decodeNumericEntities } from "../../../../../../../markdown-text.ts";
import { renderMarkdownCached } from "../AssistantMessage/Markdown/markdown.ts";

const placeholderStart = "\uE000";

/**
 * A stable marker prefix derived from the rendering input. It must not occur
 * in the text after numeric references decode, so the hash is extended until
 * it is free; deriving it from the input keeps the render guard stable across
 * identical props.
 */
function stablePrefix(input: string): string {
  const decoded = decodeNumericEntities(input);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let suffix = hash.toString(36);
  while (
    input.includes(`${placeholderStart}${suffix}`) ||
    decoded.includes(`${placeholderStart}${suffix}`)
  ) {
    suffix += "0";
  }
  return `${placeholderStart}${suffix}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type PreparedInstruction = {
  readonly source: string;
  readonly slots: readonly PromptSkillAttachment[];
  /** Matches only this render's markers. */
  readonly pattern: RegExp;
  /** The full rendering input; a repeat run with the same key is a no-op. */
  readonly key: string;
};

/**
 * Turns skill mentions into inert placeholders so Markdown can render around
 * them; the placeholders are swapped back for chips after sanitization. Only
 * mentions that still match the instruction text take part, and the prefix is
 * checked against the text (after numeric references decode) so a literal
 * marker cannot become a chip.
 */
function withPlaceholders(
  text: string,
  skills: readonly PromptSkillAttachment[],
): PreparedInstruction {
  const valid: PromptSkillAttachment[] = [];
  let end = 0;
  for (const skill of skills) {
    const mention = skill.mention;
    if (!mention || mention.start < end || text.slice(mention.start, mention.end) !== skill.name)
      continue;
    valid.push(skill);
    end = mention.end;
  }
  const identity = valid.map((slot) => `${slot.id}:${slot.name}`).join("\u0000");
  const prefix = stablePrefix(`${text}\u0000${identity}`);
  let source = "";
  end = 0;
  for (const [index, skill] of valid.entries()) {
    const mention = skill.mention!;
    source += `${text.slice(end, mention.start)}${prefix}/${index}${placeholderStart}`;
    end = mention.end;
  }
  source += text.slice(end);
  return {
    source,
    slots: valid,
    pattern: new RegExp(`${escapeRegExp(prefix)}/(\\d+)${placeholderStart}`, "g"),
    key: `${source}\u0000${identity}`,
  };
}

function replacePlaceholders(
  root: HTMLElement,
  slots: readonly PromptSkillAttachment[],
  pattern: RegExp,
): void {
  if (slots.length === 0) return;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const candidates: Text[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text && walker.currentNode.data.includes(placeholderStart))
      candidates.push(walker.currentNode);
  }
  for (const node of candidates) {
    const parent = node.parentNode;
    if (parent === null) continue;
    const fragment = root.ownerDocument.createDocumentFragment();
    let cursor = 0;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(node.data)) !== null) {
      if (match.index > cursor) fragment.append(node.data.slice(cursor, match.index));
      const slot = slots[Number(match[1])];
      if (slot === undefined) {
        // An unknown marker stays as written rather than erasing text.
        fragment.append(match[0]);
      } else {
        const chip = root.ownerDocument.createElement("span");
        chip.className = "transcript-skill-chip";
        chip.textContent = slot.name;
        fragment.append(chip);
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < node.data.length) fragment.append(node.data.slice(cursor));
    parent.replaceChild(fragment, node);
  }
}

/** Renders a sent prompt instruction as sanitized Markdown with skill chips. */
export function PromptInstruction(props: {
  readonly text: string;
  readonly skills?: readonly PromptSkillAttachment[];
}) {
  let root!: HTMLDivElement;
  let rendered: string | undefined;
  createEffect(() => {
    const prepared = withPlaceholders(props.text, props.skills ?? []);
    // A transcript refresh can re-run this effect with the same content; only
    // replacing the DOM when the rendering input changes keeps it
    // mutation-free.
    if (prepared.key === rendered) return;
    rendered = prepared.key;
    root.innerHTML = renderMarkdownCached(prepared.source);
    replacePlaceholders(root, prepared.slots, prepared.pattern);
  });
  return (
    <div
      ref={(element) => {
        root = element;
      }}
      class="transcript-markdown transcript-user-instruction"
    />
  );
}
