import type { FormAnswer, FormInfo } from "@opencode-ai/client";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

import { QuestionForm } from "./QuestionForm.tsx";

const conditionalForm = {
  id: "frm_conditional",
  sessionID: "ses_test",
  title: "Choose an approach",
  fields: [
    {
      key: "approach",
      type: "string",
      title: "Approach",
      required: true,
      default: "standard",
      options: [
        { value: "standard", label: "Standard" },
        { value: "custom", label: "Custom" },
      ],
    },
    {
      key: "details",
      type: "string",
      title: "Custom details",
      required: true,
      when: [{ key: "approach", op: "eq", value: "custom" }],
    },
  ],
} satisfies FormInfo;

function mount(
  form: FormInfo,
  options: {
    readonly disabled?: boolean;
    readonly submitting?: boolean;
    readonly error?: string;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  const onSubmit = vi.fn<(answer: FormAnswer) => void>();
  const onCancel = vi.fn<() => void>();
  const dispose = render(
    () => (
      <QuestionForm
        form={form}
        disabled={options.disabled}
        submitting={options.submitting}
        error={options.error}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    ),
    host,
  );
  return { host, onSubmit, onCancel, dispose: () => (dispose(), host.remove()) };
}

function submit(host: HTMLElement): void {
  host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
}

describe("QuestionForm", () => {
  it("keeps the custom string option selected before an answer is typed", () => {
    const form = {
      id: "frm_custom_string",
      sessionID: "ses_test",
      title: "Choose a workspace",
      fields: [
        {
          key: "workspace",
          type: "string",
          title: "Workspace",
          required: true,
          custom: true,
          options: [
            { value: "current", label: "Current worktree" },
            { value: "new", label: "New worktree" },
          ],
        },
      ],
    } satisfies FormInfo;
    const mounted = mount(form);
    const current = mounted.host.querySelector<HTMLInputElement>('input[value="current"]');
    const custom = mounted.host.querySelector<HTMLInputElement>(
      'input[value="__oc_ui_custom_answer__"]',
    );

    custom?.click();

    expect(custom?.checked).toBe(true);
    expect(current?.checked).toBe(false);
    expect(mounted.host.querySelector('input[placeholder="Type your answer"]')).not.toBeNull();
    mounted.dispose();
  });

  it("submits visible defaults without inactive conditional answers", () => {
    const mounted = mount(conditionalForm);
    expect(mounted.host.textContent).not.toContain("Custom details");
    submit(mounted.host);
    expect(mounted.onSubmit).toHaveBeenCalledWith({ approach: "standard" });
    mounted.dispose();
  });

  it("reveals conditional fields, validates them, and focuses the first missing answer", async () => {
    const mounted = mount(conditionalForm);
    mounted.host.querySelector<HTMLInputElement>('input[value="custom"]')?.click();
    expect(mounted.host.textContent).toContain("Custom details");

    submit(mounted.host);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const details = mounted.host.querySelector<HTMLInputElement>(
      '[data-form-field-key="details"] input',
    );
    expect(mounted.onSubmit).not.toHaveBeenCalled();
    expect(mounted.host.textContent).toContain("Enter an answer.");
    expect(document.activeElement).toBe(details);

    if (details) {
      details.value = "Use the repository-specific path";
      details.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    submit(mounted.host);
    expect(mounted.onSubmit).toHaveBeenCalledWith({
      approach: "custom",
      details: "Use the repository-specific path",
    });
    mounted.dispose();
  });

  it("collects predefined and custom multiselect answers", () => {
    const form = {
      id: "frm_multi",
      sessionID: "ses_test",
      title: "Choose reviews",
      fields: [
        {
          key: "reviews",
          type: "multiselect",
          title: "Reviews",
          required: true,
          custom: true,
          default: ["visual"],
          options: [
            { value: "visual", label: "Visual" },
            { value: "accessibility", label: "Accessibility" },
          ],
        },
      ],
    } satisfies FormInfo;
    const mounted = mount(form);
    const custom = mounted.host.querySelector<HTMLInputElement>(
      'input[placeholder="Type an answer"]',
    );
    if (custom) {
      custom.value = "Runtime";
      custom.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    [...mounted.host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Add")
      ?.click();
    submit(mounted.host);
    expect(mounted.onSubmit).toHaveBeenCalledWith({ reviews: ["visual", "Runtime"] });
    mounted.dispose();
  });

  it("locks every action and announces progress while submitting", () => {
    const mounted = mount(conditionalForm, { submitting: true });
    expect(mounted.host.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    expect(mounted.host.querySelector("output")?.textContent).toContain("Sending your answer");
    expect(
      [
        ...mounted.host.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button"),
      ].every((element) => element.disabled),
    ).toBe(true);
    submit(mounted.host);
    expect(mounted.onSubmit).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("exposes submission errors as alerts", () => {
    const mounted = mount(conditionalForm, { error: "The answer was rejected." });
    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toBe(
      "The answer was rejected.",
    );
    mounted.dispose();
  });

  it("uses the large OpenCode input appearance", () => {
    const mounted = mount(conditionalForm);
    mounted.host.querySelector<HTMLInputElement>('input[value="custom"]')?.click();
    const input = mounted.host.querySelector('[data-component="text-input-v2"]');
    expect(input?.getAttribute("data-appearance")).toBe("large");
    mounted.dispose();
  });
});
