/* oxlint-disable effecttsgo/async-function -- Storybook's interaction API is Promise-based. */

import { Button } from "@opencode/ui/button";
import { Checkbox } from "@opencode/ui/checkbox";
import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { InlineInput } from "@opencode/ui/inline-input";
import { RadioGroup, RadioItem } from "@opencode/ui/radio";
import { Select } from "@opencode/ui/select";
import { Switch } from "@opencode/ui/switch";
import { Textarea } from "@opencode/ui/textarea";
import { TextInput } from "@opencode/ui/text-input";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { onCleanup } from "solid-js";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { createAnnotatorCard } from "../../src/preload/browser-annotator-card.ts";

const meta = {
  title: "Design System/Focus",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

async function noOutline(element: Element) {
  await waitFor(async () => {
    const style = getComputedStyle(element);
    await expect(style.outlineStyle).toBe("none");
  });
}

export const SharedTreatment: StoryObj = {
  render: () => (
    <div style={{ display: "grid", gap: "12px", width: "min(360px, 100%)", padding: "16px" }}>
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
      <div style={{ overflow: "hidden" }}>
        <Button>Focus edge action</Button>
      </div>
      <TextInput aria-label="Focus invalid field" invalid value="Invalid" />
      <TextInput aria-label="Focus disabled field" disabled />
      <Button disabled>Focus disabled action</Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const filter = canvas.getByRole("textbox", { name: "Focus filter" });
    const frame = filter.closest('[data-component="text-input-v2"]')!;
    const restingEdge = getComputedStyle(frame).boxShadow;
    const slot = (name: string) => {
      const element = canvasElement.querySelector(`[data-slot="${name}"]`);
      if (!element) throw new Error(`Missing focus specimen slot: ${name}`);
      return element;
    };

    await userEvent.click(canvas.getByRole("button", { name: "Start focus tour" }));
    await userEvent.tab();
    const icon = canvas.getByRole("button", { name: "Focus icon" });
    await expect(icon).toHaveFocus();
    await noOutline(icon);
    await userEvent.tab();
    await expect(filter).toHaveFocus();
    await noOutline(frame);
    await waitFor(() => expect(getComputedStyle(frame).boxShadow).toBe(restingEdge));
    await expect(getComputedStyle(filter).outlineStyle).toBe("none");
    await userEvent.tab();
    const clear = canvas.getByRole("button", { name: "Clear focus filter" });
    await expect(clear).toHaveFocus();
    await noOutline(clear);
    await expect(getComputedStyle(frame).outlineStyle).toBe("none");
    await expect(getComputedStyle(frame).boxShadow).toBe(restingEdge);
    await userEvent.tab();
    const notes = canvas.getByRole("textbox", { name: "Focus notes" });
    await expect(notes).toHaveFocus();
    await noOutline(notes.closest('[data-component="textarea-v2"]')!);
    await expect(getComputedStyle(notes).outlineStyle).toBe("none");
    await userEvent.tab();
    const inline = canvas.getByRole("textbox", { name: "Focus inline input" });
    await expect(inline).toHaveFocus();
    await noOutline(inline);
    await expect(getComputedStyle(inline).boxShadow).toBe("none");
    await userEvent.tab();
    const select = canvas.getByRole("button", { name: "Focus select One" });
    await expect(select).toHaveFocus();
    await noOutline(select);
    await userEvent.keyboard("{Enter}{Escape}");
    await waitFor(() => expect(select).toHaveFocus());
    await noOutline(select);
    await userEvent.tab();
    await expect(slot("checkbox-checkbox-input")).toHaveFocus();
    await noOutline(slot("checkbox-checkbox-control"));
    await expect(getComputedStyle(slot("checkbox-checkbox-control")).boxShadow).toBe("none");
    await userEvent.tab();
    await expect(slot("switch-input")).toHaveFocus();
    await noOutline(slot("switch-control"));
    await userEvent.tab();
    await expect(slot("radio-v2-item-input")).toHaveFocus();
    await noOutline(slot("radio-v2-item-control"));
    await userEvent.tab();
    const edge = canvas.getByRole("button", { name: "Focus edge action" });
    await expect(edge).toHaveFocus();
    await noOutline(edge);
    await userEvent.tab();
    const invalid = canvas.getByRole("textbox", { name: "Focus invalid field" });
    const invalidFrame = invalid.closest('[data-component="text-input-v2"]')!;
    await expect(invalid).toHaveFocus();
    await noOutline(invalidFrame);
    // Validation is independent of the removed focus ring.
    await waitFor(async () => {
      const color =
        document.documentElement.dataset.colorScheme === "dark"
          ? "rgb(255, 93, 102)"
          : "rgb(192, 37, 48)";
      await expect(getComputedStyle(invalidFrame).boxShadow).toBe(`${color} 0px 0px 0px 1px inset`);
    });
    await expect(canvas.getByRole("textbox", { name: "Focus disabled field" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Focus disabled action" })).toBeDisabled();

    // Pointer editing also leaves the resting edge unchanged.
    await userEvent.click(filter);
    await expect(filter).toHaveFocus();
    await noOutline(frame);
    await expect(getComputedStyle(frame).boxShadow).toBe(restingEdge);
    await expect(getComputedStyle(filter).outlineStyle).toBe("none");
  },
};

export const SharedTreatmentDark: StoryObj = {
  ...SharedTreatment,
  globals: { theme: "dark" },
};

export const EmbeddedAnnotationCard: StoryObj = {
  render: () => {
    const card = createAnnotatorCard(() => undefined, { shadowRootMode: "open" });
    onCleanup(() => card.close());
    return (
      <div style={{ padding: "16px" }}>
        <Button onClick={() => card.open({ left: 24, top: 100, width: 100, height: 24 })}>
          Open embedded annotation card
        </Button>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Open embedded annotation card" }),
    );
    const host = document.querySelector<HTMLElement>("[data-ocui-annotator][data-open]");
    const root = host?.shadowRoot;
    if (!root) throw new Error("Embedded annotation card did not open");
    const editor = root.querySelector("textarea")!;
    const buttons = [...root.querySelectorAll("button")];
    await expect(root.activeElement).toBe(editor);
    await noOutline(editor);
    await expect(getComputedStyle(editor).borderColor).toBe("rgb(64, 62, 60)");
    await userEvent.type(editor, "No focus outlines");
    for (const button of buttons) {
      // userEvent's synthetic Tab traversal does not enter shadow roots.
      button.focus();
      await expect(root.activeElement).toBe(button);
      await expect(button.matches(":focus-visible")).toBe(true);
      const style = getComputedStyle(button);
      await noOutline(button);
      await expect(style.boxShadow).toBe("none");
    }
    await userEvent.keyboard("{Enter}");
    await expect(host).not.toHaveAttribute("data-open");
  },
};
