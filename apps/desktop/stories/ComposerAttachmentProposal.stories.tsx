/* oxlint-disable effecttsgo/async-function -- Storybook owns interaction test lifetimes. */
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { Composer } from "../src/renderer/components/App/ConnectedApp/Conversation/SessionPane/Composer.tsx";
import {
  composerAgentSelection,
  composerModelSelection,
  composerPasteProps,
} from "./composer-fixtures.ts";
import { AttachmentDetailExamples } from "./attachments/compact/PillsOption.tsx";
import { attachmentFiles } from "./attachment-fixtures.ts";
import "./ComposerAttachmentProposal.css";

function ComposerAttachmentProposal(props: { readonly narrow?: boolean }) {
  const [value, setValue] = createSignal(
    "Please address this feedback and use the attached reference.",
  );
  const [files, setFiles] = createSignal<readonly File[]>(attachmentFiles());
  const [modelID, setModelID] = createSignal("openai/gpt-5");
  const [variantID, setVariantID] = createSignal("deep");
  const [agentID, setAgentID] = createSignal("build");

  return (
    <div class="composer-attachment-stage">
      <div
        class="composer-attachment-frame"
        classList={{ "composer-attachment-frame--narrow": props.narrow }}
      >
        <Composer
          {...composerPasteProps}
          value={value()}
          attachments={{ count: 4, content: <AttachmentDetailExamples /> }}
          files={files()}
          onAttachFiles={(added) => setFiles((items) => [...items, ...added])}
          onRemoveFile={(file) => setFiles((items) => items.filter((item) => item !== file))}
          disabled={false}
          action="send"
          modelSelection={composerModelSelection({
            selectedModelID: modelID(),
            selectedVariantID: variantID(),
            onSelectModel: setModelID,
            onSelectVariant: setVariantID,
          })}
          agentSelection={composerAgentSelection({
            selectedAgentID: agentID(),
            onSelectAgent: setAgentID,
          })}
          onInput={setValue}
          onSubmit={() => setValue("")}
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Composer/Attachment proposal",
  component: ComposerAttachmentProposal,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ComposerAttachmentProposal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Narrow390: Story = { args: { narrow: true } };
export const Dark: Story = {
  globals: { theme: "dark" },
};

export const Interactions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const draft = canvas.getByRole("textbox", { name: "Prompt" });
    const originalDraft = "Please address this feedback and use the attached reference.";

    await expect(draft).toHaveTextContent(originalDraft);
    await userEvent.click(canvas.getByRole("button", { name: "Review · 2" }));
    await expect(screen.getByRole("dialog", { name: "Review comments" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(screen.queryByRole("dialog", { name: "Review comments" })).toBeNull();
    const imagePill = canvas.getByRole("button", { name: "Enlarge composer-reference.png" });
    await userEvent.click(within(imagePill).getByText("composer-reference.png"));
    await expect(
      await screen.findByRole("dialog", { name: "Preview of composer-reference.png" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(imagePill).toHaveFocus());
    await userEvent.keyboard("{Enter}");
    await expect(
      await screen.findByRole("dialog", { name: "Preview of composer-reference.png" }),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(imagePill).toHaveFocus());
    await expect(draft).toHaveTextContent(originalDraft);
    await expect(canvas.getByRole("button", { name: "Send" })).toBeEnabled();
  },
};
