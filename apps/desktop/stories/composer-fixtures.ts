import type { ComposerProps } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";

export function composerModelSelection(
  overrides: Partial<ComposerProps["modelSelection"]> = {},
): ComposerProps["modelSelection"] {
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

export function composerAgentSelection(
  overrides: Partial<ComposerProps["agentSelection"]> = {},
): ComposerProps["agentSelection"] {
  return {
    state: "ready",
    switching: false,
    disabled: false,
    agents: [
      { id: "build", label: "Build" },
      { id: "plan", label: "Plan" },
      { id: "review", label: "Review" },
    ],
    selectedAgentID: "build",
    onSelectAgent: () => undefined,
    ...overrides,
  };
}
