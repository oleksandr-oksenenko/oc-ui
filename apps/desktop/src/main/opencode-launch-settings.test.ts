// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";

import { configureOpenCodeLaunch } from "./opencode-launch-settings.ts";

const { resolve } = vi.hoisted(() => ({
  resolve: vi.fn(() => "/runtime/native/bin/opencode-pty"),
}));

vi.mock("@opencode/util/global", () => ({
  Global: { Path: { data: "/shared/opencode-data" } },
}));
vi.mock("node:module", () => ({
  createRequire: () => ({ resolve }),
}));

describe("owned OpenCode launch settings", () => {
  it.each([
    ["linux", "x64", "@opencode-ai/pty-linux-x64-gnu/bin/opencode-pty"],
    ["darwin", "arm64", "@opencode-ai/pty-darwin-arm64/bin/opencode-pty"],
  ])(
    "resolves the staged PTY binary on %s %s before library startup",
    async (platform, arch, binary) => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
      const originalArch = Object.getOwnPropertyDescriptor(process, "arch")!;
      Object.defineProperty(process, "platform", { value: platform });
      Object.defineProperty(process, "arch", { value: arch });
      try {
        const env: NodeJS.ProcessEnv = {};
        await configureOpenCodeLaunch("/ocui", env);
        expect(resolve).toHaveBeenLastCalledWith(binary);
        expect(env.OPENCODE_PTY_BIN).toBe("/runtime/native/bin/opencode-pty");
      } finally {
        Object.defineProperty(process, "platform", originalPlatform);
        Object.defineProperty(process, "arch", originalArch);
      }
    },
  );

  it("separates user config while retaining the normal environment and shared database", async () => {
    const env: NodeJS.ProcessEnv = {
      HOME: "/real-home",
      PATH: "/real-path",
      XDG_DATA_HOME: "/shared",
      XDG_STATE_HOME: "/shared-state",
      OPENCODE_CONFIG: "/normal/config.json",
      OPENCODE_CONFIG_CONTENT: "private-overrides",
      OPENCODE_CONFIG_DIR: "/normal/config-directory",
      PROVIDER_TOKEN: "inherited-only",
    };
    const settings = await configureOpenCodeLaunch("/ocui/user-data", env);
    expect(settings).toEqual({
      database: { path: "/shared/opencode-data/opencode.db" },
      config: {
        directory: "/ocui/user-data/opencode/config",
        project: true,
        content: JSON.stringify({
          plugins: [{ package: new URL("./session-tools/", import.meta.url).href }],
        }),
      },
    });
    expect(env).toEqual({
      HOME: "/real-home",
      PATH: "/real-path",
      XDG_DATA_HOME: "/shared",
      XDG_STATE_HOME: "/shared-state",
      OPENCODE_CONFIG_DIR: "/ocui/user-data/opencode/config",
      OPENCODE_CLIENT: "oc-ui",
      OPENCODE_PTY_BIN: "/runtime/native/bin/opencode-pty",
      PROVIDER_TOKEN: "inherited-only",
    });
  });

  it.each([
    ["custom.db", "/shared/opencode-data/custom.db"],
    ["/explicit/custom.db", "/explicit/custom.db"],
  ])("uses the existing CLI database convention for %s", async (database, expected) => {
    const settings = await configureOpenCodeLaunch("/ocui", { OPENCODE_DB: database });
    expect(settings.database.path).toBe(expected);
  });

  it("rejects in-memory persistence", async () => {
    await expect(configureOpenCodeLaunch("/ocui", { OPENCODE_DB: ":memory:" })).rejects.toThrow(
      "persistent database",
    );
  });
});
