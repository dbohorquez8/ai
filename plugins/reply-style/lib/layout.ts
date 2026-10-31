// Reply layout for the Claude Code terminal (contract C5.3), drawn like the BB plugin: a colored divider
// over the Needs You block and the closing state, a glyph in place of each marker word. Pure: text and width in,
// sections out. The hook draws the sections; it adds one blank row between them.
import { markdownBlocks, type SourceBlock } from "./blocks";
import { inlineRuns, type Run } from "./inline";
import { classifyReply, type BlockRole } from "./markers";
import { cellWidth, wrapRuns } from "./width";

export type TerminalColor = "accent" | "error" | "errorBar" | "muted" | "success" | "warning";
export type TerminalLine = Run[];
export type Section = { kind: "styled"; lines: TerminalLine[] } | { kind: "markdown"; text: string };

export const DASH = "╌";
export const RULE = "─";
export const WRAP_INDENT = "    ";

/** Glyph set, resolved by the hook from TERM_PROGRAM the way the bridge mod does it: Nerd Font glyphs in Ghostty and iTerm2, plain ones elsewhere. */
export type GlyphMode = "nerd" | "plain";

/** The glyph each marker draws in place of its word: a lightbulb for the opening, bell, cog, spinner and a check circle for Done. */
export const GLYPHS: Readonly<Record<GlyphMode, { opening: string; label: string; waiting: string; working: string; done: string }>> = {
  nerd: { opening: "\u{f0335}", label: "\uf0f3", waiting: "\u{f0493}", working: "⠋", done: "\u{f05e0}" },
  plain: { opening: "i", label: "!", waiting: "↻", working: "⠋", done: "✓" },
};

/** The divider word each block shows on its rule, like BB's uppercase "NEEDS YOU" / "WAITING" line. */
export const DIVIDER_WORDS = { opening: "NEW", label: "NEEDS YOU", waiting: "WAITING", working: "WORKING", done: "DONE" } as const;

/** The paragraph's text as the host would join it: markdown's own line breaks become spaces. */
function paragraphText(lines: readonly string[], block: SourceBlock): string {
  return lines
    .slice(block.start, block.end)
    .map((line) => line.replace(/^[ \t]+/, ""))
    .join(" ");
}

const bold = (runs: Run[]): Run[] => runs.map((run) => ({ ...run, bold: true }));

/** A rule across the width with the word at its left, both in one color: `NEEDS YOU ────────`. */
export function dividerLine(word: string, color: TerminalColor | undefined, columns: number): TerminalLine {
  const fill = Math.max(0, columns - word.length - 1);
  const paint = (text: string): Run => (color ? { text, color } : { text });
  return [paint(word), { text: " " }, paint(RULE.repeat(fill))];
}

/** Lines led by a glyph and a space; wrapped rows hang under the text, past the glyph. */
function glyphLines(glyph: string | undefined, color: TerminalColor | undefined, runs: Run[], columns: number): TerminalLine[] {
  if (glyph === undefined) return wrapRuns(runs, Math.max(1, columns));
  const lead: Run = color ? { text: glyph, color } : { text: glyph };
  const indent = cellWidth(glyph) + 1;
  return wrapRuns(runs, Math.max(1, columns - indent)).map((line, n) => (n === 0 ? [lead, { text: " " }, ...line] : [{ text: " ".repeat(indent) }, ...line]));
}

