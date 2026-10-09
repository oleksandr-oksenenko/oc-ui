/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="@wdio/electron-service" />

import { OpenCode } from "@opencode/client";
import assert from "node:assert/strict";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { $, browser } from "@wdio/globals";
import type { DesktopApi } from "../../src/shared/desktop-api.ts";
import { OPENCODE_VERSION } from "../../src/shared/desktop-api.ts";
import { verifyBrowserFlows } from "./browser-flows.ts";
import { verifyConnectionSettings } from "./connection-flows.ts";
import { verifyProjectFlows } from "./project-flows.ts";
import { verifyProviderFlows } from "./provider-flows.ts";
import { verifySessionTools } from "./session-tools-flows.ts";
import { isOwnedProcessRunning } from "./owned-process.ts";
import { packagedArtifacts } from "./packaged-artifacts.mjs";
import { runnerPath } from "./runner-path.ts";

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
let artifactDirectory = fileURLToPath(new URL("../../dist/wdio-artifacts/", import.meta.url));
const projectDirectory = join(userDataPath, "acceptance-project");
const fixtureSessionIDs: string[] = [];
let startupStage = "automatic connection";
let startupSelector = "";
let startupReady = false;
let startupFailure: Error | undefined;

async function startupClick(stage: string, selector: string, timeout?: number): Promise<void> {
  startupStage = stage;
  startupSelector = selector;
  await $(selector).waitForClickable(timeout === undefined ? undefined : { timeout });
  // Readiness can span a render; query the current target for the single action.
  await $(selector).click();
}

