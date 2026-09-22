import type { BrowserAnnotatorReply } from "../shared/browser-annotator.ts";

/**
 * Minimal comment card for the in-page annotation popover. Kept free of
 * Electron imports so its DOM behavior (Enter/Escape/IME/length) is unit
 * testable in jsdom; the preload wires the transport.
 */

export type AnnotatorCardAnchor = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

const MAX_BODY_LENGTH = 4_096;

const STYLES = `
:host { all: initial; }
.card {
  position: fixed;
  box-sizing: border-box;
  width: min(300px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow: auto;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(24, 24, 27, 0.98);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  color: #f4f4f5;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.4;
  pointer-events: auto;
}
textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 54px;
  resize: none;
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font: inherit;
  outline: none;
}
textarea:focus { border-color: rgba(255, 255, 255, 0.42); }
.row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 6px;
  gap: 6px;
}
.hint {
  margin-right: auto;
  color: rgba(244, 244, 245, 0.55);
  font-size: 11px;
}
button {
  padding: 3px 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
button.primary { border-color: transparent; background: #e4e4e7; color: #18181b; }
button:disabled { opacity: 0.45; cursor: default; }
button:not(:disabled):hover { border-color: rgba(255, 255, 255, 0.36); }
button.primary:not(:disabled):hover { background: #fff; }
`;

/** Places the card beside the anchor inside the current viewport. */
export function computeCardPosition(
  anchor: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  card: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
) {
  const left = Math.min(Math.max(8, anchor.left), Math.max(8, viewport.width - card.width - 8));
  let top = anchor.top + anchor.height + 8;
  if (top + card.height > viewport.height - 8) top = anchor.top - card.height - 8;
  const maxTop = Math.max(8, viewport.height - card.height - 8);
  return { left, top: Math.min(Math.max(8, top), maxTop) };
}

export function createAnnotatorCard(
  send: (reply: BrowserAnnotatorReply) => void,
  options: { readonly shadowRootMode?: "open" | "closed" } = {},
) {
  let host: HTMLDivElement | undefined;
  let scope: ShadowRoot | undefined;
  let card: HTMLDivElement | undefined;
  let textarea: HTMLTextAreaElement | undefined;
  let saveButton: HTMLButtonElement | undefined;
  let current: AnnotatorCardAnchor | undefined;

  function close() {
    card?.remove();
    card = undefined;
    textarea = undefined;
    saveButton = undefined;
    current = undefined;
    host?.removeAttribute("data-open");
  }

  function save() {
    const body = textarea?.value.trim() ?? "";
    if (!body || !current) return;
    send({ _tag: "save", body });
    close();
  }

  function cancel() {
    if (!current) return;
    send({ _tag: "cancel" });
    close();
  }

  function ensureHost() {
    if (host?.isConnected && scope) return;
    host?.remove();
    host = document.createElement("div");
    host.setAttribute("data-ocui-annotator", "");
    host.style.cssText =
      "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;";
    scope = host.attachShadow({ mode: options.shadowRootMode ?? "closed" });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      scope.adoptedStyleSheets = [sheet];
    } catch {
      // Engines without constructed stylesheets (for example jsdom) still render.
      const style = document.createElement("style");
      style.textContent = STYLES;
      scope.append(style);
    }
    document.documentElement.append(host);
  }

  function place(anchor: AnnotatorCardAnchor) {
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    // Fixed placement: the card describes a frozen capture and does not chase
    // the element while the page scrolls. The position is clamped to the
    // current viewport, including after a resize that shrinks it.
    const position = computeCardPosition(anchor, bounds, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    card.style.left = `${position.left}px`;
    card.style.top = `${position.top}px`;
    // Geometry for the native acceptance flow, which clicks the editor like a user.
    const placed = card.getBoundingClientRect();
    host?.setAttribute(
      "data-ocui-annotator-rect",
      `${placed.left},${placed.top},${placed.width},${placed.height}`,
    );
  }

  function open(anchor: AnnotatorCardAnchor) {
    close();
    ensureHost();
    card = document.createElement("div");
    card.className = "card";
    // Bubble phase: the textarea's own key handler must run first; stopping here
    // keeps page-level shortcuts from seeing input without swallowing editing.
    for (const type of ["pointerdown", "mousedown", "click", "keydown", "keyup", "keypress"]) {
      card.addEventListener(type, (event: Event) => event.stopPropagation());
    }
    card.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    });
    textarea = document.createElement("textarea");
    textarea.setAttribute("aria-label", "Annotation comment");
    textarea.placeholder = "Describe the change…";
    textarea.rows = 3;
    textarea.maxLength = MAX_BODY_LENGTH;
    textarea.addEventListener("keydown", (event: KeyboardEvent) => {
      event.stopPropagation();
      // IME composition owns Enter and Escape until it commits.
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        save();
      }
    });
    textarea.addEventListener("input", () => {
      if (saveButton) saveButton.disabled = textarea?.value.trim().length === 0;
    });
    const row = document.createElement("div");
    row.className = "row";
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Enter to add · Esc to cancel";
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", cancel);
    saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "primary";
    saveButton.textContent = "Add";
    saveButton.disabled = true;
    saveButton.addEventListener("click", save);
    row.append(hint, cancelButton, saveButton);
    card.append(textarea, row);
    scope!.append(card);
    host!.setAttribute("data-open", "true");
    current = anchor;
    place(anchor);
    textarea.focus({ preventScroll: true });
    send({ _tag: "opened" });
  }

  window.addEventListener("resize", () => {
    if (current) place(current);
  });

  return { open, close };
}
