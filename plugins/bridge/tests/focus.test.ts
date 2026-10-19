import { describe, expect, test, tier } from 'claude-code/testing'

import {
  appleFailureOf, chainOf, CMUX_APP_CLI, CMUX_SWITCH_SCRIPT, cmuxCandidatesOf, cmuxSwitchArgv, elsewhereMessageOf, forgetCmuxCli, forgetKnown, hostByVarOf, isSamePlace, knownCmuxCliOf, knownOf,
  knownPlaceOf, cmuxFailureOf, cmuxSurfaceOf, focusMessageOf, focusSession, ghosttyAnswerOf, ghosttyFocusByDirScript, hostOf, itermFocusScript, OWN_ARGV, ownPlaceOf, placeLabelOf, placeOf,
  probeArgv, probesOf, refreshKnown, tableOf, terminalFocusScript, tmuxClientOf, tmuxPaneOf, tmuxSelectArgv, tmuxSocketOf, ttyPathOf,
} from '../hooks/focus-policy'
import type { Own, Ran } from '../hooks/focus-policy'

tier('builtin')

/** A fake `run`: the first rule whose test matches the joined argv answers; every call is kept. */
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
const has = (text: string) => (argv: string) => argv.includes(text)
const starts = (text: string) => (argv: string) => argv.startsWith(text)
/** The cmux switch script, run through `sh -c`. */
const isSwitch = (argv: string) => argv.startsWith('sh -c ') && argv.includes('select-workspace')

const TABLE_GHOSTTY = '    1     0 /sbin/launchd\n  100     1 /Applications/Ghostty.app/Contents/MacOS/ghostty\n  101   100 login\n  102   101 -zsh\n  500   102 claude\n'
const TABLE_TMUX = '1 0 /sbin/launchd\n100 1 /Applications/Ghostty.app/Contents/MacOS/ghostty\n101 100 login\n102 101 -zsh\n103 102 tmux\n200 1 tmux\n201 200 -zsh\n500 201 claude\n'
const TABLE_CMUX = '1 0 /sbin/launchd\n100 1 /Applications/cmux.app/Contents/MacOS/cmux\n102 100 -zsh\n500 102 claude\n'
const TABLE_TERMINAL = '1 0 /sbin/launchd\n100 1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal\n101 100 login\n102 101 -zsh\n500 102 claude\n'
const TABLE_ITERM = '1 0 /sbin/launchd\n100 1 /Applications/iTerm.app/Contents/MacOS/iTerm2\n102 100 -zsh\n500 102 claude\n'

/** Presses from a pane in each app. */
const IN_CMUX: Own = { cli: '/c/cmux', place: { host: 'cmux' } }
const IN_GHOSTTY: Own = { place: { host: 'Ghostty' } }
const IN_TERMINAL: Own = { place: { host: 'Terminal' } }
const IN_ITERM: Own = { place: { host: 'iTerm2' } }
const inTmux = (socket: string): Own => ({ place: { host: 'tmux', instance: socket } })

