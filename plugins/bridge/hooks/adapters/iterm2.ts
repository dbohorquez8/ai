// iTerm2 adapter: selects the session whose tty matches, with its tab and window.
// Imports only shared.ts.

import { appleQuoted, focusByTty, hostOf, isTrueColor, isUnderTmux, placeOf } from './shared'
import type { Adapter, HostEnv, Probe } from './shared'

/** Selects the iTerm2 session whose tty is `tty`, with its tab and window; prints `ok` or `none`. */
export const itermFocusScript = (tty: string) => [
  'tell application "iTerm2"',
  'repeat with w in windows',
  'repeat with t in tabs of w',
  'repeat with s in sessions of t',
  `if tty of s is ${appleQuoted(tty)} then`,
  'select w',
  'select t',
  'select s',
  'activate',
  'return "ok"',
  'end if',
  'end repeat',
  'end repeat',
  'end repeat',
  'return "none"',
  'end tell',
].join('\n')

export const iterm2Adapter: Adapter = {
  host: 'iTerm2',
  detect: (env: HostEnv, chain: readonly string[]) => hostOf(env, chain) === 'iTerm2',
  locate: (probe: Probe) => placeOf('iTerm2', probe.env),
  focus: ctx => focusByTty(ctx.run, 'iTerm2', ctx.probe.tty, itermFocusScript),
  capabilities: env => ({ trueColor: isTrueColor(env), pictures: env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES === '1' && !isUnderTmux(env) }),
}
