// Markdown source to the C1 block model, with source line ranges.
// Block rules follow CommonMark and GFM closely enough for replies: a paragraph is a run of
// plain lines; headings, lists, quotes, fences, indented code, tables, thematic breaks and
// HTML are each one `other` block.
import type { ReplyBlock } from "./markers";

/** 0-based line indices, `end` exclusive. */
export type SourceBlock = ReplyBlock & { start: number; end: number };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const THEMATIC = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE = /^ {0,3}>/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const HTML_START = /^ {0,3}<(?:[A-Za-z][A-Za-z0-9-]*[\s/>]|[A-Za-z][A-Za-z0-9-]*$|\/[A-Za-z]|!)/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** Line `i`, or "" past either end. */
const at = (lines: readonly string[], i: number): string => lines[i] ?? "";
const isBlank = (line: string) => line.trim() === "";
const isIndentedCode = (line: string) => /^(?: {4}|\t)/.test(line);

function startsTable(lines: readonly string[], i: number): boolean {
  const next = lines[i + 1];
  return next !== undefined && at(lines, i).includes("|") && next.includes("-") && TABLE_DELIMITER.test(next);
}

/** True when `line` starts a block that may interrupt a paragraph. */
function interruptsParagraph(lines: readonly string[], i: number): boolean {
  const line = at(lines, i);
  return FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || THEMATIC.test(line) || LIST_ITEM.test(line) || startsTable(lines, i);
}

/** The bold run that opens a paragraph's text, as C1 defines `lead` and `rest`. */
function splitLead(text: string): { lead: string | null; rest: string } {
  if (!text.startsWith("**") || text.length < 3 || /\s/.test(text.charAt(2))) return { lead: null, rest: text };
  let close = text.indexOf("**", 2);
  while (close !== -1 && /\s/.test(text.charAt(close - 1))) close = text.indexOf("**", close + 1);
  if (close === -1) return { lead: null, rest: text };
  return { lead: text.slice(2, close), rest: text.slice(close + 2) };
}

export function markdownBlocks(text: string): SourceBlock[] {
  const lines: string[] = text.split("\n");
  const blocks: SourceBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = at(lines, i);
    if (isBlank(line)) {
      i++;
      continue;
    }
    const start = i;
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1]!.charAt(0);
      const size = fence[1]!.length;
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}\\${mark}{${size},}[ \\t]*$`).test(at(lines, i))) i++;
      i = Math.min(i + 1, lines.length);
      blocks.push({ kind: "other", start, end: i });
      continue;
    }
    if (HEADING.test(line) || THEMATIC.test(line)) {
      i++;
      blocks.push({ kind: "other", start, end: i });
      continue;
    }
    if (isIndentedCode(line)) {
      while (i < lines.length && (isIndentedCode(at(lines, i)) || (isBlank(at(lines, i)) && i + 1 < lines.length && isIndentedCode(at(lines, i + 1))))) i++;
      blocks.push({ kind: "other", start, end: i });
      continue;
    }
    if (QUOTE.test(line)) {
      while (i < lines.length && !isBlank(at(lines, i))) i++;
      blocks.push({ kind: "other", start, end: i });
      continue;
    }
    if (LIST_ITEM.test(line)) {
      i++;
      while (i < lines.length) {
        if (!isBlank(at(lines, i))) {
          i++;
          continue;
        }
        const after = lines[i + 1];
        if (after !== undefined && (/^(?: {2,}|\t)\S/.test(after) || LIST_ITEM.test(after))) {
          i++;
          continue;
        }
        break;
      }
      blocks.push({ kind: "other", start, end: i });
      continue;
    }
    if (startsTable(lines, i)) {
      while (i < lines.length && !isBlank(at(lines, i))) i++;
      blocks.push({ kind: "other", start, end: i });
      continue;
    }
    if (HTML_START.test(line)) {
      while (i < lines.length && !isBlank(at(lines, i))) i++;
      blocks.push({ kind: "other", start, end: i });
      continue;
    }
    // Paragraph: runs until a blank line or a block that interrupts it.
    i++;
    let setext = false;
    while (i < lines.length && !isBlank(at(lines, i))) {
      if (SETEXT.test(at(lines, i))) {
        setext = true;
        i++;
        break;
      }
      if (interruptsParagraph(lines, i)) break;
      i++;
    }
    if (setext) {
      blocks.push({ kind: "other", start, end: i });
      continue;
    }
    const paragraph = lines
      .slice(start, i)
      .map((l) => l.replace(/^[ \t]+/, ""))
      .join("\n");
    blocks.push({ kind: "paragraph", ...splitLead(paragraph), start, end: i });
  }
  return blocks;
}
