import assert from "node:assert/strict";
import { $, $$, browser } from "@wdio/globals";
import { verifyTransportRecovery } from "./transport-flows.ts";

const TIMEOUT = 30_000;
const PROMPT = 'textarea[aria-label="Prompt"]';

export async function verifyProviderFlows(): Promise<void> {
  await $('[aria-label="Model: Acceptance Stream"]').waitForClickable({ timeout: TIMEOUT });
  await send("E2E_STREAM: show a streamed answer.");
  await browser.waitUntil(
    async () =>
      (await $(".transcript-view").getText()).includes("Acceptance first streamed fragment."),
    { timeout: TIMEOUT },
  );
  assert.equal(await $('[aria-label="Stop"]').isDisplayed(), true);
  await waitForText("Acceptance completed with stream.");
  await idle();
  assert.equal(await $(PROMPT).getValue(), "");

  // Model and agent switches use the real server mutation and surface their timeline entries.
  await $('[aria-label^="Model:"]').click();
  await $('input[placeholder="Search models"]').setValue("Acceptance Alternate");
  await $(".composer-model-option=Acceptance Alternate").click();
  await $('[aria-label="Model: Acceptance Alternate"]').waitForClickable({ timeout: TIMEOUT });
  await waitForText("Model switched");
  await send("E2E_ALTERNATE: use the selected model.");
  await waitForText("Acceptance completed with alternate.");
  await idle();
  await $('[aria-label^="Agent:"]').click();
  await $('[role="option"]*=acceptance-agent').click();
  await $('[aria-label="Agent: acceptance-agent"]').waitForClickable({ timeout: TIMEOUT });
  await waitForText("Agent switched");
  await $('[aria-label^="Agent:"]').click();
  await $('[role="option"]*=Build').click();
  await $('[aria-label="Agent: Build"]').waitForClickable({ timeout: TIMEOUT });
  await $('[aria-label^="Model:"]').click();
  await $('input[placeholder="Search models"]').setValue("Acceptance Stream");
  await $(".composer-model-option=Acceptance Stream").click();
  await $('[aria-label="Model: Acceptance Stream"]').waitForClickable({ timeout: TIMEOUT });

  await addAnnotation("Acceptance note to discard.");
  await $('[aria-label="Discard 1 annotations"]').click();
  await $('[aria-label="Discard 1 annotations"]').waitForExist({ reverse: true });
  await addAnnotation("Acceptance annotation reaches the provider.");
  await send("E2E_ANNOTATION: address my note.");
  await $(".transcript-annotation-trigger").waitForDisplayed({ timeout: TIMEOUT });
  await idle();
  await $(".transcript-annotation-trigger").click();
  await waitForText("Acceptance annotation reaches the provider.");
  await $(".transcript-annotation-quote").click();
  await $(".annotation-popover").waitForDisplayed();
  assert.equal(await $('[aria-label="Remove comment"]').isExisting(), false);
  await browser.keys("Escape");
  await $(".annotation-popover").waitForExist({ reverse: true });

  // Changing the selected session disposes its UI subscription, then reloads the persisted transcript.
  const title = await $('.shell-session-main[aria-current="page"]').getText();
  await $('.shell-session-main:not([aria-current="page"])').click();
  await $(".transcript-empty-state").waitForDisplayed({ timeout: TIMEOUT });
  await $('.shell-session-main:not([aria-current="page"])').click();
  await waitForText("E2E_STREAM: show a streamed answer.");
  assert.equal(await $('.shell-session-main[aria-current="page"]').getText(), title);
  await $(".transcript-annotation-trigger").waitForDisplayed();

  const populatedTitle = await $(".titlebar-session-title").getText();
  const workerBeforeReload = await browser.electron.execute(
    (electron) =>
      electron.app.getAppMetrics().find((metric) => metric.name === "Ocui built-in OpenCode")?.pid,
  );
  assert.ok(workerBeforeReload);
  await browser.refresh();
  await $("#connection-form-title").waitForDisplayed({ timeout: TIMEOUT });
  await $("button*=Start built-in server").click();
  await $('[aria-label="Select server, Local server, Connected"]').waitForDisplayed({
    timeout: TIMEOUT,
  });
  const populatedSession = $(`.shell-session-main*=${populatedTitle}`);
  await populatedSession.waitForClickable({ timeout: TIMEOUT });
  await populatedSession.click();
  await waitForText("E2E_STREAM: show a streamed answer.");
  await waitForText("Acceptance completed with alternate.");
  await $(".transcript-annotation-trigger").waitForDisplayed();
  assert.equal(
    await browser.electron.execute(
      (electron) =>
        electron.app.getAppMetrics().find((metric) => metric.name === "Ocui built-in OpenCode")
          ?.pid,
    ),
    workerBeforeReload,
  );
  await $('[aria-label="Model: Acceptance Stream"]').waitForClickable({ timeout: TIMEOUT });

  await send("E2E_QUESTION_SUBMIT: ask the real question tool.");
  await $(".question-form").waitForDisplayed({ timeout: TIMEOUT });
  await $("label*=Alpha").click();
  await $('.question-form button[type="submit"]').click();
  await $(".question-form").waitForExist({ reverse: true, timeout: TIMEOUT });
  await waitForText("Acceptance question resolved:");
  await idle();
  assert.ok(
    (await providerState()).requests.some(
      (request) =>
        request.prompt.includes("E2E_QUESTION_SUBMIT") &&
        (JSON.stringify(request.toolReply) ?? "").includes("Alpha"),
    ),
  );

  await send("E2E_QUESTION_CANCEL: dismiss the real question tool.");
  await $(".question-form").waitForDisplayed({ timeout: TIMEOUT });
  await $(".question-form").$("button=Cancel").click();
  await $(".question-form").waitForExist({ reverse: true, timeout: TIMEOUT });
  await idle();
  // beta18866 deliberately ends the step on dismissal, so no provider continuation occurs.
  // Its persisted tool error distinguishes cancellation from an unrelated session failure.
  await $(".transcript-tool-error .transcript-tool-header").waitForClickable({ timeout: TIMEOUT });
  await $(".transcript-tool-error .transcript-tool-header").click();
  await waitForText("The user dismissed this question");

  await send("E2E_PROVIDER_ERROR: expose the rejected request.");
  await waitForText("Acceptance provider rejected this prompt");
  await idle();
  assert.equal(await $(".transcript-assistant-failed").isExisting(), true);

  const previousCancelled = (await providerState()).cancelledStreams;
  await send("E2E_STOP: keep streaming until I stop.");
  await waitForText("Acceptance stream is waiting for cancellation.");
  await $('[aria-label="Stop"]').waitForClickable();
  await $('[aria-label="Stop"]').click();
  await idle();
  await browser.waitUntil(
    async () => (await providerState()).cancelledStreams > previousCancelled,
    { timeout: TIMEOUT, timeoutMsg: "Stop did not abort the provider HTTP stream" },
  );
  const completedBeforeRecovery = await $$(".transcript-assistant-complete").length;
  await send("E2E_RECOVER: send after stop and provider failure.");
  await browser.waitUntil(
    async () => (await $$(".transcript-assistant-complete").length) > completedBeforeRecovery,
    { timeout: TIMEOUT },
  );
  await idle();
  const state = await providerState();
  assert.ok(
    state.requests.some(
      (request) => request.model === "alternate" && request.prompt.includes("E2E_ALTERNATE"),
    ),
  );
  assert.ok(
    state.requests.some((request) =>
      request.prompt.includes("Acceptance annotation reaches the provider."),
    ),
  );
  assert.ok(state.requests.some((request) => request.prompt.includes("E2E_RECOVER")));
  await verifyTransportRecovery();
}