describe('probe and host detection', () => {
  test('ps eww keeps only the host variables, never the rest of the environment; several pids in one call', () => {
    expect(probeArgv([500, 501])).toEqual(['ps', 'eww', '-o', 'pid=,tty=,command=', '-p', '500,501'])
    const probes = probesOf({ exitCode: 1, stderr: '', stdout: '  500 ttys003 claude --resume x API_TOKEN=secret TERM_PROGRAM=ghostty TMUX_PANE=%3 TMUX=/private/tmp/tmux-501/default,99,0\n  501 ?? /usr/bin/python3 x.py\n' })
    expect(probes.get(500)).toEqual({ tty: '/dev/ttys003', isClaude: true, env: { TERM_PROGRAM: 'ghostty', TMUX_PANE: '%3', TMUX: '/private/tmp/tmux-501/default,99,0' } })
    expect(probes.get(501)).toEqual({ tty: '', isClaude: false, env: {} })
    expect(probes.has(502)).toBe(false)
    expect(probesOf({ exitCode: 127, stdout: '', stderr: '' }).size).toBe(0)
  })

  test('a value with a space runs to the next variable', () => {
    const probes = probesOf({ exitCode: 0, stderr: '', stdout: '500 ttys003 claude CMUX_SOCKET_PATH=/Users/x/Library/Application Support/cmux/cmux.sock HOME=/Users/x CMUX_WORKSPACE_ID=W1\n' })
    expect(probes.get(500)!.env).toEqual({ CMUX_SOCKET_PATH: '/Users/x/Library/Application Support/cmux/cmux.sock', CMUX_WORKSPACE_ID: 'W1' })
  })

  test('ttys normalise to /dev paths; no tty is empty', () => {
    expect(['ttys003', '/dev/ttys004', '??', '-', ''].map(ttyPathOf)).toEqual(['/dev/ttys003', '/dev/ttys004', '', '', ''])
  })

  test('the parent chain walks up to pid 1, nearest first', () => {
    expect(chainOf(tableOf(TABLE_GHOSTTY), 500)).toEqual(['-zsh', 'login', '/Applications/Ghostty.app/Contents/MacOS/ghostty'])
    expect(chainOf(tableOf('5 6 a\n6 5 b\n'), 5)).toEqual(['b', 'a'])
  })

  test('hosts: cmux and tmux by variable first, then the chain, then TERM_PROGRAM', () => {
    const ghostty = chainOf(tableOf(TABLE_GHOSTTY), 500)
    expect(hostOf({ CMUX_SURFACE_ID: 's', TERM_PROGRAM: 'ghostty' }, ghostty)).toBe('cmux')
    expect(hostOf({ TMUX: '/s,1,0' }, ghostty)).toBe('tmux')
    expect(hostOf({}, ghostty)).toBe('Ghostty')
    expect(hostOf({}, chainOf(tableOf(TABLE_CMUX), 500))).toBe('cmux')
    expect(hostOf({}, chainOf(tableOf(TABLE_TMUX), 500))).toBe('tmux')
    expect(hostOf({}, chainOf(tableOf(TABLE_TERMINAL), 500))).toBe('Terminal')
    expect(hostOf({}, chainOf(tableOf(TABLE_ITERM), 500))).toBe('iTerm2')
    expect(hostOf({ TERM_PROGRAM: 'iTerm.app' }, [])).toBe('iTerm2')
    expect(hostOf({ TERM_PROGRAM: 'Apple_Terminal' }, [])).toBe('Terminal')
    expect(hostOf({ TERM_PROGRAM: 'vscode' }, ['/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper'])).toBeUndefined()
    expect(hostOf({ TERM_PROGRAM: 'WezTerm' }, [])).toBeUndefined()
  })

  test('CMUX_* wins over TERM_PROGRAM=ghostty and over a Ghostty chain; the variables alone name cmux and tmux', () => {
    const ghostty = chainOf(tableOf(TABLE_GHOSTTY), 500)
    expect(hostOf({ CMUX_WORKSPACE_ID: 'W', TERM_PROGRAM: 'ghostty' }, ghostty)).toBe('cmux')
    expect(hostOf({ CMUX_SURFACE_ID: 'S', TMUX: '/s,1,0', TERM_PROGRAM: 'ghostty' }, ghostty)).toBe('cmux')
    expect(hostByVarOf({ CMUX_WORKSPACE_ID: 'W', TERM_PROGRAM: 'ghostty' })).toBe('cmux')
    expect(hostByVarOf({ TMUX: '/s,1,0', TERM_PROGRAM: 'ghostty' })).toBe('tmux')
    expect(hostByVarOf({ TERM_PROGRAM: 'ghostty' })).toBeUndefined()
  })
})

