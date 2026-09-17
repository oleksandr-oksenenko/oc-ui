/* oxlint-disable effecttsgo/async-function -- Standalone profiling CLI awaits Playwright and CDP without an application runtime. */
/* oxlint-disable effecttsgo/process-env, effecttsgo/new-promise, effecttsgo/global-date -- This is a standalone Node CLI, not an application runtime; it reads env vars, drives an rAF/observer promise, and stamps a capture time directly. */

// Ad-hoc transcript-loading profiler. It connects a Playwright Chromium page to
// an already-running oc-ui server that owns the target sessions, opens each named
// session fresh (reload) and warm (reopen), and records frame/scroll timing plus
// optional CPU profiles and traces. It does not provision a server or fixture.
//
// Usage:
//   PROFILE_SERVER_URL=http://127.0.0.1:4096 PROFILE_PASSWORD=... \
//     node apps/desktop/scripts/profile-transcripts.mjs
//
// Env:
//   PROFILE_SERVER_URL   required; the OpenCode server URL to connect to
//   PROFILE_PASSWORD     required; the server password
//   PROFILE_UI_URL       renderer URL (default http://127.0.0.1:4173)
//   PROFILE_SESSION_A/B  session titles to profile (defaults below)
//   PROFILE_NAME_A/B     labels for those sessions (default annotation/schema)
//   PROFILE_OUTPUT       results JSON path (default ./playwright-results.json)
//   PROFILE_CAPTURE_DIRECTORY  when set, also capture a CPU profile, trace, and
//                              screenshot per run (profiler overhead applies)
//   PROFILE_WIDTH/HEIGHT viewport (default 671x796)
//
// Compare two result files with apps/desktop/scripts/compare-transcript-profiles.mjs.

import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const serverUrl = process.env.PROFILE_SERVER_URL;
const password = process.env.PROFILE_PASSWORD;
if (!serverUrl || !password) throw new Error("Set PROFILE_SERVER_URL and PROFILE_PASSWORD");
const uiUrl = process.env.PROFILE_UI_URL || "http://127.0.0.1:4173";
const output = process.env.PROFILE_OUTPUT || "playwright-results.json";
const width = Number(process.env.PROFILE_WIDTH || "671");
const height = Number(process.env.PROFILE_HEIGHT || "796");
const captureDirectory = process.env.PROFILE_CAPTURE_DIRECTORY;
const titles = [
  process.env.PROFILE_SESSION_A || "Fix intermittent annotation popover acceptance-test flake",
  process.env.PROFILE_SESSION_B || "Fix session_create output-schema validation failure",
];
const names = [process.env.PROFILE_NAME_A || "annotation", process.env.PROFILE_NAME_B || "schema"];

