import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Schema } from "effect";
import { $, $$, browser } from "@wdio/globals";

const TIMEOUT = 60_000;

// DOM interaction drives the feature; Electron inspection establishes native ownership/visibility.
export async function verifyBrowserFlows(artifacts: string): Promise<void> {
  const provider = process.env.OCUI_E2E_PROVIDER_URL;
  assert.ok(provider);
  await browser.electron.execute((electron) => {
    const win = electron.BrowserWindow.getAllWindows()[0];
    win?.show();
    win?.focus();
    electron.app.focus({ steal: true });
  });
  // No Browser-tab click or enable action: the agent must be ready in the conversation.
  await $('[aria-label="Prompt"]').setValue(`E2E_BROWSER: exercise ${provider}/browser-test`);
  await $('[aria-label="Send"]').click();
  let reply = "";
  await browser.waitUntil(
    async () => {
      const response = await fetch(`${provider}/_state`);
      const state = await response.json();
      const record = state.requests.find(
        (request: { prompt: string; toolReply?: unknown }) =>
          request.prompt.includes("E2E_BROWSER") && Schema.is(Schema.String)(request.toolReply),
      );
      if (!record) return false;
      reply = record.toolReply;
      return true;
    },
    { timeout: 120_000, timeoutMsg: "Agent browser operations did not complete successfully" },
  );
  await $('[aria-label="Send"]').waitForDisplayed({ timeout: TIMEOUT });
  await $('[aria-label="Browser address"]').waitForDisplayed({ timeout: TIMEOUT });
  await $(".browser-tab-select=Browser acceptance").waitForDisplayed({ timeout: TIMEOUT });
  try {
    await browser.waitUntil(async () => (await nativePages()).some((page) => page.visible), {
      timeout: TIMEOUT,
    });
  } catch (cause) {
    const viewport = await browser.execute(() => {
      const element = document.querySelector(".browser-viewport");
      const rect = element?.getBoundingClientRect();
      return {
        visibility: document.visibilityState,
        bounds: rect?.toJSON(),
        hit: rect
          ? document.elementFromPoint(rect.x + 1, rect.y + 1)?.outerHTML.slice(0, 200)
          : null,
        dialogs: Array.from(document.querySelectorAll('[role="dialog"]'), (dialog) => ({
          bounds: dialog.getBoundingClientRect().toJSON(),
          hidden: getComputedStyle(dialog).visibility,
        })),
      };
    });
    throw new Error(
      `Native viewport failed: ${JSON.stringify({ viewport, pages: await nativePages() })}`,
      { cause },
    );
  }
  const [page] = await nativePages();
  assert.ok(page);
  assert.match(page.proxy, /^PROXY /);
  assert.ok(page.bounds.width > 100 && page.bounds.height > 100);

  await $('[aria-label="Hide context panel"]').click();
  await browser.waitUntil(async () => (await nativePages()).every((item) => !item.visible));
  await $('[aria-label="Show context"]').click();
  await browser.waitUntil(async () => (await nativePages()).some((item) => item.visible));
  assert.equal((await nativePages())[0]?.id, page.id);
  await $('[aria-label="Create session"]').click();
  await $('[aria-label="Close new session dialog"]').waitForDisplayed();
  await browser.waitUntil(async () => (await nativePages()).every((item) => !item.visible));
  await browser.keys("Escape");
  await browser.waitUntil(async () => (await nativePages()).some((item) => item.visible));

  // This fixture is text-only: OpenCode appends an image-input notice after the JSON result.
  assert.ok(reply.startsWith("{"), `Agent browser operation failed: ${reply}`);
  const result = JSON.parse(reply.slice(0, reply.lastIndexOf("}") + 1));
  assert.equal(result.verified, "browser-roundtrip");
  assert.equal(result.data.value.source, "connected-server");
  assert.ok(
    result.logs.messages.some((entry: { text: string }) => entry.text === "Browser acceptance log"),
  );
  assert.equal(JSON.parse(result.network.responseBody.text).source, "connected-server");
  const capture = result.screenshot.files[0];
  const bytes = await readFile(capture.path);
  assert.equal(bytes.length, capture.bytes);
  assert.equal(result.uploaded.value, capture.bytes);
  assert.deepEqual(await readFile(result.exported.files[0].path), bytes);
  assert.ok(result.cpuAnalysis.durationMs >= 0);
  assert.ok(
    result.traceAnalysis.metrics.some(
      (metric: { name: string }) => metric.name === "recordedEvents",
    ),
  );
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  await copyFile(capture.path, join(artifacts, "browser-server-capture.png"));
  const report = result.audit.files.find(
    (file: { name: string }) => file.name === "lighthouse.json",
  );
  assert.ok(report);
  const audit = JSON.parse(await readFile(report.path, "utf8"));
  assert.ok(Number.isFinite(audit.categories.accessibility.score));
  await copyFile(report.path, join(artifacts, "browser-lighthouse.json"));
  await $("button*=execute").click();
  await $(".transcript-tool-image").waitForDisplayed({ timeout: TIMEOUT });
  await browser.waitUntil(() =>
    browser.execute(() => {
      const image = document.querySelector<HTMLImageElement>(".transcript-tool-image");
      return image?.complete === true && image.naturalWidth > 0;
    }),
  );
  await browser.saveScreenshot(join(artifacts, "browser-agent-roundtrip.png"));

  await $('.shell-session-main:not([aria-current="page"])').click();
  await $('[aria-label="Browser address"]').waitForDisplayed({ timeout: TIMEOUT });
  await $(".browser-empty").waitForDisplayed();
  assert.equal((await nativePages())[0]?.id, page.id);
  await browser.waitUntil(async () => (await nativePages()).every((item) => !item.visible));
  await $('.shell-session-main:not([aria-current="page"])').click();
  await browser.waitUntil(async () => (await nativePages()).some((item) => item.visible));
  await $('[aria-label="New browser tab"]').click();
  await browser.waitUntil(async () => (await nativePages()).length === 2);
  const tabs = $$(".browser-tab");
  await tabs[1].$('button[aria-label^="Close "]').click();
  await browser.waitUntil(async () => (await nativePages()).length === 1);
  assert.equal((await nativePages())[0]?.id, page.id);
  await $('.browser-tab button[aria-label^="Close "]').click();
  await browser.waitUntil(async () => (await nativePages()).length === 0);

  // Reload closes automatic attachments and all native tabs.
  const title = await $(".titlebar-session-title").getText();
  await $('[aria-label="New browser tab"]').waitForClickable({ timeout: TIMEOUT });
  await $('[aria-label="New browser tab"]').click();
  await browser.waitUntil(async () => (await nativePages()).length === 1);
  await browser.refresh();
  await $("#connection-form-title").waitForDisplayed({ timeout: TIMEOUT });
  await browser.waitUntil(async () => (await nativePages()).length === 0);
  await $("button*=Start built-in server").click();
  await $('[aria-label="Select server, Local server, Connected"]').waitForDisplayed({
    timeout: TIMEOUT,
  });
  const session = $(`.shell-session-main*=${title}`);
  await session.waitForClickable({ timeout: TIMEOUT });
  await session.click();
  await $('[aria-label="Prompt"]').waitForDisplayed({ timeout: TIMEOUT });
}

async function nativePages() {
  return browser.electron.execute(async (electron) => {
    const win = electron.BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error("Acceptance window missing");
    const pages = win.contentView.children.filter(
      (view): view is Electron.WebContentsView =>
        view instanceof electron.WebContentsView && view.webContents !== win.webContents,
    );
    return Promise.all(
      pages.map(async (page) => {
        return {
          id: page.webContents.id,
          visible: page.getVisible(),
          bounds: page.getBounds(),
          proxy: await page.webContents.session.resolveProxy(page.webContents.getURL()),
        };
      }),
    );
  });
}
