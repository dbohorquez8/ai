# Changelog

## Unreleased

- The plugin is now Bridge: id `bridge`, command `/bridge`, pane title `Bridge`. Settings saved under the
  old `koombea-sidebar` name are not carried over and start from their defaults.
- Project icons replace the per-card creatures: each card's first line starts with the project's
  picture (the first of a fixed list of candidate files, cached as a 64-pixel PNG) where the terminal draws pictures,
  else a monogram on the project color. The setting is now `Show project icons` (`setting:icons`).
  The creature stays in the working scene.
- The Working shelf is a footer setting, `Working shelf` (`setting:workingShelf`), off by default.
  While it is off, a working session stays in Active as a full card whose status shows the spinner,
  `Working` and the time.
- A Done card's title is bold until the card is pressed.
- Failed: a red `✕ Failed` pill when this session's last turn ended on an API error (until the card is
  pressed, a later turn ends well or the next prompt is sent), or when a session's status word is `failed` or `error`.
- Check?: this session's idle card shows yellow `Check?` while its last stop still listed background tasks;
  it stays parked, snoozed or settled when put away.
- This session's background tasks are rows under its card (`⟳ Kind label age`, up to 3, then `+N more`),
  in place of the `⟳ n` count.
- A chime when a card changes into Needs you or Failed, once across sessions, silent for a card put
  away; `/bridge sound on|off` (`setting:sound`, default on).
- The README lists its command table once.
- `/bridge soft-limit 150k|off` sets the context soft limit (default 150k
  tokens, `setting:softLimit`). The percentage still shows the window fill; its color turns orange
  from 75% of the soft limit and red at 100%.
- The `Manual` sort mode is gone: moving cards one place at a time is not a practical way to order a terminal list. A stored `manual` sort reads as `Recent activity`.
  Pinned cards still move up and down.
- A session renamed with `/rename` shows that name as its card title, before the generated title.

## 2.0.0

The redesigned look and behaviour, in three layers (core, drawing, terminal adapters).

- Seven shelves: Pinned, Active, Working, Inactive, Snoozed, Parked and Settled. Inactive, Snoozed,
  Parked and Settled start collapsed. A collapsed shelf shows its count in the header.
- Four statuses: Working (a spinner), Needs you (a red pill that rings a bell), Done (a gray pill
  until the card is pressed) and Idle (the age). A card never shows Failed.
- Creatures: a small animated creature on each full card (typing, waving, cheering, asleep) when
  the terminal draws 24-bit color and the pane is at least 30 columns wide. A setting turns them off.
  Without 24-bit color a one-character mark stands in.
- Empty-state scenes: line-art hills with `All clear. Time to touch some grass.`, or a creature at
  a laptop with a working caption while any session works.
- Snooze (1 hour, 5 hours, This evening, Tomorrow morning, Next week), Park and Settle, with the
  designed wake and return rules. A woken card says `Woke`.
- Sort the Active shelf by recent activity, date created, project or manual order, with move up
  and move down in manual mode and for Pinned cards.
- A `N need you` line and a `Next` button (hotkey `n`) that focuses the next session waiting for you.
- Card details: git branch, model, pull request number and, for this session, a context bar
  (`NN% ▰▰▱▱`). Subagent rows show a tag and age; waiting rows are tinted.
- Light and dark palettes from the Workspace design tokens, each checked for 4.5:1 contrast. The
  theme follows Claude Code's, with a `Theme: auto` setting to override it.
- New data sources: `claude agents --json` as a 30-second cross-check of status; titles read at
  most the last 256 KB of a transcript, in every mode; pull request numbers from `gh pr list`
  (first run after 60 seconds, then every 5 minutes; skipped when `gh` is missing or signed out).
- Ghostty focus now tells two tabs in one folder apart by their title when it can.
- Saved state is one store entry per session plus one per setting, so two panes changing different
  sessions both persist. An unreadable saved value resets to its default and says so.
- A layer checker, `tools/check-sidebar-layers.sh`, fails the build when core or drawing code
  imports across a layer or names a terminal.
- Third-party notices now list every adapted file.

## 1.0.0

Initial release.

- A docked `Sessions` pane (`/bridge`, and at every session start): this machine's sessions from
  `ListAgents` and this session's subagents, with status, refreshed every 5 seconds. Rows draw
  name, status, `[pin]` and `[park]` apart.
- Pin and park per row, kept in the plugin's store across sessions. Pinning unparks, parking
  unpins; parked rows sit in a collapsed group.
- Session rows are joined by name to the internal session registry (`~/.claude/sessions/*.json`)
  for the session id, folder and pid; with no match a row says resume is unavailable. A subagent
  row shows its transcript in the main view.
- A session-row press focuses the terminal tab that runs the session, within the pane's own
  terminal app only: cmux (`select-workspace` + `focus-panel`, same instance, any workspace), tmux
  (pane by tty, same server socket), Ghostty (AppleScript, only when one terminal has the
  session's folder), Terminal.app and iTerm2 (AppleScript, tab by tty).
- The pane finds its own terminal once at session start (cmux by `CMUX_*`, ahead of
  `TERM_PROGRAM=ghostty`; tmux by `TMUX` and its socket; else the parent chain; else
  `TERM_PROGRAM`). A live session in another app makes no call and no copy: its row is drawn dim
  with the app's name, and a press says `<name> runs in <app>`, or `<name>: terminal unknown`.
- An exited session, or a failed focus step, copies `cd '<dir>' && claude --resume <session id>`;
  the note under the list names the step that failed. A press shows no popup.
- Each new session's terminal is probed during the refresh (one batched `ps eww` call) and kept in
  memory by `pid` and registry `startedAt`, so a press runs no probe. Each terminal's focus steps
  run as one process.
