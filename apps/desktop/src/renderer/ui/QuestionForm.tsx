import {
  Item as RadioChoice,
  ItemInput,
  ItemControl,
  ItemIndicator,
  ItemLabel,
} from "@kobalte/core/radio-group";
import { Textarea } from "@opencode/ui/textarea";
import type { FormAnswer, FormField, FormInfo, FormValue } from "@opencode/client";
import { Button } from "@opencode/ui/button";
import { Card } from "@opencode/ui/card";
import { Checkbox } from "@opencode/ui/checkbox";
import { Field } from "@opencode/ui/field";
import { Icon } from "@opencode/ui/icon";
import { IconButton } from "@opencode/ui/icon-button";
import { Loader } from "@opencode/ui/loader";
import { RadioGroup, RadioItem } from "@opencode/ui/radio";
import { TextInput } from "@opencode/ui/text-input";
import { For, Show, createEffect, createMemo, createSignal, createUniqueId, on } from "solid-js";

import "./QuestionForm.css";

const CUSTOM_TOKEN = "custom";

function optionToken(index: number): string {
  return `option:${index}`;
}

/** Error ids are namespaced by the mounted instance, not the possibly shared form id. */
function fieldErrorID(instanceID: string, field: FormField): string {
  return `question-form-field-error-${instanceID}-${field.key}`;
}

type StringField = Extract<FormField, { readonly type: "string" }>;
type NumberField = Extract<FormField, { readonly type: "number" | "integer" }>;
type MultiselectField = Extract<FormField, { readonly type: "multiselect" }>;
type ExternalField = Extract<FormField, { readonly type: "external" }>;

/** Shared renderer for session-scoped and global forms. */
export type QuestionFormProps = {
  readonly form: FormInfo;
  readonly initialAnswer?: FormAnswer;
  readonly disabled?: boolean;
  readonly submitting?: boolean;
  readonly error?: string;
  readonly onSubmit: (answer: FormAnswer) => void;
  readonly onAnswerChange?: (answer: FormAnswer) => void;
  readonly onCancel?: () => void;
  readonly onOpenExternal?: (url: string) => void;
};

function fieldTitle(field: FormField): string {
  return field.title ?? field.key;
}

function fieldLabel(field: FormField): string {
  const title = fieldTitle(field);
  return "required" in field && field.required ? `${title} (required)` : title;
}

function initialAnswer(fields: FormInfo["fields"]): FormAnswer {
  const answer: FormAnswer = {};
  for (const field of fields) {
    if (field.type === "external" || field.default === undefined) continue;
    if (field.type === "number" || field.type === "integer") {
      const defaultValue = Number(field.default);
      if (Number.isFinite(defaultValue)) answer[field.key] = defaultValue;
      continue;
    }
    answer[field.key] = Array.isArray(field.default) ? [...field.default] : field.default;
  }
  return answer;
}

function answerForForm(fields: FormInfo["fields"], answer: FormAnswer | undefined): FormAnswer {
  if (answer === undefined) return initialAnswer(fields);
  return Object.fromEntries(
    Object.entries(answer).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  );
}

function conditionMatches(field: FormField, answer: FormAnswer): boolean {
  if (field.type === "external" || !field.when) return true;
  return field.when.every((condition) => {
    const current = answer[condition.key];
    if (current === undefined) return false;
    const equal = Array.isArray(current)
      ? current.some((selectedValue) => selectedValue === condition.value)
      : current === condition.value;
    return condition.op === "eq" ? equal : !equal;
  });
}

function answerText(value: FormValue | undefined): string {
  return value === undefined || Array.isArray(value) ? "" : String(value);
}

function stringError(field: StringField, value: FormValue | undefined): string | undefined {
  const text = answerText(value);
  if (field.required && text.length === 0) return "Enter an answer.";
  if (text.length === 0) return undefined;
  if (field.minLength !== undefined && text.length < field.minLength) {
    return `Use at least ${field.minLength} characters.`;
  }
  if (field.maxLength !== undefined && text.length > field.maxLength) {
    return `Use no more than ${field.maxLength} characters.`;
  }
  if (field.options && !field.custom && !field.options.some((option) => option.value === text)) {
    return "Choose one of the available answers.";
  }

  const input = document.createElement("input");
  input.value = text;
  input.type = inputType(field);
  if (field.pattern) input.pattern = field.pattern;
  return input.checkValidity() ? undefined : "Enter a valid value.";
}

