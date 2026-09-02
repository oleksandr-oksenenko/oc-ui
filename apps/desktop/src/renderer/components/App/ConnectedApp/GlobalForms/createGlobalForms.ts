import type { FormAnswer, LocationRef } from "@opencode-ai/client";
import { locationKey, type Data, type FormWithLocation } from "@opencode-ai/client/solid";
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
  readonly session: {
    readonly form: Pick<
      Data["session"]["form"],
      "list" | "sync" | "invalidate" | "reply" | "cancel"
    >;
  };
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
  readonly runtime: {
    readonly data: GlobalFormsData;
  };
  readonly connected: Accessor<boolean>;
  readonly location: LocationRef;
};

export function createGlobalForms(input: CreateGlobalFormsInput): GlobalFormsController {
  const controller = createFormController<FormWithLocation>({
    connected: input.connected,
    sessionID: () => GLOBAL_SESSION_ID,
    location: input.location,
    list: (sessionID, location) => input.runtime.data.session.form.list(sessionID, location),
    sync: (sessionID, location) => input.runtime.data.session.form.sync(sessionID, location),
    reply: (request, location) => input.runtime.data.session.form.reply(request, location),
    cancel: (request, location) => input.runtime.data.session.form.cancel(request, location),
    errorMessage,
  });

  const stopCreated = input.runtime.data.on("form.created", (event) => {
    if (event.data.form.sessionID !== GLOBAL_SESSION_ID) return;
    if (event.location && locationKey(event.location) !== locationKey(input.location)) return;
    input.runtime.data.session.form.invalidate(GLOBAL_SESSION_ID, input.location);
    void controller.sync();
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
    reply: (formID, answer) => controller.reply(formID, answer),
    cancel: (formID) => controller.cancel(formID),
  };
}
