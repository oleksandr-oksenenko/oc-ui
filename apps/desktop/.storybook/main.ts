import type { StorybookConfig } from "storybook-solidjs-vite";

const config: StorybookConfig = {
  core: { allowedHosts: true },
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: {
    name: "storybook-solidjs-vite",
    options: {},
  },
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    optimizeDeps: {
      ...viteConfig.optimizeDeps,
      // OpenCode's comment editor reaches this CommonJS dependency through its hooks barrel.
      // Worker imports must be known before an interaction test starts.
      include: [
        ...(viteConfig.optimizeDeps?.include ?? []),
        "@opencode/ui > fuzzysort",
        "shiki/langs",
        "shiki",
      ],
    },
  }),
};

export default config;