export function layoutReply(text: string, columns: number, glyphMode: GlyphMode = "plain"): Section[] | null {
  const glyphs = GLYPHS[glyphMode];
  const lines = text.split("\n");
  const blocks = markdownBlocks(text);
  const roles: BlockRole[] = classifyReply(blocks);
  const hasOpening = roles[0]?.role === "opening";
  const firstLabel = roles.findIndex((role) => role.role === "label");
  const last = roles[roles.length - 1];
  const state = last?.role === "state" ? last : undefined;
  if (!hasOpening && firstLabel === -1 && !state) return null;

  const sections: Section[] = [];
  const sourceOf = (from: number, to: number): string => lines.slice(blocks[from]?.start, blocks[to]?.end).join("\n");
  const restOf = (block: SourceBlock | undefined): string => (block?.kind === "paragraph" ? block.rest.replace(/\n/g, " ") : "");

  // Opening: a blue NEW divider like BB's new-messages line, then the word Read becomes the blue info glyph; the rest is bold.
  if (hasOpening) {
    const rest = restOf(blocks[0]).trim();
    const body = glyphLines(glyphs.opening, "accent", bold(inlineRuns(rest)), columns);
    sections.push({ kind: "styled", lines: [dividerLine(DIVIDER_WORDS.opening, "accent", columns), ...body] });
  }

  const middleStart = hasOpening ? 1 : 0;
  const middleEnd = firstLabel === -1 ? blocks.length - (state ? 1 : 0) : firstLabel;
  if (middleEnd > middleStart) sections.push({ kind: "markdown", text: sourceOf(middleStart, middleEnd - 1) });
  if (state) {
    // The closing state: a divider in the state's color (green Waiting, yellow Working, default Done), then the
    // sentence led by the state's glyph. Done's check takes the default color: white on a dark theme.
    const color: TerminalColor | undefined = state.kind === "waiting" ? "success" : state.kind === "working" ? "warning" : undefined;
    const glyph = glyphs[state.kind];
    const body = glyphLines(glyph, color, inlineRuns(restOf(blocks[blocks.length - 1]).trim()), columns);
    sections.push({ kind: "styled", lines: [dividerLine(DIVIDER_WORDS[state.kind], color, columns), ...body] });
    return sections;
  }
  if (firstLabel === -1) return sections;

  let lastAction = firstLabel;
  roles.forEach((role, i) => {
    if (i > firstLabel && (role.role === "label" || role.role === "header" || role.role === "option")) lastAction = i;
  });

  const actionLines: TerminalLine[] = [];
  const pushWrapped = (runs: Run[], indent: boolean) => {
    const wrapped = wrapRuns(runs, Math.max(1, indent ? columns - WRAP_INDENT.length : columns));
    wrapped.forEach((line, n) => actionLines.push(n > 0 && indent ? [{ text: WRAP_INDENT }, ...line] : line));
  };
  for (let i = firstLabel; i <= lastAction; i++) {
    const block = blocks[i];
    const role = roles[i];
    if (block === undefined || role === undefined) continue;
    const rest = restOf(block);
    if (role.role === "label") {
      // The red NEEDS YOU divider, then the question led by the bridge mod's bell.
      actionLines.push(dividerLine(DIVIDER_WORDS.label, "error", columns));
      actionLines.push(...glyphLines(glyphs.label, "error", inlineRuns(rest.trim()), columns));
    } else if (role.role === "header") {
      actionLines.push([{ text: DASH.repeat(Math.max(0, columns)), color: "muted" }]);
      pushWrapped(bold([{ text: `${role.number} · ` }, ...inlineRuns(role.text)]), false);
    } else if (role.role === "option") {
      const runs: Run[] = [{ text: `(${role.letter})`, color: "error" }, { text: " " }, ...bold(inlineRuns(role.text))];
      if (role.lean) runs.push({ text: " (My lean)", color: "error" });
      pushWrapped([...runs, ...inlineRuns(rest)], true);
    } else if (block.kind === "paragraph") {
      pushWrapped(inlineRuns(paragraphText(lines, block)), false);
    } else {
      for (const line of lines.slice(block.start, block.end)) actionLines.push([{ text: line }]);
    }
  }
  sections.push({ kind: "styled", lines: actionLines });

  if (lastAction + 1 < blocks.length) sections.push({ kind: "markdown", text: sourceOf(lastAction + 1, blocks.length - 1) });
  return sections;
}
