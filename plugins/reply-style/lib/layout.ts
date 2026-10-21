// Reply layout for the Claude Code terminal (contract C5.3). Pure: text and width in,
// sections out. The hook draws the sections; it adds one blank row between them.
import { markdownBlocks, type SourceBlock } from "./blocks";
import { inlineRuns, type Run } from "./inline";
import { classifyReply, type BlockRole } from "./markers";
import { wrapRuns } from "./width";

export type TerminalColor = "accent" | "error" | "errorBar" | "muted" | "success" | "warning";
export type TerminalLine = Run[];
export type Section = { kind: "styled"; lines: TerminalLine[] } | { kind: "markdown"; text: string };

export const OPENING_BAR = "▎ ";
export const ACTION_BAR = "┃ ";
export const STATE_DOT = "● ";
export const DASH = "╌";
export const WRAP_INDENT = "    ";

const BAR_WIDTH = 2;

/** The paragraph's text as the host would join it: markdown's own line breaks become spaces. */
function paragraphText(lines: readonly string[], block: SourceBlock): string {
  return lines
    .slice(block.start, block.end)
    .map((line) => line.replace(/^[ \t]+/, ""))
    .join(" ");
}

const bold = (runs: Run[]): Run[] => runs.map((run) => ({ ...run, bold: true }));
const barred = (bar: Run, runs: Run[]): TerminalLine => [bar, ...runs];

export function layoutReply(text: string, columns: number): Section[] | null {
  const lines = text.split("\n");
  const blocks = markdownBlocks(text);
  const roles: BlockRole[] = classifyReply(blocks);
  const hasOpening = roles[0]?.role === "opening";
  const firstLabel = roles.findIndex((role) => role.role === "label");
  const last = roles[roles.length - 1];
  const state = last?.role === "state" ? last : undefined;
  if (!hasOpening && firstLabel === -1 && !state) return null;

  const contentWidth = Math.max(1, columns - BAR_WIDTH);
  const sections: Section[] = [];
  const sourceOf = (from: number, to: number): string => lines.slice(blocks[from]?.start, blocks[to]?.end).join("\n");
  const restOf = (block: SourceBlock | undefined): string => (block?.kind === "paragraph" ? block.rest.replace(/\n/g, " ") : "");

  // Opening: the Read lead and its following space are dropped; the rest is bold.
  if (hasOpening) {
    const rest = restOf(blocks[0]).trim();
    const wrapped = wrapRuns(bold(inlineRuns(rest)), contentWidth);
    const bar: Run = { text: OPENING_BAR, color: "accent" };
    sections.push({ kind: "styled", lines: wrapped.map((line) => barred(bar, line)) });
  }

  const middleStart = hasOpening ? 1 : 0;
  const middleEnd = firstLabel === -1 ? blocks.length - (state ? 1 : 0) : firstLabel;
  if (middleEnd > middleStart) sections.push({ kind: "markdown", text: sourceOf(middleStart, middleEnd - 1) });
  if (state) {
    // The closing state line: a colored dot, then the sentence. Done draws the dot in the default color.
    const color: TerminalColor | undefined = state.kind === "waiting" ? "success" : state.kind === "working" ? "warning" : undefined;
    const dot: Run = color ? { text: STATE_DOT, color } : { text: STATE_DOT };
    const wrapped = wrapRuns(inlineRuns(restOf(blocks[blocks.length - 1]).trim()), contentWidth);
    sections.push({ kind: "styled", lines: wrapped.map((line, n) => (n === 0 ? [dot, ...line] : [{ text: " ".repeat(BAR_WIDTH) }, ...line])) });
    return sections;
  }
  if (firstLabel === -1) return sections;

  let lastAction = firstLabel;
  roles.forEach((role, i) => {
    if (i > firstLabel && (role.role === "label" || role.role === "header" || role.role === "option")) lastAction = i;
  });

  const bar: Run = { text: ACTION_BAR, color: "errorBar" };
  const actionLines: TerminalLine[] = [];
  const pushWrapped = (runs: Run[], indent: boolean) => {
    const wrapped = wrapRuns(runs, indent ? contentWidth - WRAP_INDENT.length : contentWidth);
    wrapped.forEach((line, n) => actionLines.push(n > 0 && indent ? [bar, { text: WRAP_INDENT }, ...line] : barred(bar, line)));
  };
  for (let i = firstLabel; i <= lastAction; i++) {
    const block = blocks[i];
    const role = roles[i];
    if (block === undefined || role === undefined) continue;
    const rest = restOf(block);
    if (role.role === "label") {
      pushWrapped([{ text: "Needs You", bold: true, color: "error" }, ...inlineRuns(rest)], false);
    } else if (role.role === "header") {
      actionLines.push([{ text: "┃", color: "errorBar" }, { text: " " + DASH.repeat(Math.max(0, columns - BAR_WIDTH)), color: "muted" }]);
      pushWrapped(bold([{ text: `${role.number} · ` }, ...inlineRuns(role.text)]), false);
    } else if (role.role === "option") {
      const runs: Run[] = [{ text: `(${role.letter})`, color: "error" }, { text: " " }, ...bold(inlineRuns(role.text))];
      if (role.lean) runs.push({ text: " (My lean)", color: "error" });
      pushWrapped([...runs, ...inlineRuns(rest)], true);
    } else if (block.kind === "paragraph") {
      pushWrapped(inlineRuns(paragraphText(lines, block)), false);
    } else {
      for (const line of lines.slice(block.start, block.end)) actionLines.push(barred(bar, [{ text: line }]));
    }
  }
  sections.push({ kind: "styled", lines: actionLines });

  if (lastAction + 1 < blocks.length) sections.push({ kind: "markdown", text: sourceOf(lastAction + 1, blocks.length - 1) });
  return sections;
}
