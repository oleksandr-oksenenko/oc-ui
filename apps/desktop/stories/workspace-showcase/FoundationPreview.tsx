import { Button } from "@opencode/ui/button";
import { createRenderEffect, createSignal, onCleanup, type ParentProps } from "solid-js";

import "./foundation-preview.css";

/** Story-owned presentation state; the document scope also reaches portaled menus and dialogs. */
export function FoundationPreview(props: ParentProps) {
  const [treatment, setTreatment] = createSignal<"current" | "proposed" | "warm">("warm");
  const root = document.documentElement;
  const previous = root.dataset.workspaceFoundations;
  createRenderEffect(() => {
    root.dataset.workspaceFoundations = treatment();
  });
  onCleanup(() => {
    if (previous === undefined) delete root.dataset.workspaceFoundations;
    else root.dataset.workspaceFoundations = previous;
  });

  return (
    <div class="foundation-preview">
      <header class="foundation-preview-toolbar">
        <span class="foundation-preview-label">Foundation preview</span>
        <div class="foundation-preview-options" role="group" aria-label="Foundation treatment">
          <Button
            size="small"
            variant="ghost"
            aria-pressed={treatment() === "current"}
            onClick={() => setTreatment("current")}
          >
            Current
          </Button>
          <Button
            size="small"
            variant="ghost"
            aria-pressed={treatment() === "proposed"}
            onClick={() => setTreatment("proposed")}
          >
            Proposed
          </Button>
          <Button
            size="small"
            variant="ghost"
            aria-pressed={treatment() === "warm"}
            onClick={() => setTreatment("warm")}
          >
            Warm paper
          </Button>
        </div>
        <span class="foundation-preview-hint">
          Compare in Light and Dark using the theme control
        </span>
      </header>
      <div class="foundation-preview-workspace">{props.children}</div>
    </div>
  );
}
