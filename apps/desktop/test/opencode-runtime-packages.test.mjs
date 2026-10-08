// @vitest-environment node
// oxlint-disable effecttsgo/node-builtin-import -- Exercise the build-time filesystem package boundary.
import { createRequire } from "node:module";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vite-plus/test";

import { stagePackageClosure } from "../../../tools/opencode-runtime-packages.mjs";
import {
  assertRuntimePackagingTarget,
  openCodeRuntimeDependencies,
} from "../../../tools/opencode-runtime-native.mjs";
import packaging from "../electron-builder.config.mjs";

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "ocui-package-closure-"));
  directories.push(directory);
  return directory;
}

function writePackage(directory, manifest) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify(manifest));
  writeFileSync(
    join(directory, "index.js"),
    `module.exports = ${JSON.stringify(manifest.version)};`,
  );
}

it("maps the runtime package directory explicitly because electron-builder skips root node_modules", () => {
  expect(packaging.extraResources).toContainEqual({
    from: "out/opencode-runtime/node_modules",
    to: "opencode-runtime/node_modules",
    filter: ["**/*"],
  });
});

it("copies only the dependency closure and preserves conflicting nested versions and cycles", () => {
  const directory = fixture();
  const install = join(directory, "install");
  const runtime = join(directory, "runtime");
  const a = join(install, "node_modules/a");
  const b = join(install, "node_modules/b");
  writePackage(a, { name: "a", version: "1", dependencies: { b: "1", shared: "1" } });
  writePackage(b, { name: "b", version: "1", dependencies: { a: "1", shared: "2" } });
  writePackage(join(install, "node_modules/shared"), { name: "shared", version: "1" });
  writePackage(join(b, "node_modules/shared"), { name: "shared", version: "2" });
  writePackage(join(install, "node_modules/unrelated"), { name: "unrelated", version: "1" });
  stagePackageClosure([{ specifier: "a", from: install }], runtime);
  const fromA = createRequire(join(runtime, "node_modules/a/index.js"));
  const fromB = createRequire(join(runtime, "node_modules/b/index.js"));
  expect(fromA("shared")).toBe("1");
  expect(fromB("shared")).toBe("2");
  expect(fromB("a")).toBe("1");
  expect(readdirSync(join(runtime, "node_modules"))).toEqual(["a", "b", "shared"]);
});

it("dereferences package links and retains runtime assets without copying dev dependencies", () => {
  const directory = fixture();
  const install = join(directory, "install");
  const source = join(directory, "store/native");
  const runtime = join(directory, "runtime");
  writePackage(source, {
    name: "native",
    version: "1",
    devDependencies: { missing: "1" },
    optionalDependencies: { "other-platform": "1" },
  });
  writeFileSync(join(source, "asset.wasm"), "wasm");
  mkdirSync(join(install, "node_modules"), { recursive: true });
  symlinkSync(source, join(install, "node_modules/native"));
  stagePackageClosure(
    [
      { specifier: "native", from: install },
      { specifier: "node:fs", from: install },
    ],
    runtime,
  );
  expect(readFileSync(join(runtime, "node_modules/native/asset.wasm"), "utf8")).toBe("wasm");
  expect(
    readdirSync(join(runtime, "node_modules"), { withFileTypes: true })[0].isSymbolicLink(),
  ).toBe(false);
  rmSync(install, { recursive: true });
  rmSync(source, { recursive: true });
  expect(createRequire(join(runtime, "entry.mjs"))("native")).toBe("1");
});

it("fails for a required missing package instead of silently shipping an incomplete runtime", () => {
  const directory = fixture();
  writePackage(join(directory, "node_modules/a"), {
    name: "a",
    version: "1",
    dependencies: { absent: "1" },
  });
  expect(() =>
    stagePackageClosure([{ specifier: "a", from: directory }], join(directory, "runtime")),
  ).toThrow("Cannot resolve runtime package absent");
});

const linuxTarget = { platform: "linux", arch: "x64", libc: "glibc" };

