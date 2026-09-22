import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import { Composer } from "./Composer.tsx";
import type { ComposerPasteRecovery } from "./Composer.tsx";

const unavailableSelection = {
  state: "failed" as const,
  switching: false,
  disabled: false,
  models: [],
  variants: [],
  onSelectModel: () => undefined,
  onSelectVariant: () => undefined,
};

const unavailableAgentSelection = {
  state: "failed" as const,
  switching: false,
  disabled: false,
  agents: [],
  onSelectAgent: () => undefined,
};

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
  readonly items?: readonly { kind: string; getAsFile: () => File | null }[];
  /** Types to advertise; defaults to the provided flavors. */
  readonly types?: readonly string[];
};

/** Dispatches a paste event with the payload a source would provide. */
function pasteClipboard(editor: HTMLElement, flavors: ClipboardFlavors): Event {
  const values: Record<string, string> = {};
  if (flavors.text !== undefined) values["text/plain"] = flavors.text;
  if (flavors.html !== undefined) values["text/html"] = flavors.html;
  const types = flavors.types ?? [
    ...(flavors.text !== undefined ? ["text/plain"] : []),
    ...(flavors.html !== undefined ? ["text/html"] : []),
    ...(flavors.files !== undefined || flavors.items !== undefined ? ["Files"] : []),
  ];
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: flavors.files ?? [],
      items: flavors.items ?? [],
      types,
      getData: (type: string) => values[type] ?? "",
    },
  });
  editor.dispatchEvent(event);
  return event;
}

function openComposer(
  options: {
    readonly value?: string;
    readonly sessionID?: string;
    readonly disabled?: boolean;
    readonly action?: "send" | "sending" | "running";
    readonly onAttachFiles?: (files: readonly File[]) => void;
    readonly onAttachText?: (text: string) => void;
    readonly pasteRecovery?: ComposerPasteRecovery;
    readonly readClipboardText?: () => Promise<string | undefined>;
    readonly files?: readonly File[];
    readonly onSubmit?: () => void;
  } = {},
) {
  const input = vi.fn<(value: string) => void>();
  const submit = vi.fn<() => void>(options.onSubmit);
  const [value, setValue] = createSignal(options.value ?? "");
  const [sessionID, setSessionID] = createSignal<string | undefined>(options.sessionID);
  const [disabled, setDisabled] = createSignal(options.disabled ?? false);
  const [action, setAction] = createSignal<"send" | "sending" | "running">(
    options.action ?? "send",
  );
  const { host, dispose } = mount(() => (
    <Composer
      value={value()}
      sessionID={sessionID()}
      disabled={disabled()}
      action={action()}
      onAttachFiles={options.onAttachFiles}
      onAttachText={options.onAttachText}
      pasteRecovery={options.pasteRecovery}
      readClipboardText={options.readClipboardText}
      files={options.files}
      modelSelection={unavailableSelection}
      agentSelection={unavailableAgentSelection}
      onInput={(text) => {
        input(text);
        setValue(text);
      }}
      onSubmit={submit}
    />
  ));
  const editor = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
  if (!editor) throw new Error("Composer did not render its prompt");
  const draft = () => input.mock.calls.at(-1)?.[0];
  const notice = () => host.querySelector<HTMLElement>('[role="alert"]')?.textContent ?? "";
  return {
    host,
    dispose,
    editor,
    input,
    draft,
    notice,
    submit,
    setValue,
    setSessionID,
    setDisabled,
    setAction,
  };
}

/** A promise a test resolves by hand, for ordering asynchronous clipboard reads. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Lets every already-settled promise continuation run before an assertion. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The editor's current draft text, even when it never changed. */
const textOf = (editor: HTMLElement) => editor.textContent ?? "";

/** The macOS literal-paste chord; the non-macOS test arms Ctrl explicitly. */
const chord = () =>
  new KeyboardEvent("keydown", {
    key: "v",
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });

const ctrlChord = () =>
  new KeyboardEvent("keydown", {
    key: "v",
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });

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

  it("uses the schema clipboard pipeline for rich HTML", () => {
    setPlatform("macos");
    const harness = openComposer();
    pasteClipboard(harness.editor, {
      html: '<article><h1>Paste routing</h1><p>See <a href="https://example.com/spec">the spec</a>.</p><ul><li>one</li><li>two</li></ul></article>',
      text: "Paste routing\nSee the spec.\none\ntwo",
    });
    expect(harness.editor.querySelector("h1")?.textContent).toBe("Paste routing");
    expect(harness.editor.querySelectorAll("li")).toHaveLength(2);
    expect(harness.draft()).toContain("[the spec](https://example.com/spec)");
    harness.dispose();
  });

  it("falls back to the text flavor when the HTML parse has no content", () => {
    setPlatform("macos");
    const harness = openComposer();
    pasteClipboard(harness.editor, {
      html: "<script>alert(1)</script>",
      text: "- one\n- two",
    });
    // Markdown classification independently succeeds, so the fallback parses.
    expect(harness.host.querySelectorAll("li")).toHaveLength(2);
    expect(harness.notice()).toBe("");
    harness.dispose();
  });

  it("leaves the selection unchanged and explains when HTML-only content cannot be used", () => {
    setPlatform("macos");
    const harness = openComposer({ value: "keep this" });
    const event = pasteClipboard(harness.editor, { html: "<script>alert(1)</script>" });
    expect(event.defaultPrevented).toBe(true);
    expect(textOf(harness.editor)).toBe("keep this");
    expect(harness.notice()).toContain("no text");
    harness.dispose();
  });

  it("strips unsafe link targets and unsupported images from HTML", () => {
    setPlatform("macos");
    const harness = openComposer();
    pasteClipboard(harness.editor, {
      html: '<p><a href="javascript:alert(1)">click</a></p><p><img src="file:///tmp/a.png" alt="local"></p>',
      text: "click",
    });
    expect(harness.draft()).not.toContain("javascript:");
    expect(harness.editor.querySelector("a")).toBeNull();
    expect(harness.draft()).toContain("click");
    harness.dispose();
  });

  it("keeps table cell text without crashing", () => {
    setPlatform("macos");
    const harness = openComposer();
    pasteClipboard(harness.editor, {
      html: "<table><tr><td>Cell A</td><td>Cell B</td></tr></table>",
      text: "Cell A\tCell B",
    });
    expect(harness.draft()).toContain("Cell A");
    expect(harness.draft()).toContain("Cell B");
    harness.dispose();
  });

  it("falls back to the text flavor for malformed markup", () => {
    setPlatform("macos");
    const harness = openComposer();
    pasteClipboard(harness.editor, {
      html: "<p>unclosed <b>bold",
      text: "unclosed bold",
    });
    expect(textOf(harness.editor)).toContain("unclosed bold");
    expect(harness.editor.querySelector("strong")?.textContent).toBe("bold");
    harness.dispose();
  });
});

