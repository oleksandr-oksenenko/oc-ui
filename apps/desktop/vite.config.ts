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
    // Prebundle the worker imports too, avoiding a reload when its first request arrives.
    include: ["@opencode/ui > fuzzysort", "shiki/langs", "shiki"],
  },
});
