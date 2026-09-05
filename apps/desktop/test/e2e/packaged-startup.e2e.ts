/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="@wdio/electron-service" />

import assert from "node:assert/strict";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $, browser } from "@wdio/globals";
import type { DesktopApi } from "../../src/shared/desktop-api.ts";
import { verifyConnectionSettings } from "./connection-flows.ts";
import { verifyProjectFlows } from "./project-flows.ts";
import { prepareProjectFixture } from "./project-fixture.ts";
import { verifyProviderFlows } from "./provider-flows.ts";

declare global {
  interface Window {
    readonly desktop: DesktopApi;
  }
}

const STARTUP_TIMEOUT_MS = 45_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;
const userDataPath = globalThis.process.env.OCUI_E2E_USER_DATA_PATH;
if (userDataPath === undefined || userDataPath.length === 0) {
  throw new Error("OCUI_E2E_USER_DATA_PATH must be set by the packaged E2E runner");
}
const settingsPath = join(userDataPath, "connection-settings.json");
const pidRecordPath = join(userDataPath, "acceptance-worker-pids.json");
const workerPids: number[] = [];
const terminalPids: number[] = [];
const artifactDirectory = fileURLToPath(new URL("../../dist/wdio-artifacts/", import.meta.url));
const projectDirectory = join(userDataPath, "acceptance-project");

describe("packaged owned OpenCode", () => {
  it("starts lazily and preserves session drafts through dialog and layout changes", async () => {
    await mkdir(artifactDirectory, { recursive: true });
    const runtime = await browser.electron.execute((electron) => ({
      isPackaged: electron.app.isPackaged,
      userData: electron.app.getPath("userData"),
      mockKeychain: electron.app.commandLine.hasSwitch("use-mock-keychain"),
      databasePath: process.env.OPENCODE_DB,
    }));
    assert.equal(runtime.isPackaged, true);
    assert.equal(runtime.userData, userDataPath);
    assert.equal(runtime.mockKeychain, true);
    assert.equal(runtime.databasePath, globalThis.process.env.OPENCODE_DB);
    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        mkdir(join(projectDirectory, `folder-${String(index).padStart(2, "0")}`), {
          recursive: true,
        }),
      ),
    );
    await prepareProjectFixture(projectDirectory);
    // The server's default location is its working directory; keep UI-created sessions isolated.
    await browser.electron.execute(
      (_electron, directory) => process.chdir(directory),
      projectDirectory,
    );

    await $("#connection-form-title").waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });
    assert.deepEqual(await ownedWorkerPids(), []);
    await resizeWindow(430, 600);
    assert.equal(await $("button*=Start built-in server").isClickable(), true);
    assert.equal(
      await browser.execute(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await browser.saveScreenshot(join(artifactDirectory, "owned-runtime-narrow.png"));
    await resizeWindow(1280, 860);
    await $("button*=Start built-in server").click();
    await waitForLocalConnection();
    const firstPid = await recordWorker();
    await verifyHealth(firstPid);
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { kind: "local" });
    await assert.rejects(access(join(userDataPath, "opencode", "service.json")), {
      code: "ENOENT",
    });
    await verifySessionDrafts();
  });

  it("validates connections, saves encrypted credentials, reconnects, and forgets them", async () => {
    await verifyConnectionSettings(settingsPath);
    assert.deepEqual(await ownedWorkerPids(), [workerPids[0]]);
  });

  it("runs prompts, selections, forms, cancellation, and transcript recovery", async () => {
    await verifyProviderFlows();
    await browser.saveScreenshot(join(artifactDirectory, "provider-flows-complete.png"));
  });

  it("updates diffs and creates and removes a worktree through the UI", async () => {
    await verifyProjectFlows(projectDirectory);
    await browser.saveScreenshot(join(artifactDirectory, "project-flows-complete.png"));
  });

  it("preserves the worker on Cancel Quit and reload, then restarts only on request", async () => {
    const firstPid = workerPids[0];
    assert.ok(firstPid !== undefined);

    // Native confirmation is mocked only by the test; Cancel must preserve the worker.
    const confirmation = await browser.electron.mock("dialog", "showMessageBox");
    await confirmation.mockResolvedValue({ response: 0, checkboxChecked: false });
    await browser.electron.execute((electron) => electron.app.quit());
    await browser.waitUntil(() => confirmation.mock.calls.length === 1);
    assert.deepEqual(await ownedWorkerPids(), [firstPid]);
    await verifyHealth(firstPid);

    // Renderer teardown does not own the server. A saved local choice remains lazy.
    await browser.refresh();
    await $("#connection-form-title").waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });
    assert.deepEqual(await ownedWorkerPids(), [firstPid]);
    await $("button*=Start built-in server").click();
    await waitForLocalConnection();
    assert.deepEqual(await ownedWorkerPids(), [firstPid]);

    // Kill only the utility PID currently reported by this app, never a name lookup.
    await browser.electron.execute((electron, expectedPid) => {
      const child = electron.app
        .getAppMetrics()
        .find((metric) => metric.name === "Ocui built-in OpenCode");
      if (child?.pid !== expectedPid) throw new Error("Owned worker changed before crash test");
      process.kill(child.pid, "SIGKILL");
    }, firstPid);
    await $("button=Restart").waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });
    assert.deepEqual(await ownedWorkerPids(), []);
    await $("button=Restart").click();
    await waitForLocalConnection();
    const secondPid = await recordWorker();
    assert.notEqual(secondPid, firstPid);
    await verifyHealth(secondPid);
    const terminalPid = await browser.execute(async (directory) => {
      const result = await window.desktop.localOpenCode.connect();
      if (result.status !== "connected") throw new Error(result.message);
      const endpoint = new URL("/api/pty", result.connection.serverUrl);
      endpoint.searchParams.set("location[directory]", directory);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`opencode:${result.connection.password}`)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          command: "/bin/sh",
          args: ["-c", "read remaining"],
          cwd: directory,
        }),
      });
      if (response.status !== 200) throw new Error(`Native PTY failed: ${response.status}`);
      return (await response.json()).data.pid;
    }, userDataPath);
    assert.ok(Number.isSafeInteger(terminalPid) && terminalPid > 0);
    terminalPids.push(terminalPid);
    globalThis.process.kill(terminalPid, 0);
    await browser.saveScreenshot(join(artifactDirectory, "owned-runtime-connected.png"));
  });

  after(async () => {
    const confirmation = await browser.electron.mock("dialog", "showMessageBox");
    await confirmation.mockResolvedValue({ response: 1, checkboxChecked: false });
    // Let the execute reply reach WDIO before the app closes its renderer.
    await browser.electron.execute((electron) => {
      setTimeout(() => electron.app.quit(), 0);
    });
    for (const pid of workerPids) await waitForProcessExit(pid);
    for (const pid of terminalPids) await waitForProcessExit(pid);
  });
});

