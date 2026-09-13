/* oxlint-disable effecttsgo/async-function -- Storybook's interaction API is Promise-based. */

import { Button } from "@opencode-ai/ui/button";
import { Checkbox } from "@opencode-ai/ui/checkbox";
import { Icon } from "@opencode-ai/ui/icon";
import { IconButton } from "@opencode-ai/ui/icon-button";
import { InlineInput } from "@opencode-ai/ui/inline-input";
import { RadioGroup, RadioItem } from "@opencode-ai/ui/radio";
import { Select } from "@opencode-ai/ui/select";
import { Switch } from "@opencode-ai/ui/switch";
import { Textarea } from "@opencode-ai/ui/textarea";
import { TextInput } from "@opencode-ai/ui/text-input";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { CatalogCard, CatalogPage } from "./StoryLayout";

const meta = {
  title: "Design System/Focus",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

async function ring(element: Element, offset = "0px") {
  await waitFor(async () => {
    const style = getComputedStyle(element);
    await expect(style.outlineColor).toBe("rgb(119, 119, 119)");
    await expect(style.outlineStyle).toBe("solid");
    await expect(style.outlineWidth).toBe("1px");
    await expect(style.outlineOffset).toBe(offset);
  });
}

export const SharedTreatment: StoryObj = {
  render: () => (
    <CatalogPage
      title="Focus"
      intro="Neutral focus is shared across controls. Tab through the examples; compound editors draw one ring on their frame, and edge controls use inset placement."
    >
      <CatalogCard
        title="Shared controls"
        description="The same outline across upstream control families and local compound fields."
      >
        <div class="design-system-control-column">
          <Button>Start focus tour</Button>
          <IconButton icon={<Icon name="close" />} aria-label="Focus icon" />
          <TextInput
            aria-label="Focus filter"
            value="Session"
            leadingIcon={<Icon name="magnifying-glass" />}
            showClearButton
            clearLabel="Clear focus filter"
          />
          <Textarea aria-label="Focus notes" />
          <InlineInput aria-label="Focus inline input" value="Inline value" />
          <Select aria-label="Focus select" options={["One", "Two"]} current="One" />
          <Checkbox>Focus checkbox</Checkbox>
          <Switch>Focus switch</Switch>
          <RadioGroup label="Focus radio group" defaultValue="one">
            <RadioItem value="one" label="Focus radio" />
          </RadioGroup>
          <div class="oc-focus-container design-system-focus-compound" data-testid="compound-frame">
            <textarea class="oc-focus-delegate" aria-label="Focus compound editor" />
          </div>
          <div class="design-system-focus-clipped">
            <Button class="oc-focus-inset">Focus edge action</Button>
          </div>
          <TextInput aria-label="Focus invalid field" invalid value="Invalid" />
          <TextInput aria-label="Focus disabled field" disabled />
          <Button disabled>Focus disabled action</Button>
        </div>
      </CatalogCard>
    </CatalogPage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const slot = (name: string) => {
      const element = canvasElement.querySelector(`[data-slot="${name}"]`);
      if (!element) throw new Error(`Missing focus specimen slot: ${name}`);
      return element;
    };

    await userEvent.click(canvas.getByRole("button", { name: "Start focus tour" }));
    await userEvent.tab();
    await ring(canvas.getByRole("button", { name: "Focus icon" }));
    await userEvent.tab();
    const filter = canvas.getByRole("textbox", { name: "Focus filter" });
    const frame = filter.closest('[data-component="text-input-v2"]')!;
    await ring(frame);
    await expect(getComputedStyle(filter).outlineStyle).toBe("none");
    await userEvent.tab();
    await ring(canvas.getByRole("button", { name: "Clear focus filter" }));
    await expect(getComputedStyle(frame).outlineStyle).toBe("none");
    await userEvent.tab();
    const notes = canvas.getByRole("textbox", { name: "Focus notes" });
    await ring(notes.closest('[data-component="textarea-v2"]')!);
    await expect(getComputedStyle(notes).outlineStyle).toBe("none");
    await userEvent.tab();
    const inline = canvas.getByRole("textbox", { name: "Focus inline input" });
    await ring(inline);
    await expect(getComputedStyle(inline).boxShadow).toBe("none");
    await userEvent.tab();
    const select = canvas.getByRole("button", { name: "Focus select One" });
    await ring(select);
    await userEvent.keyboard("{Enter}{Escape}");
    await waitFor(() => expect(select).toHaveFocus());
    await ring(select);
    await userEvent.tab();
    await ring(slot("checkbox-checkbox-control"));
    await expect(getComputedStyle(slot("checkbox-checkbox-control")).boxShadow).toBe("none");
    await userEvent.tab();
    await ring(slot("switch-control"));
    await userEvent.tab();
    await ring(slot("radio-v2-item-control"));
    await userEvent.tab();
    await ring(canvas.getByTestId("compound-frame"));
    await expect(
      getComputedStyle(canvas.getByRole("textbox", { name: "Focus compound editor" })).outlineStyle,
    ).toBe("none");
    await userEvent.tab();
    await ring(canvas.getByRole("button", { name: "Focus edge action" }), "-1px");
    await userEvent.tab();
    const invalid = canvas.getByRole("textbox", { name: "Focus invalid field" });
    const invalidFrame = invalid.closest('[data-component="text-input-v2"]')!;
    await ring(invalidFrame);
    await expect(getComputedStyle(invalidFrame).boxShadow).toContain("rgb(192, 37, 48)");
    await expect(canvas.getByRole("textbox", { name: "Focus disabled field" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Focus disabled action" })).toBeDisabled();

    // Pointer editing uses the same single frame as keyboard editing.
    await userEvent.click(filter);
    await ring(frame);
    await expect(getComputedStyle(filter).outlineStyle).toBe("none");
  },
};
