/* oxlint-disable effecttsgo/async-function -- Storybook's interaction API is Promise-based. */

import type {
  FormAnswer,
  FormInfo,
  SessionMessageAssistant,
  SessionMessageUser,
} from "@opencode/client";
import { For, createSignal, type JSX } from "solid-js";
import { expect, fn, userEvent } from "storybook/test";
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