// Runs inside the page. Keep it free of outer references so Playwright can
// serialize it. `label` is used for performance marks; timing is measured from
// the session button click to the first rendered message frame, to aria-busy
// clearing, and to a 500 ms stable message-count/scroll window.
function transcriptProfileObserver({ title, label }) {
  return new Promise((resolve, reject) => {
    const button = [...document.querySelectorAll('nav[aria-label="Sessions"] button')].find(
      (element) => element.getAttribute("aria-label") === title + ", Idle",
    );
    if (!button) return reject(new Error("Session button missing: " + title));
    const start = performance.now();
    performance.mark(label + ":click");
    const tasks = [];
    const observer = new PerformanceObserver((list) =>
      tasks.push(
        ...list
          .getEntries()
          .map((entry) => ({ start: entry.startTime - start, duration: entry.duration })),
      ),
    );
    observer.observe({ type: "longtask" });
    let first = null;
    let complete = null;
    let stableSince = null;
    let last = "";
    let maxGap = 0;
    let previous = start;
    function tick() {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - previous);
      previous = now;
      const region = [...document.querySelectorAll("section.session-pane-shell")].find(
        (element) => element.getAttribute("aria-label") === title,
      );
      const view = region?.querySelector(".transcript-view");
      const count = view?.querySelectorAll('[data-message-id^="msg_"]').length || 0;
      if (count && first === null) {
        first = now - start;
        performance.mark(label + ":first-frame");
      }
      const busy = view?.getAttribute("aria-busy");
      if (view && busy === "false" && count) {
        if (complete === null) {
          complete = now - start;
          performance.mark(label + ":loaded-frame");
        }
        const state = count + ":" + view.scrollTop + ":" + view.scrollHeight;
        if (state !== last) {
          last = state;
          stableSince = now;
        }
        if (now - stableSince >= 500) {
          observer.disconnect();
          const result = {
            label,
            title,
            firstFrameMs: first,
            loadedFrameMs: complete,
            settledMs: stableSince - start,
            observedMs: now - start,
            maxFrameGapMs: maxGap,
            messageElements: count,
            domElements: view.querySelectorAll("*").length,
            scrollHeight: view.scrollHeight,
            viewport: [innerWidth, innerHeight],
            longTasks: tasks,
            resources: performance
              .getEntriesByType("resource")
              .filter((entry) => entry.startTime >= start && entry.name.includes("/api/"))
              .map((entry) => ({
                url: entry.name,
                start: entry.startTime - start,
                duration: entry.duration,
                responseStart: entry.responseStart ? entry.responseStart - start : null,
                responseEnd: entry.responseEnd - start,
                bytes: entry.encodedBodySize,
                transfer: entry.transferSize,
              })),
          };
          performance.mark(label + ":settled");
          resolve(result);
          return;
        }
      }
      if (now - start > 25000) {
        observer.disconnect();
        reject(new Error("Loading timed out " + JSON.stringify({ count, busy, first, complete })));
        return;
      }
      requestAnimationFrame(tick);
    }
    button.click();
    requestAnimationFrame(tick);
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width, height } });
const page = await context.newPage();
const cdp = captureDirectory ? await context.newCDPSession(page) : undefined;
if (captureDirectory) await mkdir(captureDirectory, { recursive: true });
if (cdp) await cdp.send("Profiler.enable");
const runs = [];
try {
  for (let iteration = 1; iteration <= (cdp ? 1 : 3); iteration++) {
    await page.goto(uiUrl);
    await page.getByRole("textbox", { name: "Server URL", exact: true }).fill(serverUrl);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.locator('.transcript-view[aria-busy="false"]').waitFor({ timeout: 30_000 });
    await page.evaluate(() => {
      performance.setResourceTimingBufferSize(10000);
      performance.clearResourceTimings();
    });
    for (let step = 0; step < 4; step++) {
      const title = titles[step % 2];
      const kind = step < 2 ? "fresh" : "warm";
      const session = names[step % 2];
      const button = page.getByRole("button", { name: `${title}, Idle`, exact: true });
      const showSessions = page.getByRole("button", { name: "Show sessions", exact: true });
      if (await showSessions.isVisible()) await showSessions.click();
      await button.waitFor({ state: "visible" });
      if (cdp) {
        await cdp.send("Tracing.start", {
          categories:
            "devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline",
          transferMode: "ReturnAsStream",
        });
        await cdp.send("Profiler.start");
      }
      const run = await page.evaluate(transcriptProfileObserver, {
        title,
        label: `${session}-${kind}-${iteration}`,
      });
      runs.push(run);
      if (cdp) {
        const { profile } = await cdp.send("Profiler.stop");
        await writeFile(join(captureDirectory, `${run.label}.cpuprofile`), JSON.stringify(profile));
        const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
        await cdp.send("Tracing.end");
        const { stream, dataLossOccurred } = await complete;
        const chunks = [];
        try {
          for (;;) {
            const chunk = await cdp.send("IO.read", { handle: stream });
            chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"));
            if (chunk.eof) break;
          }
        } finally {
          await cdp.send("IO.close", { handle: stream });
        }
        await writeFile(join(captureDirectory, `${run.label}.trace.json`), Buffer.concat(chunks));
        run.traceDataLoss = dataLossOccurred;
        await page.screenshot({ path: join(captureDirectory, `${run.label}.png`) });
      }
    }
  }
  const result = {
    browser: browser.version(),
    viewport: { width, height },
    uiUrl,
    capturedAt: new Date().toISOString(),
    methodology: cdp
      ? "CPU/trace attribution capture; profiler overhead means these are not baseline timing runs."
      : "Separate Playwright timing series; compare only against this same harness/browser/viewport.",
    runs,
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        output,
        browser: result.browser,
        viewport: result.viewport,
        runs: runs.map(
          ({
            label,
            firstFrameMs,
            loadedFrameMs,
            settledMs,
            maxFrameGapMs,
            messageElements,
            longTasks,
          }) => ({
            label,
            firstFrameMs,
            loadedFrameMs,
            settledMs,
            maxFrameGapMs,
            messageElements,
            longTasks,
          }),
        ),
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
      headings: [...document.querySelectorAll("h1,h2,h3")].map((heading) => heading.textContent),
    })),
  );
  await page.screenshot({ path: output + ".failure.png" });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
