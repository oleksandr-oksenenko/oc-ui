/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="@wdio/electron-service" />

import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $, browser } from "@wdio/globals";
import type { DesktopApi } from "../../src/shared/desktop-api.ts";

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

describe("packaged owned OpenCode", () => {
  it("starts lazily, reconnects without replacing the worker, and restarts only on request", async () => {
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
