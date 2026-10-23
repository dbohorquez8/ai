import { describe, expect, test, tier } from 'claude-code/testing'

import {
  ADAPTERS, adapterOf, capabilitiesOf, CAPABILITY_VARS, chainOf, focusSession, forgetKnown, ghosttyAnswerOf, ghosttyFocusByDirScript, ghosttyFocusScript,
  ghosttyTitledAnswerOf, hostOf, OWN_ARGV, refreshKnown, resolveOwnPlace, tableOf,
} from '../hooks/focus-policy'
import type { Ran } from '../hooks/focus-policy'

tier('builtin')

const fake = (rules: Array<[(argv: string) => boolean, Partial<Ran>]>) => {
  const calls: string[][] = []
  const run = async (argv: readonly string[]): Promise<Ran> => {
    calls.push([...argv])
    const joined = argv.join(' ')
    const rule = rules.find(([match]) => match(joined))
    return { exitCode: 1, stdout: '', stderr: '', ...(rule?.[1] ?? {}) }
  }
  return { run, calls }
}
const starts = (prefix: string) => (argv: string) => argv.startsWith(prefix)
const has = (text: string) => (argv: string) => argv.includes(text)

const TABLE_GHOSTTY = '    1     0 /sbin/launchd\n  100     1 /Applications/Ghostty.app/Contents/MacOS/ghostty\n  101   100 login\n  102   101 -zsh\n  500   102 claude\n'
const IN_GHOSTTY = { place: { host: 'Ghostty' as const } }

describe('adapter registry', () => {
  test('the adapters are listed in detection order and each is found by its host', () => {
    expect(ADAPTERS.map(one => one.host)).toEqual(['cmux', 'tmux', 'Ghostty', 'Terminal', 'iTerm2'])
    for (const adapter of ADAPTERS) expect(adapterOf(adapter.host)).toBe(adapter)
  })

  test('a cmux environment that also says Ghostty is cmux, and only the cmux adapter detects it', () => {
    const env = { CMUX_WORKSPACE_ID: 'W', TERM_PROGRAM: 'ghostty' }
    const chain = chainOf(tableOf(TABLE_GHOSTTY), 500)
    expect(hostOf(env, chain)).toBe('cmux')
    expect(ADAPTERS.filter(one => one.detect(env, chain)).map(one => one.host)).toEqual(['cmux'])
  })

  test('Ghostty alone is Ghostty, by its parent chain or by TERM_PROGRAM', () => {
    const chain = chainOf(tableOf(TABLE_GHOSTTY), 500)
    expect(ADAPTERS.filter(one => one.detect({}, chain)).map(one => one.host)).toEqual(['Ghostty'])
    expect(ADAPTERS.filter(one => one.detect({ TERM_PROGRAM: 'ghostty' }, [])).map(one => one.host)).toEqual(['Ghostty'])
    expect(ADAPTERS.filter(one => one.detect({ TMUX: '/s,1,0', TERM_PROGRAM: 'ghostty' }, chain)).map(one => one.host)).toEqual(['tmux'])
  })

  test('locate names the host and, for tmux and cmux, the instance', () => {
    expect(adapterOf('Ghostty').locate({ tty: '/dev/ttys001', isClaude: true, env: {} })).toEqual({ host: 'Ghostty' })
    expect(adapterOf('tmux').locate({ tty: '', isClaude: true, env: { TMUX: '/s,9,0' } })).toEqual({ host: 'tmux', instance: '/s' })
    expect(adapterOf('cmux').locate({ tty: '', isClaude: true, env: { CMUX_SOCKET_PATH: '/c.sock' } })).toEqual({ host: 'cmux', instance: '/c.sock' })
  })
})