async function addAnnotation(body: string): Promise<void> {
  const block = ".transcript-assistant-message [data-annotation-block]";
  await $(block).scrollIntoView();
  await browser.execute((selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error("Assistant annotation source is missing");
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, block);
  await $(".annotation-selection-action button").waitForClickable();
  await $(".annotation-selection-action button").click();
  await $('textarea[placeholder="Write a question or note…"]').setValue(body);
  await browser.keys("Enter");
  await $(".annotation-inline-editor").waitForExist({ reverse: true });
  await browser.keys("Escape");
  await $(".annotation-popover").waitForExist({ reverse: true });
  await $('[aria-label="Discard 1 annotations"]').waitForDisplayed();
}

async function send(text: string): Promise<void> {
  await $(PROMPT).setValue(text);
  await $('[aria-label="Send"]').waitForClickable({ timeout: TIMEOUT });
  await $('[aria-label="Send"]').click();
  await browser.waitUntil(async () => (await $(PROMPT).getValue()) === "", { timeout: TIMEOUT });
}

async function idle(): Promise<void> {
  await $('[aria-label="Send"]').waitForDisplayed({ timeout: TIMEOUT });
  await $(".transcript-working").waitForExist({ reverse: true, timeout: TIMEOUT });
}

async function waitForText(text: string): Promise<void> {
  await browser.waitUntil(async () => (await $(".transcript-view").getText()).includes(text), {
    timeout: TIMEOUT,
    timeoutMsg: `Transcript did not contain ${text}`,
  });
}

async function providerState(): Promise<{
  cancelledStreams: number;
  requests: { model: string; prompt: string; toolReply?: unknown }[];
}> {
  const url = process.env.OCUI_E2E_PROVIDER_URL;
  assert.ok(url, "Packaged runner must supply the local provider URL");
  const response = await fetch(`${url}/_state`);
  assert.equal(response.status, 200);
  return response.json();
}
