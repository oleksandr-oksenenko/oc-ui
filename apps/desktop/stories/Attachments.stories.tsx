/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction test lifetimes. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { AttachmentProposal } from "./attachments/AttachmentProposal.tsx";
import { UserMessage } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView/UserMessage.tsx";
import {
  annotations,
  attachmentMessage,
  browserMessage,
  inlineSkillMessage,
} from "./attachment-fixtures.ts";
import "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/SessionPane.css";
import "./attachments/attachments.css";

const meta = {
  title: "Transcript/Attachments",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const CurrentInventory: Story = {
  render: () => (
    <main class="attachment-study">
      <header class="attachment-study-heading">
        <p>Current implementation</p>
        <h1>Attachments in the transcript</h1>
        <p>Production renderers, using representative SDK messages.</p>
      </header>
      <section class="attachment-study-example">
        <h2>Files, images, reviews, transcript annotations, skills and agents</h2>
        <UserMessage message={attachmentMessage} />
      </section>
      <section class="attachment-study-example">
        <h2>Inline skill mention</h2>
        <UserMessage message={inlineSkillMessage} />
      </section>
      <section class="attachment-study-example">
        <h2>Browser annotation: text and screenshot</h2>
        <UserMessage message={browserMessage} />
      </section>
    </main>
  ),
};

export const Proposed: Story = { render: () => <AttachmentProposal /> };
export const Expanded: Story = { render: () => <AttachmentProposal expanded /> };
export const BrowserAnnotations: Story = { render: () => <AttachmentProposal browser expanded /> };
export const AttachmentOnly: Story = { render: () => <AttachmentProposal only /> };
export const ManyAttachments: Story = { render: () => <AttachmentProposal many /> };
export const Narrow: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  render: () => <AttachmentProposal expanded />,
};
export const Dark: Story = {
  globals: { theme: "dark" },
  render: () => <AttachmentProposal expanded />,
};
export const Interactions: Story = {
  render: () => <AttachmentProposal many />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const review = canvas.getByRole("button", { name: "Code review 2 comments · 2 files" });
    review.focus();
    await userEvent.keyboard("{Enter}");
    await expect(review).toHaveAttribute("aria-expanded", "true");
    await expect(
      canvas.getByText(
        "Keep the draft when sending fails, so I can retry without losing my changes.",
      ),
    ).toBeVisible();
    await userEvent.keyboard(" ");
    await expect(review).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(
      canvas.getByRole("button", { name: "Transcript annotation 1 comment · Earlier response" }),
    );
    await expect(canvas.getByText(annotations[0]!.quote)).toBeVisible();
    const image = canvas.getByRole("button", { name: "Enlarge composer-reference.png" });
    await userEvent.click(image);
    await expect(
      screen.getByRole("dialog", { name: "Preview of composer-reference.png" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(image).toHaveFocus();
    await userEvent.click(
      await canvas.findByRole("button", { name: "12 more files Show all attached files" }),
    );
    await expect(canvas.getByText("acceptance-result-12.txt")).toBeVisible();
  },
};
