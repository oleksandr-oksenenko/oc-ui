import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "electron-vite";
import solid from "vite-plugin-solid";

const configDirectory = dirname(fileURLToPath(import.meta.url));
const rendererDirectory = resolve(configDirectory, "src/renderer");

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: resolve(configDirectory, "src/main/index.ts"),
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
    root: rendererDirectory,
    plugins: [solid()],
    build: {
      rollupOptions: {
        input: resolve(rendererDirectory, "index.html"),
      },
    },
  },
});
