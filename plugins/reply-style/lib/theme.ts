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
  // The closing state dot: green for Running, yellow for Working (WS-119). No fallback needed:
  // a custom theme's missing tokens fall through to its built-in base, which defines both.
  success: { color: "success" },
  warning: { color: "warning" },
};
