import { recommended } from "oxlint-plugin-effect/presets/recommended";
import { defineConfig } from "vite-plus";

export default defineConfig({
  defaultPackage: "./apps/web",
  fmt: {},
  lint: {
    plugins: ["react"],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      "oxlint-plugin-effect/plugin",
    ],
    rules: {
      ...recommended,
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  run: {
    cache: true,
  },
});
