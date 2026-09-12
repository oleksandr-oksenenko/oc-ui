import assert from "node:assert/strict";
import { $, $$, browser } from "@wdio/globals";
import { verifyTransportRecovery } from "./transport-flows.ts";

const TIMEOUT = 30_000;
const PROMPT = 'textarea[aria-label="Prompt"]';

export async function verifyProviderFlows(): Promise<void> {
  await $('[aria-label="Model: Acceptance Stream"]').waitForClickable({ timeout: TIMEOUT });
  // Exercise the delivered worker/provider integration before destroying the renderer.
  await send("E2E_PACKAGED: complete a request through the bundled server.");
  await waitForText("Acceptance completed with stream.");
  await idle();
  assert.equal(await $(PROMPT).getValue(), "");

  await addAnnotation("Acceptance annotation reaches the provider.");
  await send("E2E_ANNOTATION: address my note.");
  await $(".transcript-annotation-trigger").waitForDisplayed({ timeout: TIMEOUT });
  await idle();
  await $(".transcript-annotation-trigger").click();
  await waitForText("Acceptance annotation reaches the provider.");
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
  await waitForText("E2E_PACKAGED: complete a request through the bundled server.");
  await waitForText("Acceptance completed with stream.");
  await $(".transcript-annotation-trigger").waitForDisplayed();
  await $(".transcript-annotation-trigger").click();
  await waitForText("Acceptance annotation reaches the provider.");
  assert.equal(
    await browser.electron.execute(
      (electron) =>
        electron.app.getAppMetrics().find((metric) => metric.name === "Ocui built-in OpenCode")
          ?.pid,
    ),
    workerBeforeReload,
  );
  await $('[aria-label="Model: Acceptance Stream"]').waitForClickable({ timeout: TIMEOUT });

  const completedBeforeRecovery = await $$(".transcript-assistant-complete").length;
  await send("E2E_RECOVER: send after renderer reload.");
  await browser.waitUntil(
    async () => (await $$(".transcript-assistant-complete").length) > completedBeforeRecovery,
    { timeout: TIMEOUT },
  );
  await idle();
  const state = await providerState();
  assert.ok(state.requests.some((request) => request.prompt.includes("E2E_RECOVER")));
  assert.ok(
    state.requests.some((request) =>
      request.prompt.includes("Acceptance annotation reaches the provider."),
    ),
  );
  await verifyTransportRecovery();
}

async function addAnnotation(body: string): Promise<void> {
  const block = ".transcript-assistant-message [data-annotation-block]";
  await $(block).scrollIntoView();
  // Scroll events dismiss annotation selection; select only after scrolling settles.
  await browser.executeAsync((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  );
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
  await $(PROMPT).click();
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
  requests: { prompt: string }[];
}> {
  const url = process.env.OCUI_E2E_PROVIDER_URL;
  assert.ok(url, "Packaged runner must supply the local provider URL");
  const response = await fetch(`${url}/_state`);
  assert.equal(response.status, 200);
  return response.json();
}
