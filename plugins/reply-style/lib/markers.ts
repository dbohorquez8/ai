// Canonical presentation core for the layered reply style (WS-104/WS-105, contract C1).
// Vendored byte-for-byte into bb-plugin-reply-style/lib and ai/plugins/reply-style/lib (dbohorquez8/ai).
// Pure TypeScript: no imports, no DOM, no Node.

export const READ_LEAD = "Read";
export const NEEDS_YOU_LEAD = "Needs You";
export const MY_LEAN = "(My lean)";

/** The bold lead of the closing state paragraph, and the state it names. */
export const STATE_LEADS = { Running: "running", Working: "working", Done: "done" } as const;
export type StateKind = (typeof STATE_LEADS)[keyof typeof STATE_LEADS];

/** A question header's whole bold text: 1-2 digits, space, U+00B7, space, text. */
export const HEADER_LEAD: RegExp = /^(\d{1,2}) · (\S[\s\S]*)$/;
/** An option's bold text: "(", one capital A-Z, ")", space, text. */
export const OPTION_LEAD: RegExp = /^\(([A-Z])\) (\S[\s\S]*)$/;

export type ReplyBlock =
  | { kind: "paragraph"; lead: string | null; rest: string }
  | { kind: "other" };

export type BlockRole =
  | { role: "opening" }
  | { role: "label" }
  | { role: "state"; kind: StateKind }
  | { role: "header"; number: string; text: string; index: number }
  | { role: "option"; letter: string; text: string; lean: boolean; indented: boolean }
  | { role: "plain" };

const LEAN_SUFFIX = /\s\(My lean\)$/;

function restEndsLead(rest: string): boolean {
  return rest === "" || rest[0] === " " || rest[0] === "\n";
}

/** One role per block, same length and order as the input. Pure. */
export function classifyReply(blocks: readonly ReplyBlock[]): BlockRole[] {
  const roles: BlockRole[] = [];
  // A state paragraph closes a reply that asks nothing: any Needs You paragraph rules it out.
  const asks = blocks.some((b) => b.kind === "paragraph" && b.lead === NEEDS_YOU_LEAD && restEndsLead(b.rest));
  let inAction = false;
  let headers = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind !== "paragraph" || block.lead === null) {
      roles.push({ role: "plain" });
      continue;
    }
    const { lead, rest } = block;
    if (i === 0 && lead === READ_LEAD && restEndsLead(rest)) {
      roles.push({ role: "opening" });
      continue;
    }
    if (i === blocks.length - 1 && !asks && Object.hasOwn(STATE_LEADS, lead) && restEndsLead(rest)) {
      roles.push({ role: "state", kind: STATE_LEADS[lead as keyof typeof STATE_LEADS] });
      continue;
    }
    if (lead === NEEDS_YOU_LEAD && restEndsLead(rest)) {
      roles.push({ role: "label" });
      inAction = true;
      continue;
    }
    if (inAction) {
      const h = HEADER_LEAD.exec(lead);
      if (h && rest.trim() === "") {
        roles.push({ role: "header", number: h[1], text: h[2], index: headers });
        headers++;
        continue;
      }
      const o = OPTION_LEAD.exec(lead);
      if (o) {
        const lean = lead.endsWith(" " + MY_LEAN);
        roles.push({
          role: "option",
          letter: o[1],
          text: lean ? o[2].replace(LEAN_SUFFIX, "") : o[2],
          lean,
          indented: headers > 0,
        });
        continue;
      }
    }
    roles.push({ role: "plain" });
  }
  return roles;
}
