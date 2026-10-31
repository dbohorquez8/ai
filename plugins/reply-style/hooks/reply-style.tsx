// reply-style: draws the reply markers in the terminal the way the BB plugin draws them in chat.
// Three hooks and nothing else: the message render, session start and turn complete. Working's glyph spins
// on the newest reply through the Client region in ./spinner.tsx.
import type { EngineInterface, Register } from "claude-code";
import { createSessionGuard, decideVersionNotice, VERSION_STORE_KEY, withTimeout } from "../lib/notices";
import { layoutReply, SPIN_FRAMES, SPIN_PERIOD_MS, type GlyphMode } from "../lib/layout";
import { createNewestTracker } from "../lib/newest";
import { THEME_KEYS } from "../lib/theme";
import { TESTED_CLAUDE_CODE_VERSION } from "../lib/version";
import type { Run } from "../lib/inline";

const DEFAULT_COLUMNS = 80;
const STATE_TIMEOUT_MS = 1000;

/** Same rule as the bridge mod: Ghostty and iTerm2 ship the Nerd Font glyphs; every other terminal gets plain ones. */
export const glyphModeOf = (terminalProgram: string | undefined): GlyphMode =>
  terminalProgram === "ghostty" || terminalProgram === "iTerm.app" ? "nerd" : "plain";

export const register: Register = (on) => {
  const guard = createSessionGuard();
  let glyphMode: GlyphMode = "plain";
  const newest = createNewestTracker();

  // The render hook awaits nothing of its own: it returns a tree or next(e) at once.
  on("ui.render", { component: "AssistantMessage" }, ($, e, next) => {
    guard.renderRan();
    if (e.surface !== "terminal" || e.props.isSummary) return next(e);
    try {
      // Every block counts, marked or not: a newer block of any kind stops an older spinner.
      const seen = newest.see(e.requestId);
      // A newer block took over: redraw the older ones so their glyph stands still.
      if (seen.moved) $.ui.invalidate("ui.render");
      const sections = layoutReply(e.props.text, e.viewport?.columns ?? DEFAULT_COLUMNS, glyphMode);
      if (sections === null) return next(e);
      const { Box, Text, Link, Markdown, Client } = $.ui.resolve(e);
      const drawRun = (run: Run, key: number) => {
        const theme = run.color === undefined ? undefined : THEME_KEYS[run.color];
        if (run.spin && seen.isNewest) {
          return (
            <Client
              key="spin"
              module="./spinner.tsx"
              // The host refuses undefined anywhere in a Client's props, so absent colors are left out.
              props={{ frames: [...SPIN_FRAMES[glyphMode]], periodMs: SPIN_PERIOD_MS, ...(theme?.color ? { color: theme.color } : {}), ...(theme?.dimColor ? { dimColor: true } : {}) }}
            />
          );
        }
        const text = (
          <Text key={String(key)} color={theme?.color} dimColor={theme?.dimColor} bold={run.bold}>
            {run.text}
          </Text>
        );
        return run.href === undefined ? text : <Link key={String(key)} href={run.href}>{text}</Link>;
      };
      const parts = sections.map((section, i) => (
        <Box key={String(i)} flexDirection="column">
          {section.kind === "markdown" ? (
            <Markdown text={section.text} />
          ) : (
            section.lines.map((line, n) => (
              <Box key={String(n)}>{line.length === 0 ? <Text> </Text> : line.map(drawRun)}</Box>
            ))
          )}
        </Box>
      ));
      // One blank row between neighbouring sections.
      const rows = parts.flatMap((part, i) => (i === 0 ? [part] : [<Text key={`gap${i}`}> </Text>, part]));
      return <Box flexDirection="column">{rows}</Box>;
    } catch {
      guard.renderFailed();
      return next(e);
    }
  }).catch(($, e, next) => {
    guard.renderFailed();
    return next(e);
  });

  on("session.start", ($, e, next) => {
    guard.start(e);
    void checkVersion($);
    void readTerminal($).then((program) => {
      glyphMode = glyphModeOf(program);
    });
    return next(e);
  });

  on("turn.complete", ($, e, next) => {
    const notice = guard.turnEnded(e.answer);
    if (notice !== null) $.ui.log(notice);
    return next(e);
  });
};

/** TERM_PROGRAM, or undefined when the host cannot say in time. Never throws. */
async function readTerminal($: EngineInterface): Promise<string | undefined> {
  try {
    const value = await withTimeout(Promise.resolve($.env.get("TERM_PROGRAM")), STATE_TIMEOUT_MS);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Fire and forget: no await by the caller, bounded reads, never throws. */
async function checkVersion($: EngineInterface): Promise<void> {
  try {
    const version = await withTimeout($.session.version(), STATE_TIMEOUT_MS);
    const stored = await withTimeout(
      Promise.resolve($.store.get(VERSION_STORE_KEY)).then((value) => ({ value })),
      STATE_TIMEOUT_MS,
    );
    if (version === undefined || stored === undefined) return;
    const last = typeof stored.value === "string" ? stored.value : null;
    const { notice, lastSeen } = decideVersionNotice(version.version, TESTED_CLAUDE_CODE_VERSION, last);
    if (notice !== null) $.ui.log(notice);
    await $.store.set(VERSION_STORE_KEY, lastSeen);
  } catch {
    // A failed read or write means no notice; the session is unaffected.
  }
}