describe('the pane\'s own place', () => {
  test('CMUX_* wins over TERM_PROGRAM=ghostty with no process call; the cmux socket is the instance', async () => {
    const { run, calls } = fake([])
    expect(await ownPlaceOf(run, { CMUX_WORKSPACE_ID: 'W0', CMUX_SOCKET_PATH: '/a b/cmux.sock', TERM_PROGRAM: 'ghostty' })).toEqual({ host: 'cmux', instance: '/a b/cmux.sock' })
    expect(await ownPlaceOf(run, { CMUX_SURFACE_ID: 'S0', TMUX: '/s,1,0', TERM_PROGRAM: 'ghostty' })).toEqual({ host: 'cmux' })
    expect(calls).toEqual([])
  })

  test('TMUX names tmux with its server socket, no process call', async () => {
    const { run, calls } = fake([])
    expect(await ownPlaceOf(run, { TMUX: '/private/tmp/tmux-501/default,99,0', TERM_PROGRAM: 'tmux' })).toEqual({ host: 'tmux', instance: '/private/tmp/tmux-501/default' })
    expect(calls).toEqual([])
  })

  test('no deciding variable: one call reads $PPID and the table, and the chain names the app', async () => {
    const { run, calls } = fake([[(argv) => argv === OWN_ARGV.join(' '), { exitCode: 0, stdout: `500\n${TABLE_GHOSTTY}` }]])
    expect(await ownPlaceOf(run, { TERM_PROGRAM: 'ghostty' })).toEqual({ host: 'Ghostty' })
    expect(calls).toEqual([OWN_ARGV])
    const terminal = fake([[() => true, { exitCode: 0, stdout: `500\n${TABLE_TERMINAL}` }]])
    expect(await ownPlaceOf(terminal.run, {})).toEqual({ host: 'Terminal' })
    expect(await ownPlaceOf(fake([]).run, { TERM_PROGRAM: 'iTerm.app' })).toEqual({ host: 'iTerm2' })
    expect(await ownPlaceOf(fake([]).run, { TERM_PROGRAM: 'vscode' })).toBeUndefined()
  })

  test('same place: same app; tmux only on the same socket; cmux on the same socket when both name one', () => {
    expect(isSamePlace({ host: 'Ghostty' }, { host: 'Ghostty' })).toBe(true)
    expect(isSamePlace({ host: 'cmux' }, { host: 'Ghostty' })).toBe(false)
    expect(isSamePlace(undefined, { host: 'Ghostty' })).toBe(false)
    expect(isSamePlace({ host: 'tmux', instance: '/a' }, { host: 'tmux', instance: '/a' })).toBe(true)
    expect(isSamePlace({ host: 'tmux', instance: '/a' }, { host: 'tmux', instance: '/b' })).toBe(false)
    expect(isSamePlace({ host: 'cmux', instance: '/x' }, { host: 'cmux', instance: '/y' })).toBe(false)
    expect(isSamePlace({ host: 'cmux', instance: '/x' }, { host: 'cmux' })).toBe(true)
    expect(placeOf('tmux', { TMUX: '/b,1,0' })).toEqual({ host: 'tmux', instance: '/b' })
    expect(placeLabelOf({ host: 'tmux', instance: '/b' }, { host: 'tmux', instance: '/a' })).toBe('another tmux server')
    expect(placeLabelOf({ host: 'Terminal' }, { host: 'cmux' })).toBe('Terminal.app')
  })
})

describe('same app only', () => {
  test('a cached live target in another app: zero calls, elsewhere, the probe kept', async () => {
    forgetKnown()
    await refreshKnown(fake([
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys001 claude TERM_PROGRAM=ghostty\n' }],
      [starts('ps -axo'), { exitCode: 0, stdout: TABLE_GHOSTTY }],
    ]).run, [{ pid: 500, startedAt: 1 }])
    const { run, calls } = fake([])
    expect(await focusSession(run, { pid: 500, cwd: '/w', startedAt: 1 }, IN_CMUX)).toEqual({ kind: 'elsewhere', place: { host: 'Ghostty' } })
    expect(calls).toEqual([])
    expect(knownPlaceOf(500, 1)).toEqual({ host: 'Ghostty' })
    forgetKnown()
  })

  test('a cmux target from a Ghostty pane (TERM_PROGRAM=ghostty in both): zero calls', async () => {
    forgetKnown()
    await refreshKnown(fake([[starts('ps eww'), { exitCode: 0, stdout: '500 ttys005 claude CMUX_WORKSPACE_ID=W1 CMUX_SURFACE_ID=S1 TERM_PROGRAM=ghostty\n' }]]).run, [{ pid: 500, startedAt: 1 }])
    const { run, calls } = fake([])
    expect(await focusSession(run, { pid: 500, cwd: '/w', startedAt: 1 }, IN_GHOSTTY)).toEqual({ kind: 'elsewhere', place: { host: 'cmux' } })
    expect(calls).toEqual([])
    forgetKnown()
  })

  test('tmux on another server socket counts as another app: zero calls', async () => {
    forgetKnown()
    await refreshKnown(fake([[starts('ps eww'), { exitCode: 0, stdout: '500 ttys009 claude TMUX=/other,200,0 TMUX_PANE=%4\n' }]]).run, [{ pid: 500, startedAt: 1 }])
    const { run, calls } = fake([])
    const focused = await focusSession(run, { pid: 500, cwd: '/w', startedAt: 1 }, inTmux('/mine'))
    expect(focused).toEqual({ kind: 'elsewhere', place: { host: 'tmux', instance: '/other' } })
    expect(calls).toEqual([])
    expect(elsewhereMessageOf('beta', focused as never, { host: 'tmux', instance: '/mine' })).toBe('beta runs in another tmux server')
    forgetKnown()
  })

  test('a cmux target in another cmux instance: zero calls', async () => {
    forgetKnown()
    await refreshKnown(fake([[starts('ps eww'), { exitCode: 0, stdout: '500 ttys005 claude CMUX_WORKSPACE_ID=W1 CMUX_SURFACE_ID=S1 CMUX_SOCKET_PATH=/b.sock\n' }]]).run, [{ pid: 500, startedAt: 1 }])
    const { run, calls } = fake([])
    expect((await focusSession(run, { pid: 500, cwd: '/w', startedAt: 1 }, { cli: '/c/cmux', place: { host: 'cmux', instance: '/a.sock' } })).kind).toBe('elsewhere')
    expect(calls).toEqual([])
    forgetKnown()
  })

  test('a live target in an unrecognised terminal is unknown; the note says so', async () => {
    forgetKnown()
    const vscode = fake([
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys006 claude TERM_PROGRAM=vscode\n' }],
      [starts('ps -axo'), { exitCode: 0, stdout: '1 0 launchd\n100 1 Code Helper\n500 100 claude\n' }],
    ])
    expect(await focusSession(vscode.run, { pid: 500, cwd: '/w' }, IN_GHOSTTY)).toEqual({ kind: 'unknown' })
    expect(vscode.calls.length).toBe(2)
    expect(elsewhereMessageOf('alpha', { kind: 'unknown' }, { host: 'Ghostty' })).toBe('alpha: terminal unknown')
    expect(elsewhereMessageOf('alpha', { kind: 'elsewhere', place: { host: 'Ghostty' } }, { host: 'cmux' })).toBe('alpha runs in Ghostty')
  })
})