async function verifySessionDrafts(): Promise<void> {
  const opener = '[aria-label="Create session"]';
  const submit = '.server-flow-dialog button[type="submit"]';
  const prompt = 'textarea[aria-label="Prompt"]';
  await $(opener).waitForClickable({ timeout: STARTUP_TIMEOUT_MS });
  await $(opener).click();
  await $('[aria-label="Close new session dialog"]').waitForDisplayed();
  await browser.keys("Escape");
  await $('[aria-label="Close new session dialog"]').waitForExist({ reverse: true });
  await browser.waitUntil(() => $(opener).isFocused());
  await $(opener).click();
  await $("button=Add project").click();
  await $(submit).waitForClickable({ timeout: STARTUP_TIMEOUT_MS });
  assert.equal(await $('.server-directory-browser[aria-busy="true"]').isExisting(), false);
  const initialDirectory = await $(".server-directory-browser-path").getText();
  assert.equal(initialDirectory, await realpath(projectDirectory));
  await $('[aria-label="Browse directory folder-00/"]').click();
  await browser.waitUntil(async () =>
    (await $(".server-directory-browser-path").getText()).endsWith("/folder-00"),
  );
  await $(submit).waitForClickable();
  assert.equal(await $("p=No child directories.").isDisplayed(), true);
  await $('[aria-label="Go to parent directory"]').click();
  await browser.waitUntil(
    async () => (await $(".server-directory-browser-path").getText()) === initialDirectory,
  );
  await $(submit).waitForClickable();
  await resizeWindow(430, 600);
  assert.equal(
    await browser.execute(() => {
      const entries = document.querySelector<HTMLElement>('[aria-label="Directories"]');
      if (!entries) return false;
      entries.scrollTop = entries.scrollHeight;
      return entries.scrollTop > 0 && document.documentElement.scrollWidth <= window.innerWidth;
    }),
    true,
  );
  assert.equal(await $(submit).isClickable(), true);
  await browser.saveScreenshot(join(artifactDirectory, "session-directory-narrow.png"));
  await browser.keys("Escape");
  await $('[aria-label="Close new session dialog"]').waitForDisplayed();
  await browser.waitUntil(() => $("button=Add project").isFocused());
  await $("button=Add project").click();
  await $(submit).waitForClickable({ timeout: STARTUP_TIMEOUT_MS });
  assert.equal(await $(".server-directory-browser-path").getText(), initialDirectory);
  await $(submit).click();
  await $(".new-session-project-trigger").waitForClickable();
  await $(".new-session-project-trigger").click();
  await $('input[placeholder="Search projects"]').waitForDisplayed();
  await browser.keys("Escape");
  await browser.waitUntil(() => $(".new-session-project-trigger").isFocused());
  await $(submit).waitForClickable();
  await $(submit).click();
  await $('[aria-label="Close new session dialog"]').waitForExist({ reverse: true });
  await $(prompt).waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });
  await $(".transcript-empty-state").waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });
  assert.equal(await $(".titlebar-session-title").getText(), "Untitled session");
  assert.equal(await $('[aria-label="Send"]').isEnabled(), false);
  const draft = "Keep this draft with its original session.";
  await $(prompt).setValue(draft);
  assert.equal(await $(prompt).getValue(), draft);
  assert.equal(
    await browser.execute(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await browser.saveScreenshot(join(artifactDirectory, "session-draft-narrow.png"));
  await resizeWindow(1280, 860);
  await $('[aria-label="Show sessions"]').click();

  await $(opener).click();
  await $("button=Add project").click();
  await $(submit).waitForClickable({ timeout: STARTUP_TIMEOUT_MS });
  await $(submit).click();
  await $(".new-session-project-trigger").waitForClickable();
  await $(submit).waitForClickable();
  await $(submit).click();
  await $('[aria-label="Close new session dialog"]').waitForExist({ reverse: true });
  await browser.waitUntil(async () => (await $(prompt).getValue()) === "");
  await $(".transcript-empty-state").waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });
  assert.equal(
    await browser.execute(() => document.querySelectorAll(".shell-session-main").length),
    2,
  );
  await $('.shell-session-main:not([aria-current="page"])').click();
  await browser.waitUntil(async () => (await $(prompt).getValue()) === draft);
}

