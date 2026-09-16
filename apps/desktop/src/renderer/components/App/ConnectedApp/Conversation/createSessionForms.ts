import type { WorkspaceOwner } from "../../../../workspace-owner.ts";
import type { FormAnswer, FormInfo } from "@opencode/client";
import type { Data } from "@opencode/client/solid";
import { onCleanup, type Accessor } from "solid-js";

import { createFormController } from "../Forms/createFormController.ts";

type SessionFormsData = {
  readonly on: Data["on"];
  readonly session: Pick<Data["session"], "form">;
};

type SessionFormsInput = {
  readonly effects: WorkspaceOwner;
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
  const controller = createFormController({
    effects: input.effects,
    connected: input.connected,
    sessionID: input.selectedID,
    form: input.data.session.form,
    errorMessage: (kind) => {
      if (kind === "sync") return SYNC_FAILURE_MESSAGE;
      return kind === "reply" ? REPLY_FAILURE_MESSAGE : CANCEL_FAILURE_MESSAGE;
    },
  });

  const stopCreated = input.data.on("form.created", (event) => {
    const sessionID = event.data.form.sessionID;
    if (sessionID === "global") return;
    input.data.session.form.invalidate(sessionID);
    if (sessionID === input.selectedID()) controller.startSync();
  });

  onCleanup(stopCreated);

  return {
    sessionForms: controller.forms,
    state: controller.state,
    error: controller.error,
    submitting: controller.submitting,
    errorFor: controller.errorFor,
    sync: controller.sync,
    reply: (formID, answer) => controller.reply(formID, answer).then(() => undefined),
    cancel: (formID) => controller.cancel(formID).then(() => undefined),
  };
}
