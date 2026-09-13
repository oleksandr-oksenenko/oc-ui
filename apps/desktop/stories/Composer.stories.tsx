/* oxlint-disable effecttsgo/async-function */

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";

import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import type { ComposerReview } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import { composerAgentSelection, composerModelSelection } from "./composer-fixtures.ts";

const meta = {
  title: "Composer/Composer",
  component: Composer,
  decorators: [
    (Story) => (
      <div style={frameStyle}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj;

const frameStyle = {
  width: "min(760px, 90vw)",
  padding: "32px",
  background: "var(--oc-surface-subtle)",
};
const idleOnSubmit = fn<() => void>();
const idleOnSelectModel = fn<(id: string) => void>();
const runningOnStop = fn<() => void>();

export const Idle: Story = {
  render: () => {
    const [value, setValue] = createSignal("");
    const [modelID, setModelID] = createSignal("openai/gpt-5");
    const [variantID, setVariantID] = createSignal("deep");
    const [agentID, setAgentID] = createSignal("build");
    return (
      <Composer
        value={value()}
        disabled={false}
        action="send"
        modelSelection={composerModelSelection({
          selectedModelID: modelID(),
          selectedVariantID: variantID(),
          onSelectModel: (id) => {
            idleOnSelectModel(id);
            setModelID(id);
          },
          onSelectVariant: setVariantID,
        })}
        agentSelection={composerAgentSelection({
          selectedAgentID: agentID(),
          onSelectAgent: setAgentID,
        })}
        onInput={setValue}
        onSubmit={() => {
          idleOnSubmit();
          setValue("");
        }}
      />
    );
  },
  play: async ({ canvasElement, step }) => {
    idleOnSubmit.mockClear();
    idleOnSelectModel.mockClear();

    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });

    await step("Submit a non-empty draft with Enter", async () => {
      await userEvent.type(prompt, "Send");
      const frame = canvas.getByRole("form", { name: "Message composer" });
      await expect(getComputedStyle(frame).outlineColor).toBe("rgb(119, 119, 119)");
      await expect(getComputedStyle(frame).outlineWidth).toBe("1px");
      await expect(getComputedStyle(prompt).outlineStyle).toBe("none");
      await userEvent.keyboard("{Enter}");
      await expect(prompt).toHaveTextContent("");
      await expect(idleOnSubmit).toHaveBeenCalledOnce();
    });

    await step("Search models with an autofocus input", async () => {
      await userEvent.click(canvas.getByRole("button", { name: "Model: GPT-5" }));
      const modelDialog = await screen.findByRole("dialog", { name: "Models" });
      await waitFor(() => expect(modelDialog).toBeVisible());
      const modelPicker = within(modelDialog);
      const search = await modelPicker.findByPlaceholderText("Search models");
      await expect(search).toHaveFocus();

      await userEvent.type(search, "mini");
      await expect(modelPicker.getByText("GPT-5 Mini", { exact: true })).toBeVisible();
      await expect(modelPicker.queryByText("Claude", { exact: true })).toBeNull();
    });

    await step("Recover from a no-match search and select by keyboard", async () => {
      const modelDialog = await screen.findByRole("dialog", { name: "Models" });
      const modelPicker = within(modelDialog);
      const search = modelPicker.getByPlaceholderText("Search models");
      await userEvent.clear(search);
      await userEvent.type(search, "nothing-matches");
      await expect(modelPicker.getByText("No matching models.", { exact: true })).toBeVisible();

      await userEvent.clear(search);
      const modelList = modelDialog.querySelector<HTMLElement>('[data-component="list"]');
      if (!modelList) throw new Error("Model picker list did not render");
      await expect(within(modelList).getByText("GPT-5", { exact: true })).toBeVisible();
      await userEvent.keyboard("{ArrowDown}{Enter}");
      await expect(idleOnSelectModel).toHaveBeenCalledWith("openai/gpt-5-mini");
      await expect(canvas.getByRole("button", { name: "Model: GPT-5 Mini" })).toHaveTextContent(
        "GPT-5 Mini",
      );
    });
  },
};

export const PastedFiles: Story = {
  render: () => {
    const [files, setFiles] = createSignal<readonly File[]>([
      new File([], "Screenshot.png", { type: "image/png" }),
      new File([], "Project notes.txt", { type: "text/plain" }),
    ]);
    return (
      <Composer
        value=""
        files={files()}
        onPasteFiles={(incoming) => setFiles((current) => [...current, ...incoming])}
        onRemoveFile={(file) => setFiles((current) => current.filter((item) => item !== file))}
        disabled={false}
        action="send"
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection()}
        onInput={() => undefined}
        onSubmit={() => setFiles([])}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Send" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Remove Screenshot.png" }));
    const remove = canvas.getByRole("button", { name: "Remove Project notes.txt" });
    remove.focus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.queryByRole("list", { name: "Attached files" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Send" })).toBeDisabled();
  },
};

