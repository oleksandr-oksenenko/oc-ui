import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { SessionPane } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import { storyTranscript as transcript } from "./transcript-fixtures.ts";
import { composerAgentSelection, composerModelSelection } from "./composer-fixtures.ts";
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

export const NoSelection: Story = {
  args: { selected: false },
};

export const SelectedPlacement: Story = {
  render: () => {
    const [draft, setDraft] = createSignal("Summarize the remaining verification work");

    return (
      <SessionPane
        selected
        title="AMOLED polish"
        transcript={
          <TranscriptView
            sessionID="selected-placement"
            messages={transcript}
            sessionStatus="idle"
            loading={false}
          />
        }
        composer={
          <Composer
            value={draft()}
            disabled={false}
            submitting={false}
            running={false}
            modelSelection={composerModelSelection()}
            agentSelection={composerAgentSelection()}
            onInput={setDraft}
            onSubmit={() => setDraft("")}
          />
        }
      />
    );
  },
};