describe('cmux', () => {
  test('the CLI is looked for in the target env, this env, the app bundle, then PATH', () => {
    forgetCmuxCli()
    expect(cmuxCandidatesOf({ CMUX_BUNDLED_CLI_PATH: '/t/cmux' }, '/o/cmux')).toEqual(['/t/cmux', '/o/cmux', CMUX_APP_CLI, 'cmux'])
    expect(cmuxCandidatesOf({}, undefined)).toEqual([CMUX_APP_CLI, 'cmux'])
  })

  test('tree --all --json joins a surface by tty', () => {
    const tree = JSON.stringify({ windows: [{ workspaces: [
      { ref: 'workspace:1', panes: [{ surfaces: [{ ref: 'surface:1', tty: 'ttys001' }] }] },
      { id: 'WS-2', ref: 'workspace:2', panes: [{ surfaces: [{ id: 'SF-9', ref: 'surface:9', tty: '/dev/ttys009' }] }] },
    ] }] })
    expect(cmuxSurfaceOf(tree, '/dev/ttys009')).toEqual({ workspace: 'WS-2', surface: 'SF-9' })
    expect(cmuxSurfaceOf(tree, '/dev/ttys001')).toEqual({ workspace: 'workspace:1', surface: 'surface:1' })
    expect(cmuxSurfaceOf(tree, '/dev/ttys404')).toBeUndefined()
    expect(cmuxSurfaceOf('not json', '/dev/ttys001')).toBeUndefined()
  })

  test('the switch is one sh process: values are positional arguments, never in the script; no app raise', () => {
    expect(cmuxSwitchArgv('/c/cmux', { workspace: 'W1', surface: 'S1' }, 500)).toEqual(['sh', '-c', CMUX_SWITCH_SCRIPT, '/c/cmux', 'W1', 'S1', '500'])
    expect(CMUX_SWITCH_SCRIPT).toBe(
      'kill -0 "$3" 2>/dev/null || exit 75; command -v "$0" >/dev/null 2>&1 || exit 127; '
      + '"$0" select-workspace --workspace "$1" || exit 81; "$0" focus-panel --panel "$2" --workspace "$1" || exit 82',
    )
    expect(CMUX_SWITCH_SCRIPT).not.toMatch(/W1|S1|500|open/)
  })

  test('uncached env ids: probe, then the switch with the first CLI that starts', async () => {
    forgetCmuxCli()
    forgetKnown()
    const { run, calls } = fake([
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys005 claude CMUX_WORKSPACE_ID=W1 CMUX_SURFACE_ID=S1 TERM_PROGRAM=ghostty\n' }],
      [(argv) => isSwitch(argv) && argv.includes(` ${CMUX_APP_CLI} `), { exitCode: 127 }],
      [isSwitch, { exitCode: 0 }],
    ])
    expect(await focusSession(run, { pid: 500, cwd: '/w' }, { place: { host: 'cmux' } })).toEqual({ kind: 'focused', host: 'cmux' })
    // No process table: the CMUX_* variables already name the host.
    expect(calls).toEqual([
      ['ps', 'eww', '-o', 'pid=,tty=,command=', '-p', '500'],
      cmuxSwitchArgv(CMUX_APP_CLI, { workspace: 'W1', surface: 'S1' }, 500),
      cmuxSwitchArgv('cmux', { workspace: 'W1', surface: 'S1' }, 500),
    ])
    expect(knownCmuxCliOf()).toBe('cmux')
    forgetCmuxCli()
  })

  test('cached press from inside the same cmux: exactly one run call, the exact argv, no probe', async () => {
    forgetCmuxCli()
    forgetKnown()
    const refreshed = fake([[starts('ps eww'), { exitCode: 0, stdout: '500 ttys005 claude CMUX_WORKSPACE_ID=W1 CMUX_SURFACE_ID=S1 TERM_PROGRAM=ghostty\n' }]])
    await refreshKnown(refreshed.run, [{ pid: 500, startedAt: 7 }])
    expect(knownOf(500)?.host).toBe('cmux')
    const pressed = fake([[isSwitch, { exitCode: 0 }]])
    expect(await focusSession(pressed.run, { pid: 500, cwd: '/w', startedAt: 7 }, IN_CMUX)).toEqual({ kind: 'focused', host: 'cmux' })
    expect(pressed.calls).toEqual([['sh', '-c', CMUX_SWITCH_SCRIPT, '/c/cmux', 'W1', 'S1', '500']])
    forgetCmuxCli()
    forgetKnown()
  })

  test('a dead pid fails the switch: dead, and the cached probe is dropped', async () => {
    forgetCmuxCli()
    forgetKnown()
    await refreshKnown(fake([[starts('ps eww'), { exitCode: 0, stdout: '500 ttys005 claude CMUX_WORKSPACE_ID=W1 CMUX_SURFACE_ID=S1\n' }]]).run, [{ pid: 500, startedAt: 7 }])
    const pressed = fake([[isSwitch, { exitCode: 75 }]])
    expect(await focusSession(pressed.run, { pid: 500, cwd: '/w', startedAt: 7 }, IN_CMUX)).toEqual({ kind: 'dead' })
    expect(pressed.calls.length).toBe(1)
    expect(knownOf(500)).toBeUndefined()
    forgetKnown()
  })

  test('no env ids: the tty join through tree --all --json, then the switch', async () => {
    forgetCmuxCli()
    forgetKnown()
    const tree = JSON.stringify({ windows: [{ workspaces: [{ ref: 'workspace:3', panes: [{ surfaces: [{ ref: 'surface:7', tty: 'ttys005' }] }] }] }] })
    const { run, calls } = fake([
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys005 claude\n' }],
      [starts('ps -axo'), { exitCode: 0, stdout: TABLE_CMUX }],
      [has('tree --all --json'), { exitCode: 0, stdout: tree }],
      [isSwitch, { exitCode: 0 }],
    ])
    expect((await focusSession(run, { pid: 500, cwd: '/w' }, { place: { host: 'cmux' } })).kind).toBe('focused')
    expect(calls.at(-1)!.slice(3, 6)).toEqual([CMUX_APP_CLI, 'workspace:3', 'surface:7'])
    forgetCmuxCli()
  })

  test('a refusal stays generic: the failing step, named by exit code, and what cmux said', async () => {
    forgetCmuxCli()
    forgetKnown()
    expect(cmuxFailureOf('select-workspace', { exitCode: 1, stdout: '', stderr: 'Error: socket access denied (cmuxOnly)\n' }))
      .toBe('cmux: select-workspace failed (Error: socket access denied (cmuxOnly))')
    const probe: [(argv: string) => boolean, Partial<Ran>] = [starts('ps eww'), { exitCode: 0, stdout: '500 ttys005 claude CMUX_WORKSPACE_ID=W1 CMUX_SURFACE_ID=S1\n' }]
    expect(await focusSession(fake([probe, [isSwitch, { exitCode: 81, stderr: 'Connection refused' }]]).run, { pid: 500, cwd: '/w' }, IN_CMUX))
      .toEqual({ kind: 'failed', reason: 'cmux: select-workspace failed (Connection refused)' })
    expect(await focusSession(fake([probe, [isSwitch, { exitCode: 82, stderr: 'no such panel' }]]).run, { pid: 500, cwd: '/w' }, IN_CMUX))
      .toEqual({ kind: 'failed', reason: 'cmux: focus-panel failed (no such panel)' })
    forgetCmuxCli()
  })

  test('no CLI anywhere is a named failure', async () => {
    forgetCmuxCli()
    const { run } = fake([
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys005 claude CMUX_WORKSPACE_ID=W1 CMUX_SURFACE_ID=S1\n' }],
      [() => true, { exitCode: 127 }],
    ])
    expect(await focusSession(run, { pid: 500, cwd: '/w' }, { place: { host: 'cmux' } })).toEqual({ kind: 'failed', reason: 'cmux: CLI not found' })
  })
})