export const LoadingPickers: Story = {
  render: () => {
    const [value, setValue] = createSignal("Explain the latest change");
    return (
      <Composer
        value={value()}
        disabled={false}
        action="send"
        modelSelection={composerModelSelection({ state: "loading", models: [], variants: [] })}
        agentSelection={composerAgentSelection({ state: "loading", agents: [] })}
        onInput={setValue}
        onSubmit={() => setValue("")}
      />
    );
  },
};

export const DefaultAgent: Story = {
  render: () => (
    <Composer
      value=""
      disabled={false}
      action="send"
      modelSelection={composerModelSelection()}
      agentSelection={composerAgentSelection({ selectedAgentID: undefined })}
      onInput={() => undefined}
      onSubmit={() => undefined}
    />
  ),
};

export const EmptyAgents: Story = {
  render: () => (
    <Composer
      value=""
      disabled={false}
      action="send"
      modelSelection={composerModelSelection()}
      agentSelection={composerAgentSelection({ agents: [], selectedAgentID: undefined })}
      onInput={() => undefined}
      onSubmit={() => undefined}
    />
  ),
};

export const MissingAgent: Story = {
  render: () => (
    <Composer
      value=""
      disabled={false}
      action="send"
      modelSelection={composerModelSelection()}
      agentSelection={composerAgentSelection({ selectedAgentID: "missing" })}
      onInput={() => undefined}
      onSubmit={() => undefined}
    />
  ),
};

export const Multiline: Story = {
  render: () => {
    const [value, setValue] = createSignal(
      "Review this change\nThen suggest focused tests\nKeep the answer concise",
    );
    return (
      <Composer
        value={value()}
        disabled={false}
        action="send"
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection()}
        onInput={setValue}
        onSubmit={() => setValue("")}
      />
    );
  },
};

export const RunningDraft: Story = {
  render: () => {
    const [value, setValue] = createSignal("This draft remains editable while the run is active.");
    return (
      <Composer
        value={value()}
        disabled={false}
        action="running"
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection()}
        onInput={setValue}
        onSubmit={() => undefined}
        onStop={runningOnStop}
      />
    );
  },
  play: async ({ canvasElement, step }) => {
    runningOnStop.mockClear();
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });
    const send = canvas.getByRole("button", { name: "Send" });
    const pickers = canvasElement.querySelectorAll<HTMLElement>('[data-component="select-v2"]');
    const model = canvas.getByRole("button", { name: "Model: GPT-5" });

    await step("Keep the running draft editable", async () => {
      await expect(prompt).not.toBeDisabled();
      await userEvent.click(prompt);
      await userEvent.type(prompt, " Add a follow-up.");
      await expect(prompt).toHaveTextContent(
        "This draft remains editable while the run is active. Add a follow-up.",
      );
    });

    await step("Keep live-run controls available", async () => {
      await expect(send).toBeEnabled();
      await expect(model).toBeEnabled();
      await expect(pickers).toHaveLength(2);
      for (const picker of pickers) {
        await expect(picker).not.toHaveAttribute("data-disabled");
      }
      await userEvent.clear(prompt);
      await userEvent.click(canvas.getByRole("button", { name: "Stop" }));
      await expect(runningOnStop).toHaveBeenCalledOnce();
    });
  },
};

