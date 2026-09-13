/* oxlint-disable effecttsgo/async-function */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { PromptSkillAttachment } from "@opencode-ai/client";
import { createSignal, Show } from "solid-js";
import { expect, fireEvent, fn, userEvent, within, waitFor } from "storybook/test";
import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { composerAgentSelection, composerModelSelection } from "./composer-fixtures.ts";
import "./SkillsComposer.css";
const skills = [
  {
    id: "review",
    name: "review",
    description: "Review changes for bugs, risks, and missing tests.",
  },
  {
    id: "simplify",
    name: "simplify",
    description: "Find a smaller, clearer way to express the code.",
  },
  {
    id: "writing",
    name: "writing",
    description: "Write clear, concise documentation and explanations.",
  },
  {
    id: "testing",
    name: "testing",
    description: "Design focused tests around real failure modes.",
  },
];

function historyKey(prompt: HTMLElement, redo = false) {
  return fireEvent.keyDown(prompt, {
    key: "z",
    code: "KeyZ",
    keyCode: 90,
    shiftKey: redo,
    metaKey: /Mac/.test(navigator.platform),
    ctrlKey: !/Mac/.test(navigator.platform),
  });
}

function SkillsComposerFixture(props: {
  state?: "ready" | "loading" | "empty" | "failed";
  onSubmit?: (text: string, skills: readonly PromptSkillAttachment[]) => void;
}) {
  const [value, setValue] = createSignal("");
  const [selected, setSelected] = createSignal<readonly PromptSkillAttachment[]>([]);
  const [state, setState] = createSignal(props.state ?? "ready");
  const [sent, setSent] = createSignal("");
  return (
    <div class="skills-story-frame">
      <p class="skills-story-intro">Type / to add a skill to your message.</p>
      <Composer
        value={value()}
        skills={selected()}
        skillCatalog={{
          get state() {
            const current = state();
            return current === "empty" ? "ready" : current;
          },
          get items() {
            return state() === "empty" ? [] : skills;
          },
          onRetry: () => setState("ready"),
        }}
        action="send"
        disabled={false}
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection()}
        onInput={(text, attachments = []) => {
          setValue(text);
          setSelected(attachments);
        }}
        onSubmit={() => {
          props.onSubmit?.(value(), selected());
          setSent(value());
          setValue("");
          setSelected([]);
        }}
      />
      <Show when={sent()}>
        <div class="skills-story-preview" role="status">
          <span>Preview of submitted message</span>
          <p>{sent()}</p>
        </div>
      </Show>
    </div>
  );
}
const meta = {
  title: "Composer/Skills",
  component: SkillsComposerFixture,
  parameters: { layout: "centered" },
} satisfies Meta<typeof SkillsComposerFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Interactive: Story = {};
export const Suggestions: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByRole("textbox", { name: "Prompt" }), "/");
  },
};
export const MultipleSkills: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "Check this using /rev");
    await expect(canvas.getByText("/review", { exact: true })).toBeVisible();
    await expect(canvas.queryByText("/writing", { exact: true })).toBeNull();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Remove review skill" })).toBeVisible();
    await userEvent.type(prompt, "and /test");
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Remove testing skill" })).toBeVisible();
  },
};
export const SlashSuggestionsAndDismissal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "review src/components/rev ");
    await expect(canvas.queryByRole("region", { name: "Skill suggestions" })).toBeNull();
    await userEvent.type(prompt, "/rev");
    await expect(canvas.getByRole("region", { name: "Skill suggestions" })).toBeVisible();
    await userEvent.type(prompt, "-no-match", { skipClick: true });
    await expect(canvas.getByText("No matching skills.")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByRole("region", { name: "Skill suggestions" })).toBeNull();
    await expect(prompt).toHaveFocus();
  },
};
export const Loading: Story = { args: { state: "loading" }, play: Suggestions.play };
export const Empty: Story = { args: { state: "empty" }, play: Suggestions.play };
export const Failed: Story = { args: { state: "failed" }, play: Suggestions.play };
export const Narrow: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  play: Suggestions.play,
};

export const KeyboardNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Prompt" }), "/");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(canvas.getByRole("button", { name: "Remove simplify skill" })).toBeVisible();
  },
};