describe("Composer adversarial paste", () => {
  it("falls back to the text flavor for markup nested past the inspection bound", () => {
    setPlatform("macos");
    const harness = openComposer({ value: "keep this" });
    const text = "deep paste fallback";
    const html = `${"<div>".repeat(20_000)}${text}${"</div>".repeat(20_000)}`;
    const started = performance.now();
    const event = pasteClipboard(harness.editor, { html, text });
    const elapsed = performance.now() - started;
    expect(event.defaultPrevented).toBe(true);
    // The payload is never parsed as markup, so the draft keeps its text and
    // gains the fallback instead of a deep element tree.
    expect(harness.draft()).toContain("keep this");
    expect(harness.draft()).toContain(text);
    expect(harness.editor.querySelector("div div div")).toBeNull();
    expect(elapsed).toBeLessThan(1_000);
    harness.dispose();
  });

  it("keeps the draft and explains a deep markup payload with no text flavor", () => {
    setPlatform("macos");
    const harness = openComposer({ value: "keep this" });
    const html = `${"<div>".repeat(20_000)}${"</div>".repeat(20_000)}`;
    const event = pasteClipboard(harness.editor, { html });
    expect(event.defaultPrevented).toBe(true);
    expect(textOf(harness.editor)).toBe("keep this");
    expect(harness.draft()).toBeUndefined();
    expect(harness.notice()).toContain("not inserted");
    harness.dispose();
  });

  it("parses very many anchors and attributes within a bounded time", () => {
    setPlatform("macos");
    const harness = openComposer();
    const html = Array.from(
      { length: 2_000 },
      (_, index) =>
        `<p><a href="https://x.dev/${index}" title="link ${index}" rel="nofollow">anchor ${index}</a></p>`,
    ).join("");
    const started = performance.now();
    const event = pasteClipboard(harness.editor, { html, text: "anchors fallback" });
    const elapsed = performance.now() - started;
    expect(event.defaultPrevented).toBe(true);
    expect(harness.draft()).toContain("anchor 1999");
    expect(harness.editor.querySelectorAll("a")).toHaveLength(2_000);
    expect(elapsed).toBeLessThan(2_000);
    harness.dispose();
  });

  it("survives malformed markup and keeps its text", () => {
    setPlatform("macos");
    const harness = openComposer();
    const html =
      `${"<p>".repeat(200)}unclosed <b>bold <a href="https://x.dev/a(b)">link</a>` +
      `${"</div>".repeat(100)}<<script>alert(1)</script>`;
    const started = performance.now();
    const event = pasteClipboard(harness.editor, { html, text: "malformed fallback" });
    const elapsed = performance.now() - started;
    expect(event.defaultPrevented).toBe(true);
    expect(textOf(harness.editor)).toContain("unclosed");
    expect(textOf(harness.editor)).toContain("bold");
    expect(harness.notice()).toBe("");
    expect(elapsed).toBeLessThan(2_000);
    harness.dispose();
  });
});

