// tmux adapter: shows the session's pane on a client of the same tmux server.
// Imports only shared.ts.

import { firstLineOf, hostOf, isTrueColor, placeOf, tmuxSocketOf, ttyPathOf } from './shared'
import type { Adapter, Focused, HostEnv, Probe, Run } from './shared'

export const tmuxArgv = (socket: string, args: readonly string[]) => (socket ? ['tmux', '-S', socket, ...args] : ['tmux', ...args])
export const TMUX_PANES_FORMAT = 'P\t#{pane_tty}\t#{pane_id}\t#{session_name}\t#{window_id}'
export const TMUX_CLIENTS_FORMAT = 'C\t#{client_tty}\t#{client_pid}\t#{client_session}\t#{client_activity}'
/** Panes and clients in one tmux call: tmux runs commands split by a lone `;` in order. */
export const tmuxQueryArgs = ['list-panes', '-a', '-F', TMUX_PANES_FORMAT, ';', 'list-clients', '-F', TMUX_CLIENTS_FORMAT]

export type TmuxPane = { tty: string; pane: string; session: string; window: string }
export type TmuxClient = { tty: string; pid: number; session: string; activity: number }

/** The lines tagged `tag`, split by tab, the tag dropped. */
const taggedOf = (stdout: string, tag: string) =>
  stdout.split('\n').map(line => line.split('\t')).filter(one => one[0] === tag).map(one => one.slice(1))

/** The pane whose tty is `tty`, else the one named by `$TMUX_PANE`. */
export const tmuxPaneOf = (stdout: string, tty: string, paneId?: string): TmuxPane | undefined => {
  const panes = taggedOf(stdout, 'P')
    .filter(one => one.length >= 4)
    .map(([paneTty, pane, session, window]) => ({ tty: ttyPathOf(paneTty!), pane: pane!, session: session!, window: window! }))
  return panes.find(one => tty && one.tty === tty) ?? panes.find(one => paneId && one.pane === paneId)
}

/** The client that shows `session` (most recently active), else the most recently active one. */
export const tmuxClientOf = (stdout: string, session: string): TmuxClient | undefined => {
  const clients = taggedOf(stdout, 'C')
    .filter(one => one.length >= 3)
    .map(([tty, pid, name, activity]) => ({ tty: ttyPathOf(tty!), pid: Number(pid), session: name!, activity: Number(activity) || 0 }))
    .sort((a, b) => b.activity - a.activity)
  return clients.find(one => one.session === session) ?? clients[0]
}

/** The one tmux call that shows a pane on a client: its commands split by a lone `;`. */
export const tmuxSelectArgv = (socket: string, pane: TmuxPane, client: TmuxClient) => tmuxArgv(socket, [
  ...(client.session === pane.session ? [] : ['switch-client', '-c', client.tty, '-t', pane.session, ';']),
  'select-window', '-t', pane.window, ';',
  'select-pane', '-t', pane.pane,
])

/** Shows the pane on a client of the same tmux server; the pane's own terminal app is already in front. */
export const focusTmux = async (run: Run, probe: Probe): Promise<Focused> => {
  const socket = tmuxSocketOf(probe.env)
  const listed = await run(tmuxArgv(socket, tmuxQueryArgs))
  const pane = tmuxPaneOf(listed.stdout, probe.tty, probe.env.TMUX_PANE)
  if (!pane) {
    if (listed.exitCode !== 0) return { kind: 'failed', reason: `tmux: list-panes failed${firstLineOf(listed.stderr) ? ` (${firstLineOf(listed.stderr)})` : ''}` }
    return { kind: 'failed', reason: 'tmux: no pane has this session\'s tty' }
  }
  const client = tmuxClientOf(listed.stdout, pane.session)
  if (!client) return { kind: 'failed', reason: 'tmux: no client attached' }
  const selected = await run(tmuxSelectArgv(socket, pane, client))
  if (selected.exitCode !== 0) return { kind: 'failed', reason: `tmux: select failed${firstLineOf(selected.stderr) ? ` (${firstLineOf(selected.stderr)})` : ''}` }
  return { kind: 'focused', host: 'tmux' }
}

export const tmuxAdapter: Adapter = {
  host: 'tmux',
  detect: (env: HostEnv, chain: readonly string[]) => hostOf(env, chain) === 'tmux',
  locate: (probe: Probe) => placeOf('tmux', probe.env),
  focus: ctx => focusTmux(ctx.run, ctx.probe),
  capabilities: env => ({ trueColor: isTrueColor(env), pictures: false }),
}
