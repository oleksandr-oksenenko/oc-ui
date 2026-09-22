import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { BrowserAnnotatorReply } from "../shared/browser-annotator.ts";
import { computeCardPosition, createAnnotatorCard } from "./browser-annotator-card.ts";

const anchor = { left: 40, top: 60, width: 200, height: 40 };

const key = (target: Element, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

const openHost = () => document.querySelector<HTMLElement>("[data-ocui-annotator][data-open]");

function setup() {
  const send = vi.fn<(reply: BrowserAnnotatorReply) => void>();
  const card = createAnnotatorCard(send, { shadowRootMode: "open" });
  const editor = () => openHost()?.shadowRoot?.querySelector("textarea") ?? null;
  const addButton = () =>
    openHost()?.shadowRoot?.querySelector<HTMLButtonElement>("button.primary") ?? null;
  const cancelButton = () => openHost()?.shadowRoot?.querySelectorAll("button")[0] ?? null;
  return { card, send, host: openHost, editor, addButton, cancelButton };
}

afterEach(() => {
  document.querySelectorAll("[data-ocui-annotator]").forEach((host) => host.remove());
});

describe("annotator card", () => {
  it("opens beside the anchor and acknowledges the interaction", () => {
    const fixture = setup();
    fixture.card.open(anchor);
    expect(fixture.send).toHaveBeenCalledWith({ _tag: "opened" });
    expect(fixture.host()?.hasAttribute("data-open")).toBe(true);
    expect(fixture.editor()?.getAttribute("aria-label")).toBe("Annotation comment");
    expect(fixture.editor()?.maxLength).toBe(4_096);
    expect(fixture.host()?.getAttribute("data-ocui-annotator-rect")).toBeTruthy();
  });

  it("saves a trimmed comment on Enter and closes", () => {
    const fixture = setup();
    fixture.card.open(anchor);
    const editor = fixture.editor()!;
    editor.value = "  Tighten the spacing  ";
    editor.dispatchEvent(new Event("input"));
    expect(fixture.addButton()?.disabled).toBe(false);
    key(editor, { key: "Enter" });
    expect(fixture.send).toHaveBeenCalledWith({
      _tag: "save",
      body: "Tighten the spacing",
    });
    expect(document.querySelector("[data-ocui-annotator][data-open]")).toBeNull();
  });

  it("keeps Shift+Enter and IME composition from saving", () => {
    const fixture = setup();
    fixture.card.open(anchor);
    const editor = fixture.editor()!;
    editor.value = "Line one";
    key(editor, { key: "Enter", shiftKey: true });
    key(editor, { key: "Enter", isComposing: true });
    expect(fixture.send).not.toHaveBeenCalledWith(expect.objectContaining({ _tag: "save" }));
  });

  it("cancels from the textarea or from a button with Escape", () => {
    const first = setup();
    first.card.open(anchor);
    key(first.editor()!, { key: "Escape" });
    expect(first.send).toHaveBeenCalledWith({ _tag: "cancel" });

    const second = setup();
    second.card.open(anchor);
    key(second.cancelButton()!, { key: "Escape" });
    expect(second.send).toHaveBeenCalledWith({ _tag: "cancel" });
  });

  it("treats close as a no-op without an editor and recovers a detached host", () => {
    const fixture = setup();
    fixture.card.close();
    expect(document.querySelector("[data-ocui-annotator][data-open]")).toBeNull();
    fixture.card.open(anchor);
    fixture.host()?.remove();
    fixture.card.open(anchor);
    expect(fixture.host()?.isConnected).toBe(true);
    expect(fixture.host()?.getAttribute("data-ocui-annotator-rect")).toBeTruthy();
  });
});

describe("annotator card placement", () => {
  const card = { width: 300, height: 120 };

  it("sits below the anchor when there is room", () => {
    const position = computeCardPosition({ left: 40, top: 60, width: 200, height: 40 }, card, {
      width: 1024,
      height: 768,
    });
    expect(position).toEqual({ left: 40, top: 108 });
  });

  it("flips above the anchor near the bottom edge", () => {
    const position = computeCardPosition({ left: 40, top: 700, width: 200, height: 40 }, card, {
      width: 1024,
      height: 768,
    });
    expect(position.top).toBe(572);
  });

  it("clamps into a viewport that shrank below the anchor", () => {
    const position = computeCardPosition({ left: 40, top: 900, width: 200, height: 40 }, card, {
      width: 1024,
      height: 600,
    });
    expect(position.top).toBe(472);
    expect(position.top + card.height).toBeLessThanOrEqual(600 - 8);
  });

  it("clamps horizontally and never goes above the top edge", () => {
    expect(
      computeCardPosition({ left: 1000, top: 10, width: 200, height: 40 }, card, {
        width: 1024,
        height: 768,
      }).left,
    ).toBe(716);
    expect(
      computeCardPosition({ left: 10, top: 0, width: 200, height: 40 }, card, {
        width: 1024,
        height: 768,
      }).top,
    ).toBeGreaterThanOrEqual(8);
  });
});
