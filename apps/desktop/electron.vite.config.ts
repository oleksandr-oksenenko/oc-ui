import { dirname, resolve } from "node:path";
import { existsSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { defineConfig } from "electron-vite";
import rendererConfig from "./vite.config.ts";
import { bundleOpenCodeRuntime } from "./scripts/build-opencode-runtime.ts";
import { buildSessionTools } from "../../packages/opencode-session-tools/build.ts";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const rendererDirectory = resolve(configDirectory, "src/renderer");
const runtimeDirectory = resolve(configDirectory, "out/opencode-runtime");
const workerPath = resolve(runtimeDirectory, "opencode-worker.mjs");
const mainDirectory = resolve(configDirectory, "out/main");

// The worker is not an import of main; watch its known inputs and the staging
// recipe. They are registered before the bundle so a failing build can be
// repaired by editing a known input; an import first seen while the build fails
// is only picked up after restarting the dev server.
const runtimeInputs = [
  "src/main/opencode-worker.ts",
  "package.json",
  "../../pnpm-lock.yaml",
  "../../packages/opencode-session-tools/build.ts",
  "../../tools/stage-opencode.mjs",
  "../../tools/opencode-runtime-packages.mjs",
];

// Main keeps `emptyOutDir: false` so the staged Lighthouse closure and its
// completion marker survive; every other generated output is replaced here.
const cleanMainOutput = (): void => {
  if (!existsSync(mainDirectory)) return;
  for (const entry of readdirSync(mainDirectory)) {
    if (entry === "node_modules" || entry === "closure.json") continue;
    rmSync(resolve(mainDirectory, entry), { recursive: true, force: true });
  }
};

// Every `electron-vite dev` launch exposes localhost profiling attach points
// through the env variables electron-vite forwards to Electron: the renderer
// over the Chrome DevTools Protocol and the main process over the V8 inspector.
// `??=` keeps an explicit override, and an empty string disables one.
if (process.env.NODE_ENV_ELECTRON_VITE === "development") {
  process.env.REMOTE_DEBUGGING_PORT ??= "9222";
  process.env.V8_INSPECTOR_PORT ??= "9229";
}

export default defineConfig({
  main: {
    plugins: [
      {
        name: "opencode-runtime",
        async buildStart() {
          for (const input of await buildSessionTools(resolve(runtimeDirectory, "session-tools"))) {
            this.addWatchFile(input);
          }
          for (const input of runtimeInputs) {
            this.addWatchFile(resolve(configDirectory, input));
          }
          // Bundle OpenCode's extensionless ESM, but retain native modules and
          // other packages as staged packages. The standalone server uses the
          // same recipe through scripts/build-opencode-runtime.ts. The worker is
          // published by rename so a starting Electron never reads a partial file.
          const buildingWorkerPath = `${workerPath}.building`;
          const { result, dependencies } = await bundleOpenCodeRuntime({
            configDirectory,
            entryPoints: ["src/main/opencode-worker.ts"],
            outfile: buildingWorkerPath,
          });
          renameSync(buildingWorkerPath, workerPath);
          writeFileSync(resolve(runtimeDirectory, "build.json"), JSON.stringify({ dependencies }));
          for (const input of Object.keys(result.metafile.inputs)) {
            if (!input.includes("node_modules/"))
              this.addWatchFile(resolve(configDirectory, input));
          }
        },
        // Runs after the build renders but before output is written, so a
        // compilation failure leaves the running app's chunks in place.
        generateBundle() {
          cleanMainOutput();
        },
        closeBundle() {
          execFileSync(
            process.execPath,
            [resolve(configDirectory, "../../tools/stage-opencode.mjs")],
            { stdio: "inherit" },
          );
        },
      },
    ],
    build: {
      // Main and preload are self-contained; only the worker needs a package tree.
      externalizeDeps: false,
      // Staged packages and their completion marker must outlive a build;
      // `cleanMainOutput` replaces every other generated output.
      emptyOutDir: false,
      rollupOptions: {
        input: resolve(configDirectory, "src/main/index.ts"),
        // Lighthouse reads package-relative assets; stage its package tree beside main.
        external: ["lighthouse"],
        output: { format: "es" },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      isolatedEntries: true,
      rollupOptions: {
        input: {
          index: resolve(configDirectory, "src/preload/index.ts"),
          "browser-annotator": resolve(configDirectory, "src/preload/browser-annotator.ts"),
        },
        output: { format: "cjs" },
      },
    },
  },
  renderer: {
    ...rendererConfig,
    root: rendererDirectory,
    build: {
      rollupOptions: {
        input: resolve(rendererDirectory, "index.html"),
      },
    },
  },
});
