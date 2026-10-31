// Layout colors are roles; the host's theme resolves them, so a theme switch recolors the mod.
import type { Color } from "claude-code";
import type { TerminalColor } from "./layout";

export const THEME_KEYS: Readonly<Record<TerminalColor, { color: Color; dimColor?: true }>> = {
  // BB's NEW-line cyan (--timeline-accent, sampled #A1E7FA on the dark theme), Owner's ask 2026-10-31.
  // No theme key holds a cyan, so this one role is a raw color: it does not follow a light theme.
  accent: { color: "#a1e7fa" },
  error: { color: "error" },
  // Open Question 1, revised to B: the action bar is the error role at full strength (faint read as gray).
  errorBar: { color: "error" },
  muted: { color: "inactive" },
  // The closing state bar: green for Waiting, yellow for Working. No fallback needed:
  // a custom theme's missing tokens fall through to its built-in base, which defines both.
  success: { color: "success" },
  warning: { color: "warning" },
};
