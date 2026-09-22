import { describe, expect, it, vi } from "vite-plus/test";

import { mount } from "../../../../../test/mount.ts";
import { Composer } from "./Composer.tsx";
import type { ComposerPasteRecovery } from "./Composer.tsx";

// The prompt editor registers the imperative control that restore inserts
// through. Rendering it without that registration models an editor that is
// unavailable, so the restore action must not consume the retained source.
vi.mock("./Composer/PromptEditor.tsx", () => ({
  PromptEditor: () => null,
}));

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

describe("Composer paste recovery without an editor", () => {
  it("keeps the recovery when no editor can receive the retained source", () => {
    const take = vi.fn<() => string | undefined>(() => "# recovered");
    const dismiss = vi.fn<() => void>();
    const recovery: ComposerPasteRecovery = {
      message: "The pasted text is larger than the 2 MiB attachment limit.",
      take,
      dismiss,
    };
    const { host, dispose } = mount(() => (
      <Composer
        value=""
        disabled={false}
        action="send"
        pasteRecovery={recovery}
        modelSelection={unavailableSelection}
        agentSelection={unavailableAgentSelection}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ));

    const restore = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Restore text",
    );
    if (!restore) throw new Error("recovery actions did not render");
    restore.click();

    // The source stays retained so the user can retry once an editor exists.
    expect(take).not.toHaveBeenCalled();
    expect(host.querySelector(".composer-paste-recovery")).not.toBeNull();
    dispose();
  });
});
