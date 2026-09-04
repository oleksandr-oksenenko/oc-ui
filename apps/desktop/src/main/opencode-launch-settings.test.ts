// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";

import { configureOpenCodeLaunch } from "./opencode-launch-settings.ts";

vi.mock("@opencode-ai/util/global", () => ({
  Global: { Path: { data: "/shared/opencode-data" } },
}));
vi.mock("node:module", () => ({
  createRequire: () => ({ resolve: () => "/runtime/native/bin/opencode-pty" }),
}));

describe("owned OpenCode launch settings", () => {
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
      config: { directory: "/ocui/user-data/opencode/config", project: true, content: "{}" },
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
