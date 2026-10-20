// Terminal cell width and word wrap for runs.
import type { Run } from "./inline";

const COMBINING = /^[\p{Mn}\p{Me}​-‏︎️]$/u;
const EMOJI = /^\p{Emoji_Presentation}$/u;

function codePointWidth(ch: string): number {
  if (COMBINING.test(ch)) return 0;
  const cp = ch.codePointAt(0)!;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd) ||
    EMOJI.test(ch)
  ) {
    return 2;
  }
  return 1;
}

export function cellWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += codePointWidth(ch);
  return width;
}

type Piece = { source: number; text: string };

/** Splits an over-long word into chunks no wider than `width` cells. */
function hardBreak(word: string, width: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let used = 0;
  for (const ch of word) {
    const w = codePointWidth(ch);
    if (used + w > width && current !== "") {
      chunks.push(current);
      current = "";
      used = 0;
    }
    current += ch;
    used += w;
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

/** Greedy wrap at U+0020. A word wider than `width` breaks by cells. Pieces of one source run
 *  that stay on one line are joined back into a single run. */
export function wrapRuns(runs: readonly Run[], width: number): Run[][] {
  const max = Math.max(1, width);
  const lines: Piece[][] = [[]];
  let used = 0;
  const line = () => lines[lines.length - 1];
  const newLine = () => {
    const current = line();
    while (current.length > 0 && current[current.length - 1].text === " ") current.pop();
    lines.push([]);
    used = 0;
  };
  runs.forEach((run, source) => {
    for (const token of run.text.split(/( )/)) {
      if (token === "") continue;
      if (token === " ") {
        if (used === 0 || used + 1 > max) continue;
        line().push({ source, text: " " });
        used += 1;
        continue;
      }
      const w = cellWidth(token);
      if (used + w <= max) {
        line().push({ source, text: token });
        used += w;
        continue;
      }
      if (used > 0) newLine();
      if (w <= max) {
        line().push({ source, text: token });
        used = w;
        continue;
      }
      const chunks = hardBreak(token, max);
      chunks.forEach((chunk, n) => {
        if (n > 0) newLine();
        line().push({ source, text: chunk });
        used = cellWidth(chunk);
      });
    }
  });
  const last = line();
  while (last.length > 0 && last[last.length - 1].text === " ") last.pop();
  return lines
    .filter((pieces, n) => pieces.length > 0 || n === 0)
    .map((pieces) => {
      const out: Run[] = [];
      let previous = -1;
      for (const piece of pieces) {
        if (piece.source === previous) {
          out[out.length - 1].text += piece.text;
        } else {
          const { color, bold, href } = runs[piece.source];
          out.push({ text: piece.text, ...(color !== undefined && { color }), ...(bold !== undefined && { bold }), ...(href !== undefined && { href }) });
          previous = piece.source;
        }
      }
      return out;
    });
}
