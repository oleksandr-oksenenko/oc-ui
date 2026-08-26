import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";

import { Composer } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/Composer.tsx";

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
    return (
      <div style={frameStyle}>
        <Composer
          value={value()}
          disabled={false}
          submitting={false}
          running={false}
          onInput={setValue}
          onSubmit={() => setValue("")}
        />
      </div>
    );
  },
};

export const PickerShowcase: Story = {
  render: () => {
    const [value, setValue] = createSignal("Explain the latest change");
    const [model, setModel] = createSignal("balanced");
    const [reasoning, setReasoning] = createSignal("medium");
    return (
      <div style={frameStyle}>
        <Composer
          value={value()}
          disabled={false}
          submitting={false}
          running={false}
          model={{
            label: "Model",
            value: model(),
            options: [
              { value: "fast", label: "Fast" },
              { value: "balanced", label: "Balanced" },
              { value: "deep", label: "Deep" },
            ],
            onChange: setModel,
          }}
          reasoning={{
            label: "Reasoning",
            value: reasoning(),
            options: [
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ],
            onChange: setReasoning,
          }}
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
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
};

export const DisabledPickers: Story = {
  render: () => (
    <div style={frameStyle}>
      <Composer
        value="Unavailable while reconnecting"
        disabled
        submitting={false}
        running={false}
        model={{
          label: "Model",
          value: "balanced",
          options: [{ value: "balanced", label: "Balanced" }],
          disabled: true,
          onChange: () => undefined,
        }}
        reasoning={{
          label: "Reasoning",
          value: "medium",
          options: [{ value: "medium", label: "Medium" }],
          disabled: true,
          onChange: () => undefined,
        }}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    </div>
  ),
};
