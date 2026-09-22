import type { ComposerProps } from "./Composer.tsx";

/**
 * Shared fixtures for Composer tests that do not exercise the model, agent or
 * clipboard surfaces. The composer requires all of them; a test that exercises
 * one passes its own attribute on its own mount.
 */
export const unavailableSelection: ComposerProps["modelSelection"] = {
  state: "failed",
  switching: false,
  disabled: false,
  models: [],
  variants: [],
  onSelectModel: () => undefined,
  onSelectVariant: () => undefined,
};

export const unavailableAgentSelection: ComposerProps["agentSelection"] = {
  state: "failed",
  switching: false,
  disabled: false,
  agents: [],
  onSelectAgent: () => undefined,
};

/** Inert paste callbacks; routing tests override them on their own mount. */
export const inertPasteProps = {
  onAttachText: () => undefined,
  readClipboardText: () => Promise.resolve(undefined),
} satisfies Pick<ComposerProps, "onAttachText" | "readClipboardText">;
