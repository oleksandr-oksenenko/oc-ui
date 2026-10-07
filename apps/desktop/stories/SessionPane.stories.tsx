/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction tests. */
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

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
  args: { selected: false, canCreate: true, onCreate: fn(), onBrowseSessions: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const create = canvas.getByRole("button", { name: "New session" });
    create.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onCreate).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole("button", { name: "Browse sessions" }));
    await expect(args.onBrowseSessions).toHaveBeenCalledOnce();
  },
};

export const NoSelectionDisabled: Story = {
  args: { selected: false, canCreate: false, onCreate: fn(), onBrowseSessions: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const create = canvas.getByRole("button", { name: "New session" });
    await expect(create).toBeDisabled();
    await userEvent.click(create);
    await expect(args.onCreate).not.toHaveBeenCalled();
    await expect(canvas.getByRole("button", { name: "Browse sessions" })).toBeEnabled();
  },
};

export const SelectedPlacement: Story = {
  render: () => {
    const [draft, setDraft] = createSignal("Summarize the remaining verification work");

    return (
      <SessionPane
        selected
        title="Warm Paper polish"
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

export const ComposerGrowth: Story = {
  render: ReturnToLatestAboveComposer.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const view = canvasElement.querySelector<HTMLElement>(".transcript-view")!;
    const composer = canvasElement.querySelector<HTMLElement>(".composer")!;
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await waitFor(async () => {
      await expect(canvasElement.querySelectorAll("[data-message-id]")).toHaveLength(
        longTranscript.length,
      );
      await expect(view.scrollHeight - view.clientHeight - view.scrollTop).toBeLessThan(2);
    });
    const bottom = view.getBoundingClientRect().bottom;
    await userEvent.click(prompt);
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}More detail".repeat(5));
    await waitFor(async () => {
      await expect(view.getBoundingClientRect().bottom).toBeLessThan(bottom - 40);
      await expect(view.scrollHeight - view.clientHeight - view.scrollTop).toBeLessThan(2);
      const latest = canvasElement.querySelector(".transcript-document > :last-child")!;
      await expect(latest.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        composer.getBoundingClientRect().top,
      );
      await expect(canvas.queryByRole("button", { name: "Scroll to bottom" })).toBeNull();
    });

    await userEvent.clear(prompt);
    await waitFor(async () => {
      await expect(view.getBoundingClientRect().bottom).toBe(bottom);
      await expect(view.scrollHeight - view.clientHeight - view.scrollTop).toBeLessThan(2);
    });
    view.scrollTop = 200;
    view.dispatchEvent(new Event("scroll"));
    await userEvent.click(prompt);
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}More detail".repeat(5));
    await waitFor(async () => {
      await expect(view.getBoundingClientRect().bottom).toBeLessThan(bottom - 40);
      await expect(view.scrollTop).toBe(200);
      await expect(canvas.getByRole("button", { name: "Scroll to bottom" })).toBeVisible();
    });
  },
};

export const ComposerGrowthNarrow: Story = {
  ...ComposerGrowth,
  globals: { viewport: { value: "narrow", isRotated: false } },
};

export const ComposerGrowthMobile: Story = {
  ...ComposerGrowth,
  globals: { viewport: { value: "mobile", isRotated: false } },
};
