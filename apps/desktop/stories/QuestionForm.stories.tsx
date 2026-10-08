/* oxlint-disable effecttsgo/async-function -- Storybook's interaction API is Promise-based. */

import type {
  FormAnswer,
  FormInfo,
  SessionMessageAssistant,
  SessionMessageUser,
} from "@opencode/client";
import { For, createSignal, type JSX } from "solid-js";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { QuestionForm } from "../src/renderer/ui/QuestionForm.tsx";
import { TranscriptView } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView.tsx";
import { workspaceQuestionForm } from "./question-form-fixtures.ts";

import "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/SessionPane.css";

const fullForm = {
  id: "frm_release_setup",
  sessionID: "ses_oc_ui",
  title: "Confirm the release setup",
  fields: [
    {
      key: "environment",
      type: "string",
      title: "Target environment",
      required: true,
      default: "preview",
      options: [
        {
          value: "preview",
          label: "Preview",
          description: "Build and inspect without publishing.",
        },
        {
          value: "production",
          label: "Production",
          description: "Prepare the live release settings.",
        },
      ],
    },
    {
      key: "release_name",
      type: "string",
      title: "Release name",
      description: "Shown in the deployment history.",
      placeholder: "Question forms",
      minLength: 3,
      maxLength: 48,
      required: true,
    },
    {
      key: "reviewers",
      type: "multiselect",
      title: "Required reviews",
      description: "Choose every review that must pass before release.",
      minItems: 1,
      maxItems: 3,
      required: true,
      custom: true,
      default: ["accessibility"],
      options: [
        {
          value: "accessibility",
          label: "Accessibility",
          description: "Keyboard, focus, labels, and zoom.",
        },
        {
          value: "visual",
          label: "Visual QA",
          description: "Spacing, density, responsive states, and polish.",
        },
        {
          value: "runtime",
          label: "Runtime",
          description: "Electron and server behavior in the packaged path.",
        },
      ],
    },
    {
      key: "retries",
      type: "integer",
      title: "Retry attempts",
      description: "How many times should a transient preview failure retry?",
      minimum: 0,
      maximum: 5,
      default: 2,
      required: true,
    },
    {
      key: "notify_team",
      type: "boolean",
      title: "Notify the team when the preview is ready?",
      default: false,
      required: true,
    },
    {
      key: "release_channel",
      type: "string",
      title: "Production channel",
      placeholder: "stable",
      required: true,
      when: [{ key: "environment", op: "eq", value: "production" }],
    },
    {
      key: "release_notes",
      type: "external",
      title: "Release notes template",
      description: "Open the team template before you continue.",
      url: "https://opencode.ai/docs",
    },
  ],
} satisfies FormInfo;

const validationForm = {
  id: "frm_validation",
  sessionID: "ses_oc_ui",
  title: "Complete the required details",
  fields: [
    {
      key: "name",
      type: "string",
      title: "Release name",
      required: true,
      minLength: 3,
    },
    {
      key: "reviews",
      type: "multiselect",
      title: "Required reviews",
      required: true,
      minItems: 1,
      options: [
        { value: "accessibility", label: "Accessibility" },
        { value: "visual", label: "Visual QA" },
      ],
    },
    {
      key: "approved",
      type: "boolean",
      title: "Is the release approved?",
      required: true,
    },
  ],
} satisfies FormInfo;

const transcriptUser = {
  id: "question-form-user",
  time: { created: 1 },
  type: "user",
  text: "Prepare the release and ask me for any choices you need.",
} satisfies SessionMessageUser;

const transcriptAssistant = {
  id: "question-form-assistant",
  time: { created: 2, completed: 3 },
  type: "assistant",
  agent: "build",
  model: { providerID: "openai", id: "gpt-5" },
  content: [
    {
      type: "text",
      text: "I need these release details before I can continue.",
    },
  ],
  finish: "stop",
} satisfies SessionMessageAssistant;

