import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import { Composer } from "./Composer.tsx";
import { unavailableAgentSelection, unavailableSelection } from "./composer-test-fixtures.ts";

const setPlatform = (platform: "macos" | "other") => {
  document.documentElement.dataset.platform = platform;
};

afterEach(() => {
  delete document.documentElement.dataset.platform;
});

type ClipboardFlavors = {
  readonly text?: string;
  readonly html?: string;
  readonly files?: readonly File[];
};

/** Dispatches a paste event with the payload a source would provide. */
function pasteClipboard(editor: HTMLElement, flavors: ClipboardFlavors): Event {
  const values: Record<string, string> = {};
  if (flavors.text !== undefined) values["text/plain"] = flavors.text;
  if (flavors.html !== undefined) values["text/html"] = flavors.html;
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: flavors.files ?? [],
      getData: (type: string) => values[type] ?? "",
    },
  });
  editor.dispatchEvent(event);
  return event;
}

function openComposer(
  options: {
    readonly value?: string;
    readonly onAttachFiles?: (files: readonly File[]) => void;
    readonly onAttachText?: (text: string) => void;
    readonly files?: readonly File[];
  } = {},
) {
  const input = vi.fn<(value: string) => void>();
  const [value, setValue] = createSignal(options.value ?? "");
  const { host, dispose } = mount(() => (
    <Composer
      value={value()}
      disabled={false}
      action="send"
      onAttachFiles={options.onAttachFiles}
      files={options.files}
      modelSelection={unavailableSelection}
      agentSelection={unavailableAgentSelection}
      onAttachText={options.onAttachText ?? (() => undefined)}
      onInput={(text) => {
        input(text);
        setValue(text);
      }}
      onSubmit={() => undefined}
    />
  ));
  const editor = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
  if (!editor) throw new Error("Composer did not render its prompt");
  const draft = () => input.mock.calls.at(-1)?.[0];
  const notice = () => host.querySelector<HTMLElement>('[role="alert"]')?.textContent ?? "";
  return { host, dispose, editor, draft, notice };
}

/** The editor's current draft text, even when it never changed. */
const textOf = (editor: HTMLElement) => editor.textContent ?? "";

describe("Composer paste routing", () => {
  it("routes ordinary text without an attachment owner", () => {
    setPlatform("macos");
    const harness = openComposer();
    const event = pasteClipboard(harness.editor, { text: "hello" });
    expect(event.defaultPrevented).toBe(true);
    expect(harness.draft()).toBe("hello");
    harness.dispose();
  });

  it("keeps files with the attachment owner and drops the text flavor", () => {
    setPlatform("macos");
    const attach = vi.fn<(files: readonly File[]) => void>();
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    const harness = openComposer({ onAttachFiles: attach });
    const event = pasteClipboard(harness.editor, { text: "should not insert", files: [notes] });
    expect(event.defaultPrevented).toBe(true);
    expect(attach).toHaveBeenCalledWith([notes]);
    expect(harness.draft()).toBeUndefined();
    harness.dispose();
  });

  it("leaves a files-only paste to native handling when no owner exists", () => {
    setPlatform("macos");
    const harness = openComposer();
    const notes = new File(["notes"], "notes.txt", { type: "text/plain" });
    const event = pasteClipboard(harness.editor, { files: [notes] });
    expect(event.defaultPrevented).toBe(false);
    expect(harness.draft()).toBeUndefined();
    harness.dispose();
  });

  it("makes a whitespace-only paste a no-op instead of deleting the selection", () => {
    setPlatform("macos");
    const harness = openComposer({ value: "keep this" });
    const event = pasteClipboard(harness.editor, { text: "\n\n\n" });
    expect(event.defaultPrevented).toBe(true);
    expect(harness.draft()).toBeUndefined();
    expect(textOf(harness.editor)).toBe("keep this");
    harness.dispose();
  });

  it("inserts a lone URL as ordinary text", () => {
    setPlatform("macos");
    const harness = openComposer();
    pasteClipboard(harness.editor, { text: "https://example.com/a" });
    expect(harness.draft()).toBe("https://example.com/a");
    expect(harness.host.querySelector(".prompt-skill-chip")).toBeNull();
    harness.dispose();
  });

  it("parses conservative Markdown with the Markdown route", () => {
    setPlatform("macos");
    const harness = openComposer();
    pasteClipboard(harness.editor, { text: "# Heading\n\n- one\n- two" });
    expect(harness.host.querySelector(".prompt-suggestion-menu")).toBeNull();
    expect(harness.draft()).toContain("# Heading");
    expect(harness.draft()).toContain("- one");
    harness.dispose();
  });

  it("keeps plain text literal: single newlines become hard breaks", () => {
    setPlatform("macos");
    const harness = openComposer();
    pasteClipboard(harness.editor, { text: "first\nsecond\nthird" });
    expect(harness.draft()).toBe("first\nsecond\nthird");
    // No paragraph split: the tree holds one paragraph with two breaks.
    expect(harness.editor.querySelectorAll("p")).toHaveLength(1);
    expect(harness.editor.querySelectorAll("br")).toHaveLength(2);
    harness.dispose();
  });

  it("leaves the selection unchanged for an HTML-only payload", () => {
    setPlatform("macos");
    const harness = openComposer({ value: "keep this" });
    const event = pasteClipboard(harness.editor, { html: "<p>rich</p>" });
    expect(event.defaultPrevented).toBe(true);
    expect(textOf(harness.editor)).toBe("keep this");
    expect(harness.notice()).toBe("");
    expect(harness.draft()).toBeUndefined();
    harness.dispose();
  });
});

