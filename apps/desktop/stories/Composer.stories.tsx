import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";

import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { composerAgentSelection, composerModelSelection } from "./composer-fixtures.ts";

const meta = {
  title: "Composer/Composer",
  component: Composer,
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj;

const frameStyle = {
  width: "min(760px, 90vw)",
  padding: "32px",
  background: "#050506",
};

export const Idle: Story = {
  render: () => {
    const [value, setValue] = createSignal("");
    const [modelID, setModelID] = createSignal("openai/gpt-5");
    const [variantID, setVariantID] = createSignal("deep");
    const [agentID, setAgentID] = createSignal("build");
    return (
      <div style={frameStyle}>
        <Composer
          value={value()}
          disabled={false}
          submitting={false}
          running={false}
          modelSelection={composerModelSelection({
            selectedModelID: modelID(),
            selectedVariantID: variantID(),
            onSelectModel: setModelID,
            onSelectVariant: setVariantID,
          })}
          agentSelection={composerAgentSelection({
            selectedAgentID: agentID(),
            onSelectAgent: setAgentID,
          })}
          onInput={setValue}
          onSubmit={() => setValue("")}
        />
      </div>
    );
  },
};

export const LoadingPickers: Story = {
  render: () => {
    const [value, setValue] = createSignal("Explain the latest change");
    return (
      <div style={frameStyle}>
        <Composer
          value={value()}
          disabled={false}
          submitting={false}
          running={false}
          modelSelection={composerModelSelection({ state: "loading", models: [], variants: [] })}
          agentSelection={composerAgentSelection({ state: "loading", agents: [] })}
          onInput={setValue}
          onSubmit={() => setValue("")}
        />
      </div>
    );
  },
};

export const DefaultAgent: Story = {
  render: () => (
    <div style={frameStyle}>
      <Composer
        value=""
        disabled={false}
        submitting={false}
        running={false}
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection({ selectedAgentID: undefined })}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
};

export const EmptyAgents: Story = {
  render: () => (
    <div style={frameStyle}>
      <Composer
        value=""
        disabled={false}
        submitting={false}
        running={false}
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection({ agents: [], selectedAgentID: undefined })}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
};

export const MissingAgent: Story = {
  render: () => (
    <div style={frameStyle}>
      <Composer
        value=""
        disabled={false}
        submitting={false}
        running={false}
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection({ selectedAgentID: "missing" })}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
};

export const Multiline: Story = {
  render: () => {
    const [value, setValue] = createSignal(
      "Review this change\nThen suggest focused tests\nKeep the answer concise",
    );
    return (
      <div style={frameStyle}>
        <Composer
          value={value()}
          disabled={false}
          submitting={false}
          running={false}
          modelSelection={composerModelSelection()}
          agentSelection={composerAgentSelection()}
          onInput={setValue}
          onSubmit={() => setValue("")}
        />
      </div>
    );
  },
};

export const RunningDraft: Story = {
  render: () => {
    const [value, setValue] = createSignal("This draft remains editable while the run is active.");
    return (
      <div style={frameStyle}>
        <Composer
          value={value()}
          disabled
          submitting={false}
          running
          modelSelection={composerModelSelection()}
          agentSelection={composerAgentSelection()}
          onInput={setValue}
          onSubmit={() => undefined}
        />
      </div>
    );
  },
};

export const Submitting: Story = {
  render: () => (
    <div style={frameStyle}>
      <Composer
        value="Send this prompt"
        disabled
        submitting
        running={false}
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection({ switching: true })}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
};

export const AdmissionError: Story = {
  render: () => {
    const [value, setValue] = createSignal("The draft is preserved after admission fails.");
    return (
      <div style={frameStyle}>
        <Composer
          value={value()}
          disabled={false}
          submitting={false}
          running={false}
          error="The server could not admit this prompt. Try again."
          modelSelection={composerModelSelection()}
          agentSelection={composerAgentSelection()}
          onInput={setValue}
          onSubmit={() => undefined}
        />
      </div>
    );
  },
};

export const EmptyDisabled: Story = {
  render: () => (
    <div style={frameStyle}>
      <Composer
        value=""
        disabled
        submitting={false}
        running={false}
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection()}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
};

export const UnavailableWhileDisabled: Story = {
  render: () => (
    <div style={frameStyle}>
      <Composer
        value="Unavailable while reconnecting"
        disabled
        submitting={false}
        running={false}
        modelSelection={composerModelSelection({
          state: "failed",
          models: [],
          variants: [],
          error: "Models could not be loaded. Check the connection and try again.",
        })}
        agentSelection={composerAgentSelection({
          state: "failed",
          agents: [],
          error: "Agents could not be loaded. Check the connection and try again.",
        })}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
};

export const PromptFocused: Story = {
  render: () => (
    <div style={frameStyle}>
      <Composer
        value="A focused prompt exposes the canonical composer focus treatment."
        disabled={false}
        submitting={false}
        running={false}
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection()}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]')?.focus();
  },
};

export const SwitchingSelection: Story = {
  render: () => (
    <div style={frameStyle}>
      <Composer
        value="The draft remains visible while the model selection changes."
        disabled={false}
        submitting={false}
        running={false}
        modelSelection={composerModelSelection({ switching: true })}
        agentSelection={composerAgentSelection()}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
};

const narrowViewport = {
  options: {
    mobile390: { name: "Mobile 390x760", styles: { width: "390px", height: "760px" } },
  },
};

export const NarrowLongSelections: Story = {
  parameters: { viewport: narrowViewport },
  globals: { viewport: { value: "mobile390", isRotated: false } },
  render: () => (
    <div style={frameStyle}>
      <Composer
        value="Review the complete remote workspace context and preserve the server-provided path."
        disabled={false}
        submitting={false}
        running={false}
        modelSelection={composerModelSelection({
          models: [
            {
              id: "openai/long-model",
              label: "OpenAI reasoning model with an intentionally long display name",
              group: "OpenAI hosted models",
            },
          ],
          selectedModelID: "openai/long-model",
          variants: [{ id: "maximum-reasoning", label: "maximum reasoning with extended context" }],
          selectedVariantID: "maximum-reasoning",
        })}
        agentSelection={composerAgentSelection({
          agents: [{ id: "review-long", label: "Independent implementation reviewer" }],
          selectedAgentID: "review-long",
        })}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
};
