import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  // Pierre's worker entry uses dynamic import() and bare ESM specifiers. Emitting
  // module workers keeps the shiki wasm chunk lazy instead of inlining it.
  worker: {
    format: "es",
  },
  optimizeDeps: {
    include: ["@opencode/ui > fuzzysort"],
  },
});
