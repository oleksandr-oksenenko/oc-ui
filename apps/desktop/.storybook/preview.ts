import type { Preview } from "storybook-solidjs-vite";
import { createComponent, createEffect, createSignal } from "solid-js";

import "@opencode-ai/ui/styles";
import "@opencode-ai/ui/styles/tokens";
import "../src/renderer/styles.css";
import { ServerFlowDialogProvider } from "../src/renderer/ui/ServerFlowDialogProvider.tsx";
import { ThemeProvider } from "../src/renderer/ui/ThemeProvider.tsx";
import type { Theme } from "../src/renderer/appearance.ts";

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
document.documentElement.dataset.host = "desktop";

const preview: Preview = {
  decorators: [
    (Story, context) => {
      const [theme, setTheme] = createSignal<Theme>("light");
      createEffect(() => setTheme(context.globals.theme === "dark" ? "dark" : "light"));
      return createComponent(ThemeProvider, {
        theme,
        onChange: setTheme,
        get children() {
          return createComponent(ServerFlowDialogProvider, {
            get children() {
              return Story();
            },
          });
        },
      });
    },
  ],
  globalTypes: {
    theme: {
      description: "Application theme",
      toolbar: {
        dynamicTitle: true,
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark (AMOLED)" },
        ],
      },
    },
  },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    backgrounds: { disable: true },
    viewport: { options: viewports },
  },
  initialGlobals: {
    theme: "light",
    viewport: { value: "desktop", isRotated: false },
  },
};

export default preview;