describe("packaged owned OpenCode", () => {
  beforeEach(function () {
    if (this.currentTest?.title.startsWith("starts automatically")) return;
    if (!startupReady)
      throw new Error(`Packaged startup prerequisite failed during ${startupStage}`, {
        cause: startupFailure,
      });
  });

  it("starts automatically without a chooser and creates sessions in the bundled worker default directory", async () => {
    try {
      const runtime = await browser.electron.execute(async (electron) => {
        await electron.app.whenReady();
        return {
          isPackaged: electron.app.isPackaged,
          userData: electron.app.getPath("userData"),
          mockKeychain: electron.app.commandLine.hasSwitch("use-mock-keychain"),
          noSandbox: electron.app.commandLine.hasSwitch("no-sandbox"),
          passwordStore: electron.app.commandLine.getSwitchValue("password-store"),
          encryptionAvailable: electron.safeStorage.isEncryptionAvailable(),
          storageBackend:
            process.platform === "linux"
              ? electron.safeStorage.getSelectedStorageBackend()
              : undefined,
          platform: process.platform,
          arch: process.arch,
          executable: process.execPath,
          resources: process.resourcesPath,
          appPath: electron.app.getAppPath(),
          databasePath: process.env.OPENCODE_DB,
        };
      });
      assert.equal(runtime.isPackaged, true);
      assert.equal(runtime.userData, userDataPath);
      const ownedUserDataPath = runnerPath(userDataPath, runtime.userData);
      assert.equal(runtime.platform, globalThis.process.env.OCUI_E2E_PLATFORM);
      assert.equal(runtime.arch, globalThis.process.env.OCUI_E2E_ARCH);
      const expectedArtifacts = packagedArtifacts(
        fileURLToPath(new URL("../..", import.meta.url)),
        globalThis.process.platform,
        globalThis.process.arch,
        globalThis.process.platform === "linux"
          ? Schema.decodeUnknownSync(
              Schema.Struct({
                header: Schema.Struct({ glibcVersionRuntime: Schema.NonEmptyString }),
              }),
            )(globalThis.process.report.getReport()).header.glibcVersionRuntime
          : undefined,
      );
      assert.equal(
        await realpath(runtime.executable),
        await realpath(
          runnerPath(
            globalThis.process.env.OCUI_E2E_APP_BINARY_PATH,
            expectedArtifacts.appBinaryPath,
          ),
        ),
      );
      assert.equal(
        await realpath(runtime.resources),
        await realpath(
          runnerPath(globalThis.process.env.OCUI_E2E_RESOURCES_PATH, expectedArtifacts.resources),
        ),
      );
      const configuredArtifacts = globalThis.process.env.OCUI_E2E_ARTIFACT_DIRECTORY;
      if (configuredArtifacts !== undefined) {
        artifactDirectory = runnerPath(
          configuredArtifacts,
          join(dirname(runtime.userData), "artifacts"),
        );
      }
      await mkdir(artifactDirectory, { recursive: true });
      assert.equal(runtime.appPath, join(runtime.resources, "app.asar"));
      assert.equal(runtime.mockKeychain, runtime.platform === "darwin");
      assert.equal(runtime.encryptionAvailable, true);
      if (runtime.platform === "linux") {
        assert.equal(runtime.noSandbox, globalThis.process.env.OCUI_E2E_NO_SANDBOX === "1");
        assert.equal(runtime.passwordStore, "gnome-libsecret");
        assert.equal(runtime.storageBackend, "gnome_libsecret");
      }
      assert.equal(runtime.databasePath, globalThis.process.env.OPENCODE_DB);
      startupStage = "automatic connection";
      await waitForLocalConnection();
      assert.equal(await $("#connection-form-title").isExisting(), false);
      startupStage = "narrow native window";
      await resizeWindow(430, 600);
      assert.equal(
        await browser.execute(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      await browser.saveScreenshot(join(artifactDirectory, "owned-runtime-narrow.png"));
      startupStage = "wide native window";
      await resizeWindow(1280, 860);
      startupStage = "worker identity and health";
      const firstPid = await recordWorker();
      await verifyHealth(firstPid);
      assert.deepEqual(
        JSON.parse(await readFile(join(ownedUserDataPath, "connection-settings.json"), "utf8")),
        { kind: "local" },
      );
      await assert.rejects(access(join(ownedUserDataPath, "opencode", "service.json")), {
        code: "ENOENT",
      });
      await createBundledSessions();
      startupReady = true;
    } catch (cause) {
      startupFailure = new Error(`Packaged startup failed during ${startupStage}`, { cause });
      // Keep the first failure's safe state, rather than overwriting it with
      // later missing-fixture screenshots or dumping credentials/prompt text.
      try {
        const targetConnected = startupSelector ? await $(startupSelector).isExisting() : false;
        const state = await browser.execute(() => {
          const active = document.activeElement;
          const selected = document.querySelector('.shell-session-main[aria-current="page"]');
          const title = selected?.querySelector(".shell-session-title")?.textContent;
          return {
            active: active ? { tag: active.tagName, id: active.id } : undefined,
            dialog: document.querySelector('[role="dialog"]') !== null,
            menu: document.querySelector('[role="menu"], [role="listbox"]') !== null,
            selectedFixture:
              title === "Native fixture one" || title === "Native fixture two" ? title : "other",
          };
        });
        console.error("Packaged startup first failure", {
          stage: startupStage,
          selector: startupSelector,
          targetConnected,
          fixtureSessionIDs,
          state,
        });
      } catch (diagnosticError) {
        console.error("Packaged startup diagnostics unavailable", {
          stage: startupStage,
          diagnosticError,
        });
      }
      throw startupFailure;
    }
  });

  it("validates connections, saves encrypted credentials, reconnects, and forgets them", async () => {
    await verifyConnectionSettings(settingsPath);
    assert.deepEqual(await ownedWorkerPids(), [workerPids[0]]);
  });

  it("keeps the main document when a same-origin filesystem anchor is activated", async () => {
    await $(".shell-session-title=Native fixture one").waitForClickable();
    await $(".shell-session-title=Native fixture one").click();
    await $(".transcript-empty-state").waitForDisplayed();
    const initialUrl = await browser.getUrl();
    await browser.execute(() => {
      const link = document.createElement("a");
      link.id = "acceptance-file-navigation";
      link.href = "/private/tmp/not-an-ocui-asset.png";
      link.textContent = "Filesystem navigation regression";
      document.querySelector(".transcript-empty-state")!.append(link);
    });
    try {
      await $("#acceptance-file-navigation").click();
      assert.equal(await browser.getUrl(), initialUrl);
      await $(".shell-server-selector").waitForDisplayed();
      await browser.execute(() => {
        document.querySelector<HTMLAnchorElement>("#acceptance-file-navigation")!.href =
          "#acceptance-fragment";
      });
      await $("#acceptance-file-navigation").click();
      assert.equal(new URL(await browser.getUrl()).hash, "#acceptance-fragment");
    } finally {
      await browser.execute((url) => {
        document.getElementById("acceptance-file-navigation")?.remove();
        history.replaceState(null, "", url);
      }, initialUrl);
    }
  });

  it("saves supplied download bytes through trusted IPC and treats Save dialog cancellation normally", async () => {
    const ownedUserDataPath = runnerPath(
      userDataPath,
      await browser.electron.execute((electron) => electron.app.getPath("userData")),
    );
    const destination = join(ownedUserDataPath, "acceptance-download.bin");
    const saveDialog = await browser.electron.mock("dialog", "showSaveDialog");
    try {
      await saveDialog.mockResolvedValue({ canceled: false, filePath: destination });
      assert.equal(
        await browser.execute(async () => {
          await window.desktop.saveFile({
            name: "capture.bin",
            bytes: Uint8Array.from([0, 1, 255]),
          });
          return true;
        }),
        true,
      );
      assert.deepEqual(new Uint8Array(await readFile(destination)), Uint8Array.from([0, 1, 255]));
      await saveDialog.mockResolvedValue({ canceled: true, filePath: "" });
      assert.equal(
        await browser.execute(async () => {
          await window.desktop.saveFile({ name: "cancelled.bin", bytes: Uint8Array.from([3]) });
          return true;
        }),
        true,
      );
    } finally {
      await browser.electron.restoreAllMocks("dialog");
    }
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
    await browser.saveScreenshot(join(artifactDirectory, "owned-runtime-connected.png"));
  });

  it("runs the packaged terminal with bundled fonts and owns its processes through quit", async () => {
    await verifyBundledTerminal();
  });

  after(async () => {
    console.info("Owned worker PIDs before quit", {
      recorded: workerPids,
      current: await ownedWorkerPids().catch(() => undefined),
    });
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

/** Exercise packaged assets and real UI input, then leave a UI-owned PTY for quit. */
async function verifyBundledTerminal(): Promise<void> {
  await $(".shell-session-title=Native fixture one").waitForClickable();
  await $(".shell-session-title=Native fixture one").click();
  const result = await browser.execute(() => window.desktop.localOpenCode.connect());
  if (result.status !== "connected") throw new Error(result.message);
  const api = OpenCode.make({
    baseUrl: result.connection.serverUrl,
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${result.connection.password}`).toString("base64")}`,
    },
  });
  const location = { directory: await realpath(projectDirectory) };
  await $('[aria-label="Show terminal"]').waitForClickable();
  await $('[aria-label="Show terminal"]').click();
  const create = async () => {
    const existing = new Set((await api.pty.list({ location })).data.map((pty) => pty.id));
    await $('[aria-label="New terminal"]').waitForClickable();
    await $('[aria-label="New terminal"]').click();
    await browser.waitUntil(
      async () => {
        const surface = $(".terminal-surface:not([hidden])");
        if (!(await surface.isExisting())) return false;
        const id = await surface.getAttribute("data-terminal-id");
        return id !== null && !existing.has(id);
      },
      { timeout: STARTUP_TIMEOUT_MS },
    );
    // Creation has already returned a surface ID. Establish native spawn separately
    // from font/WASM/GPU initialization so a renderer failure cannot obscure it.
    const id = await $(".terminal-surface:not([hidden])").getAttribute("data-terminal-id");
    assert.ok(id);
    const info = (await api.pty.get({ ptyID: id, location })).data;
    assert.equal(info.cwd, location.directory);
    assert.equal(info.status, "running");
    assert.ok(Number.isSafeInteger(info.pid) && info.pid > 0);
    terminalPids.push(info.pid);
    globalThis.process.kill(info.pid, 0);
    try {
      await $('.terminal-surface:not([hidden])[data-ready="true"]').waitForDisplayed({
        timeout: STARTUP_TIMEOUT_MS,
      });
    } catch (cause) {
      // Only rendering state: never console logs, environment, credentials, or PTY output.
      const renderer = await browser
        .execute(() => {
          const surface = document.querySelector<HTMLElement>(".terminal-surface:not([hidden])");
          const canvas = document.createElement("canvas");
          const gl = canvas.getContext("webgl2");
          const webgl2 = gl !== null;
          gl?.getExtension("WEBGL_lose_context")?.loseContext();
          return {
            ready: surface?.dataset.ready,
            notice: surface?.querySelector(".terminal-renderer-notice span")?.textContent,
            width: surface?.clientWidth,
            height: surface?.clientHeight,
            webgl2,
          };
        })
        .catch(() => undefined);
      const gpu = await browser.electron
        .execute((electron) => electron.app.getGPUFeatureStatus())
        .catch(() => undefined);
      throw new Error(
        `Packaged terminal renderer did not initialize: ${JSON.stringify({ renderer, gpu, pty: { pid: info.pid, status: info.status } })}`,
        { cause },
      );
    }
    await browser.waitUntil(
      async () =>
        (await $('.terminal-panel-tab [role="tab"][aria-selected="true"]').getAttribute(
          "data-status",
        )) === "connected",
      { timeout: STARTUP_TIMEOUT_MS, timeoutMsg: "Packaged terminal did not connect" },
    );
    return info;
  };
  const terminal = await create();
  // Readiness and real input require the packaged WASM parser to initialize.
  // Also establish that its bundled font is delivered, rather than a fallback.
  // Chromium does not expose file-scheme fetches in Resource Timing. Resolve
  // the shipped asset through Electron's ASAR-aware filesystem instead.
  const font = await browser.electron.execute((electron) => {
    const fs = process.getBuiltinModule("node:fs");
    const path = process.getBuiltinModule("node:path");
    const directory = path.join(electron.app.getAppPath(), "out", "renderer", "assets");
    const names: string[] = fs.readdirSync(directory);
    const name = names.find((entry) => /^JetBrainsMonoNerdFontMono-Regular.*\.ttf$/u.test(entry));
    if (!name) throw new Error("Packaged terminal font is missing");
    return Array.from(fs.readFileSync(path.join(directory, name)).subarray(0, 4));
  });
  assert.deepEqual(font, [0, 1, 0, 0]);
  await $('.terminal-surface:not([hidden]) [aria-label="Terminal output"]').click();
  await browser.waitUntil(
    async () =>
      (await browser.execute(() => document.activeElement?.getAttribute("aria-label"))) ===
      "Terminal input",
  );
  await browser.keys(
    "pwd -P > .git/packaged-terminal-cwd.txt; printf 'packaged-terminal\\n' > .git/packaged-terminal-input.txt",
  );
  await browser.keys("Enter");
  await browser.waitUntil(
    async () =>
      (await readFile(join(projectDirectory, ".git", "packaged-terminal-input.txt"), "utf8").catch(
        () => "",
      )) === "packaged-terminal\n",
    {
      timeout: STARTUP_TIMEOUT_MS,
      timeoutMsg: "Packaged terminal keyboard input did not reach the bundled server",
    },
  );
  assert.equal(
    await readFile(join(projectDirectory, ".git", "packaged-terminal-cwd.txt"), "utf8"),
    `${location.directory}\n`,
  );
  await browser.saveScreenshot(join(artifactDirectory, "packaged-terminal.png"));
  const title = await $('.terminal-panel-tab [role="tab"][aria-selected="true"]').getAttribute(
    "aria-label",
  );
  await $(`[aria-label="Close terminal ${title}"]`).click();
  await browser.waitUntil(
    async () => !(await api.pty.list({ location })).data.some((pty) => pty.id === terminal.id),
    {
      timeout: STARTUP_TIMEOUT_MS,
      timeoutMsg: "Closing the packaged terminal left its server PTY behind",
    },
  );
  await waitForProcessExit(terminal.pid);
  const remaining = await create();
  assert.notEqual(remaining.id, terminal.id);
  await $('.terminal-surface:not([hidden]) [aria-label="Terminal output"]').click();
  await browser.keys("exec /bin/sh -c 'read remaining'");
  await browser.keys("Enter");
  // after() verifies this live terminal and the bundled worker both exit on quit.
  globalThis.process.kill(remaining.pid, 0);
}

/** Supply the two sessions needed by later native-boundary checks. */
async function createBundledSessions(): Promise<void> {
  await startupClick("open new session", '[aria-label="Create session"]', STARTUP_TIMEOUT_MS);
  await $(".new-session-screen").waitForDisplayed();
  await startupClick("open project picker", 'button[aria-label^="Project:"]');
  await startupClick("open directory browser", "button=Add project…");
  assert.equal(
    await $(".server-directory-browser-path").getText(),
    await realpath(projectDirectory),
  );
  await startupClick("register project", '.server-flow-dialog button[type="submit"]');
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
  for (const title of ["Native fixture one", "Native fixture two"]) {
    startupStage = `seed ${title}`;
    fixtureSessionIDs.push((await api.session.create({ title })).id);
  }
  await startupClick("select first fixture", ".shell-session-title=Native fixture one");
  startupStage = "first fixture transcript";
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
  const [contentWidth, contentHeight] = await browser.electron.execute(
    (electron, nextWidth, nextHeight) => {
      const window = electron.BrowserWindow.getAllWindows()[0];
      if (window === undefined) throw new Error("Acceptance window is missing");
      const bounds = window.getBounds();
      const content = window.getContentBounds();
      const { workAreaSize } = electron.screen.getDisplayMatching(bounds);
      // CI displays can be smaller than the wide viewport. Allow room for the
      // native frame (including Linux decorations), then require that exact size.
      const targetWidth = Math.min(nextWidth, workAreaSize.width - (bounds.width - content.width));
      const targetHeight = Math.min(
        nextHeight,
        workAreaSize.height - (bounds.height - content.height),
      );
      window.setContentSize(targetWidth, targetHeight);
      return [targetWidth, targetHeight];
    },
    width,
    height,
  );
  await browser.waitUntil(
    async () => {
      const viewport = await browser.execute(() => [window.innerWidth, window.innerHeight]);
      return viewport[0] === contentWidth && viewport[1] === contentHeight;
    },
    {
      timeoutMsg: `Renderer did not settle at ${contentWidth}×${contentHeight} (requested ${width}×${height})`,
    },
  );
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
    if (!(await isOwnedProcessRunning(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const state =
    globalThis.process.platform === "linux"
      ? await readFile(`/proc/${pid}/status`, "utf8")
          .then((status) => status.match(/^(?:State|PPid):.*$/gmu)?.join(", "))
          .catch(() => "process status unavailable")
      : undefined;
  throw new Error(`Owned OpenCode process ${pid} survived app quit${state ? ` (${state})` : ""}`);
}
