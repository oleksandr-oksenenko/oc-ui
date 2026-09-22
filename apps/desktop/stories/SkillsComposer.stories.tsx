/* oxlint-disable effecttsgo/async-function */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { PromptSkillAttachment } from "@opencode/client";
import { createSignal, Show } from "solid-js";
import { expect, fireEvent, fn, userEvent, within, waitFor } from "storybook/test";
import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { composerAgentSelection, composerModelSelection } from "./composer-fixtures.ts";
import "./SkillsComposer.css";

const commands = [
  { name: "init", description: "Guided AGENTS.md setup." },
  { name: "compact", description: "Compact the current session." },
  { name: "nested/format", description: "Format a nested component." },
];
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

type SectionState = "ready" | "loading" | "empty" | "failed";

function section<T>(state: SectionState, items: readonly T[]) {
  return {
    get state(): "loading" | "ready" | "failed" {
      return state === "empty" ? "ready" : state;
    },
    get items(): readonly T[] {
      return state === "ready" ? items : [];
    },
  };
}

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

function ComposerSuggestionsFixture(props: {
  commandState?: SectionState;
  skillState?: SectionState;
  command?: string;
  comments?: boolean;
  onSubmit?: (text: string, skills: readonly PromptSkillAttachment[]) => void;
}) {
  const [value, setValue] = createSignal("");
  const [selected, setSelected] = createSignal<readonly PromptSkillAttachment[]>([]);
  const [commandState, setCommandState] = createSignal(props.commandState ?? "ready");
  const [skillState, setSkillState] = createSignal(props.skillState ?? "ready");
  const [sent, setSent] = createSignal("");
  return (
    <div class="skills-story-frame">
      <p class="skills-story-intro">Type / to run a command or add a skill to your message.</p>
      <Composer
        value={value()}
        skills={selected()}
        command={props.command}
        review={props.comments ? { count: 2, onDiscard: () => undefined } : undefined}
        annotations={
          props.comments
            ? { count: 1, onOpen: () => undefined, onDiscard: () => undefined }
            : undefined
        }
        catalog={{
          get commands() {
            return section(commandState(), commands);
          },
          get skills() {
            return section(skillState(), skills);
          },
          onRetry: () => {
            setCommandState("ready");
            setSkillState("ready");
          },
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
  title: "Composer/Suggestions",
  component: ComposerSuggestionsFixture,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ComposerSuggestionsFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Interactive: Story = {};
export const Suggestions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Prompt" }), "/");
    await expect(canvas.getByText("Commands")).toBeVisible();
    await expect(canvas.getByText("Skills")).toBeVisible();
  },
};

export const CommandInsertion: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "/ini");
    await expect(canvas.getByText("/init", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await userEvent.type(prompt, "src", { skipClick: true });
    await expect(prompt).toHaveTextContent("/init src");
    await expect(canvas.queryByRole("region", { name: "Suggestions" })).toBeNull();
  },
};

export const NestedCommandInsertion: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "/nested");
    await expect(canvas.getByText("/nested/format", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect(prompt).toHaveTextContent("/nested/format");
  },
};

export const CommandsHiddenAfterSkill: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "/rev");
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Remove review skill" })).toBeVisible();
    await userEvent.type(prompt, "/simp", { skipClick: true });
    await expect(canvas.queryByText("Commands")).toBeNull();
    await expect(canvas.getByText("/simplify", { exact: true })).toBeVisible();
  },
};

export const NoMatchSubmits: Story = {
  args: { onSubmit: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "/zzz");
    await userEvent.keyboard("{Enter}");
    await expect(args.onSubmit).toHaveBeenCalledWith("/zzz", []);
    await expect(prompt).toHaveTextContent("");
  },
};

export const AbsolutePathSubmits: Story = {
  args: { onSubmit: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "Inspect /tmp/example");
    await expect(canvas.queryByText("Commands")).toBeNull();
    await userEvent.keyboard("{Enter}");
    await expect(args.onSubmit).toHaveBeenCalledWith("Inspect /tmp/example", []);
  },
};

export const CommandsHiddenMidMessage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "Update /sim");
    await expect(canvas.queryByText("Commands")).toBeNull();
    await expect(canvas.getByText("/simplify", { exact: true })).toBeVisible();
  },
};

export const CommandKeepsComments: Story = {
  args: { command: "init", comments: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText("Review comments and annotations stay attached for your next message."),
    ).toBeVisible();
    await expect(canvas.getByText("Code review · 2 comments")).toBeVisible();
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
    await expect(canvas.queryByRole("region", { name: "Suggestions" })).toBeNull();
    await userEvent.type(prompt, "/rev");
    await expect(canvas.getByRole("region", { name: "Suggestions" })).toBeVisible();
    await userEvent.type(prompt, "-no-match", { skipClick: true });
    await expect(canvas.getByText("No matching commands or skills.")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByRole("region", { name: "Suggestions" })).toBeNull();
    await expect(prompt).toHaveFocus();
  },
};
export const Loading: Story = {
  args: { commandState: "loading", skillState: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Prompt" }), "/");
    await expect(canvas.getByText("Loading commands…")).toBeVisible();
    await expect(canvas.getByText("Loading skills…")).toBeVisible();
    await expect(canvas.queryByText("/init", { exact: true })).toBeNull();
    await expect(canvas.queryByText("/simplify", { exact: true })).toBeNull();
  },
};
export const Empty: Story = {
  args: { commandState: "empty", skillState: "empty" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Prompt" }), "/");
    await expect(
      canvas.getByText("No commands or skills available for this project."),
    ).toBeVisible();
  },
};
export const Failed: Story = {
  args: { commandState: "failed", skillState: "failed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Prompt" }), "/");
    await expect(canvas.getByText("Couldn’t load commands.")).toBeVisible();
    await expect(canvas.getByText("Couldn’t load skills.")).toBeVisible();
    await expect(canvas.queryByText("/init", { exact: true })).toBeNull();
    await expect(canvas.queryByText("/simplify", { exact: true })).toBeNull();
  },
};
export const PartialFailure: Story = {
  args: { commandState: "failed", skillState: "ready" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("textbox", { name: "Prompt" }), "/");
    await expect(canvas.getByText("Couldn’t load commands.")).toBeVisible();
    await expect(canvas.getByText("/simplify", { exact: true })).toBeVisible();
    await expect(canvas.queryByText("Couldn’t load skills.")).toBeNull();
  },
};
export const Narrow: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  play: Suggestions.play,
};

export const KeyboardNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "/");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(prompt).toHaveTextContent("/compact");
  },
};

export const SkillKeyboardNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "/simpl");
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Remove simplify skill" })).toBeVisible();
  },
};

export const CrossGroupKeyboardNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "/");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    await expect(canvas.getByRole("button", { name: "Remove review skill" })).toBeVisible();
  },
};

export const RetryAndPointerSelection: Story = {
  args: { commandState: "failed", skillState: "failed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    await userEvent.type(prompt, "/");
    await userEvent.click(canvas.getAllByRole("button", { name: "Try again" })[0]!);
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
    // The trailing space is written as a character reference so the draft
    // still holds it when parsed again.
    await expect(args.onSubmit).toHaveBeenCalledWith("Please Use review&#x20;", [
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
    await expect(args.onSubmit).toHaveBeenCalledWith("First line\n\nreview and&#x20;", [
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
    await expect(args.onSubmit).toHaveBeenCalledWith("Use and testing&#x20;", [
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
