import type { ComposerProps } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/Composer.tsx";

export function composerSelection(
  overrides: Partial<ComposerProps["selection"]> = {},
): ComposerProps["selection"] {
  return {
    state: "ready",
    switching: false,
    disabled: false,
    models: [
      { id: "openai/gpt-5", label: "GPT-5", group: "openai" },
      { id: "openai/gpt-5-mini", label: "GPT-5 Mini", group: "openai" },
      { id: "anthropic/claude", label: "Claude", group: "anthropic" },
    ],
    selectedModelID: "openai/gpt-5",
    variants: [
      { id: "fast", label: "fast" },
      { id: "deep", label: "deep" },
    ],
    selectedVariantID: "deep",
    onSelectModel: () => undefined,
    onSelectVariant: () => undefined,
    ...overrides,
  };
}
