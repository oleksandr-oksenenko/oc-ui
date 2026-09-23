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
      files={options.files}
      modelSelection={unavailableSelection}
      agentSelection={unavailableAgentSelection}
      onAttachText={options.onAttachText ?? (() => undefined)}
      readClipboardText={options.readClipboardText ?? (() => Promise.resolve(undefined))}
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

describe("Composer literal paste gesture", () => {
  it("inserts the clipboard text literally and leaves routing untouched", async () => {
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

    // The gesture is not sticky: an ordinary paste still routes as Markdown.
    pasteClipboard(harness.editor, { text: "**bold**" });
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