describe("Composer code-block paste", () => {
  it("pastes raw newlines into a code block, where every paste is literal", () => {
    setPlatform("macos");
    const harness = openComposer({ value: "```\ncode\n```" });
    // The caret starts inside the code block; no special gesture is needed.
    pasteClipboard(harness.editor, { text: "a\nb" });
    expect(harness.editor.querySelector("code")?.textContent).toContain("a\nb");
    harness.dispose();
  });

  it("inserts whitespace into a code block instead of treating it as a no-op", () => {
    setPlatform("macos");
    const harness = openComposer({ value: "```\ncode\n```" });
    const event = pasteClipboard(harness.editor, { text: "\n\n" });
    expect(event.defaultPrevented).toBe(true);
    expect(harness.draft()).toContain("\n\n");
    harness.dispose();
  });

  it("keeps oversized text inline inside a code block", () => {
    setPlatform("macos");
    const attachText = vi.fn<(text: string) => void>();
    const harness = openComposer({ value: "```\ncode\n```", onAttachText: attachText });
    const text = "a".repeat(16_384);
    pasteClipboard(harness.editor, { text });
    expect(attachText).not.toHaveBeenCalled();
    expect(harness.draft()).toContain(text);
    harness.dispose();
  });
});

describe("Composer text attachment intent", () => {
  it("hands oversized text to the attachment owner instead of inserting it", () => {
    setPlatform("macos");
    const attachText = vi.fn<(text: string) => void>();
    const harness = openComposer({ onAttachText: attachText });
    const text = "a".repeat(16_384);
    pasteClipboard(harness.editor, { text });
    expect(attachText).toHaveBeenCalledWith(text);
    expect(harness.draft()).toBeUndefined();
    harness.dispose();
  });

  it("inserts text one unit below the threshold", () => {
    setPlatform("macos");
    const attachText = vi.fn<(text: string) => void>();
    const harness = openComposer({ onAttachText: attachText });
    const text = "a".repeat(16_383);
    pasteClipboard(harness.editor, { text });
    expect(attachText).not.toHaveBeenCalled();
    expect(harness.draft()).toBe(text);
    harness.dispose();
  });

  it("counts the threshold in UTF-16 units for surrogate pairs", () => {
    setPlatform("macos");
    const attachText = vi.fn<(text: string) => void>();
    const harness = openComposer({ onAttachText: attachText });
    const pairs = "😀".repeat(8_192);
    expect(pairs.length).toBe(16_384);
    pasteClipboard(harness.editor, { text: pairs });
    expect(attachText).toHaveBeenCalledWith(pairs);
    harness.dispose();

    const below = openComposer({ onAttachText: attachText });
    pasteClipboard(below.editor, { text: "😀".repeat(8_191) });
    expect(attachText).toHaveBeenCalledTimes(1);
    expect(below.draft()).toBe("😀".repeat(8_191));
    below.dispose();
  });
});
