import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

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
    platform,
    arch,
    appDirectory,
    appBinaryPath,
    resources,
    runtimePath,
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
      join(runtimePath, "source.json"),
      join(runtimePath, "tools", "index.js"),
      join(runtimePath, "image-tools", "index.js"),
      join(modules, "@opencode", "core", "package.json"),
      join(modules, "@silvia-odwyer", "photon-node", "photon_rs_bg.wasm"),
      join(modules, "web-tree-sitter", "tree-sitter.wasm"),
      join(modules, "tree-sitter-bash", "tree-sitter-bash.wasm"),
      join(modules, "tree-sitter-powershell", "tree-sitter-powershell.wasm"),
    ],
  };
}

/** Validate readelf's header report; executables may be ET_EXEC or PIE (ET_DYN). */
export function assertElfX64(header, path) {
  if (
    !/Class:\s+ELF64\b/u.test(header) ||
    !/Data:\s+2's complement, little endian\b/u.test(header) ||
    !/Version:\s+1 \(current\)/u.test(header) ||
    !/Type:\s+(?:EXEC|DYN)\b/u.test(header) ||
    !/Machine:\s+Advanced Micro Devices X86-64\b/u.test(header) ||
    !/Version:\s+0x1\b/u.test(header) ||
    !/Size of this header:\s+64 \(bytes\)/u.test(header)
  ) {
    throw new Error(`Expected a Linux ELF64 x86-64 executable or binding at ${path}`);
  }
}

async function nativeAddons(artifacts) {
  const root = join(artifacts.runtimePath, "node_modules");
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".node"))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => {
      // Upstream packages may ship other hosts' prebuilds. Validate every
      // selectable addon on this host, including bindings without a target tag.
      const tags = [
        ...path
          .slice(root.length)
          .matchAll(/(darwin|linux|win32|android|freebsd)[-_.](arm64|x64|ia32|arm)(?=[-_./]|$)/gu),
      ];
      return (
        tags.every((tag) => tag[1] === artifacts.platform && tag[2] === artifacts.arch) &&
        (artifacts.platform !== "linux" || !path.includes("musl"))
      );
    });
}

export async function verifyPackagedApplication(artifacts, signal, runCommand = execFileAsync) {
  signal.throwIfAborted();
  await Promise.all([
    ...artifacts.executables.map((path) => access(path, constants.X_OK)),
    ...[...artifacts.executables, ...artifacts.bindings, ...artifacts.assets].map(async (path) => {
      const file = await open(path, "r");
      try {
        const entry = await file.stat();
        if (!entry.isFile()) throw new Error(`Packaged asset is not a file: ${path}`);
        if (path === join(artifacts.resources, "app.asar") && entry.size === 0) {
          throw new Error(`Invalid packaged app.asar at ${path}`);
        }
        if (path.endsWith(".wasm") && !WebAssembly.validate(await file.readFile({ signal }))) {
          throw new Error(`Invalid packaged WASM at ${path}`);
        }
      } finally {
        await file.close();
      }
    }),
  ]);
  const provenance = JSON.parse(
    await readFile(join(artifacts.runtimePath, "source.json"), { encoding: "utf8", signal }),
  );
  const core = JSON.parse(
    await readFile(join(artifacts.runtimePath, "node_modules/@opencode/core/package.json"), {
      encoding: "utf8",
      signal,
    }),
  );
  if (!provenance.revision || core.ocuiSource !== provenance.revision)
    throw new Error("Packaged OpenCode Core does not match the local build provenance");
  if (artifacts.platform === "darwin") {
    await runCommand("codesign", ["--verify", "--deep", "--strict", artifacts.appDirectory], {
      signal,
      timeout: 60_000,
    });
  }
  const natives = new Set([
    ...artifacts.executables,
    ...artifacts.bindings,
    ...(await nativeAddons(artifacts)),
  ]);
  for (const path of natives) {
    signal.throwIfAborted();
    const mac = artifacts.platform === "darwin";
    const { stdout } = await runCommand(
      mac ? "lipo" : "readelf",
      mac ? ["-archs", path] : ["--file-header", path],
      {
        signal,
        timeout: 30_000,
        env: { ...process.env, LC_ALL: "C" },
      },
    );
    if (mac) {
      if (!stdout.trim().split(/\s+/u).includes("arm64"))
        throw new Error(`Expected an arm64 executable or binding at ${path}`);
    } else {
      assertElfX64(stdout, path);
    }
  }
  const imagePlugin = pathToFileURL(join(artifacts.runtimePath, "image-tools", "index.js")).href;
  await runCommand(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
      for (const specifier of ["@opencode/core/permission", "@opencode/core/file-access", "effect", "@silvia-odwyer/photon-node"]) {
        const resolved = import.meta.resolve(specifier);
        if (!resolved.startsWith(${JSON.stringify(pathToFileURL(join(artifacts.runtimePath, "node_modules") + "/").href)})) {
        throw new Error("Packaged image plugin dependency escaped its runtime: " + specifier);
      }
    }
    await import(${JSON.stringify(imagePlugin)});
  `,
    ],
    { signal, timeout: 30_000, cwd: join(artifacts.runtimePath, "image-tools") },
  );
}
