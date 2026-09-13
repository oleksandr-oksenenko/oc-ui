/* oxlint-disable effecttsgo/async-function */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { QueueingSteering, queuedMessage } from "./queueing-steering/QueueingSteering.tsx";

const meta = {
  title: "Composer/Queueing and steering",
  component: QueueingSteering,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof QueueingSteering>;
export default meta;
type Story = StoryObj<typeof meta>;

const pending = [
  queuedMessage("queue-1", "Add a focused test for the keyboard shortcuts."),
  queuedMessage("queue-2", "Then summarize the changes and any remaining gaps."),
];

export const RunningEmpty: Story = { args: { initialPending: pending } };
export const RunningDraft: Story = {
  args: {
    initialPending: pending,
    initialDraft: "Keep the Stop and Send actions on the same button.",
  },
};
export const WaitingForSteering: Story = {
  args: {
    initialPending: [
      queuedMessage("steer-1", "Keep the Stop and Send actions on the same button.", "steer"),
      ...pending,
    ],
  },
};
export const Idle: Story = { args: { initiallyRunning: false } };
export const AttachmentOnly: Story = { args: { attached: true } };
export const Narrow: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  args: { initialPending: pending, initialDraft: "Keep the layout compact." },
};

export const KeyboardAndActions: Story = {
  args: { initialPending: pending },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const pendingText = () =>
      within(canvas.getByRole("region", { name: "Pending messages" }))
        .getAllByRole("listitem")
        .map((item) => item.querySelector("p")?.textContent);
    const input = canvas.getByRole("textbox", { name: "Prompt" });
    await step("The shared button switches from Stop to Send, and Enter steers", async () => {
      await expect(canvas.getByRole("button", { name: "Stop" })).toBeEnabled();
      await userEvent.type(input, "Use the existing icons.");
      await expect(canvas.queryByRole("button", { name: "Stop" })).toBeNull();
      await expect(canvas.getByRole("button", { name: "Send" })).toBeEnabled();
      await userEvent.keyboard("{Enter}");
      await expect(input).toHaveTextContent("");
      await expect(pendingText()).toEqual([
        "Use the existing icons.",
        ...pending.map((message) => message.payload.text),
      ]);
      await expect(canvas.getByText("Steering · waiting for next step")).toBeVisible();
      await expect(canvas.getByRole("button", { name: "Stop" })).toBeEnabled();
    });
    await step("Cmd+Enter queues and Shift+Enter keeps a newline", async () => {
      await userEvent.type(input, "Check mobile.");
      await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
      await userEvent.type(input, "Then desktop.");
      await expect(Array.from(input.querySelectorAll("p"), (line) => line.textContent)).toEqual([
        "Check mobile.",
        "Then desktop.",
      ]);
      await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
      await expect(input).toHaveTextContent("");
      await expect(canvas.getAllByText("Queued")).toHaveLength(3);
    });
    await step("Steer now changes delivery and the red cross removes a message", async () => {
      await userEvent.click(canvas.getAllByRole("button", { name: "Steer now" })[0]!);
      await expect(canvas.getAllByText("Steering · waiting for next step")).toHaveLength(2);
      await expect(pendingText()).toEqual([
        pending[0]!.payload.text,
        "Use the existing icons.",
        pending[1]!.payload.text,
        "Check mobile.\nThen desktop.",
      ]);
      await userEvent.click(
        canvas.getByRole("button", {
          name: "Cancel message: Add a focused test for the keyboard shortcuts.",
        }),
      );
      await expect(canvas.queryByText("Add a focused test for the keyboard shortcuts.")).toBeNull();
    });
  },
};
