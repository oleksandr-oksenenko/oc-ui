/* oxlint-disable effecttsgo/async-function */

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import {
  TranscriptAnnotations,
  longToolTarget,
} from "./transcript-annotations/TranscriptAnnotations.tsx";

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
      const opener = canvas.getByRole("button", { name: "Annotations · 2" });
      await userEvent.click(opener);
      const dialog = await screen.findByRole("dialog", { name: "Transcript annotations" });
      await waitFor(() => expect(dialog).toBeVisible());
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(opener).toHaveFocus());
      // Restored pill focus uses the neutral surface cue, without an outline.
      await expect(getComputedStyle(opener).outlineStyle).toBe("none");
    });

    await step(
      "Editing preserves the textarea and caret, then saves on outside click",
      async () => {
        await userEvent.click(canvas.getByRole("button", { name: "Annotations · 2" }));
        const body = "Show just one count in the composer, like code review comments.";
        await screen.findByRole("button", { name: body });
        await userEvent.click(
          within(screen.getByRole("dialog")).getAllByRole("button", { name: "Edit comment" })[0]!,
        );
        const editor = await screen.findByRole<HTMLTextAreaElement>("textbox", {
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

    await step("The popover shows source quotes and Enter dismisses it", async () => {
      select(source);
      await userEvent.keyboard("{Escape}");
      await expect(canvas.queryByRole("button", { name: "Add note" })).toBeNull();
      select(source);
      const action = canvas.getByRole("button", { name: "Add note" });
      await expect(getComputedStyle(action.parentElement!).backgroundColor).toBe(
        "rgb(247, 247, 246)",
      );
      await userEvent.click(action);
      const dialog = await screen.findByRole("dialog", { name: "Transcript annotations" });
      await expect(getComputedStyle(dialog).backgroundColor).toBe("rgb(255, 254, 253)");
      await expect(dialog.querySelector('[data-variant="editor"]')).toBeNull();
      const editor = within(dialog).getByRole("textbox", { name: "Annotation comment" });
      await waitFor(() => expect(editor).toHaveFocus());
      await expect(dialog).toHaveTextContent(/transcript stays readable/);
      await userEvent.keyboard("New inline note{Shift>}{Enter}{/Shift}Second line{Enter}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(source).toHaveFocus());
      await expect(getComputedStyle(source).outlineStyle).toBe("none");
      await userEvent.click(canvas.getByRole("button", { name: "Annotations · 3" }));
      const comments = await screen.findByRole("dialog", { name: "Transcript annotations" });
      await expect(comments).toHaveTextContent(/transcript stays readable/);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /New inline note\s+Second line/ })).toBeVisible(),
      );
      await userEvent.click(within(comments).getAllByRole("button", { name: "Edit comment" })[2]!);
      const reopened = screen.getByRole<HTMLTextAreaElement>("textbox", {
        name: "Annotation comment",
      });
      await waitFor(() => expect(reopened).toHaveFocus());
      await expect(reopened.value).toBe("New inline note\nSecond line");
      reopened.setSelectionRange(reopened.value.length, reopened.value.length);
      await userEvent.keyboard(" updated{Enter}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() =>
        expect(canvas.getByRole("button", { name: "Annotations · 3" })).toHaveFocus(),
      );
      await userEvent.click(canvas.getByRole("button", { name: "Annotations · 3" }));
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
      await expect(canvas.getByRole("button", { name: "Annotations · 3" })).toBeVisible();
    });

    await step("A controller-driven dismissal returns focus to the opener", async () => {
      const opener = canvas.getByRole("button", { name: "Annotations · 3" });
      await userEvent.click(opener);
      const dialog = await screen.findByRole("dialog", { name: "Transcript annotations" });
      await waitFor(() => expect(dialog).toBeVisible());
      // Transcript updates and layout changes close the anchored popup through
      // the controller rather than an outside interaction. Focus must follow to
      // the opener instead of resting on the hidden anchor.
      window.dispatchEvent(new Event("resize"));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(opener).toHaveFocus());
    });

    await step("A transcript update does not close the open editor", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Annotations · 3" }));
      const dialog = await screen.findByRole("dialog", { name: "Transcript annotations" });
      await userEvent.click(within(dialog).getAllByRole("button", { name: "Edit comment" })[2]!);
      const editor = within(dialog).getByRole<HTMLTextAreaElement>("textbox", {
        name: "Annotation comment",
      });
      await waitFor(() => expect(editor).toHaveFocus());
      const probe = document.createElement("span");
      source.append(probe);
      // The transcript observer delivers its mutation callback in a microtask.
      await Promise.resolve();
      await Promise.resolve();
      await expect(within(dialog).getByRole("textbox", { name: "Annotation comment" })).toBe(
        editor,
      );
      await expect(editor).toHaveFocus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
      await userEvent.keyboard(" Keep");
      await expect(editor.value).toContain(" Keep");
      probe.remove();
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });
  },
};
export const ToggleAndNavigate: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const source = canvasElement.querySelector(
      '[data-message-id="assistant-annotations"] .transcript-markdown',
    );
    if (!source) throw new Error("Missing source passage");
    {
      const opener = canvas.getByRole("button", { name: "Annotations · 2" });
      await userEvent.click(opener);
      await expect(opener).toHaveAttribute("aria-expanded", "true");
      await userEvent.click(opener);
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Transcript annotations" })).toBeNull(),
      );
      await expect(opener).toHaveAttribute("aria-expanded", "false");
      await userEvent.click(opener);
      const dialog = await screen.findByRole("dialog", { name: "Transcript annotations" });
      await userEvent.click(
        within(dialog).getByRole("button", {
          name: "Show just one count in the composer, like code review comments.",
        }),
      );
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      await waitFor(() => expect(source).toHaveFocus());
    }
  },
};
export const AfterSending: Story = { args: { initialSent: true } };
export const RunningTurn: Story = {
  args: { initialRunning: true },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const source = canvasElement.querySelector(
      '[data-message-id="assistant-annotations"] .transcript-markdown',
    );
    if (!source) throw new Error("Missing source passage");

    await step("A running turn offers no new note", async () => {
      select(source);
      await expect(canvas.queryByRole("button", { name: "Add note" })).toBeNull();
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });

    await step("Existing comments stay readable but not editable", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Annotations · 2" }));
      const dialog = await screen.findByRole("dialog", { name: "Transcript annotations" });
      await expect(
        within(dialog).getByRole("button", {
          name: "Show just one count in the composer, like code review comments.",
        }),
      ).toBeEnabled();
      for (const edit of within(dialog).getAllByRole("button", { name: "Edit comment" }))
        await expect(edit).toBeDisabled();
      for (const remove of within(dialog).getAllByRole("button", { name: "Remove comment" }))
        await expect(remove).toBeDisabled();
    });
  },
};
export const NarrowMode: Story = { args: { narrow: true } };

