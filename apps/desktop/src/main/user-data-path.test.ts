import { describe, expect, it } from "vite-plus/test";

import { resolveSessionDataPath, resolveUserDataPath } from "./user-data-path.ts";

describe("resolveSessionDataPath", () => {
  it("keeps Chromium state under the app profile", () => {
    expect(resolveSessionDataPath("/var/lib/Ocui")).toBe("/var/lib/Ocui/Session Data");
  });
});

describe("resolveUserDataPath", () => {
  it("uses the Ocui directory under app data by default", () => {
    expect(resolveUserDataPath("/var/lib/Ocui", [])).toBe("/var/lib/Ocui");
  });

  it("uses an absolute command-line override", () => {
    expect(resolveUserDataPath("/var/lib/Ocui", ["--ocui-user-data-path=/tmp/ocui"])).toBe(
      "/tmp/ocui",
    );
  });

  it("ignores unknown arguments", () => {
    expect(resolveUserDataPath("/var/lib/Ocui", ["--verbose"])).toBe("/var/lib/Ocui");
  });

  it("rejects an empty override", () => {
    expect(() => resolveUserDataPath("/var/lib/Ocui", ["--ocui-user-data-path="])).toThrow(
      "nonempty absolute path",
    );
  });

  it("rejects a relative override", () => {
    expect(() => resolveUserDataPath("/var/lib/Ocui", ["--ocui-user-data-path=ocui"])).toThrow(
      "must be an absolute path",
    );
  });

  it("rejects duplicate overrides", () => {
    expect(() =>
      resolveUserDataPath("/var/lib/Ocui", [
        "--ocui-user-data-path=/tmp/one",
        "--ocui-user-data-path=/tmp/two",
      ]),
    ).toThrow("Duplicate --ocui-user-data-path arguments");
  });
});
