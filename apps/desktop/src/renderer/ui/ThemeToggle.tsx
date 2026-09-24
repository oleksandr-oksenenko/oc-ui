import { Button } from "@opencode/ui/button";

import type { Theme } from "../appearance.ts";
import { useTheme } from "./ThemeProvider.tsx";

const themeLabels = {
  light: "Light theme",
  dim: "Dim theme",
  dark: "Dark (AMOLED)",
} satisfies Record<Theme, string>;
const nextTheme = { light: "dim", dim: "dark", dark: "light" } satisfies Record<Theme, Theme>;

export function ThemeToggle() {
  const theme = useTheme();
  const next = () => nextTheme[theme.theme()];
  return (
    <Button
      type="button"
      size="small"
      variant="ghost-muted"
      aria-label={`Switch to ${next()} theme`}
      title={`Switch to ${next()} theme`}
      disabled={!theme.onChange}
      onClick={() => theme.onChange?.(next())}
    >
      {themeLabels[theme.theme()]}
    </Button>
  );
}