export const NestedToolOutput: Story = {
  args: { longToolOutput: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const transcript = canvasElement.querySelector<HTMLElement>(".transcript-view")!;
    await userEvent.click(
      canvasElement.querySelector<HTMLButtonElement>(".transcript-activity-trigger")!,
    );
    await userEvent.click(canvasElement.querySelector<HTMLElement>(".transcript-tool-header")!);
    const output = await waitFor(() => {
      const element = canvasElement.querySelector<HTMLElement>(
        '.transcript-tool-output[data-annotation-block*="output"]',
      );
      if (!element) throw new Error("Missing annotated tool output");
      return element;
    });
    const text = output.firstChild;
    if (!(text instanceof Text)) throw new Error("Missing tool output text");
    const start = text.data.indexOf(longToolTarget);
    if (start < 0) throw new Error("Missing target passage");
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + longToolTarget.length);

    output.scrollTop = output.scrollHeight;
    output.scrollLeft = output.scrollWidth;
    transcript.scrollTop = transcript.scrollHeight;
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await userEvent.click(canvas.getByRole("button", { name: "Add note" }));
    const editor = await screen.findByRole("textbox", { name: "Annotation comment" });
    await userEvent.type(editor, "Keep the nested output visible{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    output.scrollTop = 0;
    output.scrollLeft = 0;
    transcript.scrollTop = 0;
    await userEvent.click(canvas.getByRole("button", { name: "Annotations · 3" }));
    const dialog = await screen.findByRole("dialog", { name: "Transcript annotations" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Keep the nested output visible" }),
    );
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await expect(output).toHaveFocus();
    await expect(output.scrollTop).toBeGreaterThan(0);
    await expect(transcript.scrollTop).toBeGreaterThan(0);
    const target = range.getBoundingClientRect();
    const inner = output.getBoundingClientRect();
    const outer = transcript.getBoundingClientRect();
    await expect(target.top).toBeGreaterThanOrEqual(inner.top);
    await expect(target.bottom).toBeLessThanOrEqual(inner.bottom);
    await expect(target.left).toBeGreaterThanOrEqual(inner.left);
    await expect(target.right).toBeLessThanOrEqual(inner.right);
    await expect(target.top).toBeGreaterThanOrEqual(outer.top);
    await expect(target.bottom).toBeLessThanOrEqual(outer.bottom);
  },
};
