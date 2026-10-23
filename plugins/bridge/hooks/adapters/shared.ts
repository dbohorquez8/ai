// Shared by every terminal adapter: types, host detection, places, the probe
// cache, AppleScript helpers and the message builders. Pure: every command is
// built here and every output is parsed here; the caller passes `run`, the one
// edge that reaches `$.process`. Per-terminal files import only this file.
//
// Module state: the `known` probe cache lives here, once.

import type { Caps } from '../core/types'

/** What one command printed. A command that could not start reads as exit 127. */
export type Ran = { exitCode: number; stdout: string; stderr: string }
export type Run = (argv: readonly string[]) => Promise<Ran>

export type Host = 'cmux' | 'tmux' | 'Ghostty' | 'Terminal' | 'iTerm2'

/** The session to focus: the registry's pid, directory and start time. */
export type FocusTarget = { pid: number; cwd: string; startedAt?: number }

/**
 * Where a session runs: its terminal app, plus the instance within it when the
 * app can run several: the tmux server socket, or the cmux socket path.
 */
export type Place = { host: Host; instance?: string }

/** Where the press comes from: this process's cmux CLI path, and the pane's own place (undefined when not recognised). */
export type Own = { cli?: string; place?: Place }

export type Focused =
  | { kind: 'focused'; host: Host }
  | { kind: 'dead' }
  | { kind: 'failed'; reason: string }
  /** Live, but in another app or instance: nothing was called. */
  | { kind: 'elsewhere'; place: Place }
  /** Live, but its terminal is not one of the supported hosts. */
  | { kind: 'unknown' }

/** The environment variables that name a host; nothing else is ever read. */
export const HOST_VARS = ['CMUX_WORKSPACE_ID', 'CMUX_SURFACE_ID', 'CMUX_BUNDLED_CLI_PATH', 'CMUX_SOCKET_PATH', 'TMUX', 'TMUX_PANE', 'TERM_PROGRAM'] as const
export type HostEnv = Partial<Record<(typeof HOST_VARS)[number], string>>

export const CMUX_APP_CLI = '/Applications/cmux.app/Contents/Resources/bin/cmux'

// ---------------------------------------------------------------- probes

/** `ps eww` on one or more pids: each line its pid, its tty, then its argv followed by its environment. */
export const probeArgv = (pids: readonly number[]) => ['ps', 'eww', '-o', 'pid=,tty=,command=', '-p', pids.join(',')]

/** Every process with its parent and executable, for walking the parent chain. */
export const TABLE_ARGV = ['ps', '-axo', 'pid=,ppid=,comm=']

export type Probe = { tty: string; isClaude: boolean; env: HostEnv }

/**
 * One probed line without its pid. Only the known host variables are kept: the
 * rest of the environment holds tokens. A value runs to the next ` NAME=`, so
 * a path with a space (`~/Library/Application Support/...`) stays whole.
 */
const probeOfLine = (line: string): Probe => {
  const [tty = '', ...rest] = line.trim().split(/\s+/)
  const env: HostEnv = {}
  for (const name of HOST_VARS) {
    const found = new RegExp(`(?:^|\\s)${name}=(.*?)(?=\\s+[A-Za-z_][A-Za-z0-9_]*=|\\s*$)`).exec(line)
    if (found?.[1]) env[name] = found[1]
  }
  return { tty: ttyPathOf(tty), isClaude: rest.slice(0, 2).some(word => /claude/i.test(word)), env }
}

/** The probes in `probeArgv`'s output by pid; a gone pid has none. `ps` exits 1 when any pid is gone, so stdout decides. */
export const probesOf = (ran: Ran): Map<number, Probe> => {
  const probes = new Map<number, Probe>()
  if (ran.exitCode === 127) return probes
  for (const line of ran.stdout.split('\n')) {
    const found = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (found) probes.set(Number(found[1]), probeOfLine(found[2]!))
  }
  return probes
}

/** `ttys003` as `/dev/ttys003`; no tty (`??`, `-`) as ''. */
export const ttyPathOf = (tty: string) => {
  const one = tty.trim()
  if (!one || one === '??' || one === '-') return ''
  return one.startsWith('/dev/') ? one : `/dev/${one}`
}