describe('the probe cache', () => {
  test('refresh probes every new pid in one batched call, reading the table once for those no variable names', async () => {
    forgetKnown()
    const { run, calls } = fake([
      [starts('ps eww'), { exitCode: 1, stdout: '500 ttys005 claude CMUX_WORKSPACE_ID=W1 CMUX_SURFACE_ID=S1\n501 ttys001 claude TERM_PROGRAM=ghostty\n' }],
      [starts('ps -axo'), { exitCode: 0, stdout: TABLE_GHOSTTY.replace(' 500 ', ' 501 ') }],
    ])
    await refreshKnown(run, [{ pid: 500, startedAt: 1 }, { pid: 501, startedAt: 2 }, { pid: 502, startedAt: 3 }, { pid: 0, startedAt: 4 }])
    expect(calls).toEqual([['ps', 'eww', '-o', 'pid=,tty=,command=', '-p', '500,501,502'], ['ps', '-axo', 'pid=,ppid=,comm=']])
    expect(knownOf(500)?.host).toBe('cmux')
    expect(knownOf(501)?.host).toBe('Ghostty')
    expect(knownOf(502)).toEqual({ startedAt: 3 })
    expect(knownPlaceOf(502, 3)).toBeUndefined()
    // A second refresh with the same registry probes nothing.
    const again = fake([])
    await refreshKnown(again.run, [{ pid: 500, startedAt: 1 }, { pid: 501, startedAt: 2 }, { pid: 502, startedAt: 3 }])
    expect(again.calls).toEqual([])
    forgetKnown()
  })

  test('a pid that left the registry is dropped; a changed startedAt is probed again', async () => {
    forgetKnown()
    const probe = fake([[starts('ps eww'), { exitCode: 0, stdout: '500 ttys005 claude TMUX=/s,1,0\n501 ttys006 claude TMUX=/s,1,0\n' }]])
    await refreshKnown(probe.run, [{ pid: 500, startedAt: 1 }, { pid: 501, startedAt: 2 }])
    const next = fake([[starts('ps eww'), { exitCode: 0, stdout: '501 ttys006 claude TMUX=/s,1,0\n' }]])
    await refreshKnown(next.run, [{ pid: 501, startedAt: 9 }])
    expect(knownOf(500)).toBeUndefined()
    expect(knownOf(501)?.startedAt).toBe(9)
    expect(next.calls).toEqual([['ps', 'eww', '-o', 'pid=,tty=,command=', '-p', '501']])
    forgetKnown()
  })

  test('a press whose startedAt differs from the cache probes as before', async () => {
    forgetKnown()
    forgetCmuxCli()
    await refreshKnown(fake([[starts('ps eww'), { exitCode: 0, stdout: '500 ttys005 claude CMUX_WORKSPACE_ID=W1 CMUX_SURFACE_ID=S1\n' }]]).run, [{ pid: 500, startedAt: 1 }])
    const pressed = fake([
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys005 claude CMUX_WORKSPACE_ID=W2 CMUX_SURFACE_ID=S2\n' }],
      [isSwitch, { exitCode: 0 }],
    ])
    await focusSession(pressed.run, { pid: 500, cwd: '/w', startedAt: 2 }, IN_CMUX)
    expect(pressed.calls.map(one => one[0])).toEqual(['ps', 'sh'])
    expect(pressed.calls[1]!.slice(4, 6)).toEqual(['W2', 'S2'])
    forgetKnown()
    forgetCmuxCli()
  })
})

