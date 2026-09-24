import { Button } from "@opencode/ui/button";

import { useTheme } from "./ThemeProvider.tsx";

export function ThemeToggle() {
  const theme = useTheme();
  const next = () => (theme.theme() === "light" ? "dark" : "light");
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
      {theme.theme() === "light" ? "Light theme" : "Dark (AMOLED)"}
    </Button>
  );
}