describe("Composer literal paste gesture", () => {
  it("inserts the host clipboard text literally and leaves routing untouched", async () => {
    setPlatform("macos");
    const read = vi.fn<() => Promise<string | undefined>>(async () =>
      Promise.resolve("# not a heading\n\n- not a list"),
    );
    const harness = openComposer({ readClipboardText: read });
    harness.editor.dispatchEvent(chord());
    await vi.waitFor(() => expect(textOf(harness.editor)).toContain("# not a heading"));
    expect(read).toHaveBeenCalledOnce();
    expect(harness.editor.querySelector("h1")).toBeNull();
    expect(harness.editor.querySelector("ul")).toBeNull();
    expect(textOf(harness.editor)).toContain("- not a list");

    // The gesture is not sticky: an ordinary paste still uses the HTML pipeline.
    pasteClipboard(harness.editor, { html: "<p><strong>bold</strong></p>", text: "bold" });
    expect(harness.editor.querySelectorAll("strong")).toHaveLength(1);
    harness.dispose();
  });

  it("keeps the clipboard's Markdown and HTML out of the literal insertion", async () => {
    setPlatform("macos");
    const harness = openComposer({
      readClipboardText: async () => Promise.resolve("# plain heading"),
    });
    harness.editor.dispatchEvent(chord());
    await vi.waitFor(() => expect(textOf(harness.editor)).toContain("# plain heading"));
    expect(harness.editor.querySelector("h1")).toBeNull();
    harness.dispose();
  });

  it("turns an enormous literal paste into a text attachment", async () => {
    setPlatform("macos");
    const read = deferred<string | undefined>();
    const attachText = vi.fn<(text: string) => void>();
    const harness = openComposer({
      readClipboardText: () => read.promise,
      onAttachText: attachText,
    });
    harness.editor.dispatchEvent(chord());
    const huge = "x".repeat(16_384);
    read.resolve(huge);
    await settle();
    expect(attachText).toHaveBeenCalledWith(huge);
    expect(textOf(harness.editor)).toBe("");
    expect(harness.notice()).toBe("");
    harness.dispose();
  });

  it("keeps a literal paste just below the attachment threshold inline", async () => {
    setPlatform("macos");
    const read = deferred<string | undefined>();
    const attachText = vi.fn<(text: string) => void>();
    const harness = openComposer({
      readClipboardText: () => read.promise,
      onAttachText: attachText,
    });
    harness.editor.dispatchEvent(chord());
    const text = "x".repeat(16_383);
    read.resolve(text);
    await settle();
    expect(attachText).not.toHaveBeenCalled();
    expect(textOf(harness.editor)).toBe(text);
    harness.dispose();
  });

  it("suppresses a repeated identical large paste from a held chord", () => {
    setPlatform("macos");
    const attachText = vi.fn<(text: string) => void>();
    const harness = openComposer({ onAttachText: attachText });
    const huge = "x".repeat(16_384);
    pasteClipboard(harness.editor, { text: huge });
    pasteClipboard(harness.editor, { text: huge });
    expect(attachText).toHaveBeenCalledTimes(1);
    expect(textOf(harness.editor)).toBe("");
    harness.dispose();
  });

  it("attaches different large pastes separately", () => {
    setPlatform("macos");
    const attachText = vi.fn<(text: string) => void>();
    const harness = openComposer({ onAttachText: attachText });
    pasteClipboard(harness.editor, { text: "x".repeat(16_384) });
    pasteClipboard(harness.editor, { text: "y".repeat(16_384) });
    expect(attachText).toHaveBeenCalledTimes(2);
    expect(attachText.mock.calls[0]?.[0]).toBe("x".repeat(16_384));
    expect(attachText.mock.calls[1]?.[0]).toBe("y".repeat(16_384));
    harness.dispose();
  });

  it("explains when the host clipboard read is unavailable", async () => {
    setPlatform("macos");
    const harness = openComposer();
    harness.editor.dispatchEvent(chord());
    await vi.waitFor(() => expect(harness.notice()).toContain("Clipboard access is unavailable"));
    expect(harness.draft()).toBeUndefined();
    harness.dispose();
  });

  it("explains when the clipboard read is denied", async () => {
    setPlatform("macos");
    const harness = openComposer({ readClipboardText: async () => Promise.resolve(undefined) });
    harness.editor.dispatchEvent(chord());
    await vi.waitFor(() => expect(harness.notice()).toContain("Clipboard access is unavailable"));
    expect(harness.draft()).toBeUndefined();
    harness.dispose();
  });

  it("uses Ctrl on non-macOS platforms", async () => {
    setPlatform("other");
    const read = vi.fn<() => Promise<string | undefined>>(async () =>
      Promise.resolve("# literal on other platforms"),
    );
    const harness = openComposer({ readClipboardText: read });
    harness.editor.dispatchEvent(chord());
    // The macOS chord does nothing on the other platform.
    await Promise.resolve();
    expect(read).not.toHaveBeenCalled();
    pasteClipboard(harness.editor, { text: "# parses on other platforms" });
    expect(harness.editor.querySelector("h1")?.textContent).toBe("parses on other platforms");

    harness.editor.dispatchEvent(ctrlChord());
    await vi.waitFor(() =>
      expect(textOf(harness.editor)).toContain("# literal on other platforms"),
    );
    expect(harness.editor.querySelectorAll("h1")).toHaveLength(1);
    harness.dispose();
  });

  it("pastes raw newlines into a code block, where every paste is literal", () => {
    setPlatform("macos");
    const harness = openComposer({ value: "```\ncode\n```" });
    // The caret starts inside the code block; no gesture is needed.
    pasteClipboard(harness.editor, { text: "a\nb" });
    expect(harness.editor.querySelector("code")?.textContent).toContain("a\nb");
    harness.dispose();
  });
});