describe('tmux', () => {
  const PANES = 'P\t/dev/ttys008\t%1\tmain\t@1\nP\t/dev/ttys009\t%4\twork\t@3\n'
  const CLIENTS = 'C\t/dev/ttys002\t103\tmain\t1700000000\n'

  test('panes match by tty, else by TMUX_PANE; clients prefer the pane\'s session', () => {
    expect(tmuxPaneOf(PANES + CLIENTS, '/dev/ttys009')).toEqual({ tty: '/dev/ttys009', pane: '%4', session: 'work', window: '@3' })
    expect(tmuxPaneOf(PANES, '', '%1')?.pane).toBe('%1')
    expect(tmuxPaneOf(PANES, '/dev/ttys404')).toBeUndefined()
    expect(tmuxClientOf('C\t/dev/ttys002\t1\tmain\t5\nC\t/dev/ttys003\t2\twork\t1\n', 'work')?.pid).toBe(2)
    expect(tmuxClientOf(PANES + 'C\t/dev/ttys002\t1\tmain\t5\nC\t/dev/ttys003\t2\tmain\t9\n', 'work')?.pid).toBe(2)
    expect(tmuxSocketOf({ TMUX: '/private/tmp/tmux-501/default,99,0' })).toBe('/private/tmp/tmux-501/default')
  })

  test('one select call: switch-client only when the client shows another session', () => {
    const pane = { tty: '/dev/ttys009', pane: '%4', session: 'work', window: '@3' }
    expect(tmuxSelectArgv('/s', pane, { tty: '/dev/ttys002', pid: 1, session: 'main', activity: 0 })).toEqual(
      ['tmux', '-S', '/s', 'switch-client', '-c', '/dev/ttys002', '-t', 'work', ';', 'select-window', '-t', '@3', ';', 'select-pane', '-t', '%4'],
    )
    expect(tmuxSelectArgv('', pane, { tty: '/dev/ttys002', pid: 1, session: 'work', activity: 0 })).toEqual(['tmux', 'select-window', '-t', '@3', ';', 'select-pane', '-t', '%4'])
  })

  test('same server: one query and one select, and no outer terminal is raised', async () => {
    forgetKnown()
    const { run, calls } = fake([
      [starts('ps eww -o pid=,tty=,command= -p 500'), { exitCode: 0, stdout: '500 ttys009 claude TMUX=/s,200,0 TMUX_PANE=%4 TERM_PROGRAM=tmux\n' }],
      [has('list-panes'), { exitCode: 0, stdout: PANES + CLIENTS }],
      [starts('tmux -S /s'), { exitCode: 0 }],
    ])
    expect(await focusSession(run, { pid: 500, cwd: '/w' }, inTmux('/s'))).toEqual({ kind: 'focused', host: 'tmux' })
    expect(calls.slice(1).map(one => one.join(' '))).toEqual([
      expect.stringContaining('tmux -S /s list-panes -a -F'),
      'tmux -S /s switch-client -c /dev/ttys002 -t work ; select-window -t @3 ; select-pane -t %4',
    ])
  })

  test('no attached client falls back', async () => {
    const { run } = fake([
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys009 claude TMUX=/s,200,0\n' }],
      [has('list-panes'), { exitCode: 0, stdout: PANES }],
    ])
    expect(await focusSession(run, { pid: 500, cwd: '/w' }, inTmux('/s'))).toEqual({ kind: 'failed', reason: 'tmux: no client attached' })
  })
})