export const Submitting: Story = {
  render: () => (
    <Composer
      value="Send this prompt"
      disabled
      action="sending"
      modelSelection={composerModelSelection()}
      agentSelection={composerAgentSelection({ switching: true })}
      onInput={() => undefined}
      onSubmit={() => undefined}
    />
  ),
};

export const AdmissionError: Story = {
  render: () => {
    const [value, setValue] = createSignal("The draft is preserved after admission fails.");
    return (
      <Composer
        value={value()}
        disabled={false}
        action="send"
        error="The server could not admit this prompt. Try again."
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection()}
        onInput={setValue}
        onSubmit={() => undefined}
      />
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);
    const prompt = canvas.getByRole("textbox", { name: "Prompt" });

    await step("Expose the admission failure without losing the draft", async () => {
      await expect(canvas.getByRole("alert")).toHaveTextContent(
        "The server could not admit this prompt. Try again.",
      );
      await expect(prompt).toHaveTextContent("The draft is preserved after admission fails.");
    });

    await step("Allow the preserved draft to be edited", async () => {
      await userEvent.click(prompt);
      await userEvent.type(prompt, " Edit and retry.");
      await expect(prompt).toHaveTextContent(
        "The draft is preserved after admission fails. Edit and retry.",
      );
    });
  },
};

export const EmptyDisabled: Story = {
  render: () => (
    <Composer
      value=""
      disabled
      action="send"
      modelSelection={composerModelSelection()}
      agentSelection={composerAgentSelection()}
      onInput={() => undefined}
      onSubmit={() => undefined}
    />
  ),
};

export const ReviewAttachment: Story = {
  render: () => {
    const [value, setValue] = createSignal("");
    const [review, setReview] = createSignal<ComposerReview | undefined>({
      count: 3,
      onDiscard: () => setReview(undefined),
    });
    return (
      <Composer
        value={value()}
        disabled={false}
        action="send"
        review={review()}
        modelSelection={composerModelSelection()}
        agentSelection={composerAgentSelection()}
        onInput={setValue}
        onSubmit={() => setValue("")}
      />
    );
  },
};

export const UnavailableWhileDisabled: Story = {
  render: () => (
    <Composer
      value="Unavailable while reconnecting"
      disabled
      action="send"
      modelSelection={composerModelSelection({
        state: "failed",
        models: [],
        variants: [],
        error: "Models could not be loaded. Check the connection and try again.",
      })}
      agentSelection={composerAgentSelection({
        state: "failed",
        agents: [],
        error: "Agents could not be loaded. Check the connection and try again.",
      })}
      onInput={() => undefined}
      onSubmit={() => undefined}
    />
  ),
};

export const PromptFocused: Story = {
  render: () => (
    <Composer
      value="A focused prompt exposes the canonical composer focus treatment."
      disabled={false}
      action="send"
      modelSelection={composerModelSelection()}
      agentSelection={composerAgentSelection()}
      onInput={() => undefined}
      onSubmit={() => undefined}
    />
  ),
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLDivElement>('[aria-label="Prompt"]')?.focus();
  },
};

export const SwitchingSelection: Story = {
  render: () => (
    <Composer
      value="The draft remains visible while the model selection changes."
      disabled={false}
      action="send"
      modelSelection={composerModelSelection({ switching: true })}
      agentSelection={composerAgentSelection()}
      onInput={() => undefined}
      onSubmit={() => undefined}
    />
  ),
};

export const NarrowLongSelections: Story = {
  globals: { viewport: { value: "mobile", isRotated: false } },
  render: () => (
    <Composer
      value="Review the complete remote workspace context and preserve the server-provided path."
      disabled={false}
      action="send"
      modelSelection={composerModelSelection({
        models: [
          {
            id: "openai/long-model",
            label: "OpenAI reasoning model with an intentionally long display name",
            group: "OpenAI hosted models",
          },
        ],
        selectedModelID: "openai/long-model",
        variants: [{ id: "maximum-reasoning", label: "maximum reasoning with extended context" }],
        selectedVariantID: "maximum-reasoning",
      })}
      agentSelection={composerAgentSelection({
        agents: [{ id: "review-long", label: "Independent implementation reviewer" }],
        selectedAgentID: "review-long",
      })}
      onInput={() => undefined}
      onSubmit={() => undefined}
    />
  ),
};
