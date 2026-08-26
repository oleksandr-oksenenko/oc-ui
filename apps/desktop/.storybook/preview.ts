import type { Preview } from "storybook-solidjs-vite";

import "@opencode-ai/ui/styles";
import "../src/renderer/styles.css";

// The production renderer marks the document for the native macOS titlebar inset.
// Keep that layout path covered in Storybook without drawing fake window controls.
document.documentElement.dataset.platform = "macos";
document.documentElement.dataset.colorScheme = "dark";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#000000" }],
    },
  },
};

export default preview;
