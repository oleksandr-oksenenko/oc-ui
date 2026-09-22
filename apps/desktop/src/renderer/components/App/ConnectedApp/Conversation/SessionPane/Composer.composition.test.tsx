import { createSignal } from "solid-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import { Composer } from "./Composer.tsx";
import type { ComposerCatalog } from "./Composer.tsx";

// The suggestion menu scrolls its active option; jsdom has no scrollTo.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: () => undefined,
  });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

// Synthetic IME coverage. jsdom does not run an input method: these tests only
// prove how the handlers react to composition events and to keydown payloads
// that browsers produce around a composition. The native protocol covers the
// event order and payloads real IMEs emit.

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

const catalog: ComposerCatalog = {
  commands: {
    state: "ready",
    items: [{ name: "build", description: "Build the project" }],
  },
  skills: {
    state: "ready",
    items: [{ id: "review", name: "review", description: "Review work" }],
  },
  onRetry: () => undefined,
};

const loadingCatalog: ComposerCatalog = {
  commands: { state: "loading", items: [] },
  skills: { state: "loading", items: [] },
  onRetry: () => undefined,
};

/** The platform decides whether Mod is Meta or Ctrl, exactly as the keymap does. */
const primaryModifier = (): KeyboardEventInit =>
  /Mac|iP(hone|[oa]d)/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };

/** A composition boundary event, as the browser delivers it to the editor. */
const compositionEvent = (type: "compositionstart" | "compositionupdate" | "compositionend") =>
  new CompositionEvent(type, { bubbles: true, cancelable: true, data: "" });

/** Lets the suggestion list finish filtering before the next assertion. */
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

/**
 * Mounts a controlled composer. The draft is echoed back so ProseMirror keeps
 * its live document and the suggestion menu can stay open across events.
 */
function openComposer(composerCatalog: ComposerCatalog = catalog) {
  const submit = vi.fn<() => void>();
  const queue = vi.fn<() => void>();
  const input = vi.fn<(value: string) => void>();
  const [value, setValue] = createSignal("");
  const { host, dispose } = mount(() => (
    <Composer
      value={value()}
      disabled={false}
      action="send"
      catalog={composerCatalog}
      modelSelection={unavailableSelection}
      agentSelection={unavailableAgentSelection}
      onInput={(text) => {
        input(text);
        setValue(text);
      }}
      onSubmit={submit}
      onQueue={queue}
    />
  ));
  const editor = host.querySelector<HTMLDivElement>('[aria-label="Prompt"]');
  if (!editor) throw new Error("Composer did not render its prompt");

  const composition = (type: "compositionstart" | "compositionupdate" | "compositionend") => {
    const event = compositionEvent(type);
    editor.dispatchEvent(event);
    return event;
  };
  // The legacy key code is applied before dispatch; engines that predate
  // `isComposing` report it on the event the handlers see.
  const press = (key: string, init: KeyboardEventInit & { keyCode?: number } = {}) => {
    const { keyCode, ...rest } = init;
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...rest,
    });
    if (keyCode !== undefined) {
      Object.defineProperty(event, "keyCode", { value: keyCode, configurable: true });
    }
    editor.dispatchEvent(event);
    return event;
  };
  const enter = (init: KeyboardEventInit & { keyCode?: number } = {}) => press("Enter", init);
  const paste = (text: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files: [], getData: () => text },
    });
    editor.dispatchEvent(event);
    return event;
  };
  const menu = () => host.querySelector(".prompt-suggestion-menu");
  const draft = () => input.mock.calls.at(-1)?.[0] ?? "";

  return {
    host,
    dispose,
    editor,
    submit,
    queue,
    input,
    composition,
    press,
    enter,
    paste,
    settle,
    menu,
    draft,
  };
}

