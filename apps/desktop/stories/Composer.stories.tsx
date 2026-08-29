import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";

import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { composerSelection } from "./composer-fixtures.ts";

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
    return (
      <div style={frameStyle}>
        <Composer
          value={value()}
          disabled={false}
          submitting={false}
          running={false}
          selection={composerSelection({
            selectedModelID: modelID(),
            selectedVariantID: variantID(),
            onSelectModel: setModelID,
            onSelectVariant: setVariantID,
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
          selection={composerSelection({ state: "loading", models: [], variants: [] })}
          onInput={setValue}
          onSubmit={() => setValue("")}
        />
      </div>
    );
  },
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
          selection={composerSelection()}
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
          selection={composerSelection()}
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
        selection={composerSelection({ switching: true })}
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
          selection={composerSelection()}
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
        selection={composerSelection()}
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
        selection={composerSelection({
          state: "failed",
          models: [],
          variants: [],
          error: "Models could not be loaded. Check the connection and try again.",
        })}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
};
