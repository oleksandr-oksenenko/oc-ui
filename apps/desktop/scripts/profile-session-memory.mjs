/* oxlint-disable effecttsgo/async-function -- Standalone profiling CLI awaits Playwright and CDP without an application runtime. */
/* oxlint-disable effecttsgo/process-env, effecttsgo/new-promise, effecttsgo/global-date -- This is a standalone Node CLI, not an application runtime; it reads env vars and stamps a capture time directly. */

// Ad-hoc renderer heap profiler. It connects a Playwright Chromium page to an
// already-running oc-ui web build that owns the target sessions, walks the
// session sidebar selecting each session until its transcript settles, and
// records V8 heap usage after a forced GC at each step. Use it to quantify how
// many bytes stay resident per visited session and whether anything is released
// on reconnect or connection teardown.
//
// Usage:
//   PROFILE_SERVER_URL=http://127.0.0.1:4096 PROFILE_PASSWORD=... \
//     node apps/desktop/scripts/profile-session-memory.mjs
//
// Env:
//   PROFILE_SERVER_URL   required; the OpenCode server URL to connect to
//   PROFILE_PASSWORD     required; the server password
//   PROFILE_UI_URL       renderer URL (default http://127.0.0.1:4173)
//   PROFILE_OUTPUT       results JSON path (default ./session-memory.json)
//   PROFILE_SESSION_LIMIT  maximum sessions to visit (default 24)
//   PROFILE_HEAP_SNAPSHOT  when set, write one .heapsnapshot after the walk
//   PROFILE_RECONNECT    "1" to test an offline/online reconnect (default on)
//   PROFILE_WIDTH/HEIGHT viewport (default 1200x900)

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const serverUrl = process.env.PROFILE_SERVER_URL;
const password = process.env.PROFILE_PASSWORD;
if (!serverUrl || !password) throw new Error("Set PROFILE_SERVER_URL and PROFILE_PASSWORD");
const uiUrl = process.env.PROFILE_UI_URL || "http://127.0.0.1:4173";
const output = process.env.PROFILE_OUTPUT || "session-memory.json";
const limit = Number(process.env.PROFILE_SESSION_LIMIT || "24");
const snapshotPath = process.env.PROFILE_HEAP_SNAPSHOT;
const reconnect = process.env.PROFILE_RECONNECT !== "0";
const width = Number(process.env.PROFILE_WIDTH || "1200");
const height = Number(process.env.PROFILE_HEIGHT || "900");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width, height } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Runtime.enable");
await cdp.send("Performance.enable");
await cdp.send("HeapProfiler.enable");
await cdp.send("Network.enable");

async function sample(label, extra = {}) {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const metrics = Object.fromEntries(
    (await cdp.send("Performance.getMetrics")).metrics.map((metric) => [metric.name, metric.value]),
  );
  const dom = await page.evaluate(() => ({
    elements: document.querySelectorAll("*").length,
    messageRows: document.querySelectorAll('[data-message-id^="msg_"]').length,
    busy: document.querySelector(".transcript-view")?.getAttribute("aria-busy"),
  }));
  return {
    label,
    usedSize: heap.usedSize,
    totalSize: heap.totalSize,
    jsHeapUsedSize: metrics.JSHeapUsedSize,
    domElements: metrics.Nodes,
    documents: metrics.Documents,
    ...dom,
    ...extra,
  };
}

async function waitForTranscript() {
  await page.locator('.transcript-view[aria-busy="false"]').first().waitFor({ timeout: 30_000 });
}

async function settleTranscript() {
  await page.waitForFunction(
    () => {
      const view = document.querySelector(".transcript-view");
      if (!view) return false;
      if (view.getAttribute("aria-busy") !== "false") return false;
      const marker = `${view.querySelectorAll('[data-message-id^="msg_"]').length}:${view.scrollHeight}`;
      const state = window.__ocuiSettle;
      if (state?.marker === marker) return performance.now() - state.since >= 400;
      window.__ocuiSettle = { marker, since: performance.now() };
      return false;
    },
    undefined,
    { timeout: 30_000, polling: 50 },
  );
}

