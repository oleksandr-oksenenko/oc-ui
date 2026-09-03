/** Build the stable, collision-safe key used by transcript content markers. */
export function annotationBlock(...parts: readonly (string | number)[]): string {
  return JSON.stringify(parts);
}

export type ProjectedAnnotationSource = {
  readonly text: string;
  readonly offset: (container: Node, offset: number) => number | undefined;
  readonly range: (start: number, end: number) => Range | undefined;
};

type TextNodeEntry = { readonly node: Text; readonly start: number; readonly end: number };

/** Projects selectable text in one marked transcript block into UTF-16 offsets. */
export function projectAnnotationSource(block: HTMLElement): ProjectedAnnotationSource {
  const entries: TextNodeEntry[] = [];
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let textNode: Node | null;
  let text = "";
  while ((textNode = walker.nextNode()) !== null) {
    if (!(textNode instanceof Text) || excluded(textNode, block) || textNode.data.length === 0)
      continue;
    const start = text.length;
    text += textNode.data;
    entries.push({ node: textNode, start, end: text.length });
  }

  return {
    text,
    offset: (container, offset) => sourceOffset(block, entries, container, offset),
    range: (start, end) => sourceRange(block, entries, text, start, end),
  };
}

function sourceOffset(
  block: HTMLElement,
  entries: readonly TextNodeEntry[],
  container: Node,
  offset: number,
): number | undefined {
  if (!block.contains(container) || excluded(container, block) || !Number.isInteger(offset)) {
    return undefined;
  }
  if (container.nodeType === Node.TEXT_NODE) {
    if (offset < 0 || offset > container.nodeValue!.length) return undefined;
    const entry = entries.find((item) => item.node === container);
    if (entry) return entry.start + offset;
    // Empty text nodes have no entry; map their position like an element boundary.
  } else if (container.nodeType === Node.ELEMENT_NODE) {
    if (offset < 0 || offset > container.childNodes.length) return undefined;
  } else {
    return undefined;
  }

  let result = 0;
  for (const entry of entries) {
    const beforeStart = comparePoints(container, offset, entry.node, 0);
    const beforeEnd = comparePoints(container, offset, entry.node, entry.node.length);
    if (beforeStart <= 0) continue;
    if (beforeEnd >= 0) {
      result = entry.end;
      continue;
    }
    const partial = block.ownerDocument.createRange();
    partial.setStart(entry.node, 0);
    partial.setEnd(container, offset);
    result = entry.start + partial.toString().length;
    break;
  }
  return result;
}

function sourceRange(
  block: HTMLElement,
  entries: readonly TextNodeEntry[],
  text: string,
  start: number,
  end: number,
): Range | undefined {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length
  ) {
    return undefined;
  }
  const startEntry = entries.find((entry) => entry.end > start);
  const endEntry = entries.find((entry) => entry.end >= end);
  if (startEntry === undefined || endEntry === undefined) return undefined;

  const range = block.ownerDocument.createRange();
  range.setStart(startEntry.node, start - startEntry.start);
  range.setEnd(endEntry.node, end - endEntry.start);
  return range.toString() === text.slice(start, end) ? range : undefined;
}

function comparePoints(
  leftContainer: Node,
  leftOffset: number,
  rightContainer: Node,
  rightOffset: number,
): number {
  const range = leftContainer.ownerDocument!.createRange();
  range.setStart(leftContainer, leftOffset);
  range.setEnd(rightContainer, rightOffset);
  if (!range.collapsed) return -1;
  range.setStart(rightContainer, rightOffset);
  range.setEnd(leftContainer, leftOffset);
  return range.collapsed ? 0 : 1;
}

function excluded(node: Node, block: HTMLElement): boolean {
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  while (current !== null) {
    if (current instanceof Element) {
      const element = current;
      if (
        (element !== block && element.hasAttribute("data-annotation-block")) ||
        ["BUTTON", "INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ||
        element.hasAttribute("hidden") ||
        element.getAttribute("aria-hidden")?.toLowerCase() === "true" ||
        (element.hasAttribute("contenteditable") &&
          element.getAttribute("contenteditable") !== "false")
      ) {
        return true;
      }
    }
    if (current === block) break;
    current = current.parentNode;
  }
  return false;
}
