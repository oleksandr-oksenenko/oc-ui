import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ServerFlowDialogProvider } from "../../../../ui/ServerFlowDialogProvider.tsx";
import { createReviewFlow, ReviewRegion } from "./ReviewRegion.tsx";

async function flushMicrotask(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("ReviewRegion", () => {
  it("defers flow dismissal until after close while preserving confirmation", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
    });
    let dispose: (() => void) | undefined;
    try {
      const host = document.createElement("div");
      document.body.append(host);
      const flow = createReviewFlow();
      const onConfirm = vi.fn<() => void>();
      flow.confirmRemoval({
        title: "Remove review comment?",
        description: "The comment will be removed.",
        confirmLabel: "Remove comment",
        onConfirm,
      });
      dispose = render(
        () => (
          <ServerFlowDialogProvider>
            <ReviewRegion flow={flow} />
          </ServerFlowDialogProvider>
        ),
        host,
      );

      const confirmButton = await vi.waitFor(() => {
        const candidate = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
          (button) => button.textContent?.trim() === "Remove comment",
        );
        if (candidate === undefined) throw new Error("Remove comment button was not rendered");
        return candidate;
      });
      confirmButton.click();

      expect(onConfirm).toHaveBeenCalledOnce();
      expect(flow.removal()).toBeDefined();
      await flushMicrotask();
      expect(flow.removal()).toBeUndefined();

      // Finish the closing timer and its separate root before provider disposal.
      await vi.runAllTimersAsync();
    } finally {
      try {
        dispose?.();
        // Execute nested Kobalte timer/frame cleanup while JSDOM is still alive.
        await vi.runAllTimersAsync();
      } finally {
        vi.useRealTimers();
      }
    }
  });
});
