// Terminal.app adapter: selects the tab whose tty matches. Imports only shared.ts.

import { appleQuoted, focusByTty, hostOf, isTrueColor, placeOf } from './shared'
import type { Adapter, HostEnv, Probe } from './shared'

/** Selects the Terminal.app tab whose tty is `tty`; prints `ok` or `none`. */
export const terminalFocusScript = (tty: string) => [
  'tell application "Terminal"',
  'repeat with w in windows',
  'repeat with t in tabs of w',
  `if tty of t is ${appleQuoted(tty)} then`,
  'set selected of t to true',
  'set index of w to 1',
  'activate',
  'return "ok"',
  'end if',
  'end repeat',
  'end repeat',
  'return "none"',
  'end tell',
].join('\n')

export const terminalAdapter: Adapter = {
  host: 'Terminal',
  detect: (env: HostEnv, chain: readonly string[]) => hostOf(env, chain) === 'Terminal',
  locate: (probe: Probe) => placeOf('Terminal', probe.env),
  focus: ctx => focusByTty(ctx.run, 'Terminal', ctx.probe.tty, terminalFocusScript),
  capabilities: env => ({ trueColor: isTrueColor(env), pictures: false }),
}
