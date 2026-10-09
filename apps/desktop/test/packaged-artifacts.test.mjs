// @vitest-environment node
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  assertElfX64,
  packagedArtifacts,
  verifyPackagedApplication,
} from "./e2e/packaged-artifacts.mjs";

const directories = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});

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

const elf64 = `ELF Header:
  Class: ELF64
  Data: 2's complement, little endian
  Version: 1 (current)
  Type: DYN (Shared object file)
  Machine: Advanced Micro Devices X86-64
  Version: 0x1
  Size of this header: 64 (bytes)
`;

it.each(["EXEC", "DYN"])("accepts readelf x86-64 type %s (executable, PIE or binding)", (type) => {
  expect(() =>
    assertElfX64(elf64.replace("Type: DYN", `Type: ${type}`), "native-file"),
  ).not.toThrow();
});

it.each([
  ["Class: ELF64", "Class: ELF32"],
  ["Data: 2's complement, little endian", "Data: 2's complement, big endian"],
  ["Version: 1 (current)", "Version: 0"],
  ["Type: DYN", "Type: REL"],
  ["Machine: Advanced Micro Devices X86-64", "Machine: AArch64"],
  ["Version: 0x1", "Version: 0x0"],
  ["Size of this header: 64 (bytes)", "Size of this header: 0 (bytes)"],
])("rejects incompatible readelf header %s", (expected, incompatible) => {
  expect(() => assertElfX64(elf64.replace(expected, incompatible), "wrong-native-file")).toThrow(
    "wrong-native-file",
  );
});

it.each(["", "readelf: Error: Not an ELF file", "ELF Header:\n  Class: ELF64\n"])(
  "rejects missing, invalid, or truncated readelf headers: %s",
  (header) => {
    expect(() => assertElfX64(header, "truncated")).toThrow("truncated");
  },
);

async function fixture(platform = "linux") {
  const root = await mkdtemp(join(tmpdir(), "ocui-artifacts-unit-"));
  directories.push(root);
  const artifacts = packagedArtifacts(
    root,
    platform,
    platform === "linux" ? "x64" : "arm64",
    platform === "linux" ? "2.39" : undefined,
  );
  for (const path of [...artifacts.executables, ...artifacts.bindings, ...artifacts.assets]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      path.endsWith(".wasm") ? Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]) : "fixture",
      { mode: 0o755 },
    );
  }
  return artifacts;
}

it("retains strict macOS codesign verification and arm64 validation of executables and addons", async () => {
  const artifacts = await fixture("darwin");
  const run = vi.fn(async () => ({ stdout: "arm64\n" }));
  await verifyPackagedApplication(artifacts, new AbortController().signal, run);
  expect(run.mock.calls[0].slice(0, 2)).toEqual([
    "codesign",
    ["--verify", "--deep", "--strict", artifacts.appDirectory],
  ]);
  const binaries = run.mock.calls.slice(1, -1).map(([command, args]) => {
    expect(command).toBe("lipo");
    return args[1];
  });
  expect(new Set(binaries)).toEqual(new Set([...artifacts.executables, ...artifacts.bindings]));
  expect(run.mock.calls.at(-1)[0]).toBe(process.execPath);
});

it("validates additional host-native and untagged bindings while skipping foreign and musl prebuilds", async () => {
  const artifacts = await fixture();
  const root = join(artifacts.runtimePath, "node_modules", "multi-platform", "prebuilds");
  const selected = [join(root, "linux-x64", "binding.node"), join(root, "untagged.node")];
  const foreign = [
    join(root, "darwin-arm64", "binding.node"),
    join(root, "linux-arm64", "binding.node"),
    join(root, "linux-x64-musl", "binding.node"),
  ];
  for (const path of [...selected, ...foreign]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "fixture");
  }
  const run = vi.fn(async (_command, args) => ({
    stdout: foreign.includes(args[1])
      ? elf64.replace("Machine: Advanced Micro Devices X86-64", "Machine: AArch64")
      : elf64,
  }));
  await verifyPackagedApplication(artifacts, new AbortController().signal, run);
  const checked = run.mock.calls.map(([_command, args]) => args[1]);
  for (const path of selected) expect(checked).toContain(path);
  for (const path of foreign) expect(checked).not.toContain(path);
});

it.each([
  ["binary", elf64.replace("Class: ELF64", "Class: ELF32")],
  ["addon", elf64.replace("Machine: Advanced Micro Devices X86-64", "Machine: AArch64")],
])(
  "checks ELF headers with readelf and rejects a wrong-architecture %s",
  async (target, header) => {
    const artifacts = await fixture();
    const wrongPath = target === "binary" ? artifacts.appBinaryPath : artifacts.bindings[0];
    const run = vi.fn(async (_command, args) => ({
      stdout: args[1] === wrongPath ? header : elf64,
    }));
    await expect(
      verifyPackagedApplication(artifacts, new AbortController().signal, run),
    ).rejects.toThrow("Linux ELF64 x86-64");
    expect(run.mock.calls.every(([command]) => command === "readelf")).toBe(true);
  },
);

it("rejects missing packaged ASAR, missing WASM, and a non-executable PTY before launch", async () => {
  const artifacts = await fixture();
  const run = vi.fn(async () => ({ stdout: elf64 }));
  await verifyPackagedApplication(artifacts, new AbortController().signal, run);
  const pty = artifacts.executables[1];
  await chmod(pty, 0o644);
  await expect(
    verifyPackagedApplication(artifacts, new AbortController().signal, run),
  ).rejects.toThrow();
  await chmod(pty, 0o755);
  await rm(join(artifacts.resources, "app.asar"));
  await expect(
    verifyPackagedApplication(artifacts, new AbortController().signal, run),
  ).rejects.toThrow("app.asar");
  await writeFile(join(artifacts.resources, "app.asar"), "fixture");
  await rm(join(artifacts.runtimePath, "node_modules/web-tree-sitter/tree-sitter.wasm"));
  await expect(
    verifyPackagedApplication(artifacts, new AbortController().signal, run),
  ).rejects.toThrow("tree-sitter.wasm");
});

it("rejects a missing packaged core dependency even when the image plugin file exists", async () => {
  const artifacts = await fixture();
  await rm(join(artifacts.runtimePath, "node_modules/@opencode/core/package.json"));
  const run = vi.fn();
  await expect(
    verifyPackagedApplication(artifacts, new AbortController().signal, run),
  ).rejects.toThrow("package.json");
  expect(run).not.toHaveBeenCalled();
});

it("rejects a packaged asset directory or invalid WASM module before native validation", async () => {
  const artifacts = await fixture();
  const run = vi.fn(async () => ({ stdout: elf64 }));
  const worker = join(artifacts.runtimePath, "opencode-worker.mjs");
  await rm(worker);
  await mkdir(worker);
  await expect(
    verifyPackagedApplication(artifacts, new AbortController().signal, run),
  ).rejects.toThrow("Packaged asset is not a file");
  await rm(worker, { recursive: true });
  await writeFile(worker, "fixture");
  await writeFile(
    join(artifacts.runtimePath, "node_modules/web-tree-sitter/tree-sitter.wasm"),
    "invalid wasm",
  );
  await expect(
    verifyPackagedApplication(artifacts, new AbortController().signal, run),
  ).rejects.toThrow("Invalid packaged WASM");
  expect(run).not.toHaveBeenCalled();
});

it("preserves readelf failures for malformed or truncated native files", async () => {
  const artifacts = await fixture();
  const failure = new Error("readelf: Error: Failed to read file header");
  await expect(
    verifyPackagedApplication(artifacts, new AbortController().signal, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
});
