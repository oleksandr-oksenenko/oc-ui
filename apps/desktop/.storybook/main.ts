import type { StorybookConfig } from "storybook-solidjs-vite";

const config: StorybookConfig = {
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
      include: [...(viteConfig.optimizeDeps?.include ?? []), "@opencode/ui > fuzzysort"],
    },
  }),
};

export default config;
