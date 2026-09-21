/* oxlint-disable effecttsgo/async-function */

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, userEvent, within } from "storybook/test";

import { MarkdownBehavior } from "./composer-markdown/MarkdownBehavior.tsx";

const meta = {
  title: "Composer/Markdown behavior",
  component: MarkdownBehavior,
  parameters: { layout: "centered" },
} satisfies Meta<typeof MarkdownBehavior>;

export default meta;
type Story = StoryObj<typeof meta>;

const promptOf = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole("textbox", { name: "Prompt" });

const draftOf = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>('[data-testid="markdown-draft"]')?.dataset.draft;

const attachmentsOf = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>('[data-testid="markdown-attachments"]')?.textContent;

export const NestedEmphasis: Story = {
  args: {
    initialValue: "**a __b__ c**",
    note: "Upstream maps a Markdown mark to a ProseMirror mark set, so closing an inner identical emphasis would drop the outer bold from the tail. The adapter collapses the redundant pair; removing it would turn this into `**a b** c`.",
  },
  play: async ({ canvasElement }) => {
    const prompt = promptOf(canvasElement);
    await expect(prompt.textContent).toBe("a b c");
    await expect(prompt.querySelectorAll("strong")).toHaveLength(1);
    await expect(prompt.querySelector("strong")).toHaveTextContent("a b c");
    await expect(draftOf(canvasElement)).toBe("**a b c**");
  },
};

export const LiteralText: Story = {
  args: {
    initialValue: "\\- not a list and \\*\\*literal\\*\\* and \\&amp; and \\<b>",
    note: "Literal Markdown-looking text is escaped in the draft so it reparses to the same characters. Removing the escaping would turn this into a list, bold text, an entity and an HTML tag.",
  },
  play: async ({ canvasElement }) => {
    const prompt = promptOf(canvasElement);
    await expect(prompt.textContent).toBe("- not a list and **literal** and &amp; and <b>");
    await expect(prompt.querySelector("ul")).toBeNull();
    await expect(prompt.querySelector("strong")).toBeNull();
    await expect(draftOf(canvasElement)).toBe(
      "\\- not a list and \\*\\*literal\\*\\* and \\&amp; and \\<b>",
    );
  },
};

export const MarkerCollision: Story = {
  args: {
    initialValue: "&#xE000;abc/0&#xE000; review",
    initialSkills: [
      { id: "review", name: "review", mention: { start: 22, end: 28, text: "review" } },
    ],
    note: "A literal marker next to a real skill must not become a second chip or steal the attachment. The nonce is checked against the decoded text; without it this would show two chips and two attachments.",
  },
  play: async ({ canvasElement }) => {
    const prompt = promptOf(canvasElement);
    await expect(prompt.querySelectorAll(".prompt-skill-chip")).toHaveLength(1);
    await expect(attachmentsOf(canvasElement)).toContain("review@");
    await expect(draftOf(canvasElement)).toContain("abc/0");
    await expect(draftOf(canvasElement)).toContain("review");
  },
};

export const AdjacentLists: Story = {
  args: {
    note: "Leaving a list and starting another creates two list nodes that Markdown cannot tell apart, so they serialize as one list. Removing the merge would write three blank lines and reparse differently.",
  },
  play: async ({ canvasElement }) => {
    const prompt = promptOf(canvasElement);
    await userEvent.type(
      prompt,
      "- first{Shift>}{Enter}{/Shift}second{Shift>}{Enter}{/Shift}{Shift>}{Enter}{/Shift}- third",
    );
    await expect(prompt.querySelectorAll("li")).toHaveLength(3);
    await expect(draftOf(canvasElement)).toBe("- first\n- second\n- third");
  },
};

export const ClipboardMarkdown: Story = {
  args: {
    initialValue: "**bold** and *em*",
    note: "Copying a selection writes Markdown back through the serializer. Without the clipboard serializer the copied text would be plain `bold and em`.",
  },
  play: async ({ canvasElement }) => {
    const prompt = promptOf(canvasElement);
    await userEvent.click(prompt);
    await userEvent.keyboard(
      /Mac/.test(navigator.platform) ? "{Meta>}a{/Meta}" : "{Control>}a{/Control}",
    );
    const clipboard = new DataTransfer();
    prompt.dispatchEvent(
      new ClipboardEvent("copy", { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
    await expect(clipboard.getData("text/plain")).toBe("**bold** and *em*");
  },
};

export const EdgeSpacesAndTitles: Story = {
  args: {
    initialValue: 'keep `  spaced  ` and [title](https://x.dev "Docs")',
    note: "Code spans keep edge spaces (the bundled writer drops them), and link titles round-trip (the explicit link writer writes them).",
  },
  play: async ({ canvasElement }) => {
    const prompt = promptOf(canvasElement);
    await expect(prompt.querySelector("code")?.textContent).toBe(" spaced ");
    await expect(prompt.querySelector("a")?.getAttribute("title")).toBe("Docs");
    await expect(draftOf(canvasElement)).toBe(
      'keep `  spaced  ` and [title](https://x.dev "Docs")',
    );
  },
};

export const TypingShortcuts: Story = {
  args: {
    note: "Input rules are typed Markdown: lists, line breaks and inline marks apply while typing. Without them the draft would escape the syntax instead of formatting it.",
  },
  play: async ({ canvasElement }) => {
    const prompt = promptOf(canvasElement);
    await userEvent.type(
      prompt,
      "- item{Shift>}{Enter}{/Shift}second{Shift>}{Enter}{/Shift}{Shift>}{Enter}{/Shift}**bold**",
    );
    await expect(prompt.querySelectorAll("li")).toHaveLength(2);
    await expect(prompt.querySelector("strong")).toHaveTextContent("bold");
    await expect(draftOf(canvasElement)).toBe("- item\n- second\n\n**bold**");
  },
};

export const NewLineGesture: Story = {
  args: {
    note: "Shift+Enter breaks a line and, on an empty line, starts a paragraph so a block rule can begin. Upstream would split paragraphs on every Shift+Enter (blank lines in the draft) and allow unrepresentable multiline headings.",
  },
  play: async ({ canvasElement }) => {
    const prompt = promptOf(canvasElement);
    await userEvent.type(
      prompt,
      "first{Shift>}{Enter}{/Shift}second{Shift>}{Enter}{/Shift}{Shift>}{Enter}{/Shift}> quoted",
    );
    await expect(prompt.querySelector("blockquote")).toHaveTextContent("quoted");
    await expect(draftOf(canvasElement)).toBe("first\nsecond\n\n> quoted");
  },
};

export const SkillAttachment: Story = {
  args: {
    initialValue: "please review this",
    initialSkills: [
      { id: "review", name: "review", mention: { start: 7, end: 13, text: "review" } },
    ],
    note: "The draft is a string, so skill attachments travel as mention offsets that are recomputed on every edit. This glue is what the feature needs; there is no Markdown syntax for an atom.",
  },
  play: async ({ canvasElement }) => {
    const prompt = promptOf(canvasElement);
    await expect(prompt.querySelectorAll(".prompt-skill-chip")).toHaveLength(1);
    await expect(attachmentsOf(canvasElement)).toContain("review@7");
    await expect(draftOf(canvasElement)).toBe("please review this");
  },
};