const callbacks = {
  onSubmit: fn<(answer: FormAnswer) => void>(),
  onCancel: fn<() => void>(),
  onOpenExternal: fn<(url: string) => void>(),
};

const meta = {
  title: "Conversation/QuestionForm",
  component: QuestionForm,
  render: (args) => (
    <main style={frameStyle}>
      <QuestionForm {...args} />
    </main>
  ),
  parameters: { layout: "fullscreen" },
  args: {
    form: workspaceQuestionForm,
    disabled: false,
    submitting: false,
    error: undefined,
    ...callbacks,
  },
} satisfies Meta<typeof QuestionForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const frameStyle: JSX.CSSProperties = {
  display: "grid",
  height: "100vh",
  "align-items": "start",
  "justify-items": "center",
  overflow: "auto",
  "box-sizing": "border-box",
  padding: "32px",
  background: "var(--oc-surface-subtle)",
};

const narrowFrameStyle: JSX.CSSProperties = {
  ...frameStyle,
  width: "360px",
  height: "720px",
  padding: "12px",
};

const transcriptFrameStyle: JSX.CSSProperties = {
  height: "100vh",
  "min-height": "640px",
  background: "var(--oc-surface-canvas)",
};

export const SingleQuestion: Story = {};

export const CompleteForm: Story = {
  args: { form: fullForm },
};

export const InTranscript: Story = {
  args: { form: fullForm },
  render: (args) => (
    <main style={transcriptFrameStyle}>
      <TranscriptView
        sessionID="ses_oc_ui"
        messages={[transcriptUser, transcriptAssistant]}
        sessionStatus="idle"
        pendingInteraction={<QuestionForm {...args} />}
      />
    </main>
  ),
};

export const MultiplePendingInTranscript: Story = {
  render: (args) => {
    const [forms, setForms] = createSignal<readonly FormInfo[]>([workspaceQuestionForm, fullForm]);
    const settle = (formID: string): void => {
      setForms((current) => current.filter((form) => form.id !== formID));
    };

    return (
      <main style={transcriptFrameStyle}>
        <TranscriptView
          sessionID="ses_oc_ui"
          messages={[transcriptUser, transcriptAssistant]}
          sessionStatus="idle"
          pendingInteraction={
            <For each={forms()}>
              {(form) => (
                <QuestionForm
                  {...args}
                  form={form}
                  onSubmit={(answer) => {
                    args.onSubmit(answer);
                    settle(form.id);
                  }}
                  onCancel={() => {
                    args.onCancel?.();
                    settle(form.id);
                  }}
                />
              )}
            </For>
          }
        />
      </main>
    );
  },
};

export const ValidationErrors: Story = {
  args: { form: validationForm },
};

export const Submitting: Story = {
  args: { form: fullForm, submitting: true },
};

export const SubmissionError: Story = {
  args: {
    form: fullForm,
    error: "The server could not accept this answer. Review the fields and try again.",
  },
};

export const Disabled: Story = {
  args: { form: fullForm, disabled: true },
  play: async ({ canvasElement }) => {
    const choices = canvasElement.querySelectorAll<HTMLElement>(
      '[data-disabled]:not([data-checked]):is([data-slot="radio-v2-item"], [data-component="checkbox"])',
    );
    await expect(choices.length).toBeGreaterThan(1);
    for (const choice of choices) {
      const before = getComputedStyle(choice).backgroundColor;
      await userEvent.hover(choice);
      await expect(getComputedStyle(choice).backgroundColor).toBe(before);
      await userEvent.unhover(choice);
    }
  },
};

export const NarrowLayout: Story = {
  args: { form: fullForm },
  globals: { viewport: { value: "mobile", isRotated: false } },
  render: (args) => (
    <main style={narrowFrameStyle}>
      <QuestionForm {...args} />
    </main>
  ),
};

