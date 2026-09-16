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
      const action = canvas.getByRole("button", { name: "Add note" });
      await expect(action).toBeVisible();
      await waitFor(() => {
        const range = window.getSelection()?.getRangeAt(0);
        const container = action.closest(".annotation-selection-action");
        if (!range || !container) throw new Error("Missing selection or action");
        const gap = range.getBoundingClientRect().top - container.getBoundingClientRect().bottom;
        return expect(Math.abs(gap - 6)).toBeLessThanOrEqual(1);
      });
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
      // The reading-content exception never strips a control's indicator.
      await expect(getComputedStyle(opener).outlineStyle).toBe("solid");
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

    await step("The popover shows only comments and Enter dismisses it", async () => {
      select(source);
      await userEvent.keyboard("{Escape}");
      await expect(canvas.queryByRole("button", { name: "Add note" })).toBeNull();
      select(source);
      const action = canvas.getByRole("button", { name: "Add note" });
      await expect(getComputedStyle(action.parentElement!).backgroundColor).toBe(
        "rgb(245, 245, 245)",
      );
      await userEvent.click(action);
      const dialog = await screen.findByRole("dialog", { name: "Annotation comments" });
      await expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(245, 245, 245)");
      await expect(dialog.querySelector('[data-variant="editor"]')).toBeNull();
      const editor = within(dialog).getByRole("textbox", { name: "Annotation comment" });
      await waitFor(() => expect(editor).toHaveFocus());
      await expect(dialog).not.toHaveTextContent(/transcript stays readable/);
      await userEvent.keyboard("New inline note{Shift>}{Enter}{/Shift}Second line{Enter}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(source).toHaveFocus());
      await expect(getComputedStyle(source).outlineStyle).toBe("none");
      await userEvent.click(canvas.getByRole("button", { name: "Annotations · 3 comments" }));
      const comments = await screen.findByRole("dialog", { name: "Annotation comments" });
      await expect(comments).not.toHaveTextContent(/transcript stays readable/);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /New inline note\s+Second line/ })).toBeVisible(),
      );
      await userEvent.click(screen.getByRole("button", { name: /New inline note\s+Second line/ }));
      const reopened = screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Annotation comment",
      });
      await waitFor(() => expect(reopened).toHaveFocus());
      await expect(reopened.value).toBe("New inline note\nSecond line");
      reopened.setSelectionRange(reopened.value.length, reopened.value.length);
      await userEvent.keyboard(" updated{Enter}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: "Annotations · 3 comments" })).toHaveFocus(),
      );
      await userEvent.click(canvas.getByRole("button", { name: "Annotations · 3 comments" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /Second line updated/ })).toBeVisible(),
      );
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

      select(source);
      await userEvent.click(canvas.getByRole("button", { name: "Add note" }));
      await screen.findByRole("textbox", { name: "Annotation comment" });
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await expect(canvas.getByRole("button", { name: "Annotations · 3 comments" })).toBeVisible();
    });
  },
};
export const AfterSending: Story = { args: { initialSent: true } };
export const RunningTurn: Story = { args: { initialRunning: true } };
export const NarrowMode: Story = { args: { narrow: true } };
