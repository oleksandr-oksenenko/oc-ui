import type { WorkspaceOwner } from "../../../../workspace-owner.ts";
import type { FormAnswer, LocationRef } from "@opencode/client";
import { locationKey, type Data, type FormWithLocation } from "@opencode/client/solid";
import { createMemo, onCleanup, type Accessor } from "solid-js";

import { createFormController } from "../Forms/createFormController.ts";

const GLOBAL_SESSION_ID = "global" as const;
const LOAD_ERROR = "Could not load global forms.";
const ACTION_ERROR = "Could not complete the form action.";

const errorMessage = (kind: "sync" | "reply" | "cancel", cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  return kind === "sync" ? LOAD_ERROR : ACTION_ERROR;
};

type GlobalFormsData = {
  readonly on: Data["on"];
  readonly session: Pick<Data["session"], "form">;
};

export type GlobalFormsController = {
  readonly location: LocationRef;
  readonly forms: Accessor<readonly FormWithLocation[]>;
  readonly loading: Accessor<boolean>;
  readonly loadError: Accessor<string | undefined>;
  readonly connected: Accessor<boolean>;
  readonly pending: Accessor<boolean>;
  readonly submitting: (formID: string) => boolean;
  readonly errorFor: (formID: string) => string | undefined;
  readonly refresh: () => Promise<void>;
  readonly reply: (formID: string, answer: FormAnswer) => Promise<boolean>;
  readonly cancel: (formID: string) => Promise<boolean>;
};

export type CreateGlobalFormsInput = {
  readonly effects: WorkspaceOwner;
  readonly runtime: {
    readonly data: GlobalFormsData;
  };
  readonly connected: Accessor<boolean>;
  readonly location: LocationRef;
};

export function createGlobalForms(input: CreateGlobalFormsInput): GlobalFormsController {
  const controller = createFormController({
    effects: input.effects,
    connected: input.connected,
    sessionID: () => GLOBAL_SESSION_ID,
    location: input.location,
    form: input.runtime.data.session.form,
    errorMessage,
  });

  const stopCreated = input.runtime.data.on("form.created", (event) => {
    if (event.data.form.sessionID !== GLOBAL_SESSION_ID) return;
    if (event.location && locationKey(event.location) !== locationKey(input.location)) return;
    input.runtime.data.session.form.invalidate(GLOBAL_SESSION_ID, input.location);
    controller.startSync();
  });

  onCleanup(stopCreated);

  return {
    location: input.location,
    forms: controller.forms,
    loading: createMemo(() => controller.state() === "loading"),
    loadError: controller.error,
    connected: input.connected,
    pending: controller.pending,
    submitting: controller.submitting,
    errorFor: controller.errorFor,
    refresh: controller.sync,
    reply: controller.reply,
    cancel: controller.cancel,
  };
}
