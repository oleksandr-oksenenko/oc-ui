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
  /** Descendant sessions of the selection, in display order; their forms bubble up. */
  readonly subagentIDs: Accessor<readonly string[]>;
  readonly connected: Accessor<boolean>;
};

type SessionFormsState = "loading" | "ready" | "failed";

export type SessionFormsController = {
  readonly sessionForms: Accessor<readonly FormInfo[]>;
  readonly state: Accessor<SessionFormsState>;
  readonly error: Accessor<string | undefined>;
  /** Set when a descendant session's forms could not be loaded. */
  readonly subagentError: Accessor<string | undefined>;
  readonly submitting: (sessionID: string, formID: string) => boolean;
  readonly errorFor: (sessionID: string, formID: string) => string | undefined;
  readonly sync: () => Promise<void>;
  readonly retrySubagents: () => Promise<void>;
  readonly reply: (sessionID: string, formID: string, answer: FormAnswer) => Promise<void>;
  readonly cancel: (sessionID: string, formID: string) => Promise<void>;
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
    relatedIDs: input.subagentIDs,
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
    else if (input.subagentIDs().includes(sessionID)) controller.syncSession(sessionID);
  });

  onCleanup(stopCreated);

  return {
    sessionForms: controller.forms,
    state: controller.state,
    error: controller.error,
    subagentError: controller.relatedError,
    submitting: controller.submitting,
    errorFor: controller.errorFor,
    sync: controller.sync,
    retrySubagents: controller.retryRelated,
    reply: (sessionID, formID, answer) =>
      controller.reply(sessionID, formID, answer).then(() => undefined),
    cancel: (sessionID, formID) => controller.cancel(sessionID, formID).then(() => undefined),
  };
}
