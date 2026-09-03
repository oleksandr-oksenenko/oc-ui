/* oxlint-disable effecttsgo/async-function */

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { TranscriptAnnotations } from "./transcript-annotations/TranscriptAnnotations.tsx";

const meta = {
  title: "Transcript/Annotations",
  component: TranscriptAnnotations,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TranscriptAnnotations>;
export default meta;
type Story = StoryObj<typeof meta>;

const select = (element: Element) => {
  const range = document.createRange();
  range.selectNodeContents(element);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
};

export const Comparison: Story = {
  name: "Interactive",
  args: {},
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const source = canvasElement.querySelector(
      '[data-message-id="assistant-annotations"] .transcript-markdown',
    );
    const header = canvas.getByRole("heading", { name: "Transcript annotations" });
    if (!source) throw new Error("Missing source passage");

    await step("Clear the saved passage when selection leaves the source", async () => {
      select(source);
      await expect(canvas.getByRole("button", { name: "Add note" })).toBeVisible();
      select(header);
      await expect(canvas.queryByRole("button", { name: "Add note" })).toBeNull();
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });

    await step("Escape restores focus to the real annotation opener", async () => {
      const opener = canvas.getByRole("button", { name: "Annotations · 2 comments" });
      await userEvent.click(opener);
      const dialog = await screen.findByRole("dialog", { name: "Annotation comments" });
      await waitFor(() => expect(dialog).toBeVisible());
      await waitFor(() =>
        expect(
          within(dialog).getByRole("button", {
            name: "Show just one count in the composer, like code review comments.",
          }),
        ).toHaveFocus(),
      );
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(opener).toHaveFocus());
    });

    await step(
      "Editing preserves the textarea and caret, then saves on outside click",
      async () => {
        await userEvent.click(canvas.getByRole("button", { name: "Annotations · 2 comments" }));
        const body = "Show just one count in the composer, like code review comments.";
        await userEvent.click(await screen.findByRole("button", { name: body }));
        const editor = screen.getByRole<HTMLTextAreaElement>("textbox", {
          name: "Annotation comment",
        });
        await waitFor(() => expect(editor).toHaveFocus());
        editor.setSelectionRange(5, 5);
        await userEvent.keyboard("only ");
        await expect(screen.getByRole("textbox", { name: "Annotation comment" })).toBe(editor);
        await expect(editor.selectionStart).toBe(10);
        await expect(editor.value).toBe(
          "Show only just one count in the composer, like code review comments.",
        );
        const prompt = canvas.getByRole("textbox", { name: "Prompt" });
        await userEvent.click(prompt);
        await expect(prompt).toHaveFocus();
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      },
    );
  },
};
export const AfterSending: Story = { args: { initialSent: true } };
export const RunningTurn: Story = { args: { initialRunning: true } };
export const NarrowMode: Story = { args: { narrow: true } };
