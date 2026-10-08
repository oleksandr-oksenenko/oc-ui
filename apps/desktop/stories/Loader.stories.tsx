/* oxlint-disable effecttsgo/async-function -- Storybook interactions use Promise APIs. */
import { Loader as UpstreamLoader } from "@opencode/ui/loader";
import { For } from "solid-js";
import type { Meta } from "storybook-solidjs-vite";
import { expect } from "storybook/test";

import { Loader } from "../src/renderer/ui/Loader.tsx";

const sizes = [14, 16, 18, 32];

export default {
  title: "Feedback/Loader",
  component: Loader,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Loader>;

export const VisualParity = {
  render: () => (
    <div style={{ display: "grid", "grid-template-columns": "128px 128px", gap: "24px" }}>
      <span>Upstream</span>
      <span>Ocui</span>
      <For each={sizes}>
        {(size) => (
          <>
            <div data-reference-size={size} style={{ display: "grid", "place-items": "center" }}>
              <UpstreamLoader width={size} height={size} />
            </div>
            <div data-local-size={size} style={{ display: "grid", "place-items": "center" }}>
              <Loader width={size} height={size} />
            </div>
          </>
        )}
      </For>
    </div>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    // Freeze at the same rotation for geometry checks, then resume the live comparison.
    for (const animation of canvasElement.getAnimations({ subtree: true })) {
      animation.pause();
      animation.currentTime = 225;
    }
    for (const size of sizes) {
      const reference = canvasElement.querySelector(`[data-reference-size="${size}"] svg`);
      const local = canvasElement.querySelector(`[data-local-size="${size}"] svg`);
      if (!reference || !local) throw new Error(`Missing ${size}px loader pair`);
      await expect(local.innerHTML).toBe(reference.innerHTML);
      await expect(getComputedStyle(local).color).toBe(getComputedStyle(reference).color);
      await expect(local.getAttribute("aria-hidden")).toBe(reference.getAttribute("aria-hidden"));
      await expect(local.getBoundingClientRect().width).toBeCloseTo(
        reference.getBoundingClientRect().width,
      );
      await expect(local.getBoundingClientRect().height).toBeCloseTo(
        reference.getBoundingClientRect().height,
      );
    }
    for (const animation of canvasElement.getAnimations({ subtree: true })) {
      animation.play();
    }
  },
};