describe("Composer composition precedence", () => {
  it("does not submit or queue on Enter while a composition is active", () => {
    const harness = openComposer();
    harness.paste("/");
    expect(harness.menu()).not.toBeNull();

    harness.composition("compositionstart");
    expect(harness.menu()).toBeNull();

    // Browsers differ on the payload they send for the Enter that commits a
    // composition. None of these may reach the form or the document.
    harness.enter();
    harness.enter({ isComposing: true });
    harness.enter({ keyCode: 229 });
    harness.composition("compositionupdate");
    harness.enter();
    harness.enter({ metaKey: true });
    harness.enter({ ctrlKey: true });

    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.queue).not.toHaveBeenCalled();
    expect(harness.draft()).toBe("/");

    harness.dispose();
  });

  it("never queues during composition even with the queue modifier", () => {
    const harness = openComposer();
    harness.composition("compositionstart");
    harness.enter({ metaKey: true });
    harness.enter({ ctrlKey: true });
    harness.enter({ keyCode: 229 });
    expect(harness.queue).not.toHaveBeenCalled();
    expect(harness.submit).not.toHaveBeenCalled();
    harness.dispose();
  });

  it("picks the suggestion item on Enter and keeps the form out of it", async () => {
    const harness = openComposer();
    harness.paste("/");
    await harness.settle();
    expect(harness.menu()).not.toBeNull();

    harness.enter();

    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.queue).not.toHaveBeenCalled();
    expect(harness.menu()).toBeNull();
    expect(harness.draft()).toContain("/build");

    harness.dispose();
  });

  it("gives composition precedence over the open suggestion menu", async () => {
    for (const signal of [{ isComposing: true }, { keyCode: 229 }] as const) {
      const harness = openComposer();
      harness.paste("/");
      await harness.settle();
      expect(harness.menu()).not.toBeNull();

      // A keydown that claims to belong to a composition while the browser
      // failed to deliver composition events must not select an item, format
      // the document, or submit the draft.
      harness.enter(signal);

      expect(harness.submit).not.toHaveBeenCalled();
      expect(harness.queue).not.toHaveBeenCalled();
      expect(harness.menu()).not.toBeNull();
      expect(harness.draft()).toBe("/");

      harness.dispose();
    }
  });

  it("closes the suggestion menu when composition starts, without sending", async () => {
    const harness = openComposer();
    harness.paste("/");
    await harness.settle();
    expect(harness.menu()).not.toBeNull();

    harness.composition("compositionstart");
    expect(harness.menu()).toBeNull();
    harness.enter();
    expect(harness.submit).not.toHaveBeenCalled();

    harness.dispose();
  });

  it("leaves Escape to the composition and keeps it closing the menu otherwise", async () => {
    const composing = openComposer();
    composing.paste("/");
    await composing.settle();
    composing.composition("compositionstart");
    composing.press("Escape");
    expect(composing.submit).not.toHaveBeenCalled();
    composing.dispose();

    const menu = openComposer();
    menu.paste("/");
    await menu.settle();
    expect(menu.menu()).not.toBeNull();
    menu.press("Escape");
    expect(menu.menu()).toBeNull();
    expect(menu.submit).not.toHaveBeenCalled();
    menu.dispose();
  });

  it("leaves Tab to the composition instead of transforming the document", () => {
    const composing = openComposer();
    composing.paste("- one\n- two");
    const before = composing.draft();
    composing.composition("compositionstart");
    composing.press("Tab");
    composing.press("Tab", { shiftKey: true });
    expect(composing.draft()).toBe(before);
    composing.dispose();

    // Control: the same document sinks its item when no composition is active.
    const editing = openComposer();
    editing.paste("- one\n- two");
    const plain = editing.draft();
    editing.press("Tab");
    expect(editing.draft()).not.toBe(plain);
    editing.dispose();
  });

  it("does not open the menu from text that arrives during composition", async () => {
    const harness = openComposer();
    harness.composition("compositionstart");
    harness.paste("/");
    expect(harness.menu()).toBeNull();
    expect(harness.input).not.toHaveBeenCalled();
    harness.composition("compositionend");

    // Committed text behaves normally again.
    harness.paste("/");
    await harness.settle();
    expect(harness.menu()).not.toBeNull();
    harness.dispose();
  });

  // D4 is not asserted here: on Safari-like engines ProseMirror drops the
  // first keydown within 500 ms of `compositionend`, so a quick Enter after
  // committing does nothing and the next Enter sends. That is upstream engine
  // behavior, not the composer's contract, and Electron on macOS is Chromium.
  // The native protocol records the platform behavior before any grace guard
  // is considered.
});