export type ProcessRow = { pid: number; ppid: number; comm: string }

/** The process table, as `TABLE_ARGV` prints it. */
export const tableOf = (stdout: string): Map<number, ProcessRow> => {
  const table = new Map<number, ProcessRow>()
  for (const line of stdout.split('\n')) {
    const found = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!found) continue
    const pid = Number(found[1])
    table.set(pid, { pid, ppid: Number(found[2]), comm: found[3]!.trim() })
  }
  return table
}

/** The executables above a pid, nearest first, stopping at pid 1. */
export const chainOf = (table: ReadonlyMap<number, ProcessRow>, pid: number): string[] => {
  const chain: string[] = []
  const seen = new Set<number>()
  let at = table.get(pid)?.ppid
  while (at !== undefined && at > 1 && !seen.has(at) && chain.length < 64) {
    seen.add(at)
    const row = table.get(at)
    if (!row) break
    chain.push(row.comm)
    at = row.ppid
  }
  return chain
}

const hostOfComm = (comm: string): Host | undefined => {
  if (/cmux\.app\//i.test(comm) || /(^|\/)cmux$/i.test(comm)) return 'cmux'
  if (/(^|\/)tmux(:|$|\s)/i.test(comm)) return 'tmux'
  if (/Ghostty\.app\//i.test(comm) || /(^|\/)ghostty$/i.test(comm)) return 'Ghostty'
  if (/Terminal\.app\//i.test(comm) || /(^|\/)Terminal$/.test(comm)) return 'Terminal'
  if (/iTerm\.app\//i.test(comm) || /(^|\/)iTerm2$/i.test(comm)) return 'iTerm2'
  return undefined
}

const hostOfTermProgram = (name: string | undefined): Host | undefined => {
  if (name === 'ghostty') return 'Ghostty'
  if (name === 'Apple_Terminal') return 'Terminal'
  if (name === 'iTerm.app') return 'iTerm2'
  if (name === 'tmux') return 'tmux'
  return undefined
}

/**
 * The host named by the exact variables alone, cmux before tmux; undefined
 * when only the parent chain can tell. When this answers, the process table
 * is never read.
 */
export const hostByVarOf = (env: HostEnv): Host | undefined => {
  if (env.CMUX_SURFACE_ID || env.CMUX_WORKSPACE_ID) return 'cmux'
  if (env.TMUX) return 'tmux'
  return undefined
}

/**
 * The host of a process: cmux and tmux by their exact variables first, then
 * the nearest known ancestor, then `TERM_PROGRAM` (cmux embeds Ghostty, so
 * `TERM_PROGRAM` never decides cmux against Ghostty).
 */
export const hostOf = (env: HostEnv, chain: readonly string[]): Host | undefined => {
  const byVar = hostByVarOf(env)
  if (byVar) return byVar
  for (const comm of chain) {
    const host = hostOfComm(comm)
    if (host) return host
  }
  return hostOfTermProgram(env.TERM_PROGRAM)
}

// ---------------------------------------------------------------- places

/** The socket a tmux client talks to: the first field of `$TMUX`. */
export const tmuxSocketOf = (env: HostEnv) => (env.TMUX ?? '').split(',')[0] ?? ''

/** A host with its instance, read from the same environment that named it. */
export const placeOf = (host: Host, env: HostEnv): Place => {
  if (host === 'tmux') return { host, instance: tmuxSocketOf(env) }
  if (host === 'cmux' && env.CMUX_SOCKET_PATH) return { host, instance: env.CMUX_SOCKET_PATH }
  return { host }
}

/**
 * Whether a press from `own` may focus `target`: the same app, and for tmux
 * the same server socket. For cmux the socket paths are compared only when
 * both sides name one (an older cmux sets none: its one default socket).
 */
export const isSamePlace = (own: Place | undefined, target: Place) => {
  if (!own || own.host !== target.host) return false
  if (target.host === 'tmux') return (own.instance ?? '') === (target.instance ?? '')
  if (target.host === 'cmux') return !own.instance || !target.instance || own.instance === target.instance
  return true
}

const HOST_LABEL: Record<Host, string> = { cmux: 'cmux', tmux: 'tmux', Ghostty: 'Ghostty', Terminal: 'Terminal.app', iTerm2: 'iTerm2' }

/** The app a place names, for the row tag and the note: `Ghostty`, or `another tmux server` beside a pane in another one. */
export const placeLabelOf = (place: Place, own: Place | undefined) => {
  if (own?.host === place.host && place.host === 'tmux') return 'another tmux server'
  if (own?.host === place.host && place.host === 'cmux') return 'another cmux'
  return HOST_LABEL[place.host]
}

/**
 * One call for the pane's own parent chain: `$PPID` of the shell is the
 * process that runs the pane (Claude Code), then the process table.
 */
export const OWN_ARGV = ['sh', '-c', 'echo "$PPID"; ps -axo pid=,ppid=,comm=']

/**
 * The pane's own place, found once at startup: cmux by its `CMUX_*` variables
 * (they win over `TERM_PROGRAM=ghostty`, as cmux embeds Ghostty), tmux by
 * `TMUX`, else the nearest known app in its parent chain, else `TERM_PROGRAM`.
 * The process table is read only when no variable decides.
 */
export const ownPlaceOf = async (run: Run, env: HostEnv): Promise<Place | undefined> => {
  const byVar = hostByVarOf(env)
  if (byVar) return placeOf(byVar, env)
  const ran = await run(OWN_ARGV)
  const [first = '', ...rest] = ran.exitCode === 0 ? ran.stdout.split('\n') : []
  const pid = Number(first.trim())
  const host = hostOf(env, pid > 1 ? chainOf(tableOf(rest.join('\n')), pid) : [])
  return host ? placeOf(host, env) : undefined
}

/** The process table, read on first use. */
export type Table = () => Promise<ReadonlyMap<number, ProcessRow>>

export const tableReader = (run: Run): Table => {
  let listed: Promise<Map<number, ProcessRow>> | undefined
  return () => (listed ??= run(TABLE_ARGV).then(ran => (ran.exitCode === 0 ? tableOf(ran.stdout) : new Map<number, ProcessRow>())))
}

/** The host of a probed pid: by variable, else by its parent chain (the table read only then). */
export const hostOfProbe = async (probe: Probe, pid: number, table: Table) => hostByVarOf(probe.env) ?? hostOf(probe.env, chainOf(await table(), pid))

// ---------------------------------------------------------------- the probe cache

/** A registry session probed at refresh: its host, or no probe when it was not a live Claude. */
export type Known = { startedAt: number; probe?: Probe; host?: Host }

const known = new Map<number, Known>()
export const knownOf = (pid: number) => known.get(pid)
/** Forgets every cached probe (tests). */
export const forgetKnown = () => known.clear()

/**
 * Called on each refresh with the registry: drops the pids that left it or
 * restarted (another `startedAt`), then probes every new pid in one `ps eww`
 * call, reading the process table at most once for those no variable names.
 */
export const refreshKnown = async (run: Run, entries: ReadonlyArray<{ pid: number; startedAt: number }>) => {
  const live = new Map<number, number>()
  for (const entry of entries) if (entry.pid > 0) live.set(entry.pid, entry.startedAt)
  for (const [pid, one] of known) if (live.get(pid) !== one.startedAt) known.delete(pid)
  const fresh = [...live.keys()].filter(pid => !known.has(pid))
  if (fresh.length === 0) return
  // Held before the probe returns, so an overlapping refresh does not probe the same pids again.
  for (const pid of fresh) known.set(pid, { startedAt: live.get(pid)! })
  const probes = probesOf(await run(probeArgv(fresh)))
  const table = tableReader(run)
  for (const pid of fresh) {
    const startedAt = live.get(pid)!
    const probe = probes.get(pid)
    known.set(pid, probe?.isClaude ? { startedAt, probe, host: await hostOfProbe(probe, pid, table) } : { startedAt })
  }
}

// ---------------------------------------------------------------- shared helpers

export const firstLineOf = (text: string) => text.split('\n').map(one => one.trim()).find(one => one !== '') ?? ''

// ---------------------------------------------------------------- AppleScript

/** A string as an AppleScript literal. */
export const appleQuoted = (text: string) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

export const osascriptArgv = (script: string) => ['osascript', '-e', script]


/** Why an AppleScript call failed; -1743 is a missing Automation permission. */
export const appleFailureOf = (host: Host, ran: Ran) => {
  const said = firstLineOf(ran.stderr)
  if (/-1743|not authori[sz]ed|not allowed/i.test(said)) {
    return `${host}: Automation permission denied (System Settings > Privacy & Security > Automation)`
  }
  return `${host}: AppleScript failed${said ? ` (${said})` : ''}`
}

/** Selects a tab by tty with an AppleScript the terminal's own file builds; Terminal.app and iTerm2 share this. */
export const focusByTty = async (run: Run, host: 'Terminal' | 'iTerm2', tty: string, scriptOf: (tty: string) => string): Promise<Focused> => {
  if (!tty) return { kind: 'failed', reason: `${host}: session has no tty` }
  const ran = await run(osascriptArgv(scriptOf(tty)))
  if (ran.exitCode !== 0) return { kind: 'failed', reason: appleFailureOf(host, ran) }
  if (ran.stdout.trim() !== 'ok') return { kind: 'failed', reason: `${host}: no tab has this session's tty` }
  return { kind: 'focused', host }
}

/** Forgets one cached probe: a dead or failed press, so the next press probes afresh. */
export const dropKnown = (pid: number) => known.delete(pid)

/** The place a target was found in at refresh, for the row tag; undefined when not probed or not recognised. */
export const knownPlaceOf = (pid: number, startedAt: number | undefined) => {
  const one = known.get(pid)
  if (!one?.probe || !one.host || (startedAt !== undefined && one.startedAt !== startedAt)) return undefined
  return placeOf(one.host, one.probe.env)
}

/** The note under the list for a live session this pane does not switch to; nothing is copied. */
export const elsewhereMessageOf = (name: string, focused: Extract<Focused, { kind: 'elsewhere' | 'unknown' }>, own: Place | undefined) =>
  focused.kind === 'unknown' ? `${name}: terminal unknown` : `${name} runs in ${placeLabelOf(focused.place, own)}`

/** The note under the list after a failed press: which step failed, plus the copied line. */
export const focusMessageOf = (focused: Extract<Focused, { kind: 'dead' | 'failed' }>, line: string, isCopied: boolean) => {
  const why = focused.kind === 'dead' ? 'session not running' : focused.reason
  return isCopied ? `${why}. Copied: ${line}` : `${why}. Run: ${line}`
}

// ---------------------------------------------------------------- adapter contract

/** Everything an adapter needs to bring one session's tab forward. */
export type FocusContext = { run: Run; pid: number; cwd: string; title?: string; probe: Probe; own: Own }

export interface Adapter {
  readonly host: Host
  /** Whether this terminal runs a process with this environment and parent chain (delegates to hostOf; cmux before tmux before chain before TERM_PROGRAM). */
  detect(env: HostEnv, chain: readonly string[]): boolean
  /** Where a probed session runs, instance included (placeOf). */
  locate(probe: Probe): Place
  /** Brings the session's tab forward; the phase-1 steps for this host. */
  focus(ctx: FocusContext): Promise<Focused>
  /** What this terminal draws, given the pane's own environment. */
  capabilities(env: CapsEnv): Caps
}

/** The pane's own environment as the capability rules read it: the host variables and `CAPABILITY_VARS`. */
export type CapsEnv = HostEnv & { COLORTERM?: string; KITTY_WINDOW_ID?: string; CLAUDE_CODE_FORCE_TERMINAL_IMAGES?: string }

/** Pictures are never drawn through a tmux layer. */
export const isUnderTmux = (env: HostEnv) => Boolean(env.TMUX)

/** 24-bit colour is on when `COLORTERM` says so; every host reads it the same way. */
export const isTrueColor = (env: { COLORTERM?: string }) => env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit'
