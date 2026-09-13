import {
  createContext,
  createRenderEffect,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";

import type { Theme } from "../appearance.ts";

type ThemeControls = {
  readonly theme: Accessor<Theme>;
  readonly onChange?: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeControls>();
export const useTheme = (): ThemeControls => useContext(ThemeContext) ?? { theme: () => "light" };

/** DOM synchronization stays in Solid; the application service owns the preference. */
export function ThemeProvider(props: ParentProps<ThemeControls>) {
  createRenderEffect(() => {
    document.documentElement.dataset.colorScheme = props.theme();
    const canvas = getComputedStyle(document.documentElement)
      .getPropertyValue("--oc-surface-canvas")
      .trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", canvas);
  });
  return <ThemeContext.Provider value={props}>{props.children}</ThemeContext.Provider>;
}
