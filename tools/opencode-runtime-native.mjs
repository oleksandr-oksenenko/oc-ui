import { join } from "node:path";

import { findPackage } from "./opencode-runtime-packages.mjs";

const hostTarget = () => ({
  platform: process.platform,
  arch: process.arch,
  libc:
    process.platform === "linux"
      ? process.report.getReport().header.glibcVersionRuntime
        ? "glibc"
        : "musl"
      : undefined,
});

function validateTarget(target) {
  const { platform, arch, libc } = target;
  if (
    !(platform === "darwin" && arch === "arm64") &&
    !(platform === "linux" && arch === "x64" && libc === "glibc")
  ) {
    throw new Error(
      `OpenCode runtime supports only macOS arm64 and Linux x64/glibc; received ${platform} ${arch}${libc ? `/${libc}` : ""}`,
    );
  }
}

/** Staged native assets belong to the host; cross-packaging would ship the wrong binaries. */
export function assertRuntimePackagingTarget(target, host = hostTarget()) {
  validateTarget(host);
  if (target.platform !== host.platform || target.arch !== host.arch) {
    throw new Error(
      `OpenCode runtime packaging must match the build host ${host.platform} ${host.arch}; requested ${target.platform} ${target.arch}`,
    );
  }
}

/** Required dynamic imports and assets for the two supported desktop runtimes. */
export function openCodeRuntimeDependencies(serverDirectory, target = hostTarget()) {
  validateTarget(target);
  const { platform, arch } = target;

  const suffix = `${platform}-${arch}`;
  const nodePty = `@lydell/node-pty-${suffix}`;
  const watcher = `@parcel/watcher-${suffix}${platform === "linux" ? "-glibc" : ""}`;
  const persistentPty = `@opencode-ai/pty-${suffix}${platform === "linux" ? "-gnu" : ""}`;
  const coreDirectory = findPackage("@opencode/core", serverDirectory);
  const nativeImports = [
    ["@lydell/node-pty", nodePty],
    ["@parcel/watcher", watcher],
    ["@opencode-ai/pty", persistentPty],
  ].flatMap(([specifier, native]) => [
    { specifier, from: coreDirectory },
    // Native packages are optional upstream, but required for this runtime.
    { specifier: native, from: findPackage(specifier, coreDirectory) },
  ]);
  const wasmAssets = [
    ["@silvia-odwyer/photon-node", "photon_rs_bg.wasm"],
    ["web-tree-sitter", "tree-sitter.wasm"],
    ["tree-sitter-bash", "tree-sitter-bash.wasm"],
    ["tree-sitter-powershell", "tree-sitter-powershell.wasm"],
  ];
  return {
    imports: [
      ...nativeImports,
      ...wasmAssets.map(([specifier]) => ({ specifier, from: coreDirectory })),
    ],
    assets: [
      join(nodePty, "prebuilds", suffix, "pty.node"),
      ...(platform === "darwin" ? [join(nodePty, "prebuilds", suffix, "spawn-helper")] : []),
      join(watcher, "watcher.node"),
      join(persistentPty, "bin", "opencode-pty"),
      ...wasmAssets.map(([specifier, asset]) => join(specifier, asset)),
    ],
  };
}
