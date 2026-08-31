import type { Preview } from "storybook-solidjs-vite";
import { createComponent } from "solid-js";

import "@opencode-ai/ui/styles";
import "@opencode-ai/ui/styles/tokens";
import "../src/renderer/styles.css";
import { ServerFlowDialogProvider } from "../src/renderer/ui/ServerFlowDialogProvider.tsx";

const viewports = {
  desktop: {
    name: "Desktop",
    styles: { width: "1440px", height: "900px" },
    type: "desktop" as const,
  },
  narrow: {
    name: "Narrow",
    styles: { width: "820px", height: "900px" },
    type: "desktop" as const,
  },
  mobile: {
    name: "Mobile",
    styles: { width: "390px", height: "760px" },
    type: "mobile" as const,
  },
};

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
    a11y: { test: "error" },
    backgrounds: {
      default: "dark",
      values: [{ name: "dark", value: "#000000" }],
    },
    viewport: { options: viewports },
  },
  initialGlobals: {
    viewport: { value: "desktop", isRotated: false },
  },
};

export default preview;
