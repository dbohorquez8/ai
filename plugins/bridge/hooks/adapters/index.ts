// The adapter registry: picks the adapter for a host, focuses a session through
// it and reports what the pane's own terminal draws. Per-terminal files never
// import this one.

import { cmuxAdapter } from './cmux'
import { ghosttyAdapter } from './ghostty'
import { iterm2Adapter } from './iterm2'
import { dropKnown, hostByVarOf, isTrueColor, isUnderTmux, hostOfProbe, isSamePlace, knownOf, knownPlaceOf, ownPlaceOf, placeOf, probeArgv, probesOf, tableReader } from './shared'
import type { Adapter, CapsEnv, Focused, FocusTarget, Host, HostEnv, Own, Place, Probe, Run } from './shared'
import { terminalAdapter } from './terminal-app'
import { tmuxAdapter } from './tmux'
import type { Caps } from '../core/types'

/** In detection order: cmux, tmux, Ghostty, Terminal, iTerm2. */
export const ADAPTERS: readonly Adapter[] = [cmuxAdapter, tmuxAdapter, ghosttyAdapter, terminalAdapter, iterm2Adapter]

export const adapterOf = (host: Host): Adapter => ADAPTERS.find(one => one.host === host)!

/** The environment variables besides `HOST_VARS` the pane reads: colour depth, kitty, and Claude Code's forced pictures. */
export const CAPABILITY_VARS = ['COLORTERM', 'KITTY_WINDOW_ID', 'CLAUDE_CODE_FORCE_TERMINAL_IMAGES'] as const

/**
 * trueColor: `COLORTERM` is `truecolor` or `24bit` (any host, or unknown). pictures (AC-101): Ghostty, cmux and
 * kitty always; iTerm2 with `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`; never under tmux or in Terminal. kitty has no
 * adapter (it is not switched to), so it is known by `KITTY_WINDOW_ID` when no adapter claims the pane.
 */
export const capabilitiesOf = (own: Place | undefined, env: CapsEnv): Caps => {
  if (!own) return { trueColor: isTrueColor(env), pictures: Boolean(env.KITTY_WINDOW_ID) && !isUnderTmux(env) }
  return adapterOf(own.host).capabilities(env)
}

/**
 * The pane's own place: by variable with no process; else the place already
 * probed for the pane's own pid; else the parent chain via `ownPlaceOf`.
 */
export const resolveOwnPlace = async (run: Run, env: HostEnv, self?: { pid: number; startedAt: number }): Promise<Place | undefined> => {
  const byVar = hostByVarOf(env)
  if (byVar) return placeOf(byVar, env)
  const probed = self ? knownPlaceOf(self.pid, self.startedAt) : undefined
  if (probed) return probed
  return ownPlaceOf(run, env)
}

/**
 * Focuses a live target whose host is known: only when it runs in the pane's
 * own place; otherwise nothing is called.
 */
const focusPlaced = async (run: Run, target: { pid: number; cwd: string; title?: string }, probe: Probe, host: Host | undefined, own: Own): Promise<Focused> => {
  if (!host) return { kind: 'unknown' }
  const adapter = adapterOf(host)
  const place = adapter.locate(probe)
  if (!isSamePlace(own.place, place)) return { kind: 'elsewhere', place }
  return adapter.focus({ run, pid: target.pid, cwd: target.cwd, title: target.title, probe, own })
}

/**
 * Brings forward the tab that runs `target`, within the pane's own app only.
 * A probe cached at refresh for the same pid and `startedAt` is used as is;
 * otherwise the pid is probed now. A target in another app or instance is
 * `elsewhere` with no further call, and with a cached probe no call at all.
 * A gone pid is `dead` (the caller copies the resume line; it never resumes
 * on its own). A pid that is alive but no longer Claude was reused by another
 * program: also `dead`. A failed or dead press drops the cached probe, so the
 * next press probes afresh.
 */
export const focusSession = async (run: Run, target: FocusTarget & { title?: string }, own: Own = {}): Promise<Focused> => {
  if (!target.pid) return { kind: 'dead' }
  const cached = knownOf(target.pid)
  if (cached?.probe && target.startedAt !== undefined && cached.startedAt === target.startedAt) {
    const focused = await focusPlaced(run, target, cached.probe, cached.host, own)
    if (focused.kind === 'dead' || focused.kind === 'failed') dropKnown(target.pid)
    return focused
  }
  const probe = probesOf(await run(probeArgv([target.pid]))).get(target.pid)
  if (!probe || !probe.isClaude) return { kind: 'dead' }
  return focusPlaced(run, target, probe, await hostOfProbe(probe, target.pid, tableReader(run)), own)
}