describe('Ghostty', () => {
  test('one script matches the folder with or without a trailing slash and focuses only one match', () => {
    const script = ghosttyFocusByDirScript('/Users/x/Work "a"/')
    expect(script).toContain('if d is "/Users/x/Work \\"a\\"" or d is ("/Users/x/Work \\"a\\"" & "/") then')
    expect(script).toContain('if (count of found) is 1 then')
    expect(script).toContain('focus terminal id (item 1 of found)')
    // `tab` is Ghostty's tab class: the script never uses it as a separator or keyword.
    expect(script).not.toMatch(/\btab\b/)
    expect(ghosttyAnswerOf('ok\n')).toEqual({ isFocused: true })
    expect(ghosttyAnswerOf('0\n')).toEqual({ reason: 'Ghostty: no tab in this folder' })
    expect(ghosttyAnswerOf('2\n')).toEqual({ reason: 'Ghostty: 2 tabs in this folder' })
    expect(ghosttyAnswerOf('')).toEqual({ reason: 'Ghostty: unexpected answer (none)' })
  })

  test('a cached Ghostty session from a Ghostty pane focuses with exactly one osascript call', async () => {
    forgetKnown()
    await refreshKnown(fake([
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys001 claude TERM_PROGRAM=ghostty\n' }],
      [starts('ps -axo'), { exitCode: 0, stdout: TABLE_GHOSTTY }],
    ]).run, [{ pid: 500, startedAt: 1 }])
    const { run, calls } = fake([[has('repeat with t in terminals'), { exitCode: 0, stdout: 'ok\n' }]])
    expect(await focusSession(run, { pid: 500, cwd: '/w', startedAt: 1 }, IN_GHOSTTY)).toEqual({ kind: 'focused', host: 'Ghostty' })
    expect(calls).toEqual([['osascript', '-e', ghosttyFocusByDirScript('/w')]])
    forgetKnown()
  })

  test('a shared folder never focuses and says how many tabs share it', async () => {
    const { run } = fake([
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys001 claude TERM_PROGRAM=ghostty\n' }],
      [starts('ps -axo'), { exitCode: 0, stdout: TABLE_GHOSTTY }],
      [has('repeat with t in terminals'), { exitCode: 0, stdout: '2\n' }],
    ])
    expect(await focusSession(run, { pid: 500, cwd: '/w' }, IN_GHOSTTY)).toEqual({ kind: 'failed', reason: 'Ghostty: 2 tabs in this folder' })
  })
})