function numberError(field: NumberField, value: FormValue | undefined): string | undefined {
  if (value === undefined) return field.required ? "Enter a number." : undefined;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "Enter a valid number.";
  if (field.type === "integer" && !Number.isInteger(numericValue)) return "Enter a whole number.";
  if (field.minimum !== undefined && numericValue < Number(field.minimum)) {
    return `Use ${field.minimum} or more.`;
  }
  if (field.maximum !== undefined && numericValue > Number(field.maximum)) {
    return `Use ${field.maximum} or less.`;
  }
  return undefined;
}

function multiselectError(field: MultiselectField, value: FormValue | undefined) {
  const selected = Array.isArray(value) ? value : [];
  if (field.required && selected.length === 0) return "Choose at least one answer.";
  if (field.minItems !== undefined && selected.length < field.minItems) {
    return `Choose at least ${field.minItems}.`;
  }
  if (field.maxItems !== undefined && selected.length > field.maxItems) {
    return `Choose no more than ${field.maxItems}.`;
  }
  if (
    !field.custom &&
    selected.some(
      (selectedValue) => !field.options.some((option) => option.value === selectedValue),
    )
  ) {
    return "Choose only available answers.";
  }
  return undefined;
}

function fieldError(field: FormField, value: FormValue | undefined): string | undefined {
  if (field.type === "string") return stringError(field, value);
  if (field.type === "number" || field.type === "integer") return numberError(field, value);
  if (field.type === "boolean") {
    return field.required && value !== true && value !== false ? "Choose yes or no." : undefined;
  }
  if (field.type === "multiselect") return multiselectError(field, value);
  return undefined;
}

function inputType(field: StringField): "text" | "email" | "url" | "date" | "datetime-local" {
  if (field.format === "email") return "email";
  if (field.format === "uri") return "url";
  if (field.format === "date") return "date";
  if (field.format === "date-time") return "datetime-local";
  return "text";
}

function radioLabel(label: string) {
  return (
    <>
      <Icon class="question-form-radio-check" name="check-small" />
      <span>{label}</span>
    </>
  );
}

