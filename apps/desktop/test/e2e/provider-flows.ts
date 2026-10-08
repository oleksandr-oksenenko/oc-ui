import assert from "node:assert/strict";
import { $, $$, browser } from "@wdio/globals";
import { verifyTransportRecovery } from "./transport-flows.ts";

const TIMEOUT = 30_000;
const PROMPT = '[aria-label="Prompt"]';

// Electron 42 still exposes Performance, which newer devtools-protocol types omit.
type PerformanceMetrics = { metrics: { name: string; value: number }[] };

export async function verifyProviderFlows(): Promise<void> {
  await $('[aria-label="Model: Acceptance Stream"]').waitForClickable({ timeout: TIMEOUT });
  // Exercise the delivered worker/provider integration before destroying the renderer.
  await send("E2E_PACKAGED: complete a request through the bundled server.");
  await waitForText("Acceptance completed with stream.");
  await idle();
  assert.equal(await $(PROMPT).getText(), "");

  await addAnnotation("Acceptance annotation reaches the provider.");
  await send("E2E_ANNOTATION: address my note.");
  await $(
    ".transcript-user-message .attachment-pill-annotations .attachment-pill-trigger",
  ).waitForDisplayed({ timeout: TIMEOUT });
  await idle();
  await $(".transcript-user-message .attachment-pill-annotations .attachment-pill-trigger").click();
  await browser.waitUntil(
    async () =>
      (await $(".transcript-annotation-content").getText()).includes(
        "Acceptance annotation reaches the provider.",
      ),
    { timeout: TIMEOUT },
  );
  const populatedTitle = await $(".titlebar-session-title").getText();
  const workerBeforeReload = await browser.electron.execute(
    (electron) =>
      electron.app.getAppMetrics().find((metric) => metric.name === "Ocui built-in OpenCode")?.pid,
  );
  assert.ok(workerBeforeReload);
  await browser.refresh();
  await $('[aria-label="Select server, Local server, Connected"]').waitForDisplayed({
    timeout: TIMEOUT,
  });
  const populatedSession = $(`.shell-session-main*=${populatedTitle}`);
  await populatedSession.waitForClickable({ timeout: TIMEOUT });
  await populatedSession.click();
  await waitForText("E2E_PACKAGED: complete a request through the bundled server.");
  await waitForText("Acceptance completed with stream.");
  await $(
    ".transcript-user-message .attachment-pill-annotations .attachment-pill-trigger",
  ).waitForDisplayed();
  await $(".transcript-user-message .attachment-pill-annotations .attachment-pill-trigger").click();
  await browser.waitUntil(
    async () =>
      (await $(".transcript-annotation-content").getText()).includes(
        "Acceptance annotation reaches the provider.",
      ),
    { timeout: TIMEOUT },
  );
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
  await verifyIdleSpinners();
  await verifyTransportRecovery();
}

async function verifyIdleSpinners(): Promise<void> {
  const title = await $(".titlebar-session-title").getText();
  await send("E2E_STOP: keep a background session running while the focused view is idle.");
  try {
    await waitForText("Acceptance stream is waiting for cancellation.");
    await $('[aria-label="Create session"]').click();
    await $(".new-session-screen").waitForDisplayed();
    await $(
      '.shell-session-status[data-status="running"] [data-component="loader-v2"]',
    ).waitForDisplayed();
    const styleRecalculations = await browser.electron.execute(async (electron) => {
      const contents = electron.BrowserWindow.getAllWindows()[0]?.webContents;
      if (!contents) throw new Error("Main renderer is missing");
      if (contents.debugger.isAttached()) throw new Error("Renderer debugger already has an owner");
      contents.debugger.attach("1.3");
      try {
        await contents.debugger.sendCommand("Performance.enable");
        const before: PerformanceMetrics =
          await contents.debugger.sendCommand("Performance.getMetrics");
        // Measure a quiet one-second window, rather than asserting wall-clock CPU time.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const after: PerformanceMetrics =
          await contents.debugger.sendCommand("Performance.getMetrics");
        const start = before.metrics.find((metric) => metric.name === "RecalcStyleCount");
        const end = after.metrics.find((metric) => metric.name === "RecalcStyleCount");
        if (!start || !end) throw new Error("Style recalculation counters are unavailable");
        return end.value - start.value;
      } finally {
        try {
          await contents.debugger.sendCommand("Performance.disable");
        } finally {
          contents.debugger.detach();
        }
      }
    });
    // Allow transient UI updates, but reject continuous 60/120 Hz SVG animation work.
    assert.ok(
      styleRecalculations < 15,
      `Idle spinners caused ${styleRecalculations} style recalculations`,
    );
  } finally {
    await $(`.shell-session-main*=${title}`).click();
    const stop = $('[aria-label="Stop"]');
    if (await stop.isExisting()) await stop.click();
    await idle();
  }
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
  await $('textarea[placeholder="Write a question or note…"]').waitForDisplayed({
    timeout: TIMEOUT,
  });
  await $('textarea[placeholder="Write a question or note…"]').setValue(body);
  await browser.keys("Enter");
  await $(".annotation-popover").waitForExist({ reverse: true });
  await $('[aria-label="Discard 1 annotations"]').waitForDisplayed();
}

async function send(text: string): Promise<void> {
  await $(PROMPT).setValue(text);
  await $('[aria-label="Send"]').waitForClickable({ timeout: TIMEOUT });
  await $('[aria-label="Send"]').click();
  await browser.waitUntil(async () => (await $(PROMPT).getText()) === "", { timeout: TIMEOUT });
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
