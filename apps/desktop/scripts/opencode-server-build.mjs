import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { findPackage, stagePackageClosure } from "../../../tools/opencode-runtime-packages.mjs";
import { bundleOpenCodeRuntime } from "./build-opencode-runtime.ts";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(scriptsDirectory, "..");
const runtimeDirectory = join(desktopDirectory, "out", "opencode-standalone");
const bundlePath = join(runtimeDirectory, "opencode-server.mjs");
const manifestPath = join(runtimeDirectory, "build.json");
const lockDirectory = join(runtimeDirectory, ".build.lock");
const lockOwnerPath = join(lockDirectory, "owner.json");
const lockGraceMs = 5_000;
const lockDeadlineMs = 120_000;
const nativePackages = ["@lydell/node-pty", "@parcel/watcher", "@opencode-ai/pty"];

let pending;

/** Builds (or reuses) the standalone server bundle and its staged package closure. */
export function ensureOpenCodeServerBundle() {
  pending ??= buildServerBundle();
  return pending;
}

async function buildServerBundle() {
  mkdirSync(runtimeDirectory, { recursive: true });
  const token = await acquireBuildLock();
  try {
    const serverDirectory = findPackage("@opencode/server", desktopDirectory);
    const inputs = trackedInputs(serverDirectory);
    let dependencies;
    if (isBundleCurrent(inputs)) {
      dependencies = JSON.parse(readFileSync(manifestPath, "utf8")).dependencies;
    } else {
      // The manifest is the build-completion marker: invalidate it first and
      // write it only after the bundle is atomically in place.
      rmSync(manifestPath, { force: true });
      validatePinnedVersion(serverDirectory);
      const buildingBundle = `${bundlePath}.building`;
      ({ dependencies } = await bundleOpenCodeRuntime({
        configDirectory: desktopDirectory,
        entryPoints: [join(scriptsDirectory, "opencode-server.ts")],
        outfile: buildingBundle,
      }));
      renameSync(buildingBundle, bundlePath);
      const buildingManifest = `${manifestPath}.building`;
      writeFileSync(
        buildingManifest,
        JSON.stringify({ dependencies, inputs: recordInputs(inputs) }, null, 2),
      );
      renameSync(buildingManifest, manifestPath);
    }
    stagePackageClosure(
      [...dependencies, ...dynamicRuntimeImports(serverDirectory)],
      runtimeDirectory,
      {
        mode: "link",
      },
    );
    return bundlePath;
  } finally {
    releaseBuildLock(token);
    rmSync(`${bundlePath}.building`, { force: true });
    rmSync(`${manifestPath}.building`, { force: true });
  }
}

function trackedInputs(serverDirectory) {
  return [
    join(scriptsDirectory, "opencode-server.ts"),
    join(scriptsDirectory, "build-opencode-runtime.ts"),
    join(scriptsDirectory, "opencode-server-build.mjs"),
    join(desktopDirectory, "src/shared/desktop-api.ts"),
    join(desktopDirectory, "package.json"),
    resolve(desktopDirectory, "../../pnpm-lock.yaml"),
    join(serverDirectory, "package.json"),
  ];
}

function recordInputs(inputs) {
  return Object.fromEntries(inputs.map((input) => [input, statSync(input).mtimeMs]));
}

function isBundleCurrent(inputs) {
  try {
    if (!existsSync(bundlePath)) return false;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return inputs.every((input) => manifest.inputs?.[input] === statSync(input).mtimeMs);
  } catch {
    return false;
  }
}

function validatePinnedVersion(serverDirectory) {
  const expected = /export const OPENCODE_VERSION = ["']([^"']+)["']/u.exec(
    readFileSync(join(desktopDirectory, "src/shared/desktop-api.ts"), "utf8"),
  )?.[1];
  const actual = /"version"\s*:\s*"([^"]+)"/u.exec(
    readFileSync(join(serverDirectory, "package.json"), "utf8"),
  )?.[1];
  if (expected === undefined || actual !== expected) {
    throw new Error(`@opencode/server ${actual} does not match the pinned OpenCode ${expected}`);
  }
}

// These packages are loaded from paths or native bindings that esbuild cannot
// analyze, and they resolve relative to the bundle, so stage them explicitly.
function dynamicRuntimeImports(serverDirectory) {
  const coreDirectory = findPackage("@opencode/core", serverDirectory);
  const platformPackages = nativePackages
    .map((name) => platformPackageName(name, coreDirectory))
    .filter((name) => name !== undefined);
  return [
    ...nativePackages,
    "@silvia-odwyer/photon-node",
    "web-tree-sitter",
    "tree-sitter-bash",
    "tree-sitter-powershell",
    ...platformPackages,
  ].map((specifier) => ({ specifier, from: coreDirectory }));
}

function platformPackageName(name, from) {
  try {
    const manifest = JSON.parse(
      readFileSync(join(findPackage(name, from), "package.json"), "utf8"),
    );
    const suffix = `-${process.platform}-${process.arch}`;
    const candidates = Object.keys(manifest.optionalDependencies ?? {}).filter(
      (key) => key.endsWith(suffix) || key.includes(`${suffix}-`),
    );
    const plain = candidates.find((key) => key.endsWith(suffix));
    if (plain !== undefined) return plain;
    if (process.platform !== "linux") return candidates[0];
    const glibc = process.report.getReport().header.glibcVersionRuntime !== undefined;
    return candidates.find((key) => (glibc ? /-(gnu|glibc)$/u.test(key) : key.endsWith("-musl")));
  } catch {
    return undefined;
  }
}

function isLockStale() {
  try {
    const owner = JSON.parse(readFileSync(lockOwnerPath, "utf8"));
    const pid = Number(owner.pid);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return error?.code === "ESRCH";
    }
  } catch {
    // Missing or unreadable owner file: reclaim only after a short grace period.
    try {
      return Date.now() - statSync(lockDirectory).mtimeMs > lockGraceMs;
    } catch {
      return false;
    }
  }
}

async function acquireBuildLock() {
  const deadline = Date.now() + lockDeadlineMs;
  const token = randomBytes(8).toString("hex");
  while (true) {
    try {
      mkdirSync(lockDirectory);
      writeFileSync(lockOwnerPath, JSON.stringify({ pid: process.pid, token }));
      return token;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (isLockStale()) rmSync(lockDirectory, { recursive: true, force: true });
      if (Date.now() > deadline) {
        throw new Error("Timed out waiting for the OpenCode server build lock", { cause: error });
      }
      await delay(100);
    }
  }
}

function releaseBuildLock(token) {
  try {
    const owner = JSON.parse(readFileSync(lockOwnerPath, "utf8"));
    if (owner.token === token) rmSync(lockDirectory, { recursive: true, force: true });
  } catch {
    // Another owner already reclaimed the lock.
  }
}