describe("Composer literal paste read ownership", () => {
  it("drops a read that resolves after navigating away and back", async () => {
    setPlatform("macos");
    const read = deferred<string | undefined>();
    const harness = openComposer({
      sessionID: "session-a",
      readClipboardText: () => read.promise,
    });
    harness.editor.dispatchEvent(chord());
    // A -> B -> A returns to the same session, but the draft that started the
    // read is gone; comparing session IDs alone would let this land.
    harness.setSessionID("session-b");
    harness.setSessionID("session-a");
    read.resolve("# stale clipboard");
    await settle();
    expect(textOf(harness.editor)).not.toContain("# stale clipboard");
    expect(harness.draft()).toBeUndefined();
    harness.dispose();
  });

  it("drops a read that resolves after the draft is cleared", async () => {
    setPlatform("macos");
    const read = deferred<string | undefined>();
    const harness = openComposer({ value: "keep this", readClipboardText: () => read.promise });
    harness.editor.dispatchEvent(chord());
    harness.setValue("");
    read.resolve("# stale clipboard");
    await settle();
    expect(textOf(harness.editor)).toBe("");
    expect(harness.draft()).toBeUndefined();
    harness.dispose();
  });

  it("drops a read that resolves after the draft is sent", async () => {
    setPlatform("macos");
    const read = deferred<string | undefined>();
    const harness = openComposer({ value: "send me", readClipboardText: () => read.promise });
    harness.editor.dispatchEvent(chord());
    // A confirmed send empties the draft while the host read is in flight.
    harness.setAction("sending");
    harness.setValue("");
    harness.setAction("send");
    read.resolve("# stale clipboard");
    await settle();
    expect(textOf(harness.editor)).toBe("");
    expect(harness.draft()).toBeUndefined();
    harness.dispose();
  });

  it("drops a read that resolves after an attachment-only send", async () => {
    setPlatform("macos");
    const read = deferred<string | undefined>();
    const file = new File(["shot"], "shot.png", { type: "image/png" });
    const harness = openComposer({
      files: [file],
      readClipboardText: () => read.promise,
    });
    harness.editor.dispatchEvent(chord());
    // Enter submits an empty-text, attachment-only draft. The parent's
    // clearIfUnchanged is invisible here because the text never changes, so the
    // submission boundary itself must invalidate the pending read.
    harness.editor.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(harness.submit).toHaveBeenCalledTimes(1);
    read.resolve("# stale clipboard");
    await settle();
    expect(textOf(harness.editor)).toBe("");
    expect(harness.draft()).toBeUndefined();
    harness.dispose();
  });

  it("drops a read that resolves while the composer is unavailable", async () => {
    setPlatform("macos");
    const read = deferred<string | undefined>();
    const harness = openComposer({ readClipboardText: () => read.promise });
    harness.editor.dispatchEvent(chord());
    harness.setDisabled(true);
    read.resolve("# stale clipboard");
    await settle();
    expect(textOf(harness.editor)).toBe("");
    // Re-enabling the composer does not replay the dropped insertion.
    harness.setDisabled(false);
    await settle();
    expect(textOf(harness.editor)).toBe("");
    harness.dispose();
  });

  it("drops a read that resolves while an IME owns the editor", async () => {
    setPlatform("macos");
    const read = deferred<string | undefined>();
    const harness = openComposer({ readClipboardText: () => read.promise });
    harness.editor.dispatchEvent(chord());
    harness.editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    read.resolve("# stale clipboard");
    await settle();
    expect(textOf(harness.editor)).not.toContain("# stale clipboard");
    harness.editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    harness.dispose();
  });

  it("drops a read that resolves after disposal", async () => {
    setPlatform("macos");
    const read = deferred<string | undefined>();
    const harness = openComposer({ readClipboardText: () => read.promise });
    harness.editor.dispatchEvent(chord());
    const editor = harness.editor;
    harness.dispose();
    read.resolve("# stale clipboard");
    await settle();
    expect(textOf(editor)).not.toContain("# stale clipboard");
    expect(harness.input).not.toHaveBeenCalled();
  });

  it("lets the later overlapping read win when it completes first", async () => {
    setPlatform("macos");
    const first = deferred<string | undefined>();
    const second = deferred<string | undefined>();
    const reads = [first, second];
    let index = 0;
    const harness = openComposer({ readClipboardText: () => reads[index++]!.promise });
    harness.editor.dispatchEvent(chord());
    harness.editor.dispatchEvent(chord());

    second.resolve("second text");
    await settle();
    expect(textOf(harness.editor)).toContain("second text");
    first.resolve("first text");
    await settle();
    expect(textOf(harness.editor)).not.toContain("first text");
    harness.dispose();
  });

  it("drops an earlier overlapping read that completes before the latest", async () => {
    setPlatform("macos");
    const first = deferred<string | undefined>();
    const second = deferred<string | undefined>();
    const reads = [first, second];
    let index = 0;
    const harness = openComposer({ readClipboardText: () => reads[index++]!.promise });
    harness.editor.dispatchEvent(chord());
    harness.editor.dispatchEvent(chord());

    first.resolve("first text");
    await settle();
    expect(textOf(harness.editor)).not.toContain("first text");
    second.resolve("second text");
    await settle();
    expect(textOf(harness.editor)).toContain("second text");
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

  it("leaves an oversized paste to native handling when no attachment owner exists", () => {
    setPlatform("macos");
    const harness = openComposer();
    const text = "a".repeat(16_384);
    pasteClipboard(harness.editor, { text });
    // No intent was submitted; ProseMirror's own paste handling inserts the
    // characters, which is the pre-existing behavior when no owner is present.
    expect(harness.draft()).toBe(text);
    harness.dispose();
  });
});

describe("Composer literal paste escape hatch", () => {
  it("offers a menu action that inserts clipboard text literally", async () => {
    setPlatform("macos");
    const harness = openComposer({
      readClipboardText: async () => Promise.resolve("# literal from the clipboard"),
    });
    harness.editor.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    const item = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('[role="menuitem"]');
      if (found === null) throw new Error("paste menu did not open");
      return found;
    });
    expect(item.textContent).toContain("Paste as plain text");
    // Keyboard activation, exactly as a list item is selected from the menu.
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // The clipboard read is asynchronous; wait for its insertion.
    await vi.waitFor(() =>
      expect(textOf(harness.editor)).toContain("# literal from the clipboard"),
    );
    expect(harness.editor.querySelector("h1")).toBeNull();
    expect(harness.editor.contains(document.activeElement)).toBe(true);
    harness.dispose();
  });

  it("explains unavailable clipboard access instead of failing silently", async () => {
    setPlatform("macos");
    const harness = openComposer({
      readClipboardText: async () => Promise.resolve(undefined),
    });
    harness.editor.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    const item = await vi.waitFor(() => {
      const found = document.querySelector<HTMLElement>('[role="menuitem"]');
      if (found === null) throw new Error("paste menu did not open");
      return found;
    });
    // Mouse activation path: Kobalte selects an item on pointer up.
    item.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    await vi.waitFor(() => expect(harness.notice()).toContain("Clipboard access"));
    expect(harness.draft()).toBeUndefined();
    harness.dispose();
  });
});

describe("Composer paste recovery surface", () => {
  it("shows the retained source text and restores it literally", async () => {
    setPlatform("macos");
    let retained: string | undefined = "# recovered";
    const dismiss = vi.fn<() => void>();
    const harness = openComposer({
      pasteRecovery: {
        message: "The pasted text is larger than the 2 MiB attachment limit.",
        take: () => {
          const text = retained;
          retained = undefined;
          return text;
        },
        dismiss,
      },
    });
    const alert = harness.host.querySelector<HTMLElement>('[role="alert"]');
    expect(alert?.textContent).toContain("2 MiB");
    const buttons = [...harness.host.querySelectorAll("button")];
    const restore = buttons.find((button) => button.textContent === "Restore text");
    const dismissButton = buttons.find((button) => button.textContent === "Dismiss");
    if (!restore || !dismissButton) throw new Error("recovery actions did not render");

    restore.click();
    await vi.waitFor(() => expect(textOf(harness.editor)).toContain("# recovered"));
    expect(harness.editor.querySelector("h1")).toBeNull();

    dismissButton.click();
    expect(dismiss).toHaveBeenCalledOnce();
    harness.dispose();
  });
});
