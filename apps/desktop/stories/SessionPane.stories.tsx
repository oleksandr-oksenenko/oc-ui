import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Composer } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/Composer.tsx";
import { SessionPane } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/TranscriptView.tsx";
import type { TranscriptMessage } from "../src/renderer/components/App/ConnectedApp/AppShell/Workspace/SessionPane/transcript-types.ts";

const meta = {
  title: "Session/SessionPane",
  component: SessionPane,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ width: "100vw", height: "100vh", background: "#000" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SessionPane>;

export default meta;
type Story = StoryObj<typeof meta>;

const transcript: readonly TranscriptMessage[] = [
  {
    kind: "user",
    id: "user-1",
    text: "Can you keep the final workspace layout compact?",
  },
  {
    kind: "assistant",
    id: "assistant-1",
    state: "complete",
    blocks: [
      {
        kind: "paragraph",
        content:
          "The selected session keeps its transcript readable while leaving room for the composer.",
      },
      {
        kind: "tool",
        name: "layout-check",
        status: "done",
        output: "Sidebar, transcript, and composer fit the selected shell.",
        defaultExpanded: true,
      },
    ],
  },
];

export const NoSelection: Story = {
  args: { selected: false },
};

export const SelectedPlacement: Story = {
  render: () => {
    const [draft, setDraft] = createSignal("Summarize the remaining verification work");
    const [model, setModel] = createSignal("balanced");
    const [reasoning, setReasoning] = createSignal("medium");

    return (
      <SessionPane
        selected
        title="AMOLED polish"
        transcript={<TranscriptView items={transcript} loading={false} working={false} />}
        composer={
          <Composer
            value={draft()}
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
            onInput={setDraft}
            onSubmit={() => setDraft("")}
          />
        }
      />
    );
  },
};
