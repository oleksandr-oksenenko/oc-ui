import { dirname, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { defineConfig } from "electron-vite";
import { build } from "esbuild";
import rendererConfig from "./vite.config.ts";
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
          // OpenCode publishes extensionless ESM and Node-specific conditional loaders.
          // Bundle its code, but retain native modules and other packages as packages.
          const dependencies = new Map<string, string>();
          const result = await build({
            absWorkingDir: configDirectory,
            entryPoints: ["src/main/opencode-worker.ts"],
            outfile: resolve(runtimeDirectory, "opencode-worker.mjs"),
            bundle: true,
            platform: "node",
            conditions: ["node"],
            format: "esm",
            target: "node24",
            metafile: true,
            banner: {
              js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
            },
            plugins: [
              {
                name: "opencode-package-boundary",
                setup(builder) {
                  builder.onResolve({ filter: /^[^./#]/ }, (args) => {
                    if (
                      args.path.startsWith("@opencode/") ||
                      args.path === "@parcel/watcher/wrapper"
                    ) {
                      return undefined;
                    }
                    dependencies.set(`${args.path}\0${args.resolveDir}`, args.resolveDir);
                    return { path: args.path, external: true };
                  });
                },
              },
            ],
          });
          writeFileSync(
            resolve(runtimeDirectory, "build.json"),
            JSON.stringify({
              dependencies: [...dependencies].map(([key, from]) => ({
                specifier: key.split("\0")[0],
                from,
              })),
            }),
          );
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