const longLabel = "UnbrokenOptionLabel".repeat(8);
const longDescription = "UnbrokenOptionDescription".repeat(8);
const customAnswerPrefix = "shared-custom-answer-prefix".repeat(8);
const customAnswers = [
  `${customAnswerPrefix}-first-distinct-suffix`,
  `${customAnswerPrefix}-second-distinct-suffix`,
];
const longContentForm = {
  id: "frm_card_width",
  sessionID: "ses_oc_ui",
  title: "Choices in differently sized slots",
  fields: [
    {
      key: "text",
      type: "string",
      title: "StringFieldTitle".repeat(28),
      description: "This explains the text field.",
    },
    {
      key: "numericFallbackKey".repeat(24),
      type: "number",
      description: "This explains the numeric field with a fallback key label.",
    },
    {
      key: "choice",
      type: "string",
      title: "UnbrokenRadioGroupTitle".repeat(6),
      description: longDescription,
      options: [{ value: "radio", label: longLabel, description: longDescription }],
    },
    {
      key: "answers",
      type: "multiselect",
      title: "UnbrokenMultiselectLegend".repeat(6),
      description: longDescription,
      custom: true,
      options: [{ value: "checkbox", label: longLabel, description: longDescription }],
    },
    {
      key: "external",
      type: "external",
      title: "UnbrokenExternalTitle".repeat(20),
      description: "Open the reference before continuing.",
      url: "https://opencode.ai/docs",
    },
  ],
} satisfies FormInfo;

