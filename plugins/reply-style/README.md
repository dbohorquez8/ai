# reply-style

A Claude Code mod that makes structured replies easy to scan in the terminal. It finds three kinds of marker in
Claude's reply and draws each one as a colored bar: the answer at the top, the question that needs you, and the line
that says whether work is still running.

![The same reply without and with the mod](assets/before-after.png)

## What it draws

| Marker in the reply | What the terminal shows |
| --- | --- |
| `**Read** <answer>` as the first paragraph | The answer in bold behind a blue bar; the word Read is dropped. |
| `**Needs You** <question>` and the lettered options after it | A red bar down the whole block, red option letters, a dashed line between numbered questions. |
| `**Waiting**`, `**Working**` or `**Done**` as the last paragraph | The sentence behind a green (Waiting), yellow (Working) or plain (Done) bar; the word is dropped. |

Everything between the markers is drawn by Claude Code as usual. A reply with no markers is left alone, and so is
every surface other than the terminal. Colors come from your Claude Code theme, so they follow light and dark themes.

A question block:

![A Needs You block with two numbered questions](assets/needs-you.png)

The three closing lines:

![Waiting, Working and Done lines](assets/states.png)

## Getting replies in this shape

The mod only draws; it does not tell Claude how to write. Replies get the markers from your output style or
instructions. A reply the mod styles looks like this in plain markdown:

```markdown
**Read** The checkout bug is fixed: a discount code no longer applies twice.

The cause was the cart page re-sending the code on every refresh.

**Waiting** The full test suite is running in the background; next: I push the fix when it passes.
```

The rules the mod reads:

- **Read** is the first paragraph's bold lead.
- **Needs You** starts the action block. Options are bold `(A)`, `(B)` … leads, and the recommended one ends its bold
  text with `(My lean)`. Numbered questions use a bold `1 · Question?` header.
- **Waiting**, **Working** or **Done** is the last paragraph's bold lead. A reply with a Needs You block has no such line.
- A lead counts only when it is the exact capitalised word followed by a space, a line break or the end of the paragraph.

## Install

```sh
claude plugin marketplace add dbohorquez8/ai
claude plugin install reply-style@dbohorquez
```

Restart Claude Code to load it. To turn it off: `claude plugin disable reply-style@dbohorquez`; to remove it:
`claude plugin uninstall reply-style@dbohorquez`.

## Limits

- The bars appear when a reply finishes, not while it streams. Claude Code draws streaming text itself and raises
  `ui.render` for an `AssistantMessage` only once the block is complete (checked on 2.1.306 with `--debug-file`: no
  render dispatch until 3 ms before `turn.complete`). The classic `MessageDisplay` hook sees streamed lines, but it can
  only replace them with plain text, so it cannot draw colored bars.
- Tested on Claude Code **2.1.302** (`lib/version.ts`). On another version it prints one notice per version change.
- If the render hook fails or never runs, it prints one "inactive" notice per session. The check runs one turn late,
  because the host can raise `turn.complete` before the final reply's `ui.render`.

## How it works

- Three hooks only: `ui.render` (AssistantMessage), `session.start`, `turn.complete`. No prompt hook: the reply rules
  reach the session through the output style.
- `lib/layout.ts` turns a reply's text and the terminal width into sections; the hook draws them with Claude Code's
  `Box`, `Text` and `Markdown` elements.
- `lib/markers.ts` is vendored byte for byte from the Workspace repo (`docs/reply-style/markers.ts`). Do not edit it here.
- The screenshots in `assets/` are drawn from `lib/layout.ts` itself, with Claude Code's dark theme colors approximated.