describe("Composer menu ownership", () => {
  it("consumes Enter when the open menu has no matching item", async () => {
    // The menu owns Enter while it is open, whatever its state. A query with
    // no matches keeps the draft in the composer instead of sending it.
    const harness = openComposer();
    harness.paste("/zzz");
    await harness.settle();
    expect(harness.menu()).not.toBeNull();

    harness.enter();
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.queue).not.toHaveBeenCalled();
    expect(harness.menu()).not.toBeNull();
    expect(harness.draft()).toBe("/zzz");

    harness.enter({ metaKey: true });
    harness.enter({ ctrlKey: true });
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.queue).not.toHaveBeenCalled();

    harness.dispose();
  });

  it("consumes Enter while the menu is loading and lets Escape send", async () => {
    const harness = openComposer(loadingCatalog);
    harness.paste("/");
    await harness.settle();
    expect(harness.menu()).not.toBeNull();
    expect(harness.host.textContent).toContain("Loading commands…");

    harness.enter();
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.queue).not.toHaveBeenCalled();
    expect(harness.draft()).toBe("/");

    // Dismissing the menu is the way to send a draft it owns.
    harness.press("Escape");
    expect(harness.menu()).toBeNull();
    harness.enter();
    expect(harness.submit).toHaveBeenCalledOnce();

    harness.dispose();
  });

  it("keeps Mod+Enter in the menu while it is open", async () => {
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const harness = openComposer();
      harness.paste("/bu");
      await harness.settle();
      expect(harness.menu()).not.toBeNull();

      harness.enter(modifier);
      expect(harness.queue).not.toHaveBeenCalled();
      expect(harness.submit).not.toHaveBeenCalled();
      expect(harness.menu()).toBeNull();
      expect(harness.draft()).toContain("/build");

      harness.dispose();
    }
  });

  it("keeps Shift+Enter in the editor while the menu is open", async () => {
    const harness = openComposer();
    harness.paste("/bu");
    await harness.settle();
    expect(harness.menu()).not.toBeNull();

    harness.press("Enter", { shiftKey: true });
    expect(harness.submit).not.toHaveBeenCalled();
    expect(harness.queue).not.toHaveBeenCalled();

    // The line break stayed in the editor: the next text lands on line two.
    harness.paste("next");
    await harness.settle();
    expect(harness.draft()).toBe("/bu\nnext");

    harness.dispose();
  });

  it("keeps a dismissed menu closed until the query changes", async () => {
    const harness = openComposer();
    harness.paste("/build");
    await harness.settle();
    expect(harness.menu()).not.toBeNull();

    harness.press("Escape");
    expect(harness.menu()).toBeNull();

    // A transaction with no document change (a formatting toggle with an
    // empty selection) recomputes the same query; it must not reopen the menu.
    harness.press("b", primaryModifier());
    expect(harness.menu()).toBeNull();
    expect(harness.draft()).toBe("/build");

    // A changed query is a new interaction and opens the menu again.
    harness.paste("more");
    await harness.settle();
    expect(harness.menu()).not.toBeNull();
    expect(harness.draft()).toBe("/buildmore");

    // A selection-only caret move that changes the query is a new interaction.
    // jsdom does not move carets for arrow keys, so drive the DOM selection
    // the way a browser would and let ProseMirror sync it.
    harness.press("Escape");
    expect(harness.menu()).toBeNull();
    harness.editor.focus();
    const paragraph = harness.editor.querySelector("p");
    const textNode = paragraph?.firstChild;
    if (textNode) {
      const range = document.createRange();
      range.setStart(textNode, Math.max(0, (textNode.textContent ?? "").length - 1));
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    }
    await harness.settle();
    expect(harness.menu()).not.toBeNull();

    harness.dispose();
  });
});
