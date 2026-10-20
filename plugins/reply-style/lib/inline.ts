// The inline subset the mod draws itself: **bold**, `code`, [text](url). All else is literal.
import type { TerminalColor } from "./layout";

export type Run = { text: string; color?: TerminalColor; bold?: boolean; href?: string };

export function inlineRuns(markdown: string): Run[] {
  const runs: Run[] = [];
  let literal = "";
  const flush = () => {
    if (literal !== "") runs.push({ text: literal });
    literal = "";
  };
  let i = 0;
  while (i < markdown.length) {
    const rest = markdown.slice(i);
    if (rest.startsWith("**") && rest.length > 2 && !/\s/.test(rest.charAt(2))) {
      let close = rest.indexOf("**", 2);
      while (close !== -1 && /\s/.test(rest.charAt(close - 1))) close = rest.indexOf("**", close + 1);
      if (close !== -1) {
        flush();
        for (const run of inlineRuns(rest.slice(2, close))) runs.push({ ...run, bold: true });
        i += close + 2;
        continue;
      }
    }
    if (rest.startsWith("`")) {
      const close = rest.indexOf("`", 1);
      if (close > 1) {
        flush();
        runs.push({ text: rest.slice(1, close) });
        i += close + 1;
        continue;
      }
    }
    if (rest.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
      if (link) {
        flush();
        runs.push({ text: link[1], href: link[2] });
        i += link[0].length;
        continue;
      }
    }
    literal += rest.charAt(0);
    i++;
  }
  flush();
  return runs;
}

export function plainText(markdown: string): string {
  return inlineRuns(markdown)
    .map((run) => run.text)
    .join("");
}
