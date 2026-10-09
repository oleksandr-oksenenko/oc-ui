import { copyFileSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openCodeRuntimeDependencies } from "./opencode-runtime-native.mjs";
import { findPackage, stagePackageClosure } from "./opencode-runtime-packages.mjs";

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = join(repositoryDirectory, "apps", "desktop");
const runtimeDirectory = join(desktopDirectory, "out", "opencode-runtime");

const serverDirectory = realpathSync(join(desktopDirectory, "node_modules/@opencode/server"));
const source = JSON.parse(
  readFileSync(join(repositoryDirectory, "vendor/opencode/source.json"), "utf8"),
);
for (const name of source.packages) {
  const directory = findPackage(`@opencode/${name}`, serverDirectory);
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  if (manifest.ocuiSource !== source.revision)
    throw new Error(`@opencode/${name} must come from local build ${source.revision}`);
}
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
copyFileSync(
  join(repositoryDirectory, "vendor/opencode/build.json"),
  join(runtimeDirectory, "source.json"),
);

// These Node loaders use createRequire, package-relative WASM paths, or a binary
// environment override rather than static imports. They are not in esbuild's graph.
stagePackageClosure(
  [
    ...build.dependencies,
    ...imports,
    // Image tools consume the host's core services; the worker bundles core.
    { specifier: "@opencode/core", from: serverDirectory },
  ],
  runtimeDirectory,
);
// Lighthouse dynamically reads its own assets. Main imports the intact package.
stagePackageClosure(
  [{ specifier: "lighthouse", from: desktopDirectory }],
  join(desktopDirectory, "out", "main"),
);

for (const plugin of ["tools", "image-tools"]) {
  if (!statSync(join(runtimeDirectory, plugin, "index.js")).isFile()) {
    throw new Error(`OpenCode ${plugin} plugin is missing`);
  }
}
for (const asset of assets) {
  if (!statSync(join(runtimeDirectory, "node_modules", asset)).isFile()) {
    throw new Error(`OpenCode runtime asset is missing: ${asset}`);
  }
}
console.log(`Staged OpenCode ${expectedVersion} library runtime and native/WASM assets`);
