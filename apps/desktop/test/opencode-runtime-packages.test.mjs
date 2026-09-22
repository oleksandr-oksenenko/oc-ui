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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vite-plus/test";

import { stagePackageClosure } from "../../../tools/opencode-runtime-packages.mjs";
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
