import type { FormAnswer, FormInfo } from "@opencode-ai/client";
import { describe, expect, it, vi } from "vite-plus/test";

import { mount as mountView } from "../test/mount.ts";
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
    readonly initialAnswer?: FormAnswer;
    readonly disabled?: boolean;
    readonly submitting?: boolean;
    readonly error?: string;
    readonly onAnswerChange?: (answer: FormAnswer) => void;
    readonly onOpenExternal?: (url: string) => void;
  } = {},
) {
  const onSubmit = vi.fn<(answer: FormAnswer) => void>();
  const onCancel = vi.fn<() => void>();
  const { host, dispose } = mountView(() => (
    <QuestionForm
      form={form}
      initialAnswer={options.initialAnswer}
      disabled={options.disabled}
      submitting={options.submitting}
      error={options.error}
      onSubmit={onSubmit}
      onAnswerChange={options.onAnswerChange}
      onCancel={onCancel}
      onOpenExternal={options.onOpenExternal}
    />
  ));
  return { host, onSubmit, onCancel, dispose };
}

function submit(host: HTMLElement): void {
  host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true }));
}

describe("QuestionForm", () => {
  it("edits and submits a custom answer inline while retaining its radio", async () => {
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
    const current = mounted.host.querySelector<HTMLInputElement>('input[value="option:0"]');
    const custom = mounted.host.querySelector<HTMLInputElement>('input[value="custom"]');

    custom?.click();

    expect(custom?.checked).toBe(true);
    expect(current?.checked).toBe(false);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const input = mounted.host.querySelector<HTMLInputElement>(
      "[data-question-form-custom-input]",
    )!;
    expect(input.closest('[data-slot="radio-v2-item"]')).toBe(custom?.parentElement);
    expect(document.activeElement).toBe(input);
    input.value = "Another workspace";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(custom?.checked).toBe(true);
    submit(mounted.host);
    expect(mounted.onSubmit).toHaveBeenCalledWith({ workspace: "Another workspace" });

    mounted.host.querySelector<HTMLInputElement>('input[value="option:0"]')?.click();
    expect(mounted.host.querySelector<HTMLInputElement>('input[value="custom"]')?.checked).toBe(
      false,
    );
    expect(mounted.host.querySelector("[data-question-form-custom-input]")).toBeNull();
    submit(mounted.host);
    expect(mounted.onSubmit).toHaveBeenLastCalledWith({ workspace: "current" });
    mounted.dispose();
  });

  it("submits a predefined answer even when its server value is the custom sentinel", () => {
    const form = {
      id: "frm_sentinel_option",
      sessionID: "ses_test",
      title: "Choose an answer",
      fields: [
        {
          key: "answer",
          type: "string",
          title: "Answer",
          required: true,
          custom: true,
          options: [
            { value: "custom", label: "Server-defined answer" },
            { value: "other", label: "Other" },
          ],
        },
      ],
    } satisfies FormInfo;
    const mounted = mount(form);

    mounted.host.querySelector<HTMLInputElement>('input[value="option:0"]')?.click();
    submit(mounted.host);

    expect(mounted.onSubmit).toHaveBeenCalledWith({ answer: "custom" });
    expect(mounted.host.querySelector('input[placeholder="Type your answer"]')).toBeNull();
    mounted.dispose();
  });

  it("focuses the visible custom string input when its answer is required", async () => {
    const form = {
      id: "frm_custom_required",
      sessionID: "ses_test",
      title: "Choose an answer",
      fields: [
        {
          key: "answer",
          type: "string",
          title: "Answer",
          required: true,
          custom: true,
          options: [{ value: "predefined", label: "Predefined" }],
        },
      ],
    } satisfies FormInfo;
    const mounted = mount(form);
    mounted.host.querySelector<HTMLInputElement>('input[value="custom"]')?.click();

    submit(mounted.host);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const customInput = mounted.host.querySelector<HTMLInputElement>(
      "[data-question-form-custom-input]",
    );
    expect(customInput).not.toBeNull();
    expect(document.activeElement).toBe(customInput);
    const describedBy = customInput?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe("Enter an answer.");
    mounted.dispose();
  });

  it("associates choice errors with their controls", async () => {
    const form = {
      id: "frm_choice_errors",
      sessionID: "ses_test",
      title: "Choose answers",
      fields: [
        {
          key: "stringChoice",
          type: "string",
          title: "String choice",
          required: true,
          options: [{ value: "one", label: "One" }],
        },
        {
          key: "booleanChoice",
          type: "boolean",
          title: "Boolean choice",
          required: true,
        },
        {
          key: "multipleChoice",
          type: "multiselect",
          title: "Multiple choice",
          required: true,
          options: [{ value: "one", label: "One" }],
        },
      ],
    } satisfies FormInfo;
    const mounted = mount(form);

    submit(mounted.host);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    for (const key of ["stringChoice", "booleanChoice"]) {
      const field = mounted.host.querySelector<HTMLElement>(`[data-form-field-key="${key}"]`);
      const controls = field?.querySelectorAll<HTMLInputElement>(
        '[data-slot="radio-v2-item-input"]',
      );
      const error = field?.querySelector<HTMLElement>(".question-form-field-error");
      expect(error?.id).toBeTruthy();
      expect(
        [...(controls ?? [])].every((control) =>
          control
            .getAttribute("aria-describedby")
            ?.split(/\s+/)
            .includes(error?.id ?? ""),
        ),
      ).toBe(true);
    }

    const multipleField = mounted.host.querySelector<HTMLElement>(
      '[data-form-field-key="multipleChoice"]',
    );
    const multipleError = multipleField?.querySelector<HTMLElement>(".question-form-field-error");
    expect(multipleError?.id).toBeTruthy();
    const multiselect = multipleField?.querySelector("fieldset");
    expect(multiselect?.getAttribute("aria-describedby")?.split(/\s+/)).toContain(
      multipleError?.id,
    );
    expect(multipleError?.getAttribute("role")).toBe("alert");
    mounted.dispose();
  });

  it("submits visible defaults without inactive conditional answers", () => {
    const mounted = mount(conditionalForm);
    expect(mounted.host.textContent).not.toContain("Custom details");
    submit(mounted.host);
    expect(mounted.onSubmit).toHaveBeenCalledWith({ approach: "standard" });
    mounted.dispose();
  });

  it("restores a provided answer snapshot", () => {
    const mounted = mount(conditionalForm, {
      initialAnswer: { approach: "custom", details: "Use the saved approach" },
    });

    expect(mounted.host.querySelector<HTMLInputElement>('input[value="option:1"]')?.checked).toBe(
      true,
    );
    expect(
      mounted.host.querySelector<HTMLInputElement>('[data-form-field-key="details"] input')?.value,
    ).toBe("Use the saved approach");
    submit(mounted.host);
    expect(mounted.onSubmit).toHaveBeenCalledWith({
      approach: "custom",
      details: "Use the saved approach",
    });
    mounted.dispose();
  });

  it("reports answer changes", () => {
    const onAnswerChange = vi.fn<(answer: FormAnswer) => void>();
    const mounted = mount(conditionalForm, { onAnswerChange });

    mounted.host.querySelector<HTMLInputElement>('input[value="option:1"]')?.click();
    expect(onAnswerChange).toHaveBeenLastCalledWith({ approach: "custom" });

    const details = mounted.host.querySelector<HTMLInputElement>(
      '[data-form-field-key="details"] input',
    );
    if (details) {
      details.value = "Saved details";
      details.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    expect(onAnswerChange).toHaveBeenLastCalledWith({
      approach: "custom",
      details: "Saved details",
    });
    mounted.dispose();
  });

  it("preserves an explicitly empty snapshot when a default is cleared and remounted", () => {
    const form = {
      id: "frm_default_snapshot",
      sessionID: "ses_test",
      title: "Enter a value",
      fields: [
        {
          key: "value",
          type: "string",
          title: "Value",
          default: "Default value",
        },
      ],
    } satisfies FormInfo;
    let snapshot: FormAnswer | undefined;
    const first = mount(form, {
      onAnswerChange: (answer) => {
        snapshot = answer;
      },
    });
    const input = first.host.querySelector<HTMLInputElement>("input");
    expect(input?.value).toBe("Default value");
    if (input) {
      input.value = "";
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    expect(snapshot).toEqual({});
    first.dispose();

    const restored = mount(form, { initialAnswer: snapshot });
    expect(restored.host.querySelector<HTMLInputElement>("input")?.value).toBe("");
    submit(restored.host);
    expect(restored.onSubmit).toHaveBeenCalledWith({});
    restored.dispose();
  });

  it("reveals conditional fields, validates them, and focuses the first missing answer", async () => {
    const mounted = mount(conditionalForm);
    mounted.host.querySelector<HTMLInputElement>('input[value="option:1"]')?.click();
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
    mounted.host.querySelector<HTMLInputElement>('input[value="option:1"]')?.click();
    const input = mounted.host.querySelector('[data-component="text-input-v2"]');
    expect(input?.getAttribute("data-appearance")).toBe("large");
    mounted.dispose();
  });

  it("identifies required controls and gives external actions a specific name", () => {
    const onOpenExternal = vi.fn<(url: string) => void>();
    const form = {
      id: "frm_accessible_fields",
      sessionID: "ses_test",
      title: "Complete setup",
      fields: [
        { key: "name", type: "string", title: "Display name", required: true },
        {
          key: "choice",
          type: "string",
          title: "Approach",
          required: true,
          options: [{ value: "one", label: "One" }],
        },
        {
          key: "features",
          type: "multiselect",
          title: "Features",
          required: true,
          options: [{ value: "one", label: "One" }],
        },
        {
          key: "docs",
          type: "external",
          title: "Setup documentation",
          url: "https://example.com/setup",
        },
      ],
    } satisfies FormInfo;
    const mounted = mount(form, { onOpenExternal });

    expect(
      mounted.host.querySelector<HTMLInputElement>('[data-form-field-key="name"] input')?.required,
    ).toBe(true);
    expect(mounted.host.querySelector('[data-form-field-key="name"]')?.textContent).toContain(
      "Display name (required)",
    );
    expect(
      mounted.host.querySelector<HTMLInputElement>(
        '[data-form-field-key="choice"] [data-slot="radio-v2-item-input"]',
      )?.required,
    ).toBe(true);
    expect(mounted.host.querySelector('[data-form-field-key="features"] legend')?.textContent).toBe(
      "Features (required)",
    );
    const open = mounted.host.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Setup documentation"]',
    );
    open?.click();
    expect(onOpenExternal).toHaveBeenCalledWith("https://example.com/setup");
    mounted.dispose();
  });
});
