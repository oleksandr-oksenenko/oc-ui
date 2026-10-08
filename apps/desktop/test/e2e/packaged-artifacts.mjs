import { join } from "node:path";

/** Expected delivery layout, independent of the staging implementation. */
export function packagedArtifacts(desktopRoot, platform, arch, glibcVersion) {
  const mac = platform === "darwin" && arch === "arm64";
  const linux = platform === "linux" && arch === "x64" && Boolean(glibcVersion);
  if (!mac && !linux) {
    throw new Error("Packaged acceptance requires macOS arm64 or Linux x64/glibc");
  }
  const appDirectory = join(
    desktopRoot,
    "dist",
    ...(mac ? ["mac-arm64", "Ocui.app"] : ["linux-unpacked"]),
  );
  const resources = join(appDirectory, ...(mac ? ["Contents", "Resources"] : ["resources"]));
  const appBinaryPath = join(appDirectory, ...(mac ? ["Contents", "MacOS", "Ocui"] : ["ocui"]));
  const runtimePath = join(resources, "opencode-runtime");
  const nativeTarget = mac ? "darwin-arm64" : "linux-x64";
  const modules = join(runtimePath, "node_modules");
  return {
    appDirectory,
    appBinaryPath,
    executables: [
      appBinaryPath,
      join(
        modules,
        "@opencode-ai",
        `pty-${mac ? nativeTarget : "linux-x64-gnu"}`,
        "bin",
        "opencode-pty",
      ),
      ...(mac
        ? [
            join(
              modules,
              "@lydell",
              `node-pty-${nativeTarget}`,
              "prebuilds",
              nativeTarget,
              "spawn-helper",
            ),
          ]
        : []),
    ],
    bindings: [
      join(modules, "@lydell", `node-pty-${nativeTarget}`, "prebuilds", nativeTarget, "pty.node"),
      join(modules, "@parcel", `watcher-${mac ? nativeTarget : "linux-x64-glibc"}`, "watcher.node"),
    ],
    assets: [
      join(resources, "app.asar"),
      join(runtimePath, "opencode-worker.mjs"),
      join(runtimePath, "session-tools", "index.js"),
      join(modules, "@silvia-odwyer", "photon-node", "photon_rs_bg.wasm"),
      join(modules, "web-tree-sitter", "tree-sitter.wasm"),
      join(modules, "tree-sitter-bash", "tree-sitter-bash.wasm"),
      join(modules, "tree-sitter-powershell", "tree-sitter-powershell.wasm"),
    ],
  };
}

/** Executables may be ET_EXEC or PIE (ET_DYN); native bindings are ET_DYN. */
export function assertElfX64(header, path) {
  if (
    header.length < 64 ||
    header.subarray(0, 4).toString("hex") !== "7f454c46" ||
    header[4] !== 2 ||
    header[5] !== 1 ||
    header[6] !== 1 ||
    ![2, 3].includes(header.readUInt16LE(16)) ||
    header.readUInt16LE(18) !== 62 ||
    header.readUInt32LE(20) !== 1 ||
    header.readUInt16LE(52) !== 64
  ) {
    throw new Error(`Expected a 64-bit little-endian x86-64 ELF executable or binding at ${path}`);
  }
}
