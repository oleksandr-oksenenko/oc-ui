import type { PromptSkillAttachment } from "@opencode/client";
import { createEffect } from "solid-js";

import { decodeNumericEntities } from "@oc-ui/prompt-editor/markdown-text";
import { renderMarkdownCached } from "../AssistantMessage/Markdown/markdown.ts";

const placeholderStart = "\uE000";

/**
 * The first prefix that does not occur in the decoded text. A local counter
 * keeps the choice deterministic for identical props, so the render guard
 * stays stable, and it moves past literal markers instead of turning them
 * into chips.
 */
function placeholderPrefix(decoded: string): string {
  for (let counter = 0; ; counter += 1) {
    const prefix = `${placeholderStart}${counter.toString(36)}`;
    if (!decoded.includes(prefix)) return prefix;
  }
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
 * them; the placeholders are swapped back for chips after sanitization. The
 * caller passes ordered, non-overlapping mentions that still match the text
 * (UserMessage filters them); the prefix is checked against the decoded text
 * so a literal marker cannot become a chip.
 *
 * TODO: redesign this around custom elements. If the Markdown renderer emitted
 * a chip element per skill (or sanitization preserved a custom tag), the
 * placeholder markers and the post-render DOM walk could be deleted.
 */
function withPlaceholders(
  text: string,
  skills: readonly PromptSkillAttachment[],
): PreparedInstruction {
  const identity = skills.map((slot) => `${slot.id}:${slot.name}`).join("\u0000");
  const prefix = placeholderPrefix(decodeNumericEntities(text));
  let source = "";
  let end = 0;
  for (const [index, skill] of skills.entries()) {
    const mention = skill.mention!;
    source += `${text.slice(end, mention.start)}${prefix}/${index}${placeholderStart}`;
    end = mention.end;
  }
  source += text.slice(end);
  return {
    source,
    slots: skills,
    pattern: new RegExp(`${prefix}/(\\d+)${placeholderStart}`, "g"),
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

/**
 * Renders a sent prompt instruction in the transcript: sanitized Markdown with
 * skill attachments shown as chips. Skill mentions are first protected with
 * this render's private placeholder prefix so Markdown rendering cannot touch
 * them, then swapped for chip elements. The effect is keyed on the full input,
 * so a transcript refresh with identical content leaves the DOM untouched.
 */
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