export const RetryAndPointerSelection: Story = {
  args: { state: "failed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "/");
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await userEvent.click(canvas.getByRole("button", { name: /\/writing Write clear/ }));
    await expect(canvas.getByRole("button", { name: "Remove writing skill" })).toBeVisible();
    await expect(prompt).toHaveFocus();
  },
};

export const UndoRedoAndEditing: Story = {
  args: { onSubmit: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "Use /rev");
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Remove review skill" })).toBeVisible();
    // Exercise the editor keymap, including remounting a working Solid chip.
    await historyKey(prompt);
    await expect(canvas.queryByRole("button", { name: "Remove review skill" })).toBeNull();
    await expect(prompt).toHaveTextContent("Use /rev");
    await historyKey(prompt, true);
    await expect(canvas.getByRole("button", { name: "Remove review skill" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Remove review skill" }));
    await expect(canvas.queryByRole("button", { name: "Remove review skill" })).toBeNull();
    await historyKey(prompt);
    await expect(canvas.getByRole("button", { name: "Remove review skill" })).toBeVisible();
    // Undo restores a live chip with a working remove action.
    await userEvent.click(canvas.getByRole("button", { name: "Remove review skill" }));
    await expect(canvas.queryByRole("button", { name: "Remove review skill" })).toBeNull();
    await historyKey(prompt);
    const range = document.createRange();
    range.selectNodeContents(prompt);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await userEvent.type(prompt, "Please ", { skipClick: true });
    await expect(canvas.getByRole("button", { name: "Remove review skill" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
    await expect(canvas.getByRole("status")).toHaveTextContent("review");
    await expect(args.onSubmit).toHaveBeenCalledWith("Please Use review ", [
      { id: "review", name: "review", mention: { start: 11, end: 17, text: "review" } },
    ]);
  },
};

export const MultilineAndDeletion: Story = {
  args: { onSubmit: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "First line");
    await userEvent.keyboard("{Shift>}{Enter}{Enter}{/Shift}");
    await userEvent.type(prompt, "/rev", { skipClick: true });
    await userEvent.keyboard("{Enter}");
    await userEvent.type(prompt, "and /test", { skipClick: true });
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Backspace}");
    await waitFor(() => expect(prompt.textContent).toBe("First linereview and testing"));
    await fireEvent.keyDown(prompt, { key: "Backspace", code: "Backspace", keyCode: 8 });
    await expect(canvas.queryByRole("button", { name: "Remove testing skill" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
    await expect(args.onSubmit).toHaveBeenCalledWith("First line\n\nreview and ", [
      { id: "review", name: "review", mention: { start: 12, end: 18, text: "review" } },
    ]);
  },
};
export const RemoveChipAndSeparator: Story = {
  args: { onSubmit: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "/rev");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(canvas.getByRole("button", { name: "Remove review skill" }));
    await expect(prompt.textContent).toBe("");
    await expect(canvas.getByRole("button", { name: "Send" })).toBeDisabled();
    await historyKey(prompt);
    await expect(canvas.getByRole("button", { name: "Remove review skill" })).toBeVisible();
    await expect(prompt.textContent).toBe("review ");
    await historyKey(prompt, true);
    await expect(prompt.textContent).toBe("");
    await userEvent.type(prompt, "Use /rev");
    await userEvent.keyboard("{Enter}");
    await userEvent.type(prompt, "and /test");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(canvas.getByRole("button", { name: "Remove review skill" }));
    await expect(prompt.textContent).toBe("Use and testing ");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
    await expect(args.onSubmit).toHaveBeenCalledWith("Use and testing ", [
      { id: "testing", name: "testing", mention: { start: 8, end: 15, text: "testing" } },
    ]);
  },
};

export const PlainTextPasteAndReset: Story = {
  args: { onSubmit: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "Prefix /rev");
    await userEvent.keyboard("{Enter}");
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "one\n\ntwo");
    clipboardData.setData("text/html", "<b>wrong</b>");
    prompt.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    );
    await userEvent.keyboard("{Enter}");
    await expect(args.onSubmit).toHaveBeenCalledWith("Prefix review one\n\ntwo", [
      { id: "review", name: "review", mention: { start: 7, end: 13, text: "review" } },
    ]);
    await historyKey(prompt);
    await expect(prompt.textContent).toBe("");
    await expect(canvas.getByRole("button", { name: "Send" })).toBeDisabled();
  },
};
