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
});