describe('Terminal.app and iTerm2', () => {
  test('scripts select the tab or session whose tty matches, quoted', () => {
    expect(terminalFocusScript('/dev/ttys003')).toContain('if tty of t is "/dev/ttys003" then')
    expect(terminalFocusScript('/dev/ttys003')).toContain('set selected of t to true')
    expect(itermFocusScript('/dev/ttys004')).toContain('if tty of s is "/dev/ttys004" then')
    expect(itermFocusScript('a"b\\c')).toContain('"a\\"b\\\\c"')
  })

  test('Terminal.app focuses by tty; no matching tab falls back', async () => {
    const rules = (answer: string): Array<[(argv: string) => boolean, Partial<Ran>]> => [
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys003 claude TERM_PROGRAM=Apple_Terminal\n' }],
      [starts('ps -axo'), { exitCode: 0, stdout: TABLE_TERMINAL }],
      [has('tell application "Terminal"'), { exitCode: 0, stdout: `${answer}\n` }],
    ]
    expect(await focusSession(fake(rules('ok')).run, { pid: 500, cwd: '/w' }, IN_TERMINAL)).toEqual({ kind: 'focused', host: 'Terminal' })
    expect(await focusSession(fake(rules('none')).run, { pid: 500, cwd: '/w' }, IN_TERMINAL)).toEqual({ kind: 'failed', reason: "Terminal: no tab has this session's tty" })
  })

  test('iTerm2 without Automation permission names the setting', async () => {
    const { run } = fake([
      [starts('ps eww'), { exitCode: 0, stdout: '500 ttys004 claude TERM_PROGRAM=iTerm.app\n' }],
      [starts('ps -axo'), { exitCode: 0, stdout: TABLE_ITERM }],
      [has('tell application "iTerm2"'), { exitCode: 1, stderr: 'execution error: Not authorized to send Apple events to iTerm. (-1743)' }],
    ])
    expect(await focusSession(run, { pid: 500, cwd: '/w' }, IN_ITERM)).toEqual({ kind: 'failed', reason: 'iTerm2: Automation permission denied (System Settings > Privacy & Security > Automation)' })
    expect(appleFailureOf('Terminal', { exitCode: 1, stdout: '', stderr: 'boom' })).toBe('Terminal: AppleScript failed (boom)')
  })
})

describe('fallbacks', () => {
  test('a dead or reused pid is dead, whatever app it ran in', async () => {
    forgetKnown()
    expect(await focusSession(fake([]).run, { pid: 500, cwd: '/w' }, IN_CMUX)).toEqual({ kind: 'dead' })
    expect(await focusSession(fake([[starts('ps eww'), { exitCode: 0, stdout: '500 ttys001 /usr/bin/vim x\n' }]]).run, { pid: 500, cwd: '/w' })).toEqual({ kind: 'dead' })
    expect(await focusSession(fake([]).run, { pid: 0, cwd: '/w' })).toEqual({ kind: 'dead' })
  })

  test('the failure note names the step and the line, copied or to run', () => {
    expect(focusMessageOf({ kind: 'failed', reason: 'Ghostty: 2 tabs in this folder' }, 'claude --resume x', true)).toBe('Ghostty: 2 tabs in this folder. Copied: claude --resume x')
    expect(focusMessageOf({ kind: 'dead' }, 'claude --resume x', true)).toBe('session not running. Copied: claude --resume x')
    expect(focusMessageOf({ kind: 'dead' }, 'claude --resume x', false)).toBe('session not running. Run: claude --resume x')
  })
})
