import type { FormAnswer, FormField, FormInfo, FormValue } from "@opencode-ai/client";

export type FormDraft = Record<string, FormValue | undefined>;
export type FormFieldError = { readonly key: string; readonly message: string };
export type FormValidation = {
  readonly errors: readonly FormFieldError[];
  readonly configurationError?: string;
};

function scalarEquals(answer: FormValue | undefined, expected: FormValue): boolean {
  if (answer === undefined) return false;
  if (Array.isArray(answer)) return false;
  return answer === expected;
}

/** A field is active only when every server condition is satisfied. */
export function isFieldVisible(field: FormField, draft: FormDraft): boolean {
  return (field.when ?? []).every((condition) => {
    const answer = draft[condition.key];
    if (answer === undefined) return false;
    if (Array.isArray(answer)) {
      return condition.op === "eq"
        ? answer.includes(String(condition.value))
        : !answer.includes(String(condition.value));
    }
    return condition.op === "eq"
      ? scalarEquals(answer, condition.value as FormValue)
      : !scalarEquals(answer, condition.value as FormValue);
  });
}

export function initializeFormDraft(form: FormInfo): FormDraft {
  const draft: FormDraft = {};
  for (const field of form.fields) {
    if (field.type === "external") continue;
    if (field.default !== undefined) draft[field.key] = field.default;
    else if (field.type === "multiselect") draft[field.key] = [];
    else if (field.type === "boolean") draft[field.key] = false;
    else draft[field.key] = "";
  }
  return draft;
}

function formatValid(value: string, format: NonNullable<Extract<FormField, { type: "string" }>["format"]>): boolean {
  if (format === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (format === "uri") {
    try {
      return Boolean(new URL(value));
    } catch {
      return false;
    }
  }
  if (format === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateForm(form: FormInfo, draft: FormDraft): FormValidation {
  const errors: FormFieldError[] = [];
  let configurationError: string | undefined;
  for (const field of form.fields) {
    if (field.type === "external" || !isFieldVisible(field, draft)) continue;
    const value = draft[field.key];
    const label = field.title || field.key;
    if (field.required && (value === undefined || value === "" || (Array.isArray(value) && value.length === 0))) {
      errors.push({ key: field.key, message: `${label} is required.` });
      continue;
    }
    if (value === undefined || value === "") continue;
    if (field.type === "string" && typeof value === "string") {
      if (field.minLength !== undefined && value.length < field.minLength) errors.push({ key: field.key, message: `${label} must be at least ${field.minLength} characters.` });
      if (field.maxLength !== undefined && value.length > field.maxLength) errors.push({ key: field.key, message: `${label} must be at most ${field.maxLength} characters.` });
      if (field.format && !formatValid(value, field.format)) errors.push({ key: field.key, message: `${label} has an invalid format.` });
      if (field.pattern !== undefined) {
        try {
          if (!new RegExp(field.pattern).test(value)) errors.push({ key: field.key, message: `${label} has an invalid value.` });
        } catch {
          configurationError ??= `The server supplied an invalid pattern for ${label}.`;
        }
      }
    }
    if ((field.type === "number" || field.type === "integer") && typeof value === "number") {
      if (!Number.isFinite(value)) errors.push({ key: field.key, message: `${label} must be a number.` });
      if (field.type === "integer" && !Number.isInteger(value)) errors.push({ key: field.key, message: `${label} must be a whole number.` });
      if (field.minimum !== undefined && value < Number(field.minimum)) errors.push({ key: field.key, message: `${label} is too small.` });
      if (field.maximum !== undefined && value > Number(field.maximum)) errors.push({ key: field.key, message: `${label} is too large.` });
    }
    if (field.type === "multiselect" && Array.isArray(value)) {
      if (field.minItems !== undefined && value.length < field.minItems) errors.push({ key: field.key, message: `Select at least ${field.minItems} options for ${label}.` });
      if (field.maxItems !== undefined && value.length > field.maxItems) errors.push({ key: field.key, message: `Select at most ${field.maxItems} options for ${label}.` });
    }
  }
  return { errors, configurationError };
}

/** Return only visible, answerable values accepted by the upstream API. */
export function answerableFormDraft(form: FormInfo, draft: FormDraft): FormAnswer {
  const answer: FormAnswer = {};
  for (const field of form.fields) {
    if (field.type === "external" || !isFieldVisible(field, draft)) continue;
    const value = draft[field.key];
    if (value !== undefined) answer[field.key] = value;
  }
  return answer;
}
