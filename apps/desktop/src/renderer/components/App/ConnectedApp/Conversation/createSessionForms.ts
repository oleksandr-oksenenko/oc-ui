import type { FormAnswer, FormInfo } from "@opencode-ai/client";
import type { Data } from "@opencode-ai/client/solid";
import { onCleanup, type Accessor } from "solid-js";

import { createFormController } from "../Forms/createFormController.ts";

type SessionFormsData = {
  readonly on: Data["on"];
  readonly session: {
    readonly form: Pick<
      Data["session"]["form"],
      "list" | "sync" | "invalidate" | "reply" | "cancel"
    >;
  };
};

type SessionFormsInput = {
  readonly data: SessionFormsData;
  readonly selectedID: Accessor<string | undefined>;
  readonly connected: Accessor<boolean>;
};

type SessionFormsState = "loading" | "ready" | "failed";

export type SessionFormsController = {
  readonly sessionForms: Accessor<readonly FormInfo[]>;
  readonly state: Accessor<SessionFormsState>;
  readonly error: Accessor<string | undefined>;
  readonly submitting: (formID: string) => boolean;
  readonly errorFor: (formID: string) => string | undefined;
  readonly sync: () => Promise<void>;
  readonly reply: (formID: string, answer: FormAnswer) => Promise<void>;
  readonly cancel: (formID: string) => Promise<void>;
};

const SYNC_FAILURE_MESSAGE = "Forms could not be refreshed. Try again.";
const REPLY_FAILURE_MESSAGE = "The form could not be submitted. Try again.";
const CANCEL_FAILURE_MESSAGE = "The form could not be cancelled. Try again.";

/** Owns pending forms for the selected session and their server mutations. */
export function createSessionForms(input: SessionFormsInput): SessionFormsController {
  const controller = createFormController<FormInfo>({
    connected: input.connected,
    sessionID: input.selectedID,
    list: (sessionID) => input.data.session.form.list(sessionID),
    sync: (sessionID) => input.data.session.form.sync(sessionID),
    reply: (request) => input.data.session.form.reply(request),
    cancel: (request) => input.data.session.form.cancel(request),
    errorMessage: (kind) => {
      if (kind === "sync") return SYNC_FAILURE_MESSAGE;
      return kind === "reply" ? REPLY_FAILURE_MESSAGE : CANCEL_FAILURE_MESSAGE;
    },
  });

  const stopCreated = input.data.on("form.created", (event) => {
    const sessionID = event.data.form.sessionID;
    if (sessionID === "global") return;
    input.data.session.form.invalidate(sessionID);
    if (sessionID === input.selectedID()) void controller.sync();
  });

  onCleanup(stopCreated);

  return {
    sessionForms: controller.forms,
    state: controller.state,
    error: controller.error,
    submitting: controller.submitting,
    errorFor: controller.errorFor,
    sync: controller.sync,
    reply: async (formID, answer) => {
      await controller.reply(formID, answer);
    },
    cancel: async (formID) => {
      await controller.cancel(formID);
    },
  };
}
