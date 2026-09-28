import type { Theme } from "./appearance.ts";

export const syntaxThemes = {
  light: "github-light-high-contrast",
  dark: "github-dark-high-contrast",
} as const;

export function activeSyntaxTheme(theme: Theme) {
  return syntaxThemes[theme];
}
