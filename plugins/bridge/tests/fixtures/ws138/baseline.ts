// WS-138 baselines, frozen from the pre-feature Bridge (ai repo HEAD 6c505cf, 2026-10-23), before any feature code.
// Plain literals: never regenerate them from the code under test. The runner imports code files only, so the
// README, CHANGELOG and manifest baselines sit beside this file as README.baseline.md, CHANGELOG.baseline.md,
// plugin.baseline.json, hooks.baseline.json and README-reads.baseline.txt (for the Workspace-root S checks).

/** AC-35: the six-worker own card at 44 columns with ticket progress off: the child rows (spinner shown as ⠋) and the "more" line. */
export const SIX_WORKER_ROWS = [
  '  │ ● trim fixtures               ✕ Failed',
  '  │ ● tidy shelf              ⠋ Working 2m',
  '  │ ● scan WS-11 alpha        ⠋ Working 2m',
  '  │ ● review docs             ⠋ Working 2m',
  '  │ ● port notes                        2m',
]
export const SIX_WORKER_MORE = '+1 more'

/** NH-14: the status line of an idle own card with no workers, read from the module entry at 44 columns. */
export const IDLE_STATUS_LINE = 'O  own                                 now'

/** AC-17: the status line of the own card (busy 5 minutes) with prefixes off, at 44 columns. Workers do not change it today. */
export const BUSY_STATUS_LINE = 'proj                       ⠋ Working 5m'

/**
 * AC-49 H and TC-1: every file, process and network call the host layer sees over the flow "mount the pane, run `/bridge tickets WS-`,
 * 13 redraws of 5 s (65 s of fake time, past the 30 s agents cross-check and the 60 s pull-request read), with three workers on three
 * tickets (counted from before the mount), sorted. Frozen from 6c505cf.
 */
export const FLOW_HOST_LOG: string[] = [
  "fs.stat /p/own/.idea/icon.svg",
  "fs.stat /p/own/app/favicon.ico",
  "fs.stat /p/own/app/favicon.png",
  "fs.stat /p/own/app/icon.ico",
  "fs.stat /p/own/app/icon.png",
  "fs.stat /p/own/app/icon.svg",
  "fs.stat /p/own/assets/icon.png",
  "fs.stat /p/own/assets/icon.svg",
  "fs.stat /p/own/assets/logo.png",
  "fs.stat /p/own/assets/logo.svg",
  "fs.stat /p/own/favicon.ico",
  "fs.stat /p/own/favicon.png",
  "fs.stat /p/own/favicon.svg",
  "fs.stat /p/own/icon.ico",
  "fs.stat /p/own/icon.png",
  "fs.stat /p/own/icon.svg",
  "fs.stat /p/own/public/favicon.ico",
  "fs.stat /p/own/public/favicon.png",
  "fs.stat /p/own/public/favicon.svg",
  "fs.stat /p/own/src/app/favicon.ico",
  "fs.stat /p/own/src/app/icon.png",
  "fs.stat /p/own/src/app/icon.svg",
  "fs.stat /p/own/src/favicon.ico",
  "fs.stat /p/own/src/favicon.svg",
  "process.run claude agents --json",
  "process.run claude agents --json",
  "process.run claude agents --json",
  "process.run ps -axo pid=,ppid=,comm=",
  "process.run ps eww -o pid=,tty=,command= -p 1",
  "process.run sh -c d=\"${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects\"\nfor spec; do\n  mode=${spec%%:*}; f=\"$d/${spec#*:}.jsonl\"\n  t=$(tail -c 262144 \"$f\" 2>/dev/null)\n  a=$(printf %s \"$t\" | grep -F '\"type\":\"custom-title\"' | tail -n 1)\n  [ -z \"$a\" ] && a=$(printf %s \"$t\" | grep -F '\"type\":\"ai-title\"' | tail -n 1)\n  p=$(printf %s \"$t\" | grep -F '\"type\":\"last-prompt\"' | tail -n 1)\n  m=$(printf %s \"$t\" | grep -o '\"model\":\"[^\"]*\"' | tail -n 1)\n  l=$(printf %s \"$t\" | grep -E '\"type\":\"(user|assistant)\"' | tail -n 1)\n  u=$(printf %s \"$t\" | grep -F '\"type\":\"assistant\"' | grep -F '\"usage\":{' | grep -vF '\"isSidechain\":true' | tail -n 1 | grep -oE '\"(input_tokens|cache_creation_input_tokens|cache_read_input_tokens)\":[0-9]+' | tr \"\\n\" \" \")\n  printf '%s\\037%s\\037%s\\037%s\\037%s\\036' \"$a\" \"$p\" \"$m\" \"$l\" \"$u\"\ndone\nexit 0 bridge full:-p-own/04de1f00-0000-4000-8000-000000000000",
  "process.run sh -c for d; do\n  b=$(git -C \"$d\" branch --show-current 2>/dev/null)\n  [ -z \"$b\" ] && b=$(git -C \"$d\" rev-parse --short HEAD 2>/dev/null)\n  c=$(git -C \"$d\" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)\n  printf '%s\\037%s\\036' \"$b\" \"$c\"\ndone\nexit 0 bridge /p/own",
  ...Array<string>(14).fill("process.run sh -c for f in \"${CLAUDE_CONFIG_DIR:-$HOME/.claude}\"/sessions/*.json; do [ -f \"$f\" ] && cat \"$f\" && printf '\\036'; done; exit 0"),
]
