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
          },
        },
        {
          test: {
            name: "web",
            environment: "node",
            include: ["test/e2e/browser.test.mjs"],
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
