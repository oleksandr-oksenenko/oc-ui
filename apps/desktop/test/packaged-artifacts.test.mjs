// @vitest-environment node
// oxlint-disable effecttsgo/node-builtin-import -- Validate the packaged acceptance artifact boundary.
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { assertElfX64, packagedArtifacts } from "./e2e/packaged-artifacts.mjs";

it("retains the macOS bundle layout and native spawn helper", () => {
  const artifacts = packagedArtifacts("desktop", "darwin", "arm64");
  expect(artifacts.appBinaryPath).toBe(
    join("desktop", "dist", "mac-arm64", "Ocui.app", "Contents", "MacOS", "Ocui"),
  );
  expect(artifacts.executables).toContain(
    join(
      artifacts.appDirectory,
      "Contents",
      "Resources",
      "opencode-runtime",
      "node_modules",
      "@lydell",
      "node-pty-darwin-arm64",
      "prebuilds",
      "darwin-arm64",
      "spawn-helper",
    ),
  );
});

it("checks Linux GNU PTY and glibc watcher without requiring a nonexistent spawn helper", () => {
  const artifacts = packagedArtifacts("desktop", "linux", "x64", "2.39");
  const runtime = join(
    "desktop",
    "dist",
    "linux-unpacked",
    "resources",
    "opencode-runtime",
    "node_modules",
  );
  expect(artifacts.appBinaryPath).toBe(join("desktop", "dist", "linux-unpacked", "ocui"));
  expect(artifacts.executables).toEqual([
    artifacts.appBinaryPath,
    join(runtime, "@opencode-ai", "pty-linux-x64-gnu", "bin", "opencode-pty"),
  ]);
  expect(artifacts.bindings).toEqual([
    join(runtime, "@lydell", "node-pty-linux-x64", "prebuilds", "linux-x64", "pty.node"),
    join(runtime, "@parcel", "watcher-linux-x64-glibc", "watcher.node"),
  ]);
});

it.each([
  ["darwin", "x64", undefined],
  ["linux", "arm64", "2.39"],
  ["linux", "x64", undefined],
  ["win32", "x64", undefined],
])("rejects unsupported acceptance target %s/%s (glibc %s)", (platform, arch, glibc) => {
  expect(() => packagedArtifacts("desktop", platform, arch, glibc)).toThrow(
    "macOS arm64 or Linux x64/glibc",
  );
});

function elf(type = 3) {
  const header = Buffer.alloc(64);
  header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  header.writeUInt16LE(type, 16);
  header.writeUInt16LE(62, 18);
  header.writeUInt32LE(1, 20);
  header.writeUInt16LE(64, 52);
  return header;
}

it.each([2, 3])("accepts x86-64 ELF type %s (executable, PIE or binding)", (type) => {
  expect(() => assertElfX64(elf(type), "native-file")).not.toThrow();
});

it.each([
  [0, 0], // not ELF
  [4, 1], // 32-bit
  [5, 2], // big-endian
  [6, 0], // invalid ELF version
  [16, 1], // relocatable object, not an executable or binding
  [18, 183], // AArch64
  [20, 0], // invalid header version
  [52, 0], // invalid ELF64 header size
])("rejects incompatible ELF header byte %s = %s", (offset, value) => {
  const header = elf();
  header[offset] = value;
  expect(() => assertElfX64(header, "wrong-native-file")).toThrow("wrong-native-file");
});

it("rejects a truncated ELF header rather than reading beyond the buffer", () => {
  expect(() => assertElfX64(elf().subarray(0, 63), "truncated")).toThrow("truncated");
});
