import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findPackage, stagePackageClosure } from "./opencode-runtime-packages.mjs";

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = join(repositoryDirectory, "apps", "desktop");
const runtimeDirectory = join(desktopDirectory, "out", "opencode-runtime");

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("OpenCode runtime packaging is supported only on macOS arm64");
}

const expectedVersion = readFileSync(
  join(desktopDirectory, "src/shared/desktop-api.ts"),
  "utf8",
).match(/export const OPENCODE_VERSION = ["']([^"']+)["']/)?.[1];
for (const name of ["server", "util", "client", "ui"]) {
  const manifest = JSON.parse(
    readFileSync(join(desktopDirectory, "node_modules/@opencode-ai", name, "package.json"), "utf8"),
  );
  if (manifest.version !== expectedVersion) {
    throw new Error(`@opencode-ai/${name} must match desktop protocol ${expectedVersion}`);
  }
}

const serverDirectory = realpathSync(join(desktopDirectory, "node_modules/@opencode-ai/server"));
const coreDirectory = findPackage("@opencode-ai/core", serverDirectory);
const watcherDirectory = findPackage("@parcel/watcher", coreDirectory);
const ptyDirectory = findPackage("@opencode-ai/pty", coreDirectory);
const build = JSON.parse(readFileSync(join(runtimeDirectory, "build.json"), "utf8"));

// These Node loaders use createRequire, package-relative WASM paths, or a binary
// environment override rather than static imports. They are not in esbuild's graph.
const dynamicDependencies = [
  ["@lydell/node-pty", coreDirectory],
  ["@parcel/watcher-darwin-arm64", watcherDirectory],
  ["@silvia-odwyer/photon-node", coreDirectory],
  ["web-tree-sitter", coreDirectory],
  ["tree-sitter-bash", coreDirectory],
  ["tree-sitter-powershell", coreDirectory],
  ["@opencode-ai/pty-darwin-arm64", ptyDirectory],
];
const roots = [
  ...build.dependencies,
  ...dynamicDependencies.map(([specifier, from]) => ({ specifier, from })),
];
stagePackageClosure(roots, runtimeDirectory);
// Lighthouse dynamically reads its own assets. Main imports the intact package.
stagePackageClosure(
  [{ specifier: "lighthouse", from: desktopDirectory }],
  join(desktopDirectory, "out", "main"),
);

const assets = [
  "@lydell/node-pty-darwin-arm64/prebuilds/darwin-arm64/pty.node",
  "@lydell/node-pty-darwin-arm64/prebuilds/darwin-arm64/spawn-helper",
  "@parcel/watcher-darwin-arm64/watcher.node",
  "@silvia-odwyer/photon-node/photon_rs_bg.wasm",
  "web-tree-sitter/tree-sitter.wasm",
  "tree-sitter-bash/tree-sitter-bash.wasm",
  "tree-sitter-powershell/tree-sitter-powershell.wasm",
  "@opencode-ai/pty-darwin-arm64/bin/opencode-pty",
];
for (const asset of assets) {
  if (!statSync(join(runtimeDirectory, "node_modules", asset)).isFile()) {
    throw new Error(`OpenCode runtime asset is missing: ${asset}`);
  }
}
console.log(`Staged OpenCode ${expectedVersion} library runtime and native/WASM assets`);
