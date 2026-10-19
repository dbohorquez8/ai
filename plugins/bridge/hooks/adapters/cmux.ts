// cmux adapter: finds the workspace and surface by the session's tty (or its
// CMUX_* variables) and switches to it with one process. Imports only shared.ts.
//
// Module state: the remembered CLI path (`knownCmuxCli`) lives here, once.

import { CMUX_APP_CLI, isTrueColor, isUnderTmux, placeOf } from './shared'
import type { Adapter, Focused, HostEnv, Own, Probe, Ran, Run } from './shared'
import { firstLineOf, hostOf, ttyPathOf } from './shared'

// ---------------------------------------------------------------- cmux

/** The cmux CLI that last started, kept for the module's life so later presses skip probing. */
let knownCmuxCli: string | undefined
export const knownCmuxCliOf = () => knownCmuxCli
/** Forgets the remembered CLI (tests). */
export const forgetCmuxCli = () => {
  knownCmuxCli = undefined
}

/** Where the cmux CLI may be, in order: the one that last started, the target's, this process's, the app's, then PATH. */
export const cmuxCandidatesOf = (targetEnv: HostEnv, ownCli: string | undefined) => {
  const all = [knownCmuxCli, targetEnv.CMUX_BUNDLED_CLI_PATH, ownCli, CMUX_APP_CLI, 'cmux'].filter((one): one is string => !!one)
  return [...new Set(all)]
}

export const cmuxTreeArgs = ['tree', '--all', '--json']

/** Exit codes of `CMUX_SWITCH_SCRIPT` that name its step. */
export const CMUX_EXIT = { dead: 75, select: 81, focus: 82 } as const

/**
 * One process for the whole cmux switch, run from a pane inside the same
 * cmux: checks the pid lives, that the CLI starts (127 otherwise), selects the
 * workspace and focuses the panel. Every value is a positional argument: $0
 * the CLI, $1 the workspace, $2 the surface, $3 the pid. `focus-panel
 * --workspace` only names the context, so the workspace switch stays a
 * command of its own; `cmux help` names no single command for both.
 */
export const CMUX_SWITCH_SCRIPT = [
  `kill -0 "$3" 2>/dev/null || exit ${CMUX_EXIT.dead}`,
  'command -v "$0" >/dev/null 2>&1 || exit 127',
  `"$0" select-workspace --workspace "$1" || exit ${CMUX_EXIT.select}`,
  `"$0" focus-panel --panel "$2" --workspace "$1" || exit ${CMUX_EXIT.focus}`,
].join('; ')

export const cmuxSwitchArgv = (cli: string, place: { workspace: string; surface: string }, pid: number) =>
  ['sh', '-c', CMUX_SWITCH_SCRIPT, cli, place.workspace, place.surface, String(pid)]

type Json = Record<string, unknown>
const listOf = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((one): one is Json => !!one && typeof one === 'object') : [])
const idOf = (one: Json) => (typeof one.id === 'string' && one.id) || (typeof one.ref === 'string' && one.ref) || ''

/** The workspace and surface whose tty is `tty`, from `cmux tree --all --json`. */
export const cmuxSurfaceOf = (stdout: string, tty: string): { workspace: string; surface: string } | undefined => {
  let tree: Json
  try {
    tree = JSON.parse(stdout) as Json
  } catch {
    return undefined
  }
  if (!tty || !tree || typeof tree !== 'object') return undefined
  for (const window of listOf(tree.windows)) {
    for (const workspace of listOf(window.workspaces)) {
      for (const pane of listOf(workspace.panes)) {
        for (const surface of listOf(pane.surfaces)) {
          if (typeof surface.tty === 'string' && ttyPathOf(surface.tty) === tty && idOf(surface) && idOf(workspace)) {
            return { workspace: idOf(workspace), surface: idOf(surface) }
          }
        }
      }
    }
  }
  return undefined
}


/** Why a cmux call failed, in words: the step and what cmux said. */
export const cmuxFailureOf = (step: string, ran: Ran) => {
  const said = firstLineOf(ran.stderr) || firstLineOf(ran.stdout)
  return `cmux: ${step} failed${said ? ` (${said})` : ''}`
}

const switchCmux = async (run: Run, cli: string, place: { workspace: string; surface: string }, pid: number): Promise<Focused | 'missing'> => {
  const ran = await run(cmuxSwitchArgv(cli, place, pid))
  if (ran.exitCode === 127) return 'missing'
  if (ran.exitCode === CMUX_EXIT.dead) return { kind: 'dead' }
  knownCmuxCli = cli
  if (ran.exitCode === 0) return { kind: 'focused', host: 'cmux' }
  if (ran.exitCode === CMUX_EXIT.select) return { kind: 'failed', reason: cmuxFailureOf('select-workspace', ran) }
  return { kind: 'failed', reason: cmuxFailureOf('focus-panel', ran) }
}

export const focusCmux = async (run: Run, pid: number, probe: Probe, own: Own): Promise<Focused> => {
  const fromEnv = probe.env.CMUX_WORKSPACE_ID && probe.env.CMUX_SURFACE_ID
    ? { workspace: probe.env.CMUX_WORKSPACE_ID, surface: probe.env.CMUX_SURFACE_ID }
    : undefined
  for (const cli of cmuxCandidatesOf(probe.env, own.cli)) {
    let place = fromEnv
    // With no ids in the environment, ask the CLI's tree for the tty.
    if (!place) {
      const tree = await run([cli, ...cmuxTreeArgs])
      if (tree.exitCode === 127) continue
      if (tree.exitCode !== 0) return { kind: 'failed', reason: cmuxFailureOf('tree', tree) }
      place = cmuxSurfaceOf(tree.stdout, probe.tty)
      if (!place) return { kind: 'failed', reason: 'cmux: no surface has this session\'s tty' }
    }
    const switched = await switchCmux(run, cli, place, pid)
    if (switched !== 'missing') return switched
  }
  return { kind: 'failed', reason: 'cmux: CLI not found' }
}

export const cmuxAdapter: Adapter = {
  host: 'cmux',
  detect: (env: HostEnv, chain: readonly string[]) => hostOf(env, chain) === 'cmux',
  locate: (probe: Probe) => placeOf('cmux', probe.env),
  focus: ctx => focusCmux(ctx.run, ctx.pid, ctx.probe, ctx.own),
  capabilities: env => ({ trueColor: isTrueColor(env), pictures: !isUnderTmux(env) }),
}