export function QuestionForm(props: QuestionFormProps) {
  const instanceID = createUniqueId();
  const titleID = `question-form-title-${instanceID}`;
  const [answer, setAnswerState] = createSignal<FormAnswer>(
    answerForForm(props.form.fields, props.initialAnswer),
  );
  const [customDraft, setCustomDraft] = createSignal(new Map<string, string>());
  const [customStringFields, setCustomStringFields] = createSignal(new Set<string>());
  const [submitted, setSubmitted] = createSignal(false);
  const fieldRoots = new Map<string, HTMLElement>();
  const unavailable = () => props.disabled === true || props.submitting === true;
  const formIdentity = createMemo(() => `${props.form.sessionID}\u0000${props.form.id}`);

  createEffect(
    on(formIdentity, () => {
      setAnswerState(answerForForm(props.form.fields, props.initialAnswer));
      setCustomDraft(new Map());
      setCustomStringFields(new Set<string>());
      setSubmitted(false);
    }),
  );

  const visibleFields = createMemo(() =>
    props.form.fields.filter((field) => conditionMatches(field, answer())),
  );

  const setAnswer = (key: string, value: FormValue | undefined): void => {
    setAnswerState((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else next[key] = value;
      props.onAnswerChange?.(next);
      return next;
    });
  };

  const setDraft = (key: string, value: string): void => {
    setCustomDraft((current) => {
      const next = new Map(current);
      next.set(key, value);
      return next;
    });
  };

  const setCustomStringField = (key: string, selected: boolean): void => {
    setCustomStringFields((current) => {
      const next = new Set(current);
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const renderString = (field: StringField, error: string | undefined) => {
    const options = field.options;
    if (!options || options.length === 0) {
      return (
        <Field invalid={error !== undefined}>
          <Field.Label tooltip={field.description}>{fieldLabel(field)}</Field.Label>
          <Field.Control>
            <TextInput
              class="question-form-input"
              appearance="large"
              type={inputType(field)}
              value={answerText(answer()[field.key])}
              placeholder={field.placeholder}
              disabled={unavailable()}
              invalid={error !== undefined}
              required={field.required}
              minLength={field.minLength}
              maxLength={field.maxLength}
              pattern={field.pattern}
              onInput={(event) => setAnswer(field.key, event.currentTarget.value || undefined)}
            />
          </Field.Control>
          <Show when={error}>{(message) => <Field.Suffix>{message()}</Field.Suffix>}</Show>
        </Field>
      );
    }

    const errorID = fieldErrorID(instanceID, field);
    const selected = () => {
      if (customStringFields().has(field.key)) return CUSTOM_TOKEN;
      const text = answerText(answer()[field.key]);
      if (text.length === 0) return undefined;
      const optionIndex = options.findIndex((option) => option.value === text);
      return optionIndex === -1 ? CUSTOM_TOKEN : optionToken(optionIndex);
    };
    return (
      <div class="question-form-choice-group" data-invalid={error ? "" : undefined}>
        <RadioGroup
          label={fieldLabel(field)}
          description={field.description}
          value={selected()}
          disabled={unavailable()}
          required={field.required}
          aria-describedby={error ? errorID : undefined}
          validationState={error ? "invalid" : "valid"}
          onChange={(value) => {
            if (value === CUSTOM_TOKEN) {
              setCustomStringField(field.key, true);
              const existing = answer()[field.key];
              setAnswer(
                field.key,
                existing !== undefined &&
                  !Array.isArray(existing) &&
                  !options.some((option) => option.value === String(existing))
                  ? String(existing)
                  : undefined,
              );
              queueMicrotask(() =>
                fieldRoots
                  .get(field.key)
                  ?.querySelector<HTMLTextAreaElement>("[data-question-form-custom-input]")
                  ?.focus(),
              );
              return;
            }
            const optionIndex = options.findIndex((_, index) => optionToken(index) === value);
            const option = options[optionIndex];
            if (option === undefined) return;
            setCustomStringField(field.key, false);
            setAnswer(field.key, option.value);
          }}
        >
          <For each={options}>
            {(option, index) => (
              <RadioItem
                value={optionToken(index())}
                label={radioLabel(option.label)}
                description={option.description}
              />
            )}
          </For>
          <Show when={field.custom}>
            <RadioChoice
              value={CUSTOM_TOKEN}
              data-slot="radio-v2-item"
              class="question-form-custom-choice"
            >
              <ItemInput data-slot="radio-v2-item-input" aria-label="Custom answer" />
              <div data-slot="radio-v2-item-control-stack">
                <ItemControl data-slot="radio-v2-item-control">
                  <ItemIndicator data-slot="radio-v2-item-indicator" />
                </ItemControl>
              </div>
              <Icon class="question-form-radio-check" name="check-small" />
              <Show
                when={selected() === CUSTOM_TOKEN}
                fallback={<ItemLabel data-slot="radio-v2-item-label">Custom answer</ItemLabel>}
              >
                <Textarea
                  rows={1}
                  class="question-form-custom-answer"
                  aria-label="Custom answer"
                  aria-describedby={error ? errorID : undefined}
                  aria-invalid={error !== undefined}
                  value={answerText(answer()[field.key])}
                  placeholder={field.placeholder ?? "Type your answer"}
                  data-question-form-custom-input
                  disabled={unavailable()}
                  invalid={error !== undefined}
                  onInput={(event) => setAnswer(field.key, event.currentTarget.value || undefined)}
                />
              </Show>
            </RadioChoice>
          </Show>
        </RadioGroup>
        <Show when={error}>
          {(message) => (
            <p id={errorID} class="question-form-field-error">
              {message()}
            </p>
          )}
        </Show>
      </div>
    );
  };

  const renderNumber = (field: NumberField, error: string | undefined) => (
    <Field invalid={error !== undefined}>
      <Field.Label tooltip={field.description}>{fieldLabel(field)}</Field.Label>
      <Field.Control>
        <TextInput
          class="question-form-input"
          appearance="large"
          type="number"
          value={answerText(answer()[field.key])}
          disabled={unavailable()}
          invalid={error !== undefined}
          required={field.required}
          min={field.minimum === undefined ? undefined : Number(field.minimum)}
          max={field.maximum === undefined ? undefined : Number(field.maximum)}
          step={field.type === "integer" ? 1 : "any"}
          numeric
          onInput={(event) => {
            const value = event.currentTarget.value;
            setAnswer(field.key, value.length === 0 ? undefined : Number(value));
          }}
        />
      </Field.Control>
      <Show when={error}>{(message) => <Field.Suffix>{message()}</Field.Suffix>}</Show>
    </Field>
  );

  const renderBoolean = (
    field: Extract<FormField, { readonly type: "boolean" }>,
    error: string | undefined,
  ) => (
    <div class="question-form-choice-group" data-invalid={error ? "" : undefined}>
      <RadioGroup
        label={fieldLabel(field)}
        description={field.description}
        value={
          answer()[field.key] === true
            ? "true"
            : answer()[field.key] === false
              ? "false"
              : undefined
        }
        disabled={unavailable()}
        required={field.required}
        aria-describedby={error ? fieldErrorID(instanceID, field) : undefined}
        validationState={error ? "invalid" : "valid"}
        onChange={(value) => setAnswer(field.key, value === "true")}
      >
        <RadioItem value="true" label={radioLabel("Yes")} />
        <RadioItem value="false" label={radioLabel("No")} />
      </RadioGroup>
      <Show when={error}>
        {(message) => (
          <p id={fieldErrorID(instanceID, field)} class="question-form-field-error">
            {message()}
          </p>
        )}
      </Show>
    </div>
  );

  const renderMultiselect = (field: MultiselectField, error: string | undefined) => {
    const selected = () => {
      const value = answer()[field.key];
      return Array.isArray(value) ? value : [];
    };
    const customValues = () =>
      selected().filter((value) => !field.options.some((option) => option.value === value));
    const toggle = (value: string, checked: boolean): void => {
      const current = selected();
      setAnswer(
        field.key,
        checked ? [...current, value] : current.filter((item) => item !== value),
      );
    };
    const addCustom = (): void => {
      const value = customDraft().get(field.key)?.trim();
      if (!value || selected().includes(value)) return;
      if (field.maxItems !== undefined && selected().length >= field.maxItems) return;
      setAnswer(field.key, [...selected(), value]);
      setDraft(field.key, "");
    };
    return (
      <fieldset
        class="question-form-multiselect"
        data-invalid={error ? "" : undefined}
        aria-describedby={error ? fieldErrorID(instanceID, field) : undefined}
      >
        <legend>{fieldLabel(field)}</legend>
        <Show when={field.description}>
          {(description) => <p class="question-form-description">{description()}</p>}
        </Show>
        <div class="question-form-options">
          <For each={field.options}>
            {(option) => (
              <Checkbox
                checked={selected().includes(option.value)}
                disabled={unavailable()}
                description={option.description}
                onChange={(checked) => toggle(option.value, checked)}
              >
                {option.label}
              </Checkbox>
            )}
          </For>
        </div>
        <Show when={field.custom}>
          <div class="question-form-custom-values">
            <For each={customValues()}>
              {(value) => (
                <span class="question-form-custom-value">
                  <span>{value}</span>
                  <IconButton
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    aria-label={`Remove ${value}`}
                    icon={<Icon name="xmark-small" />}
                    disabled={unavailable()}
                    onClick={() => toggle(value, false)}
                  />
                </span>
              )}
            </For>
            <Field>
              <Field.Label>Add another answer</Field.Label>
              <Field.Control>
                <div class="question-form-custom-input">
                  <TextInput
                    class="question-form-input"
                    appearance="large"
                    value={customDraft().get(field.key) ?? ""}
                    disabled={unavailable()}
                    placeholder="Type an answer"
                    onInput={(event) => setDraft(field.key, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.isComposing) return;
                      event.preventDefault();
                      addCustom();
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={unavailable() || !customDraft().get(field.key)?.trim()}
                    onClick={addCustom}
                  >
                    Add
                  </Button>
                </div>
              </Field.Control>
            </Field>
          </div>
        </Show>
        <Show when={error}>
          {(message) => (
            <p id={fieldErrorID(instanceID, field)} class="question-form-field-error" role="alert">
              {message()}
            </p>
          )}
        </Show>
      </fieldset>
    );
  };

  const renderExternal = (field: ExternalField) => (
    <div class="question-form-external">
      <div>
        <strong>{fieldTitle(field)}</strong>
        <Show when={field.description}>
          {(description) => <p class="question-form-description">{description()}</p>}
        </Show>
      </div>
      <Button
        type="button"
        variant="outline"
        icon="square-arrow-top-right"
        aria-label={`Open ${fieldTitle(field)}`}
        disabled={unavailable() || !props.onOpenExternal}
        onClick={() => props.onOpenExternal?.(field.url)}
      >
        Open
      </Button>
    </div>
  );

  const renderField = (field: FormField) => {
    const error = submitted() ? fieldError(field, answer()[field.key]) : undefined;
    if (field.type === "string") return renderString(field, error);
    if (field.type === "number" || field.type === "integer") return renderNumber(field, error);
    if (field.type === "boolean") return renderBoolean(field, error);
    if (field.type === "multiselect") return renderMultiselect(field, error);
    return renderExternal(field);
  };

  const handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (unavailable()) return;
    setSubmitted(true);
    const invalid = visibleFields().find((field) => fieldError(field, answer()[field.key]));
    if (invalid) {
      queueMicrotask(() => {
        const root = fieldRoots.get(invalid.key);
        const target =
          root?.querySelector<HTMLElement>("[data-question-form-custom-input]") ??
          root?.querySelector<HTMLElement>("input, textarea, button");
        target?.focus();
      });
      return;
    }

    const visibleAnswer: FormAnswer = {};
    for (const field of visibleFields()) {
      if (field.type === "external") continue;
      const value = answer()[field.key];
      if (value !== undefined) visibleAnswer[field.key] = value;
    }
    props.onSubmit(visibleAnswer);
  };

  return (
    <Card class="question-form-card">
      <form
        class="question-form"
        aria-labelledby={titleID}
        aria-busy={props.submitting}
        onSubmit={handleSubmit}
        noValidate
      >
        <header class="question-form-header">
          <span class="question-form-eyebrow">Needs your input</span>
          <h2 id={titleID}>{props.form.title}</h2>
        </header>

        <div class="question-form-fields">
          <For each={visibleFields()}>
            {(field) => (
              <div
                class="question-form-field"
                data-form-field-key={field.key}
                ref={(element) => fieldRoots.set(field.key, element)}
              >
                {renderField(field)}
              </div>
            )}
          </For>
        </div>

        <Show when={props.error}>
          {(message) => (
            <p class="question-form-error" role="alert">
              {message()}
            </p>
          )}
        </Show>

        <Show when={props.submitting}>
          <output class="question-form-status" aria-live="polite">
            <Loader /> Sending your answer…
          </output>
        </Show>

        <footer class="question-form-actions">
          <Show when={props.onCancel}>
            <Button
              type="button"
              size="small"
              variant="ghost-muted"
              disabled={unavailable()}
              onClick={() => props.onCancel?.()}
            >
              Cancel
            </Button>
          </Show>
          <Button
            class="question-form-submit"
            type="submit"
            size="small"
            variant="contrast"
            disabled={unavailable()}
          >
            {props.submitting ? "Submitting…" : "Continue"}
          </Button>
        </footer>
      </form>
    </Card>
  );
}
