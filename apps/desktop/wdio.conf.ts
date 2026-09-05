/// <reference types="node" />
/// <reference types="@wdio/electron-service" />

import { mkdir } from "node:fs/promises";
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

const capabilities: Capabilities.TestrunnerCapabilities = [
  {
    browserName: "electron",
    "wdio:electronServiceOptions": {
      appBinaryPath,
      appArgs: [
        "--use-mock-keychain",
        `${USER_DATA_PATH_ARGUMENT_PREFIX}${userDataPath}`,
        `--user-data-dir=${resolveSessionDataPath(userDataPath)}`,
      ],
      captureRendererLogs: true,
      captureMainProcessLogs: false,
    },
  },
];

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
  afterTest: async (_test, _context, result) => {
    if (result.passed) return;
    try {
      await mkdir(artifactDirectory, { recursive: true });
      await browser.saveScreenshot(join(artifactDirectory, `${artifactName}.png`));
    } catch {
      // Preserve the original test failure when screenshot capture is unavailable.
    }
  },
};
