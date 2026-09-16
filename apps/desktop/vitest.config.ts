import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { defineConfig, mergeConfig } from "vite-plus/test/config";
import { playwright } from "vite-plus/test/browser-playwright";

import viteConfig from "./vite.config.ts";

const storybookConfigDir = fileURLToPath(new URL(".storybook", import.meta.url));

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Persist Vite's transformed modules across runs so warm test runs skip
      // re-transforming large inline dependency graphs.
      experimental: {
        fsModuleCache: true,
      },
      server: {
        deps: {
          inline: true,
        },
      },
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "jsdom",
            include: ["src/**/*.test.{ts,tsx}", "test/*.test.mjs"],
            setupFiles: ["./test/setup-dom.ts"],
          },
        },
        {
          test: {
            name: "web",
            environment: "node",
            include: ["test/e2e/browser.test.mjs", "test/e2e/opencode-server.test.mjs"],
            hookTimeout: 60_000,
            testTimeout: 180_000,
            expect: { poll: { timeout: 30_000 } },
          },
        },
        {
          extends: true,
          plugins: [
            storybookTest({
              configDir: storybookConfigDir,
            }),
          ],
          test: {
            name: "storybook",
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              instances: [{ browser: "chromium" }],
            },
          },
        },
      ],
    },
  }),
);
