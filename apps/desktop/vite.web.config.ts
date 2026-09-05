import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

import rendererConfig from "./vite.config.ts";

export default defineConfig({
  ...rendererConfig,
  root: fileURLToPath(new URL("src/renderer", import.meta.url)),
  plugins: [
    rendererConfig.plugins,
    {
      name: "browser-entry",
      transformIndexHtml: {
        order: "pre",
        handler: (html) => html.replace('src="/main.tsx"', 'src="/browser.ts"'),
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: { outDir: "../../dist-web", emptyOutDir: true },
});
