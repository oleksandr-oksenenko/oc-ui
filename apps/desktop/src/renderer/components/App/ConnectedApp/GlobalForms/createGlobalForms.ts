import type { FormAnswer, FormInfo, LocationRef } from "@opencode-ai/client";
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

import type { ConnectedRuntime } from "../../../../opencode/runtime.ts";
import { answerableFormDraft, initializeFormDraft, type FormDraft } from "./form.ts";

export type GlobalForm = FormInfo & { readonly location?: LocationRef };
export type GlobalForms = ReturnType<typeof createGlobalForms>;

export type CreateGlobalFormsInput = {
  readonly runtime: ConnectedRuntime;
  readonly connected: Accessor<boolean>;
};

export function createGlobalForms(input: CreateGlobalFormsInput) {
  const location = input.runtime.defaultLocation;
  const [syncState, setSyncState] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [syncError, setSyncError] = createSignal<string>();
  const [draftVersion, setDraftVersion] = createSignal(0);
  const [actionVersion, setActionVersion] = createSignal(0);
  const drafts = new Map<string, FormDraft>();
  const actionErrors = new Map<string, string>();
  const actions = new Set<string>();
  let syncGeneration = 0;
  let connectedOnce = false;
  let alive = true;

  onCleanup(() => {
    alive = false;
    syncGeneration += 1;
  });

  const forms = createMemo<readonly GlobalForm[]>(() =>
    input.runtime.data.session.form.list("global", location) ?? [],
  );

  const draft = (form: GlobalForm): FormDraft => {
    draftVersion();
    let value = drafts.get(form.id);
    if (!value) {
      value = initializeFormDraft(form);
      drafts.set(form.id, value);
    }
    return value;
  };
  const setDraftValue = (formID: string, key: string, value: FormDraft[string]) => {
    const current = drafts.get(formID);
    if (!current) return;
    current[key] = value;
    setDraftVersion((version) => version + 1);
  };
  const actionError = (formID: string) => {
    actionVersion();
    return actionErrors.get(formID);
  };
  const actionPending = (formID: string) => {
    actionVersion();
    return actions.has(formID);
  };

  const sync = async (): Promise<void> => {
    const generation = ++syncGeneration;
    setSyncState("loading");
    setSyncError(undefined);
    try {
      await input.runtime.data.session.form.sync("global", location);
      if (!alive || generation !== syncGeneration) return;
      setSyncState("ready");
    } catch (cause) {
      if (!alive || generation !== syncGeneration) return;
      setSyncState("error");
      setSyncError(cause instanceof Error ? cause.message : "Could not load server requests.");
    }
  };

  createEffect(() => {
    if (!input.connected() || connectedOnce) return;
    connectedOnce = true;
    void sync();
  });

  const settle = async (form: GlobalForm, operation: "reply" | "cancel", answer?: FormAnswer) => {
    if (actions.has(form.id)) return false;
    actions.add(form.id);
    actionErrors.delete(form.id);
    setActionVersion((version) => version + 1);
    try {
      if (operation === "reply") {
        await input.runtime.data.session.form.reply(
          { sessionID: "global", formID: form.id, answer: answer ?? answerableFormDraft(form, draft(form)) },
          location,
        );
      } else {
        await input.runtime.data.session.form.cancel({ sessionID: "global", formID: form.id }, location);
      }
      return true;
    } catch (cause) {
      actionErrors.set(form.id, cause instanceof Error ? cause.message : "The server request could not be completed.");
      return false;
    } finally {
      actions.delete(form.id);
      setActionVersion((version) => version + 1);
    }
  };

  return {
    location,
    forms,
    sync,
    syncState,
    syncError,
    draft,
    setDraftValue,
    actionError,
    actionPending,
    reply: (form: GlobalForm, answer?: FormAnswer) => settle(form, "reply", answer),
    cancel: (form: GlobalForm) => settle(form, "cancel"),
  };
}
