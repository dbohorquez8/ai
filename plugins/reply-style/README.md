# reply-style

Claude Code mod `reply-style`. Draws replies that follow the Read / Needs You reply markers as bars in the terminal:
an accent bar on the opening, a red bar on the action block, dashed lines between question groups, and a bar on
the closing Waiting / Working / Done line (green, yellow, default color).
Every other reply, and every surface but the terminal, shows as the host draws it.

- Three hooks only: `ui.render` (AssistantMessage), `session.start`, `turn.complete`. No prompt hook: the reply rules reach the session through the output style.
- Tested on Claude Code **2.1.302** (`lib/version.ts`). On another version it prints one notice per version change.
- If the render hook fails or never runs, it prints one "inactive" notice per session. The check runs one turn late, because the host can raise `turn.complete` before the final reply's `ui.render`.
- The bars appear when a reply finishes, not while it streams. Claude Code draws streaming text itself and raises
  `ui.render` for an `AssistantMessage` only once the block is complete (checked on 2.1.306 with `--debug-file`: no
  render dispatch until 3 ms before `turn.complete`). The classic `MessageDisplay` hook sees streamed lines, but it can
  only replace them with plain text, so it cannot draw colored bars.
- `lib/markers.ts` is vendored byte for byte from the Workspace repo (`docs/reply-style/markers.ts`). Do not edit it here.

Install: `claude plugin marketplace add dbohorquez8/ai`, then `claude plugin install reply-style@dbohorquez`.