async function expectTextContained(text: HTMLElement, surface: HTMLElement): Promise<void> {
  const bounds = surface.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(text);
  const fragments = [...range.getClientRects()];
  await expect(fragments.length).toBeGreaterThan(0);
  for (const fragment of fragments) {
    await expect(fragment.left).toBeGreaterThanOrEqual(bounds.left - 1);
    await expect(fragment.right).toBeLessThanOrEqual(bounds.right + 1);
    await expect(fragment.top).toBeGreaterThanOrEqual(bounds.top - 1);
    await expect(fragment.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
  }
}

export const CardWidthAndLongAnswers: Story = {
  args: { form: longContentForm },
  globals: { viewport: { value: "desktop", isRotated: false } },
  render: (args) => (
    <main style={{ ...frameStyle, "grid-template-columns": "360px 620px", gap: "32px" }}>
      <For each={[360, 620]}>
        {(width) => (
          <section aria-label={`${width}px form slot`} style={{ width: `${width}px` }}>
            <QuestionForm
              {...args}
              form={{ ...args.form, title: `${args.form.title} — ${width}px slot` }}
            />
          </section>
        )}
      </For>
    </main>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    for (const width of [360, 620]) {
      const slot = canvas.getByRole("region", { name: `${width}px form slot` });
      const form = within(slot);
      const card = slot.querySelector<HTMLElement>(".question-form-card")!;
      await expect(card.getBoundingClientRect().width).toBeCloseTo(width, 0);
      const textNodes = card.querySelectorAll<HTMLElement>(
        '[data-slot="radio-v2-label"], [data-slot="radio-v2-description"], [data-slot="radio-v2-item-label-text"], [data-slot="radio-v2-item-description"], [data-slot="checkbox-checkbox-label"], [data-slot="checkbox-checkbox-description"], legend',
      );
      await expect(textNodes.length).toBe(7);
      for (const text of textNodes) {
        await expectTextContained(
          text,
          text.closest<HTMLElement>('[data-slot="radio-v2-item"], [data-component="checkbox"]') ??
            card,
        );
      }
      for (const field of args.form.fields.filter(
        (candidate) =>
          candidate.type === "number" || (candidate.type === "string" && !candidate.options),
      )) {
        const text = form.getByText(field.title ?? field.key, { selector: "span" });
        const label = text.closest("label")!;
        const info = within(label).getByRole("button", { name: field.description! });
        info.scrollIntoView({ block: "center" });
        await expectTextContained(text, text);
        const infoBounds = info.getBoundingClientRect();
        await expect(text.getBoundingClientRect().right).toBeLessThanOrEqual(infoBounds.left);
        await expect(infoBounds.right).toBeLessThanOrEqual(label.getBoundingClientRect().right);
        await expect(
          info.contains(
            document.elementFromPoint(
              infoBounds.left + infoBounds.width / 2,
              infoBounds.top + infoBounds.height / 2,
            ),
          ),
        ).toBe(true);
        await userEvent.hover(info);
        await expect(await within(document.body).findByRole("tooltip")).toHaveTextContent(
          field.description!,
        );
        await userEvent.unhover(info);
        await waitFor(() => expect(within(document.body).queryByRole("tooltip")).toBeNull());
      }
      const radioText = form.getByText(longLabel, { selector: "span" });
      const radioLabel = radioText.closest("label")!;
      const radio = within(radioLabel.parentElement!).getByRole("radio");
      await expect(radio).toHaveAttribute("aria-labelledby", radioLabel.id);
      await expect(radio).not.toBeChecked();
      await userEvent.click(radioText);
      await expect(radio).toBeChecked();
      const checkboxLabel = form.getByText(longLabel, { selector: "label" });
      await userEvent.click(checkboxLabel);
      await expect(form.getByRole("checkbox", { name: longLabel })).toBeChecked();
      await userEvent.click(checkboxLabel);

      const draft = form.getByRole("textbox", { name: "Add another answer" });
      for (const answer of customAnswers) {
        await userEvent.click(draft);
        await userEvent.paste(answer);
        await expect(draft).toHaveValue(answer);
        await userEvent.click(form.getByRole("button", { name: "Add" }));
        await expect(draft).toHaveValue("");
      }
      for (const answer of customAnswers) {
        const text = form.getByText(answer, { selector: "span" });
        await expectTextContained(text, text.parentElement!);
        const remove = form.getByRole("button", { name: `Remove ${answer}` });
        await expect(remove.getBoundingClientRect().width).toBeGreaterThanOrEqual(20);
      }
      const inputRow = card.querySelector<HTMLElement>(".question-form-custom-input")!;
      const input = draft.getBoundingClientRect();
      const add = within(inputRow).getByRole("button", { name: "Add" }).getBoundingClientRect();
      const external = card.querySelector<HTMLElement>(".question-form-external")!;
      const externalText = external.querySelector("div")!.getBoundingClientRect();
      const externalTitle = external.querySelector<HTMLElement>("strong")!;
      await expectTextContained(externalTitle, externalTitle.parentElement!);
      const openButton = form.getByRole("button", { name: `Open ${externalTitle.textContent}` });
      const open = openButton.getBoundingClientRect();
      if (width === 360) {
        await expect(add.top).toBeGreaterThanOrEqual(input.bottom);
        await expect(open.top).toBeGreaterThanOrEqual(externalText.bottom);
      } else {
        await expect(add.left).toBeGreaterThanOrEqual(input.right);
        await expect(open.left).toBeGreaterThanOrEqual(externalText.right);
      }
      openButton.scrollIntoView({ block: "center" });
      const openBounds = openButton.getBoundingClientRect();
      await expect(
        openButton.contains(
          document.elementFromPoint(
            openBounds.left + openBounds.width / 2,
            openBounds.top + openBounds.height / 2,
          ),
        ),
      ).toBe(true);
      await userEvent.click(openButton);
      await expect(args.onOpenExternal).toHaveBeenLastCalledWith("https://opencode.ai/docs");
      await userEvent.click(form.getByRole("button", { name: `Remove ${customAnswers[0]}` }));
      await expect(form.queryByText(customAnswers[0]!)).toBeNull();
      await userEvent.click(form.getByRole("button", { name: "Continue" }));
      await expect(args.onSubmit).toHaveBeenLastCalledWith({
        choice: "radio",
        answers: [customAnswers[1]],
        external: true,
      });
    }
  },
};
