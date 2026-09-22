import type {
  BlockContent,
  Code,
  Heading,
  Image,
  Link,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Text,
} from "mdast";
import { toMarkdown, type Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import { Fragment, Mark, type Node as PMNode } from "prosemirror-model";

/**
 * Draft serialization built on `mdast-util-to-markdown`.
 *
 * ProseMirror documents are converted to an mdast tree, and the mdast library
 * owns the escaping, whitespace and delimiter rules; the converter only maps
 * nodes and marks. Every node and mark of the composer's schema is mapped
 * explicitly, and anything else throws rather than silently flattening
 * content.
 *
 * This module is private to the package. `markdown.ts` owns the parser, the
 * skill nonce round-trip and mention offsets, and calls in here to write the
 * text; `renderSkill` receives each skill atom and returns the placeholder to
 * write for it.
 */

/**
 * `mdast-util-to-markdown` options that align its output with the composer's
 * conventions. Escaping, code-span padding and list spacing are deliberately
 * left to the library.
 */
export const mdastOptions: ToMarkdownOptions = {
  bullet: "-",
  bulletOrdered: ".",
  emphasis: "*",
  strong: "*",
  fence: "`",
  fences: true,
  listItemIndent: "one",
  rule: "-",
  ruleRepetition: 3,
  // The transcript renders GFM strikethrough, but the composer has no
  // strikethrough mark, so a literal `~~` pair must stay literal on the wire.
  // The library escapes `~` only at the start of a line; mark tilde pairs in
  // phrasing as unsafe as well.
  unsafe: [
    { character: "~", inConstruct: "phrasing", after: "~" },
    { character: "~", inConstruct: "phrasing", before: "~" },
  ],
  handlers: {
    // The composer reads a single newline as a line break, so a break is
    // written as a plain newline rather than the library's backslash hard
    // break, matching Shift+Enter and the transcript's `breaks` rendering.
    break: () => "\n",
  },
};

type RenderSkill = (node: PMNode) => string;

/**
 * Serializes a document to draft text. A skill atom is written as the opaque
 * string `renderSkill` returns; the caller substitutes the real names and owns
 * the mention offsets.
 */
export function serializeMdast(doc: PMNode, renderSkill: RenderSkill): string {
  const content = doc.type.name === "doc" ? mergeAdjacentLists(doc) : doc;
  // `toMarkdown` terminates the document with a newline; drafts never carry
  // one.
  return toMarkdown(root(content, renderSkill), mdastOptions).replace(/\n$/, "");
}

function root(doc: PMNode, renderSkill: RenderSkill): Root {
  const children: RootContent[] = [];
  if (doc.type.name === "doc") doc.forEach((node) => children.push(block(node, renderSkill)));
  else children.push(block(doc, renderSkill));
  return { type: "root", children };
}

function blocks(parent: PMNode, renderSkill: RenderSkill): BlockContent[] {
  const children: BlockContent[] = [];
  parent.forEach((node) => children.push(block(node, renderSkill)));
  return children;
}

function block(node: PMNode, renderSkill: RenderSkill): BlockContent {
  switch (node.type.name) {
    case "paragraph":
      return { type: "paragraph", children: phrasing(node, renderSkill) };
    case "heading":
      return {
        type: "heading",
        depth: headingDepth(node),
        children: phrasing(node, renderSkill),
      };
    case "blockquote":
      return { type: "blockquote", children: blocks(node, renderSkill) };
    case "bullet_list":
    case "ordered_list":
      return list(node, renderSkill);
    case "code_block":
      return code(node);
    case "horizontal_rule":
      return { type: "thematicBreak" };
    default:
      throw new Error(`Unsupported block node \`${node.type.name}\``);
  }
}

function list(node: PMNode, renderSkill: RenderSkill): List {
  // The ProseMirror schema carries looseness on the list; mdast mirrors it on
  // the list and each item.
  const spread = node.attrs.tight !== true;
  const children: ListItem[] = [];
  node.forEach((item) => {
    children.push({ type: "listItem", spread, children: blocks(item, renderSkill) });
  });
  if (node.type.name === "ordered_list") {
    const start = Number(node.attrs.order ?? 1);
    return { type: "list", ordered: true, start, spread, children };
  }
  return { type: "list", ordered: false, spread, children };
}

function code(node: PMNode): Code {
  const params = String(node.attrs.params ?? "").trim();
  const space = params.search(/\s/);
  const lang = space < 0 ? params : params.slice(0, space);
  const meta = space < 0 ? "" : params.slice(space).trim();
  return {
    type: "code",
    lang: lang === "" ? null : lang,
    meta: meta === "" ? null : meta,
    value: node.textContent,
  };
}

const headingDepths = [1, 2, 3, 4, 5, 6] as const satisfies readonly Heading["depth"][];

/** mdast headings only carry the six depths Markdown can express. */
function headingDepth(node: PMNode): Heading["depth"] {
  const level = Number(node.attrs.level ?? 1);
  const clamped = Math.min(Math.max(level, 1), 6);
  return headingDepths[clamped - 1] ?? 1;
}

type MarkFrame = {
  readonly mark: Mark;
  readonly children: PhrasingContent[];
};

/**
 * Converts a textblock's inline nodes to phrasing content. Marks are opened
 * and closed as they come and go, so a mark that continues across a
 * differently-marked run stays one wrapper and its boundary spaces stay
 * interior; only a mark that actually ends is closed. A code mark is not a
 * wrapper: it writes its text runs as code spans, split around content a span
 * cannot carry.
 */
function phrasing(parent: PMNode, renderSkill: RenderSkill): PhrasingContent[] {
  const nodes: PMNode[] = [];
  parent.forEach((node) => nodes.push(node));
  // A trailing line break carries no text, so it is dropped rather than
  // swallowed by the surrounding block separator.
  let lastContent = -1;
  nodes.forEach((node, index) => {
    if (node.type.name !== "hard_break") lastContent = index;
  });

  const top: PhrasingContent[] = [];
  const stack: MarkFrame[] = [];
  const write = (child: PhrasingContent) => {
    const frame = stack[stack.length - 1];
    (frame ? frame.children : top).push(child);
  };
  const closeTo = (keep: number) => {
    while (stack.length > keep) {
      const frame = stack.pop()!;
      write(markWrapper(frame.mark, frame.children));
    }
  };

  let index = 0;
  while (index <= lastContent) {
    // Adjacent nodes with the same marks are one run, so a mark that spans a
    // line break keeps one delimiter pair.
    let end = index + 1;
    while (end <= lastContent && Mark.sameSet(marksAt(nodes, index), marksAt(nodes, end))) {
      end += 1;
    }
    const marks = marksAt(nodes, index).filter((mark) => mark.type.name !== "code");
    // Close every mark the run no longer carries; the marks above it are
    // reopened below.
    let keep = 0;
    while (keep < stack.length && marks.some((mark) => stack[keep]!.mark.eq(mark))) keep += 1;
    closeTo(keep);
    for (const mark of marks) {
      if (stack.some((frame) => frame.mark.eq(mark))) continue;
      stack.push({ mark, children: [] });
    }
    const run: PhrasingContent[] = [];
    for (let cursor = index; cursor < end; cursor += 1) {
      run.push(inline(nodes[cursor]!, renderSkill));
    }
    if (marksAt(nodes, index).some((mark) => mark.type.name === "code")) {
      writeCodeRun(run, write);
    } else {
      for (const child of run) write(child);
    }
    index = end;
  }
  closeTo(0);
  return top;
}

/**
 * The marks a node writes. A hard break keeps a mark only when the mark is
 * open on the previous node and continues into the next node's visible text:
 * a mark that starts or ends at the break would put a newline inside the
 * delimiter pair, which Markdown cannot read back.
 */
function marksAt(nodes: readonly PMNode[], index: number): readonly Mark[] {
  const node = nodes[index]!;
  if (node.type.name !== "hard_break") return node.marks;
  const previous = nodes[index - 1];
  const next = nodes[index + 1];
  if (previous === undefined || next === undefined) return [];
  return node.marks.filter(
    (mark) =>
      mark.isInSet(previous.marks) &&
      mark.isInSet(next.marks) &&
      (!next.isText || /\S/.test(next.text ?? "")),
  );
}

/** The mdast node for a ProseMirror mark around some phrasing content. */
function markWrapper(mark: Mark, children: PhrasingContent[]): PhrasingContent {
  switch (mark.type.name) {
    case "em":
      return { type: "emphasis", children };
    case "strong":
      return { type: "strong", children };
    case "link":
      return link(mark, children);
    default:
      throw new Error(`Unsupported mark \`${mark.type.name}\``);
  }
}

function inline(node: PMNode, renderSkill: RenderSkill): PhrasingContent {
  switch (node.type.name) {
    case "text":
      return { type: "text", value: node.text ?? "" };
    case "hard_break":
      return { type: "break" };
    case "image":
      return image(node);
    case "skill":
      return skill(node, renderSkill);
    default:
      throw new Error(`Unsupported inline node \`${node.type.name}\``);
  }
}

function image(node: PMNode): Image {
  const title = node.attrs.title;
  const alt = node.attrs.alt;
  return {
    type: "image",
    url: String(node.attrs.src ?? ""),
    alt: alt == null ? null : String(alt),
    title: title == null ? null : String(title),
  };
}

function skill(node: PMNode, renderSkill: RenderSkill): Text {
  return { type: "text", value: renderSkill(node) };
}

/**
 * Writes a code-marked run as code spans around the content a span cannot
 * carry. An inline code span is text only, so a break or image splits it: the
 * code wrapper closes before the node, the node is written without the code
 * mark, and code resumes after it. Keeping the node inside one span has no
 * Markdown form and must not drop content.
 */
function writeCodeRun(
  run: readonly PhrasingContent[],
  write: (child: PhrasingContent) => void,
): void {
  let text = "";
  const flush = () => {
    if (text === "") return;
    write({ type: "inlineCode", value: text });
    text = "";
  };
  for (const child of run) {
    if (child.type === "text") text += child.value;
    else {
      flush();
      write(child);
    }
  }
  flush();
}

function link(mark: Mark, content: PhrasingContent[]): Link {
  const title = mark.attrs.title;
  return {
    type: "link",
    url: String(mark.attrs.href ?? ""),
    title: title == null ? null : String(title),
    children: content,
  };
}

const listTypes = new Set(["bullet_list", "ordered_list"]);

/**
 * Adjacent lists of the same type are one list in Markdown, so they are
 * serialized as one; the parser then rebuilds a single list. Separating them
 * would need a different bullet character, and the composer keeps the
 * canonical `-` bullet.
 */
function mergeAdjacentLists(doc: PMNode): PMNode {
  const merged: PMNode[] = [];
  doc.forEach((node) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.type === node.type && listTypes.has(node.type.name)) {
      merged[merged.length - 1] = previous.type.create(
        { ...previous.attrs, tight: previous.attrs.tight === true && node.attrs.tight === true },
        previous.content.append(node.content),
        previous.marks,
      );
      return;
    }
    merged.push(node);
  });
  return merged.length === doc.childCount ? doc : doc.copy(Fragment.fromArray(merged));
}
