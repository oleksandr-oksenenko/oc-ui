/// <reference types="node" />
/// <reference types="@wdio/electron-service" />

import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "@wdio/globals";
import type { Capabilities } from "@wdio/types";

import {
  resolveSessionDataPath,
  USER_DATA_PATH_ARGUMENT_PREFIX,
} from "./src/main/user-data-path.ts";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const appBinaryPath = globalThis.process.env.OCUI_E2E_APP_BINARY_PATH ?? "";
const userDataPath = globalThis.process.env.OCUI_E2E_USER_DATA_PATH ?? "";
const artifactDirectory =
  globalThis.process.env.OCUI_E2E_ARTIFACT_DIRECTORY ?? join(desktopRoot, "dist", "wdio-artifacts");
const artifactName = globalThis.process.env.OCUI_E2E_ARTIFACT_NAME ?? "packaged-startup-failure";
const configuredMochaTimeout = Number(globalThis.process.env.OCUI_E2E_MOCHA_TIMEOUT_MS);
const mochaTimeout =
  Number.isFinite(configuredMochaTimeout) && configuredMochaTimeout > 0
    ? configuredMochaTimeout
    : 120_000;
const linux = globalThis.process.platform === "linux";

const capability: WebdriverIO.Capabilities = {
  browserName: "electron",
  "wdio:electronServiceOptions": {
    appBinaryPath,
    appArgs: [
      ...(linux
        ? [
            "--password-store=gnome-libsecret",
            // Xvfb has no GPU. Keep WebGL available through Chromium's CPU renderer.
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ]
        : ["--use-mock-keychain"]),
      ...(linux && globalThis.process.env.OCUI_E2E_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
      `${USER_DATA_PATH_ARGUMENT_PREFIX}${userDataPath}`,
      `--user-data-dir=${resolveSessionDataPath(userDataPath)}`,
    ],
    captureRendererLogs: true,
    captureMainProcessLogs: false,
  },
};
// ChromeDriver otherwise injects basic storage and the macOS mock switch.
if (linux) {
  capability["goog:chromeOptions"] = { excludeSwitches: ["password-store", "use-mock-keychain"] };
}
const capabilities: Capabilities.TestrunnerCapabilities = [capability];

export const config: WebdriverIO.Config = {
  runner: "local",
  rootDir: desktopRoot,
  specs: [join(desktopRoot, "test", "e2e", "packaged-startup.e2e.ts")],
  maxInstances: 1,
  capabilities,
  services: ["electron"],
  framework: "mocha",
  reporters: ["spec"],
  // execute results can include the local server credential during API verification.
  logLevel: "warn",
  outputDir: join(artifactDirectory, "logs"),
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 0,
  specFileRetries: 0,
  mochaOpts: {
    ui: "bdd",
    timeout: mochaTimeout,
    retries: 0,
  },
  onPrepare: () => {
    if (appBinaryPath.length === 0) {
      throw new Error("OCUI_E2E_APP_BINARY_PATH must be set by the packaged E2E runner");
    }
    if (userDataPath.length === 0) {
      throw new Error("OCUI_E2E_USER_DATA_PATH must be set by the packaged E2E runner");
    }
  },
  afterTest: async (test, _context, result) => {
    if (result.passed) return;
    try {
      await mkdir(artifactDirectory, { recursive: true });
      const title = test.title.replace(/[^a-zA-Z0-9_-]+/gu, "-").slice(0, 80);
      await browser.saveScreenshot(
        join(artifactDirectory, `${artifactName}-${title}-${randomUUID()}.png`),
      );
    } catch {
      // Preserve the original test failure when screenshot capture is unavailable.
    }
  },
};
