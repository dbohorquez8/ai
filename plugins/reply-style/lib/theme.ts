// Layout colors are roles; the host's theme resolves them, so a theme switch recolors the mod.
import type { ThemeKey } from "claude-code";
import type { TerminalColor } from "./layout";

export const THEME_KEYS: Readonly<Record<TerminalColor, { color: ThemeKey; dimColor?: true }>> = {
  // "ide" is the theme's blue in every built-in theme; "suggestion" draws lavender in the dark ones.
  accent: { color: "ide" },
  error: { color: "error" },
  // Open Question 1, revised to B: the action bar is the error role at full strength (faint read as gray).
  errorBar: { color: "error" },
  muted: { color: "inactive" },
};
