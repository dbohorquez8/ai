// Ghostty adapter: one osascript finds the terminal by working directory and,
// when several share the folder, by title. Imports only shared.ts.

import { appleFailureOf, appleQuoted, hostOf, isTrueColor, isUnderTmux, osascriptArgv, placeOf } from './shared'
import type { Adapter, Focused, HostEnv, Probe, Run } from './shared'

const normalDir = (dir: string) => (dir.length > 1 ? dir.replace(/\/+$/, '') : dir)

/**
 * One osascript for Ghostty: finds the terminals whose working directory is
 * `cwd` (with or without a trailing slash) and focuses the one match; prints
 * `ok`, else the number of matches. Never names Ghostty's `tab` class.
 */
export const ghosttyFocusByDirScript = (cwd: string) => {
  const dir = appleQuoted(normalDir(cwd))
  return [
    'tell application "Ghostty"',
    'set found to {}',
    'repeat with t in terminals',
    'set d to (working directory of t) as text',
    `if d is ${dir} or d is (${dir} & "/") then set end of found to (id of t)`,
    'end repeat',
    'if (count of found) is 1 then',
    'focus terminal id (item 1 of found)',
    'activate',
    'return "ok"',
    'end if',
    'return (count of found) as text',
    'end tell',
  ].join('\n')
}

/** What the Ghostty script printed: focused, or why not. */
export const ghosttyAnswerOf = (stdout: string): { isFocused: true } | { reason: string } => {
  const said = stdout.trim()
  if (said === 'ok') return { isFocused: true }
  const count = Number(said)
  if (said !== '' && count === 0) return { reason: 'Ghostty: no tab in this folder' }
  if (count > 1) return { reason: `Ghostty: ${count} tabs in this folder` }
  return { reason: `Ghostty: unexpected answer (${said || 'none'})` }
}

/**
 * One osascript for Ghostty: finds the terminals whose working directory is
 * `cwd` (with or without a trailing slash). One match is focused and prints
 * `ok`. With more than one and a non-empty `title`, the matches whose name
 * contains the title are narrowed; exactly one is focused and prints `ok`.
 * Otherwise it prints the folder's match count. Never names Ghostty's `tab` class.
 */
export const ghosttyFocusScript = (cwd: string, title: string | undefined) => {
  const dir = appleQuoted(normalDir(cwd))
  const wanted = title?.trim() ?? ''
  return [
    'tell application "Ghostty"',
    'set found to {}',
    'set names to {}',
    'repeat with t in terminals',
    'set d to (working directory of t) as text',
    `if d is ${dir} or d is (${dir} & "/") then`,
    'set end of found to (id of t)',
    'set end of names to ((name of t) as text)',
    'end if',
    'end repeat',
    'if (count of found) is 1 then',
    'focus terminal id (item 1 of found)',
    'activate',
    'return "ok"',
    'end if',
    ...(wanted === '' ? [] : [
      'if (count of found) > 1 then',
      'set matched to {}',
      'repeat with i from 1 to (count of found)',
      `if (item i of names) contains ${appleQuoted(wanted)} then set end of matched to (item i of found)`,
      'end repeat',
      'if (count of matched) is 1 then',
      'focus terminal id (item 1 of matched)',
      'activate',
      'return "ok"',
      'end if',
      'end if',
    ]),
    'return (count of found) as text',
    'end tell',
  ].join('\n')
}

/** What the title-aware Ghostty script printed: focused, or why not. */
export const ghosttyTitledAnswerOf = (stdout: string): { isFocused: true } | { reason: string } => {
  const said = stdout.trim()
  if (said === 'ok') return { isFocused: true }
  const count = Number(said)
  if (said !== '' && count === 0) return { reason: 'Ghostty: no tab in this folder' }
  if (count > 1) return { reason: `Ghostty: the folder is shared by ${count} tabs` }
  return { reason: `Ghostty: unexpected answer (${said || 'none'})` }
}

/** Focuses by folder and title when a title is known, else by folder alone (phase-1 script and answer). */
export const focusGhostty = async (run: Run, cwd: string, title?: string): Promise<Focused> => {
  if (!cwd) return { kind: 'failed', reason: 'Ghostty: session folder unknown' }
  const isTitled = (title?.trim() ?? '') !== ''
  const ran = await run(osascriptArgv(isTitled ? ghosttyFocusScript(cwd, title) : ghosttyFocusByDirScript(cwd)))
  if (ran.exitCode !== 0) return { kind: 'failed', reason: appleFailureOf('Ghostty', ran) }
  const answer = isTitled ? ghosttyTitledAnswerOf(ran.stdout) : ghosttyAnswerOf(ran.stdout)
  return 'reason' in answer ? { kind: 'failed', reason: answer.reason } : { kind: 'focused', host: 'Ghostty' }
}

export const ghosttyAdapter: Adapter = {
  host: 'Ghostty',
  detect: (env: HostEnv, chain: readonly string[]) => hostOf(env, chain) === 'Ghostty',
  locate: (probe: Probe) => placeOf('Ghostty', probe.env),
  focus: ctx => focusGhostty(ctx.run, ctx.cwd, ctx.title),
  // Ghostty draws pictures itself, never through a tmux layer.
  capabilities: env => ({ trueColor: isTrueColor(env), pictures: !isUnderTmux(env) }),
}