describe('capabilities', () => {
  test('the capability variables are COLORTERM, KITTY_WINDOW_ID and CLAUDE_CODE_FORCE_TERMINAL_IMAGES', () => {
    expect([...CAPABILITY_VARS]).toEqual(['COLORTERM', 'KITTY_WINDOW_ID', 'CLAUDE_CODE_FORCE_TERMINAL_IMAGES'])
  })

  test('true colour needs COLORTERM truecolor or 24bit, on every host and on an unknown one', () => {
    for (const own of [undefined, { host: 'cmux' as const }, { host: 'tmux' as const }, { host: 'Ghostty' as const }, { host: 'Terminal' as const }, { host: 'iTerm2' as const }]) {
      expect(capabilitiesOf(own, { COLORTERM: 'truecolor' }).trueColor).toBe(true)
      expect(capabilitiesOf(own, { COLORTERM: '24bit' }).trueColor).toBe(true)
      expect(capabilitiesOf(own, {}).trueColor).toBe(false)
      expect(capabilitiesOf(own, { COLORTERM: 'yes' }).trueColor).toBe(false)
    }
  })

  // `images` became `pictures`: Ghostty, cmux and kitty always; iTerm2 when forced; never tmux or Terminal.
  test('pictures on Ghostty, cmux and kitty; iTerm2 only when forced; never under tmux or in Terminal', () => {
    expect(capabilitiesOf({ host: 'Ghostty' }, { COLORTERM: 'truecolor' })).toEqual({ trueColor: true, pictures: true })
    expect(capabilitiesOf({ host: 'Ghostty' }, { COLORTERM: 'truecolor', TMUX: '/s,1,0' })).toEqual({ trueColor: true, pictures: false })
    expect(capabilitiesOf({ host: 'Ghostty' }, {})).toEqual({ trueColor: false, pictures: true })
    expect(capabilitiesOf({ host: 'cmux' }, { COLORTERM: 'truecolor' }).pictures).toBe(true)
    expect(capabilitiesOf({ host: 'cmux' }, { TMUX: '/s,1,0' }).pictures).toBe(false)
    expect(capabilitiesOf(undefined, { KITTY_WINDOW_ID: '1' }).pictures).toBe(true)
    expect(capabilitiesOf(undefined, { KITTY_WINDOW_ID: '1', TMUX: '/s,1,0' }).pictures).toBe(false)
    expect(capabilitiesOf(undefined, {}).pictures).toBe(false)
    expect(capabilitiesOf({ host: 'iTerm2' }, {}).pictures).toBe(false)
    expect(capabilitiesOf({ host: 'iTerm2' }, { CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '0' }).pictures).toBe(false)
    expect(capabilitiesOf({ host: 'iTerm2' }, { CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' }).pictures).toBe(true)
    for (const own of [{ host: 'tmux' as const }, { host: 'Terminal' as const }]) {
      expect(capabilitiesOf(own, { COLORTERM: 'truecolor', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1', KITTY_WINDOW_ID: '1' }).pictures).toBe(false)
    }
  })
})

describe('resolveOwnPlace', () => {
  test('a deciding variable runs no process', async () => {
    const { run, calls } = fake([])
    expect(await resolveOwnPlace(run, { CMUX_WORKSPACE_ID: 'W0', CMUX_SOCKET_PATH: '/a.sock', TERM_PROGRAM: 'ghostty' })).toEqual({ host: 'cmux', instance: '/a.sock' })
    expect(await resolveOwnPlace(run, { TMUX: '/s,1,0' })).toEqual({ host: 'tmux', instance: '/s' })
    expect(calls).toEqual([])
  })

  test('a probed self pid runs no process', async () => {
    forgetKnown()
    await refreshKnown(fake([
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys001 claude TERM_PROGRAM=ghostty\n' }],
      [starts('ps -axo'), { exitCode: 0, stdout: TABLE_GHOSTTY }],
    ]).run, [{ pid: 500, startedAt: 7 }])
    const { run, calls } = fake([])
    expect(await resolveOwnPlace(run, { TERM_PROGRAM: 'ghostty' }, { pid: 500, startedAt: 7 })).toEqual({ host: 'Ghostty' })
    expect(calls).toEqual([])
    forgetKnown()
  })

  test('otherwise it runs exactly OWN_ARGV once', async () => {
    forgetKnown()
    const { run, calls } = fake([[(argv) => argv === OWN_ARGV.join(' '), { exitCode: 0, stdout: `500\n${TABLE_GHOSTTY}` }]])
    expect(await resolveOwnPlace(run, { TERM_PROGRAM: 'ghostty' }, { pid: 999, startedAt: 1 })).toEqual({ host: 'Ghostty' })
    expect(calls).toEqual([[...OWN_ARGV]])
    const none = fake([])
    expect(await resolveOwnPlace(none.run, {})).toBeUndefined()
    expect(none.calls).toEqual([[...OWN_ARGV]])
  })
})

describe('Ghostty by title and folder', () => {
  test('the script quotes the folder and the title and narrows by name', () => {
    const script = ghosttyFocusScript('/Users/x/Work "a"/', 'Fix "b"')
    expect(script).toContain('if d is "/Users/x/Work \\"a\\"" or d is ("/Users/x/Work \\"a\\"" & "/") then')
    expect(script).toContain('contains "Fix \\"b\\""')
    expect(script).toContain('focus terminal id (item 1 of found)')
    expect(script).toContain('focus terminal id (item 1 of matched)')
    expect(script).not.toMatch(/\btab\b/)
    expect(script.match(/tell application/g)).toHaveLength(1)
  })

  test('without a title the script has no name branch', () => {
    for (const title of [undefined, '', '  ']) expect(ghosttyFocusScript('/w', title)).not.toContain('contains')
  })

  test('the titled answers read ok, 0, a shared folder and nothing', () => {
    expect(ghosttyTitledAnswerOf('ok\n')).toEqual({ isFocused: true })
    expect(ghosttyTitledAnswerOf('0\n')).toEqual({ reason: 'Ghostty: no tab in this folder' })
    expect(ghosttyTitledAnswerOf('2\n')).toEqual({ reason: 'Ghostty: the folder is shared by 2 tabs' })
    expect(ghosttyTitledAnswerOf('')).toEqual({ reason: 'Ghostty: unexpected answer (none)' })
  })

  test('the phase-1 folder-only builder and answer are unchanged', () => {
    expect(ghosttyFocusByDirScript('/w')).not.toContain('contains')
    expect(ghosttyAnswerOf('2\n')).toEqual({ reason: 'Ghostty: 2 tabs in this folder' })
  })

  const world = (answer: string) => fake([
    [starts('ps eww'), { exitCode: 0, stdout: '500 ttys001 claude TERM_PROGRAM=ghostty\n' }],
    [starts('ps -axo'), { exitCode: 0, stdout: TABLE_GHOSTTY }],
    [has('repeat with t in terminals'), { exitCode: 0, stdout: answer }],
  ])

  test('a press with a title runs exactly one osascript with the titled script', async () => {
    forgetKnown()
    await refreshKnown(world('ok\n').run, [{ pid: 500, startedAt: 1 }])
    const { run, calls } = fake([[has('repeat with t in terminals'), { exitCode: 0, stdout: 'ok\n' }]])
    expect(await focusSession(run, { pid: 500, cwd: '/w', startedAt: 1, title: 'Docs title' }, IN_GHOSTTY)).toEqual({ kind: 'focused', host: 'Ghostty' })
    expect(calls).toEqual([['osascript', '-e', ghosttyFocusScript('/w', 'Docs title')]])
    forgetKnown()
  })

  test('two tabs the title cannot tell apart name the shared folder', async () => {
    forgetKnown()
    const { run } = world('2\n')
    expect(await focusSession(run, { pid: 500, cwd: '/w', title: 'Docs title' }, IN_GHOSTTY)).toEqual({ kind: 'failed', reason: 'Ghostty: the folder is shared by 2 tabs' })
    forgetKnown()
  })

  test('no title keeps the phase-1 script', async () => {
    forgetKnown()
    const { run, calls } = world('ok\n')
    await focusSession(run, { pid: 500, cwd: '/w' }, IN_GHOSTTY)
    expect(calls.at(-1)).toEqual(['osascript', '-e', ghosttyFocusByDirScript('/w')])
    forgetKnown()
  })
})
