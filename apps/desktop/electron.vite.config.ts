import { dirname, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { defineConfig } from "electron-vite";
import rendererConfig from "./vite.config.ts";
import { bundleOpenCodeRuntime } from "./scripts/build-opencode-runtime.ts";
import { buildSessionTools } from "../../packages/opencode-session-tools/build.ts";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const rendererDirectory = resolve(configDirectory, "src/renderer");
const runtimeDirectory = resolve(configDirectory, "out/opencode-runtime");

export default defineConfig({
  main: {
    plugins: [
      {
        name: "opencode-runtime",
        async buildStart() {
          for (const input of await buildSessionTools(resolve(runtimeDirectory, "session-tools"))) {
            this.addWatchFile(input);
          }
          // Bundle OpenCode's extensionless ESM, but retain native modules and
          // other packages as staged packages. The standalone server uses the
          // same recipe through scripts/build-opencode-runtime.ts.
          const { result, dependencies } = await bundleOpenCodeRuntime({
            configDirectory,
            entryPoints: ["src/main/opencode-worker.ts"],
            outfile: resolve(runtimeDirectory, "opencode-worker.mjs"),
          });
          writeFileSync(resolve(runtimeDirectory, "build.json"), JSON.stringify({ dependencies }));
          // The worker is not an import of main; explicitly watch all of its local inputs.
          for (const input of Object.keys(result.metafile.inputs)) {
            if (!input.includes("node_modules/"))
              this.addWatchFile(resolve(configDirectory, input));
          }
          for (const input of [
            "package.json",
            "../../pnpm-lock.yaml",
            "../../packages/opencode-session-tools/build.ts",
            "../../tools/stage-opencode.mjs",
            "../../tools/opencode-runtime-packages.mjs",
          ]) {
            this.addWatchFile(resolve(configDirectory, input));
          }
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
        input: resolve(configDirectory, "src/preload/index.ts"),
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
