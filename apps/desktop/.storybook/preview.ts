import type { Preview } from "storybook-solidjs-vite";
import { createComponent } from "solid-js";

import "@opencode-ai/ui/styles";
import "@opencode-ai/ui/styles/tokens";
import "../src/renderer/styles.css";
import { ServerFlowDialogProvider } from "../src/renderer/ui/ServerFlowDialogProvider.tsx";

// The production renderer marks the document for the native macOS titlebar inset.
// Keep that layout path covered in Storybook without drawing fake window controls.
document.documentElement.dataset.platform = "macos";
document.documentElement.dataset.colorScheme = "dark";

const preview: Preview = {
  decorators: [
    (Story) =>
      createComponent(ServerFlowDialogProvider, {
        get children() {
          return Story();
        },
      }),
  ],
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#000000" }],
    },
  },
};

export default preview;
