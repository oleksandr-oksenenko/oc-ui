import { createEffect, on, onCleanup, onMount } from "solid-js";
import type { Browser } from "@opencode/plugin-browser/rpc";
import type { BrowserLayout } from "../../../../../shared/browser-api.ts";

export type BrowserViewportProps = {
  readonly bindingID: string;
  readonly tabID: Browser.TabID;
  readonly onLayout: (layout: BrowserLayout) => void;
};

/** Native views sit above DOM content, so hide them while app overlays cover this slot. */
export function BrowserViewport(props: BrowserViewportProps) {
  let element: HTMLDivElement | undefined;
  let frame = 0;
  let last: BrowserLayout | undefined;
  const measure = () => {
    frame = 0;
    if (!element) return;
    const viewport = element;
    const rect = viewport.getBoundingClientRect();
    const overlay = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'),
    ).some(
      (dialog) =>
        !dialog.contains(viewport) &&
        dialog.getClientRects().length > 0 &&
        getComputedStyle(dialog).visibility !== "hidden",
    );
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      !overlay &&
      document.visibilityState !== "hidden" &&
      [
        [rect.left + 1, rect.top + 1],
        [rect.right - 1, rect.bottom - 1],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
      ].every(([x = 0, y = 0]) => viewport.contains(document.elementFromPoint(x, y)));
    const layout: BrowserLayout = {
      bindingID: props.bindingID,
      tabID: props.tabID,
      visible,
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      },
    };
    if (JSON.stringify(layout) === JSON.stringify(last)) return;
    last = layout;
    props.onLayout(layout);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
  createEffect(on(() => [props.tabID, props.bindingID], schedule));
  onMount(() => {
    if (!element) return;
    const resize = new ResizeObserver(schedule);
    const mutation = new MutationObserver(schedule);
    resize.observe(element);
    mutation.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "inert", "data-state"],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    onCleanup(() => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("visibilitychange", schedule);
      cancelAnimationFrame(frame);
      if (last) props.onLayout({ ...last, visible: false });
    });
  });
  return (
    <div
      ref={(value) => {
        element = value;
      }}
      class="browser-viewport"
      aria-label="Browser page"
    />
  );
}
