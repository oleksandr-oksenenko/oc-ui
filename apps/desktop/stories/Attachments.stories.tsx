/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction test lifetimes. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { UserMessage } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView/UserMessage.tsx";
import { createSessionPrompt } from "../src/renderer/opencode/session-prompt.ts";
import {
  annotations,
  attachmentMessage,
  browserMessage,
  inlineSkillMessage,
  mixedAttachmentMessage,
} from "./attachment-fixtures.ts";
import "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/SessionPane.css";

const meta = {
  title: "Transcript/Attachments",
  component: UserMessage,
  parameters: { layout: "fullscreen" },
  args: { message: attachmentMessage },
  decorators: [
    (Story) => (
      <div style={{ padding: "16px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UserMessage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Mixed: Story = {};
export const InlineSkill: Story = { args: { message: inlineSkillMessage } };
export const BrowserAnnotations: Story = { args: { message: browserMessage } };
export const AttachmentOnly: Story = {
  args: { message: { ...attachmentMessage, text: "", metadata: undefined } },
};
export const AnnotationOnly: Story = {
  args: {
    message: {
      id: "annotation-only",
      type: "user",
      time: { created: 0 },
      ...createSessionPrompt({ instruction: "", reviewComments: [], annotations }),
    },
  },
};
export const FilesAndImagesOnly: Story = {
  args: {
    message: {
      id: "files-only",
      type: "user",
      time: { created: 0 },
      text: "",
      files: attachmentMessage.files,
    },
  },
};

const openSource = fn();
export const SharedPills: Story = {
  args: { message: mixedAttachmentMessage, onOpenAnnotation: openSource },
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
