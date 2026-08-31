/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="@wdio/electron-service" />

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { $, browser } from "@wdio/globals";

const STARTUP_TIMEOUT_MS = 45_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;
const userDataPath = globalThis.process.env.OCUI_E2E_USER_DATA_PATH;

if (userDataPath === undefined || userDataPath.length === 0) {
  throw new Error("OCUI_E2E_USER_DATA_PATH must be set by the packaged E2E runner");
}

const serviceRegistrationPath = join(userDataPath, "opencode", "service.json");
const settingsPath = join(userDataPath, "connection-settings.json");

describe("packaged startup", () => {
  it("starts the packaged app and connects its built-in server", async () => {
    const runtime = await browser.electron.execute((electron) => ({
      isPackaged: electron.app.isPackaged,
      userData: electron.app.getPath("userData"),
    }));

    assert.equal(runtime.isPackaged, true);
    assert.equal(runtime.userData, userDataPath);

    const connectionHeading = $("#connection-form-title");
    await connectionHeading.waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });
    assert.equal(await connectionHeading.getText(), "Connect to OpenCode");

    const startBuiltInServer = $("button*=Start built-in server");
    await startBuiltInServer.waitForClickable({ timeout: STARTUP_TIMEOUT_MS });
    await startBuiltInServer.click();

    const sessions = $('[aria-label="Sessions"]');
    await sessions.waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });

    const localConnectedSelector = '[aria-label="Select server, Local server, Connected"]';
    const localConnected = sessions.$(localConnectedSelector);
    await localConnected.waitForDisplayed({ timeout: STARTUP_TIMEOUT_MS });
    await waitForPathCreation(
      serviceRegistrationPath,
      "OpenCode service registration",
      STARTUP_TIMEOUT_MS,
    );
    await waitForPathCreation(settingsPath, "Connection settings file", STARTUP_TIMEOUT_MS);
    assert.deepEqual(JSON.parse(await readFile(settingsPath, "utf8")), { kind: "local" });
  });

  after(async () => {
    // Queue quit asynchronously so the Electron execute call can complete first.
    await browser.electron.execute((electron) => {
      setTimeout(() => electron.app.quit(), 0);
    });

    await waitForPathRemoval(serviceRegistrationPath, SHUTDOWN_TIMEOUT_MS);
    // The app owns sidecar cleanup; WDIO owns the final Electron process reap.
  });
});

async function waitForPathRemoval(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
    } catch (cause) {
      if (isNodeError(cause) && cause.code === "ENOENT") return;
      throw cause;
    }
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`OpenCode service registration was not removed within ${timeoutMs}ms`);
}

async function waitForPathCreation(
  path: string,
  description: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch (cause) {
      if (!isNodeError(cause) || cause.code !== "ENOENT") throw cause;
    }
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`${description} was not created within ${timeoutMs}ms`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isNodeError(cause: unknown): cause is NodeJS.ErrnoException {
  return cause instanceof Error && "code" in cause;
}