const results = [];
let baseline;
try {
  await page.goto(uiUrl);
  await page.getByRole("textbox", { name: "Server URL", exact: true }).fill(serverUrl);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await waitForTranscript();
  await settleTranscript();
  baseline = await sample("connected-baseline");

  const sessionIDs = await page.$$eval(
    'nav[aria-label="Sessions"] .shell-session-main',
    (buttons) =>
      buttons.map((button) => ({
        label: button.getAttribute("aria-label"),
        selected: button.getAttribute("aria-current") === "page",
      })),
  );
  results.push({ ...baseline, sessionCount: sessionIDs.length });

  const visited = [];
  for (let index = 0; index < Math.min(limit, sessionIDs.length); index++) {
    const { label, selected } = sessionIDs[index];
    const current = page.locator("nav[aria-label='Sessions'] .shell-session-main").nth(index);
    if (!selected) {
      await current.scrollIntoViewIfNeeded();
      await current.click();
    }
    await settleTranscript();
    visited.push(label);
    results.push(await sample(`visit-${index + 1}`, { index: index + 1, label, selected }));
  }

  const finalSample = results.at(-1);
  if (snapshotPath) {
    await mkdir(dirname(snapshotPath), { recursive: true });
    const chunks = [];
    const onChunk = (event) => chunks.push(event.chunk);
    cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
    try {
      await cdp.send("HeapProfiler.takeHeapSnapshot", {
        reportProgress: false,
        captureNumericValue: false,
      });
    } finally {
      cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
    }
    await writeFile(snapshotPath, chunks.join(""));
  }

  let reconnectResult;
  if (reconnect) {
    const before = await sample("reconnect-before");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await page.waitForTimeout(2_000);
    const offline = await sample("reconnect-offline");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await page.locator('.transcript-view[aria-busy="false"]').first().waitFor({ timeout: 30_000 });
    await settleTranscript();
    const after = await sample("reconnect-after");
    reconnectResult = { before, offline, after };
  }

  const beforeTeardown = await sample("teardown-before");
  const selector = page.locator(".shell-server-selector");
  let teardown;
  if (await selector.count()) {
    await selector.first().click();
    await page.getByRole("button", { name: "Connect", exact: true }).waitFor({ timeout: 15_000 });
    teardown = await sample("teardown-after");
  }

  const meaningful = results.filter((entry) => entry.index !== undefined);
  const retained = meaningful.map((entry) => entry.usedSize);
  const peakUsedSize = retained.length === 0 ? baseline.usedSize : Math.max(...retained);
  const finalUsedSize = retained.length === 0 ? baseline.usedSize : retained[retained.length - 1];
  const medianUsedSize =
    retained.length === 0
      ? baseline.usedSize
      : retained.toSorted((left, right) => left - right)[Math.floor(retained.length / 2)];
  const perSession =
    meaningful.length >= 2 ? (finalUsedSize - meaningful[0].usedSize) / (meaningful.length - 1) : 0;
  const freshAfterWalk = meaningful[0] ? meaningful[0].usedSize - baseline.usedSize : 0;
  const result = {
    browser: browser.version(),
    viewport: { width, height },
    uiUrl,
    capturedAt: new Date().toISOString(),
    methodology:
      "Headless Chromium production web build; forced GC then Runtime.getHeapUsage and Performance.getMetrics at each step.",
    sessionCount: sessionIDs.length,
    visited,
    baseline,
    finalSample,
    peakUsedSize,
    finalUsedSize,
    medianUsedSize,
    perSessionRetainedBytes: perSession,
    retentionMetric: "first-to-last average bytes per visit, not a steady-state growth rate",
    firstVisitRetainedBytes: freshAfterWalk,
    reconnect: reconnectResult,
    teardown,
    steps: results,
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output,
        visited: visited.length,
        sessionCount: sessionIDs.length,
        baselineUsedSize: baseline.usedSize,
        peakUsedSize,
        finalUsedSize,
        medianUsedSize,
        perSessionRetainedBytes: perSession,
        reconnectBefore: reconnectResult?.before.usedSize,
        reconnectAfter: reconnectResult?.after.usedSize,
        teardownBefore: beforeTeardown.usedSize,
        teardownAfter: teardown?.usedSize,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    await page.evaluate(() => ({
      url: location.href,
      buttons: [...document.querySelectorAll("button[aria-label]")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    })),
  );
  await page.screenshot({ path: output + ".failure.png" });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
