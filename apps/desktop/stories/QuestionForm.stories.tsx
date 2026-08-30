import type {
  FormAnswer,
  FormInfo,
  SessionMessageAssistant,
  SessionMessageUser,
} from "@opencode-ai/client";
import { Button } from "@opencode-ai/ui/button";
import { Card, CardActions, CardDescription, CardTitle } from "@opencode-ai/ui/card";
import { Checkbox } from "@opencode-ai/ui/checkbox";
import { Field } from "@opencode-ai/ui/field";
import { RadioGroup, RadioItem } from "@opencode-ai/ui/radio";
import { TextInput } from "@opencode-ai/ui/text-input";
import type { JSX } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

import { QuestionForm } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/QuestionForm.tsx";
import { AssistantMessage } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView/AssistantMessage.tsx";
import { UserMessage } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/TranscriptView/UserMessage.tsx";
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
  background: "#050506",
};

const narrowFrameStyle: JSX.CSSProperties = {
  ...frameStyle,
  width: "360px",
  height: "720px",
  padding: "12px",
};

const defaultsFrameStyle: JSX.CSSProperties = {
  height: "100vh",
  overflow: "auto",
  padding: "32px",
  background: "#050506",
};

const defaultsStackStyle: JSX.CSSProperties = {
  display: "grid",
  gap: "24px",
  width: "min(620px, 100%)",
};

const defaultsGroupStyle: JSX.CSSProperties = {
  display: "grid",
  gap: "12px",
};

const defaultsActionsStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  "flex-wrap": "wrap",
  gap: "8px",
};

const transcriptFrameStyle: JSX.CSSProperties = {
  height: "100vh",
  "min-height": "640px",
  background: "#000",
};

export const SingleQuestion: Story = {
  render: (args) => (
    <main style={frameStyle}>
      <QuestionForm {...args} />
    </main>
  ),
};

export const CompleteForm: Story = {
  args: { form: fullForm },
  render: (args) => (
    <main style={frameStyle}>
      <QuestionForm {...args} />
    </main>
  ),
};

export const InTranscript: Story = {
  args: { form: fullForm },
  render: (args) => (
    <main style={transcriptFrameStyle}>
      <section class="transcript-view" aria-label="Transcript with a pending question form">
        <div class="transcript-document">
          <UserMessage message={transcriptUser} />
          <AssistantMessage message={transcriptAssistant} sessionStatus="idle" />
          <article
            class="transcript-message transcript-assistant-message transcript-pending-interaction"
            data-message-id="question-form-pending"
          >
            <QuestionForm {...args} />
          </article>
        </div>
      </section>
    </main>
  ),
};

export const OpenCodeDefaults: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <main style={defaultsFrameStyle}>
      <section aria-label="Default OpenCode form controls" style={defaultsStackStyle}>
        <Card>
          <CardTitle icon={false}>Default OpenCode card</CardTitle>
          <CardDescription>No local QuestionForm styles are applied in this story.</CardDescription>
        </Card>

        <Field>
          <Field.Label tooltip="Shown in the deployment history.">Release name</Field.Label>
          <Field.Control>
            <TextInput placeholder="Question forms" />
          </Field.Control>
        </Field>

        <RadioGroup
          label="Target environment"
          description="These are default OpenCode radio items."
          defaultValue="preview"
        >
          <RadioItem
            value="preview"
            label="Preview"
            description="Build and inspect without publishing."
          />
          <RadioItem
            value="production"
            label="Production"
            description="Prepare the live release settings."
          />
        </RadioGroup>

        <div style={defaultsGroupStyle}>
          <Checkbox defaultChecked description="Keyboard, focus, labels, and zoom.">
            Accessibility
          </Checkbox>
          <Checkbox description="Spacing, density, responsive states, and polish.">
            Visual QA
          </Checkbox>
          <Checkbox description="Electron and server behavior in the packaged path.">
            Runtime
          </Checkbox>
        </div>

        <Field>
          <Field.Label tooltip="How many times should a transient failure retry?">
            Retry attempts
          </Field.Label>
          <Field.Control>
            <TextInput type="number" value="2" numeric />
          </Field.Control>
        </Field>

        <RadioGroup label="Notify the team when the preview is ready?" defaultValue="false">
          <RadioItem value="true" label="Yes" />
          <RadioItem value="false" label="No" />
        </RadioGroup>

        <Card>
          <CardTitle icon={false}>Release notes template</CardTitle>
          <CardDescription>Open the team template before you continue.</CardDescription>
          <CardActions>
            <Button icon="square-arrow-top-right">Open</Button>
          </CardActions>
        </Card>

        <div style={defaultsActionsStyle}>
          <Button>Default button</Button>
          <Button variant="outline">Outline button</Button>
          <Button variant="contrast">Contrast button</Button>
          <Button variant="ghost-muted">Ghost muted button</Button>
        </div>
      </section>
    </main>
  ),
};

export const ValidationErrors: Story = {
  args: { form: validationForm },
  render: (args) => (
    <main style={frameStyle}>
      <QuestionForm {...args} />
    </main>
  ),
};

export const Submitting: Story = {
  args: { form: fullForm, submitting: true },
  render: (args) => (
    <main style={frameStyle}>
      <QuestionForm {...args} />
    </main>
  ),
};

export const SubmissionError: Story = {
  args: {
    form: fullForm,
    error: "The server could not accept this answer. Review the fields and try again.",
  },
  render: (args) => (
    <main style={frameStyle}>
      <QuestionForm {...args} />
    </main>
  ),
};

export const Disabled: Story = {
  args: { form: fullForm, disabled: true },
  render: (args) => (
    <main style={frameStyle}>
      <QuestionForm {...args} />
    </main>
  ),
};

export const NarrowLayout: Story = {
  args: { form: fullForm },
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: (args) => (
    <main style={narrowFrameStyle}>
      <QuestionForm {...args} />
    </main>
  ),
};
