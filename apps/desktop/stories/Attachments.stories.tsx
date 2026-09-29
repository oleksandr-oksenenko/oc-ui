/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction test lifetimes. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { AttachmentProposal } from "./attachments/AttachmentProposal.tsx";
import { UserMessage } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView/UserMessage.tsx";
import {
  annotations,
  attachmentMessage,
  browserMessage,
  inlineSkillMessage,
  mixedAttachmentMessage,
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

const openSource = fn();
export const SharedPills: Story = {
  render: () => (
    <main class="attachment-study">
      <section class="attachment-study-example">
        <h1>Shared attachment pills</h1>
        <UserMessage message={mixedAttachmentMessage} onOpenAnnotation={openSource} />
      </section>
    </main>
  ),
  play: async ({ canvasElement }) => {
    openSource.mockClear();
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelectorAll(".transcript-user-bubble")).toHaveLength(1);
    const attachments = within(canvas.getByRole("group", { name: "Attachments" }));
    await expect(attachments.queryByText("explore", { exact: true })).not.toBeInTheDocument();
    await expect(attachments.queryByText("review", { exact: true })).not.toBeInTheDocument();
    await expect(attachments.getByRole("button", { name: "Browser · 1" })).toBeVisible();
    const review = canvas.getByRole("button", { name: "Review · 2" });
    review.focus();
    await userEvent.keyboard("{Enter}");
    await expect(
      screen.getByText(
        "Keep the draft when sending fails, so I can retry without losing my changes.",
      ),
    ).toBeVisible();
    await expect(screen.getByRole("dialog", { name: "Review comments" })).toHaveFocus();
    await userEvent.tab();
    await expect(screen.getByRole("dialog", { name: "Review comments" })).not.toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(review).toHaveFocus();
    await expect(getComputedStyle(review).outlineStyle).toBe("none");
    await expect(getComputedStyle(review).boxShadow).toBe("none");
    await userEvent.click(canvas.getByRole("button", { name: "Annotations · 1" }));
    await userEvent.click(screen.getByRole("button", { name: `“${annotations[0]!.quote}”` }));
    await expect(openSource).toHaveBeenCalledWith(
      attachmentMessage.id,
      annotations[0]!.id,
      expect.any(HTMLElement),
    );
    await userEvent.keyboard("{Escape}");
    const browser = canvas.getByRole("button", { name: "Browser · 1" });
    await userEvent.click(browser);
    await expect(screen.getByText("1. Give this button more breathing room.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Enlarge Browser annotation 1" }));
    await expect(
      screen.getByRole("dialog", { name: "Preview of Browser annotation 1" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(
      await screen.findByRole("button", { name: "Enlarge Browser annotation 1" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect(browser).toHaveFocus();
    await expect(canvas.queryByRole("button", { name: /Remove|Discard/ })).not.toBeInTheDocument();
  },
};
export const SharedPillsNarrow: Story = {
  ...SharedPills,
  globals: { viewport: { value: "mobile", isRotated: false } },
};

export const SharedPillsDark: Story = { ...SharedPills, globals: { theme: "dark" } };