// Keep native dependencies beside their loaders, as pnpm does. Resolving them
// from core instead would fail even when the right binary is installed.
function runtimeInstall(directory) {
  const server = join(directory, "node_modules/@opencode/server");
  writePackage(server, { name: "@opencode/server", version: "1" });
  writePackage(join(directory, "node_modules/@opencode/core"), {
    name: "@opencode/core",
    version: "1",
  });
  for (const [loader, packages] of [
    [
      "@lydell/node-pty",
      {
        "@lydell/node-pty-linux-x64": ["prebuilds/linux-x64/pty.node"],
        "@lydell/node-pty-darwin-arm64": [
          "prebuilds/darwin-arm64/pty.node",
          "prebuilds/darwin-arm64/spawn-helper",
        ],
      },
    ],
    [
      "@parcel/watcher",
      {
        "@parcel/watcher-linux-x64-glibc": ["watcher.node"],
        "@parcel/watcher-linux-x64-musl": ["watcher.node"],
        "@parcel/watcher-darwin-arm64": ["watcher.node"],
      },
    ],
    [
      "@opencode-ai/pty",
      {
        "@opencode-ai/pty-linux-x64-gnu": ["bin/opencode-pty"],
        "@opencode-ai/pty-linux-x64-musl": ["bin/opencode-pty"],
        "@opencode-ai/pty-darwin-arm64": ["bin/opencode-pty"],
      },
    ],
  ]) {
    const source = join(directory, "node_modules", loader);
    writePackage(source, {
      name: loader,
      version: "1",
      optionalDependencies: Object.fromEntries(Object.keys(packages).map((name) => [name, "1"])),
    });
    for (const [name, assets] of Object.entries(packages)) {
      const native = join(source, "node_modules", name);
      writePackage(native, { name, version: "1" });
      for (const asset of assets) {
        const file = join(native, asset);
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, `${name}/${asset}`, { mode: 0o755 });
      }
    }
  }
  for (const [name, asset] of [
    ["@silvia-odwyer/photon-node", "photon_rs_bg.wasm"],
    ["web-tree-sitter", "tree-sitter.wasm"],
    ["tree-sitter-bash", "tree-sitter-bash.wasm"],
    ["tree-sitter-powershell", "tree-sitter-powershell.wasm"],
  ]) {
    const source = join(directory, "node_modules", name);
    writePackage(source, { name, version: "1" });
    writeFileSync(join(source, asset), "wasm");
  }
  return server;
}

it("stages the Linux glibc native roots from their loaders without requiring a macOS spawn helper", () => {
  const directory = fixture();
  const install = join(directory, "install");
  const runtime = join(directory, "runtime");
  const { imports, assets } = openCodeRuntimeDependencies(runtimeInstall(install), linuxTarget);
  expect(imports.map(({ specifier }) => specifier)).toEqual(
    expect.arrayContaining([
      "@lydell/node-pty-linux-x64",
      "@parcel/watcher-linux-x64-glibc",
      "@opencode-ai/pty-linux-x64-gnu",
    ]),
  );
  expect(imports.some(({ specifier }) => /musl|darwin/u.test(specifier))).toBe(false);
  expect(assets.some((asset) => asset.endsWith("spawn-helper"))).toBe(false);
  stagePackageClosure(imports, runtime);
  rmSync(install, { recursive: true });
  for (const asset of assets) {
    expect(statSync(join(runtime, "node_modules", asset)).isFile()).toBe(true);
  }
  const binary = join(runtime, "node_modules/@opencode-ai/pty-linux-x64-gnu/bin/opencode-pty");
  expect(readFileSync(binary, "utf8")).toBe("@opencode-ai/pty-linux-x64-gnu/bin/opencode-pty");
  expect(statSync(binary).mode & 0o111).toBe(0o111);
});

