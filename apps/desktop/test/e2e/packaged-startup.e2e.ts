/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="@wdio/electron-service" />

import { OpenCode } from "@opencode/client";
import assert from "node:assert/strict";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { $, browser } from "@wdio/globals";
import type { DesktopApi } from "../../src/shared/desktop-api.ts";
import { OPENCODE_VERSION } from "../../src/shared/desktop-api.ts";
import { verifyBrowserFlows } from "./browser-flows.ts";
import { verifyConnectionSettings } from "./connection-flows.ts";
import { verifyProjectFlows } from "./project-flows.ts";
import { verifyProviderFlows } from "./provider-flows.ts";
import { verifySessionTools } from "./session-tools-flows.ts";

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
  it("starts automatically without a chooser and creates sessions in the bundled worker default directory", async () => {
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
    await waitForLocalConnection();
    assert.equal(await $("#connection-form-title").isExisting(), false);
    await resizeWindow(430, 600);
    assert.equal(
      await browser.execute(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await browser.saveScreenshot(join(artifactDirectory, "owned-runtime-narrow.png"));
    await resizeWindow(1280, 860);
    const firstPid = await recordWorker();
    await verifyHealth(firstPid);
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { kind: "local" });
    await assert.rejects(access(join(userDataPath, "opencode", "service.json")), {
      code: "ENOENT",
    });
    await createBundledSessions();
  });

  it("validates connections, saves encrypted credentials, reconnects, and forgets them", async () => {
    await verifyConnectionSettings(settingsPath);
    assert.deepEqual(await ownedWorkerPids(), [workerPids[0]]);
  });

  it("recovers the bundled-server transcript across renderer reload and reconnect", async () => {
    await verifyProviderFlows();
    await browser.saveScreenshot(join(artifactDirectory, "provider-flows-complete.png"));
  });

  it("shares an embedded browser with the agent and releases its native resources", async () => {
    try {
      await verifyBrowserFlows(artifactDirectory);
    } finally {
      const diff = $("button=Diff");
      if (await diff.isDisplayed()) await diff.click();
    }
  });

  it("updates diffs and keeps a worktree after deleting its session", async () => {
    await verifyProjectFlows(projectDirectory);
    await browser.saveScreenshot(join(artifactDirectory, "project-flows-complete.png"));
  });

  it("loads the bundled session tool and creates independent worktree sessions", async () => {
    await verifySessionTools(projectDirectory);
  });

  it("keeps the worker across renderer reload and restarts only on request", async () => {
    const firstPid = workerPids[0];
    assert.ok(firstPid !== undefined);

    await $('[aria-label="Create session"]').click();
    await $(".new-session-screen").waitForDisplayed();
    await $('[aria-label="Prompt"]').setValue("Native persistent draft");
    await browser.execute(() => {
      const clipboardData = new DataTransfer();
      clipboardData.items.add(
        new File(["Native durable bytes"], "native.txt", { type: "text/plain" }),
      );
      document
        .querySelector('[aria-label="Prompt"]')!
        .dispatchEvent(
          new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
        );
    });
    await $('[aria-label="Remove native.txt"]').waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            new Promise<boolean>((resolve, reject) => {
              const request = indexedDB.open("ocui");
              request.addEventListener("error", () => reject(request.error));
              request.addEventListener("success", () => {
                const db = request.result;
                const transaction = db.transaction("drafts", "readonly");
                const records = transaction.objectStore("drafts").getAll();
                transaction.addEventListener("complete", () => {
                  db.close();
                  resolve(
                    records.result.some(
                      (record) =>
                        record.text === "Native persistent draft" &&
                        record.serverKey === "built-in" &&
                        record.attachments.length === 1,
                    ),
                  );
                });
                transaction.addEventListener("abort", () => {
                  db.close();
                  reject(transaction.error);
                });
              });
            }),
        ),
      { timeout: STARTUP_TIMEOUT_MS },
    );

    // Renderer reload reconnects automatically to the same app-owned server.
    await browser.refresh();
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
    await $(".session-drafts").$(".shell-session-title=Native persistent draft").waitForClickable();
    await $(".session-drafts").$(".shell-session-title=Native persistent draft").click();
    await browser.waitUntil(
      async () => (await $('[aria-label="Prompt"]').getText()) === "Native persistent draft",
    );
    assert.equal(await $('[aria-label="Send"]').isEnabled(), false);
    await $('[aria-label="Remove native.txt"]').waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });
    assert.equal(
      await browser.execute(
        () =>
          new Promise<string>((resolve, reject) => {
            const opening = indexedDB.open("ocui");
            opening.addEventListener("error", () => reject(opening.error));
            opening.addEventListener("success", () => {
              const db = opening.result;
              const request = db.transaction("attachments").objectStore("attachments").getAll();
              request.addEventListener("success", () => {
                db.close();
                const file = request.result.find((row) => row.name === "native.txt");
                if (!file) {
                  reject(new Error("Native draft bytes were not restored"));
                  return;
                }
                void file.blob.text().then(resolve, reject);
              });
              request.addEventListener("error", () => {
                db.close();
                reject(request.error);
              });
            });
          }),
      ),
      "Native durable bytes",
    );

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
    // Quit no longer asks. Mock native dialogs so a stop failure cannot block the run.
    const dialogs = await browser.electron.mock("dialog", "showMessageBox");
    await dialogs.mockResolvedValue({ response: 0, checkboxChecked: false });
    // Let the execute reply reach WDIO before the app closes its renderer.
    await browser.electron.execute((electron) => {
      setTimeout(() => electron.app.quit(), 0);
    });
    for (const pid of workerPids) await waitForProcessExit(pid);
    for (const pid of terminalPids) await waitForProcessExit(pid);
  });
});

/** Supply the two sessions needed by later native-boundary checks. */
async function createBundledSessions(): Promise<void> {
  await $('[aria-label="Create session"]').waitForClickable({ timeout: STARTUP_TIMEOUT_MS });
  await $('[aria-label="Create session"]').click();
  await $(".new-session-screen").waitForDisplayed();
  await $('button[aria-label^="Project:"]').click();
  await $("button=Add project…").click();
  assert.equal(
    await $(".server-directory-browser-path").getText(),
    await realpath(projectDirectory),
  );
  await $('.server-flow-dialog button[type="submit"]').waitForClickable();
  await $('.server-flow-dialog button[type="submit"]').click();
  await $(".server-flow-dialog").waitForExist({ reverse: true });
  // Submission is the next slice. Seed existing sessions for the native flows.
  const result = await browser.execute(() => window.desktop.localOpenCode.connect());
  if (result.status !== "connected") throw new Error(result.message);
  const api = OpenCode.make({
    baseUrl: result.connection.serverUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${result.connection.password}`).toString("base64")}`,
    },
  });
  await api.session.create({ title: "Native fixture one" });
  await api.session.create({ title: "Native fixture two" });
  await $(".shell-session-title=Native fixture one").waitForClickable();
  await $(".shell-session-title=Native fixture one").click();
  await $(".transcript-empty-state").waitForDisplayed();
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
  assert.equal(health.body.version, OPENCODE_VERSION);
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
