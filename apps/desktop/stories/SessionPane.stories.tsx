/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, waitFor } from "storybook/test";

import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { SessionPane } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import { longTranscript } from "./transcript-catalog-fixtures.ts";
import { storyTranscript as transcript } from "./transcript-fixtures.ts";
import {
  composerAgentSelection,
  composerModelSelection,
  composerPasteProps,
} from "./composer-fixtures.ts";
const meta = {
  title: "Session/SessionPane",
  component: SessionPane,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ width: "100vw", height: "100vh", background: "var(--oc-surface-canvas)" }}>
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
            {...composerPasteProps}
            value={draft()}
            disabled={false}
            action="send"
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

export const ReturnToLatestAboveComposer: Story = {
  render: () => {
    const [draft, setDraft] = createSignal("Summarize the remaining verification work");

    return (
      <SessionPane
        selected
        title="Long transcript"
        transcript={
          <TranscriptView
            sessionID="return-to-latest"
            messages={longTranscript}
            sessionStatus="idle"
            loading={false}
          />
        }
        composer={
          <Composer
            {...composerPasteProps}
            value={draft()}
            disabled={false}
            action="send"
            modelSelection={composerModelSelection()}
            agentSelection={composerAgentSelection()}
            onInput={setDraft}
            onSubmit={() => setDraft("")}
          />
        }
      />
    );
  },
  play: async ({ canvasElement }) => {
    const view = canvasElement.querySelector<HTMLElement>(".transcript-view");
    const composer = canvasElement.querySelector<HTMLElement>(".composer");
    if (!view || !composer) throw new Error("Session pane content is missing");
    await waitFor(() =>
      expect(canvasElement.querySelectorAll("[data-message-id]")).toHaveLength(
        longTranscript.length,
      ),
    );

    view.scrollTop = 0;
    view.dispatchEvent(new Event("scroll"));
    const button = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>(".transcript-scroll-to-bottom");
      if (!element) throw new Error("The return-to-latest control did not appear");
      return element;
    });
    const buttonRect = button.getBoundingClientRect();
    // The floating control hovers at the transcript's bottom edge, above the
    // composer rather than over it.
    await expect(buttonRect.bottom).toBeLessThanOrEqual(composer.getBoundingClientRect().top);
    await expect(buttonRect.bottom).toBeGreaterThan(view.getBoundingClientRect().bottom - 48);
  },
};
