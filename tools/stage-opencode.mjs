import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openCodeRuntimeDependencies } from "./opencode-runtime-native.mjs";
import { stagePackageClosure } from "./opencode-runtime-packages.mjs";

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = join(repositoryDirectory, "apps", "desktop");
const runtimeDirectory = join(desktopDirectory, "out", "opencode-runtime");

const serverDirectory = realpathSync(join(desktopDirectory, "node_modules/@opencode/server"));
const { imports, assets } = openCodeRuntimeDependencies(serverDirectory);

const expectedVersion = readFileSync(
  join(desktopDirectory, "src/shared/desktop-api.ts"),
  "utf8",
).match(/export const OPENCODE_VERSION = ["']([^"']+)["']/)?.[1];
for (const name of ["server", "util", "client", "ui"]) {
  const manifest = JSON.parse(
    readFileSync(join(desktopDirectory, "node_modules/@opencode", name, "package.json"), "utf8"),
  );
  if (manifest.version !== expectedVersion) {
    throw new Error(`@opencode/${name} must match desktop protocol ${expectedVersion}`);
  }
}

const build = JSON.parse(readFileSync(join(runtimeDirectory, "build.json"), "utf8"));

// These Node loaders use createRequire, package-relative WASM paths, or a binary
// environment override rather than static imports. They are not in esbuild's graph.
stagePackageClosure([...build.dependencies, ...imports], runtimeDirectory);
// Lighthouse dynamically reads its own assets. Main imports the intact package.
stagePackageClosure(
  [{ specifier: "lighthouse", from: desktopDirectory }],
  join(desktopDirectory, "out", "main"),
);

if (!statSync(join(runtimeDirectory, "session-tools/index.js")).isFile()) {
  throw new Error("OpenCode session tools plugin is missing");
}
for (const asset of assets) {
  if (!statSync(join(runtimeDirectory, "node_modules", asset)).isFile()) {
    throw new Error(`OpenCode runtime asset is missing: ${asset}`);
  }
}
console.log(`Staged OpenCode ${expectedVersion} library runtime and native/WASM assets`);