it("retains the macOS arm64 native assets including its spawn helper", () => {
  const directory = fixture();
  const { imports, assets } = openCodeRuntimeDependencies(runtimeInstall(directory), {
    platform: "darwin",
    arch: "arm64",
  });
  expect(assets).toContain("@lydell/node-pty-darwin-arm64/prebuilds/darwin-arm64/spawn-helper");
  expect(imports.some(({ specifier }) => specifier.includes("linux"))).toBe(false);
  const runtime = join(directory, "runtime");
  stagePackageClosure(imports, runtime);
  for (const asset of assets) {
    expect(statSync(join(runtime, "node_modules", asset)).isFile()).toBe(true);
  }
});

it("requires the glibc native package even when another optional platform package is present", () => {
  const directory = fixture();
  const server = runtimeInstall(directory);
  rmSync(
    join(directory, "node_modules/@parcel/watcher/node_modules/@parcel/watcher-linux-x64-glibc"),
    { recursive: true },
  );
  const { imports } = openCodeRuntimeDependencies(server, linuxTarget);
  expect(() => stagePackageClosure(imports, join(directory, "runtime"))).toThrow(
    "Cannot resolve runtime package @parcel/watcher-linux-x64-glibc",
  );
});

it.each([
  { platform: "linux", arch: "x64", libc: "musl" },
  { platform: "linux", arch: "arm64", libc: "glibc" },
  { platform: "darwin", arch: "x64" },
  { platform: "win32", arch: "x64" },
])("rejects unsupported runtime targets before looking for packages: %j", (target) => {
  expect(() => openCodeRuntimeDependencies("/missing-install", target)).toThrow(
    "OpenCode runtime supports only macOS arm64 and Linux x64/glibc",
  );
});

it.each([
  [
    { platform: "linux", arch: "x64" },
    { platform: "darwin", arch: "arm64" },
  ],
  [{ platform: "darwin", arch: "arm64" }, linuxTarget],
  [{ platform: "linux", arch: "arm64" }, linuxTarget],
])("rejects cross-packaging %j from host %j", (target, host) => {
  expect(() => assertRuntimePackagingTarget(target, host)).toThrow(
    "OpenCode runtime packaging must match the build host",
  );
});

it.each([{ platform: "darwin", arch: "arm64" }, linuxTarget])(
  "allows packaging on the matching supported host: %j",
  (target) => {
    expect(() => assertRuntimePackagingTarget(target, target)).not.toThrow();
  },
);

it("rejects Linux musl packaging even when its platform and architecture match the host", () => {
  expect(() =>
    assertRuntimePackagingTarget(
      { platform: "linux", arch: "x64" },
      { platform: "linux", arch: "x64", libc: "musl" },
    ),
  ).toThrow("OpenCode runtime supports only macOS arm64 and Linux x64/glibc");
});

// A privileged process and Windows do not enforce owner read bits, so the
// unreadable-source simulation only applies where the mode is enforced.
const deniesRead = process.platform !== "win32" && process.getuid?.() !== 0;

it.skipIf(!deniesRead)(
  "drops the completion marker before restaging so an interrupted copy is not reused",
  () => {
    const directory = fixture();
    const install = join(directory, "install");
    const runtime = join(directory, "runtime");
    const a = join(install, "node_modules/a");
    const b = join(install, "node_modules/b");
    writePackage(a, { name: "a", version: "1" });
    stagePackageClosure([{ specifier: "a", from: install }], runtime);
    expect(existsSync(join(runtime, "closure.json"))).toBe(true);

    // A dependency change forces a restage that fails while copying.
    writePackage(b, { name: "b", version: "1" });
    writePackage(a, { name: "a", version: "1", dependencies: { b: "1" } });
    chmodSync(join(b, "index.js"), 0o000);
    try {
      expect(() => stagePackageClosure([{ specifier: "a", from: install }], runtime)).toThrow();
      expect(existsSync(join(runtime, "closure.json"))).toBe(false);
    } finally {
      chmodSync(join(b, "index.js"), 0o644);
    }

    stagePackageClosure([{ specifier: "a", from: install }], runtime);
    expect(existsSync(join(runtime, "closure.json"))).toBe(true);
  },
);