async function ownedWorkerPids(): Promise<number[]> {
  return browser.electron.execute((electron) =>
    electron.app
      .getAppMetrics()
      .filter((metric) => metric.name === "Ocui built-in OpenCode")
      .map((metric) => metric.pid),
  );
}

async function resizeWindow(width: number, height: number): Promise<void> {
  await browser.electron.execute(
    (electron, nextWidth, nextHeight) => {
      const window = electron.BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error("Acceptance window is missing");
      window.setSize(nextWidth, nextHeight);
    },
    width,
    height,
  );
  await browser.waitUntil(async () => (await browser.execute(() => window.innerWidth)) <= width);
}

async function recordWorker(): Promise<number> {
  const pids = await ownedWorkerPids();
  assert.equal(pids.length, 1);
  const pid = pids[0];
  assert.ok(pid !== undefined && pid > 0);
  workerPids.push(pid);
  await writeFile(pidRecordPath, JSON.stringify(workerPids));
  return pid;
}

async function waitForLocalConnection(): Promise<void> {
  await $('[aria-label="Select server, Local server, Connected"]').waitForDisplayed({
    timeout: STARTUP_TIMEOUT_MS,
  });
}

async function verifyHealth(expectedPid: number): Promise<void> {
  const health = await browser.execute(async () => {
    const result = await window.desktop.localOpenCode.connect();
    if (result.status !== "connected") throw new Error(result.message);
    const response = await fetch(`${result.connection.serverUrl}/api/health`, {
      headers: { Authorization: `Basic ${btoa(`opencode:${result.connection.password}`)}` },
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(health.status, 200);
  assert.equal(health.body.pid, expectedPid);
  assert.equal(health.body.version, "0.0.0-beta-18866");
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      globalThis.process.kill(pid, 0);
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ESRCH") return;
      throw cause;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Owned OpenCode process ${pid} survived app quit`);
}
