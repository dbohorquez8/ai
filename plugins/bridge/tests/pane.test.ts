import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { childRowsOf, joined, prefIdOf, prefOf, REGISTRY_SCRIPT, REGISTRY_SEPARATOR, registryOf, resumeCommandOf, rowsOf, toggled, unavailableOf } from '../hooks/pane-policy'
import { BRANCH_SCRIPT, statusLabelOf, TITLE_SCRIPT } from '../hooks/card-policy'
import { CMUX_SWITCH_SCRIPT, forgetCmuxCli, forgetKnown, OWN_ARGV } from '../hooks/focus-policy'
import { PALETTES } from '../hooks/core/palette'
import { snapToRasterGrid } from '../hooks/core/types'
import { KEYS, loadStored, PANE_ARGS_HINT, paneSettingOf } from '../hooks/core/persist'

tier('builtin')

const LISTING = {
  listing: 'text',
  sections: [
    { kind: 'sessions', total: 3, rows: [
      { name: 'alpha', id: 'a1', type: 'session', status: 'running' },
      { name: 'beta', id: 'b2', type: 'session', status: 'idle' },
      { name: 'gamma', id: 'c3', type: 'session', status: 'waiting' },
    ] },
    { kind: 'peers', total: 2, rows: [{ ref: 'r9' }, { name: 'alpha', id: 'a1' }, {}] },
  ],
}

describe('pane policy', () => {
  test('ListAgents rows: one per address, deduplicated, falling back from id to ref to name', () => {
    expect(rowsOf(LISTING).map(row => [row.id, row.name, row.kind, row.status])).toEqual([
      ['a1', 'alpha', 'sessions', 'running'],
      ['b2', 'beta', 'sessions', 'idle'],
      ['c3', 'gamma', 'sessions', 'waiting'],
      ['r9', 'r9', 'peers', ''],
    ])
    expect(rowsOf(undefined)).toEqual([])
    expect(rowsOf({ listing: 'only text' })).toEqual([])
  })

  test('ListAgents subagent and teammate sections are never session rows (a finished subagent is no card)', () => {
    const listing = {
      listing: 'text',
      sections: [
        { kind: 'subagents', total: 2, rows: [{ id: 'a715004d2b60f4252', type: 'general-purpose', status: 'completed' }, { id: 'a9c897ebdde119ed1', type: 'general-purpose', status: 'running' }] },
        { kind: 'teammates', total: 1, rows: [{ name: 'scout', id: 'scout@team', status: 'idle' }] },
        { kind: 'sessions', total: 1, rows: [{ name: 'demo-app-f5', ref: '3507a9', type: 'interactive', status: 'idle' }] },
      ],
    }
    expect(rowsOf(listing).map(row => row.id)).toEqual(['3507a9'])
  })

  test('pin and park toggle and exclude each other; a stored value reads back safely', () => {
    expect(toggled({}, 'pin')).toEqual({ isPinned: true })
    expect(toggled({ isPinned: true }, 'pin')).toEqual({})
    expect(toggled({ isPinned: true }, 'park')).toEqual({ isParked: true })
    expect(toggled({ isParked: true }, 'park')).toEqual({})
    expect(prefOf({ isPinned: true })).toEqual({ isPinned: true })
    expect(prefOf('junk')).toEqual({})
    expect(prefOf(null)).toEqual({})
  })

  test('subagents become child rows; a nested one is indented deeper', () => {
    const rows = childRowsOf([
      { id: 'x', description: 'Read docs', type: 'Explore', status: 'running' },
      { id: 'y', description: 'Nested', type: 'general-purpose', status: 'completed', name: 'helper', parentId: 'x' },
    ])
    expect(rows).toEqual([
      { id: 'x', name: 'Read docs', type: 'Explore', status: 'running', depth: 1 },
      { id: 'y', name: 'helper', type: 'general-purpose', status: 'completed', depth: 2 },
    ])
  })

  test('statuses read as the designed words', () => {
    expect(['running', 'busy', 'waiting', 'completed', 'killed', 'idle', '', 'pending'].map(one => statusLabelOf(one).word)).toEqual(['Working', 'Working', 'Needs you', 'Done', 'Failed', 'Idle', 'Idle', 'Queued'])
  })
})

// ListAgents as a live session lists peers: a name and a 6-character ref, no id.
const LIVE = {
  listing: 'text',
  sections: [{ kind: 'sessions', total: 3, rows: [
    { name: 'webshop-88', ref: '3507a9', status: 'busy' },
    { name: "o'brien-proto", ref: '7f00aa', status: 'idle' },
    { name: 'stranger', ref: '99beef', status: 'idle' },
  ] }],
}

const REGISTRY = [
  { pid: 1, startedAt: 100, sessionId: 'c3de9793-28c5-485f-9503-34c223907488', cwd: '/Users/x/Webshop', kind: 'interactive', name: 'webshop-88', status: 'busy' },
  { pid: 2, startedAt: 200, sessionId: '48e83fdf-5cd2-459c-8466-3adacbeb5572', cwd: "/Users/x/o'brien proto", kind: 'interactive', name: "o'brien-proto", status: 'idle' },
].map(one => JSON.stringify(one)).join(REGISTRY_SEPARATOR) + REGISTRY_SEPARATOR + '{broken' + REGISTRY_SEPARATOR + '{"pid":3}' + REGISTRY_SEPARATOR

describe('session registry', () => {
  test('the registry reads each file; a broken or partial one is skipped', () => {
    expect(registryOf(REGISTRY).map(one => [one.name, one.sessionId, one.pid])).toEqual([
      ['webshop-88', 'c3de9793-28c5-485f-9503-34c223907488', 1],
      ["o'brien-proto", '48e83fdf-5cd2-459c-8466-3adacbeb5572', 2],
    ])
    expect(registryOf('')).toEqual([])
  })

  test('rows join the registry by name; the resume line cds into the quoted directory first', () => {
    const [mine, quoted, stranger] = joined(rowsOf(LIVE), registryOf(REGISTRY))
    expect(resumeCommandOf(mine!)).toBe("cd '/Users/x/Webshop' && claude --resume c3de9793-28c5-485f-9503-34c223907488")
    expect(resumeCommandOf(quoted!)).toBe("cd '/Users/x/o'\\''brien proto' && claude --resume 48e83fdf-5cd2-459c-8466-3adacbeb5572")
    expect(prefIdOf(mine!)).toBe('c3de9793-28c5-485f-9503-34c223907488')
    expect(stranger!.id).toBe('99beef')
    expect(resumeCommandOf(stranger!)).toBeUndefined()
    expect(unavailableOf(stranger!)).toBe('stranger: resume unavailable (session id unknown)')
  })

  test('a name two registry files share matches neither: no guessed id', () => {
    const twice = registryOf(REGISTRY + JSON.stringify({ sessionId: 'other', name: 'webshop-88', cwd: '/y' }))
    expect(joined(rowsOf(LIVE), twice)[0]!.sessionId).toBeUndefined()
  })
})

type World = { now?: number; titleOut?: (args: readonly string[]) => string; branchOut?: (args: readonly string[]) => string; reads?: string[][]; store?: Map<string, unknown>; selfId?: string; listing?: unknown; deny?: string; agents?: unknown[]; registry?: string; isProcessRefused?: boolean; run?: (argv: readonly string[]) => { exitCode: number; stdout: string; stderr?: string }; toasts?: string[]; copies?: string[]; ran?: string[][]; env?: Record<string, string> }

const engine = (on: On, world: World = {}) => {
  const store = world.store ?? new Map<string, unknown>()
  // these cards were written with the Working shelf on; it is a setting now, off by default.
  if (!store.has('setting:workingShelf')) store.set('setting:workingShelf', true)
  mock.clock(on, { now: world.now ?? 0 })
  on('store.get', ($s, e) => ({ value: store.get(e.key) }))
  on('store.set', ($s, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($s, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.start', ($s, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: world.selfId ?? 'a1' }))
  on('tool.call', { tool: 'ListAgents' }, () => (world.deny ? { deny: world.deny } : { result: world.listing ?? LISTING }) as never)
  on('agent.list', () => ({ value: world.agents ?? [{ id: 'sub1', description: 'Scan repo', type: 'Explore', status: 'running' }] }) as never)
  on('ui.copy', ($s, e) => (world.copies?.push((e as { text: string }).text), { value: { isCopied: true } }) as never)
  on('env.get', ($s, e) => ({ value: world.env?.[(e as { name: string }).name] }) as never)
  on('process.run', ($s, e) => {
    if (world.isProcessRefused) throw new Error('refused')
    const argv = (e as { argv: readonly string[] }).argv
    if (argv[0] === 'sh' && argv[2] === REGISTRY_SCRIPT) return { value: { exitCode: 0, stdout: world.registry ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    if (argv[0] === 'sh' && (argv[2] === TITLE_SCRIPT || argv[2] === BRANCH_SCRIPT)) {
      const args = argv.slice(4)
      world.reads?.push([argv[2] === TITLE_SCRIPT ? 'titles' : 'branches', ...args])
      const answer = argv[2] === TITLE_SCRIPT ? world.titleOut : world.branchOut
      return { value: { exitCode: answer ? 0 : 1, stdout: answer?.(args) ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    }
    world.ran?.push([...argv])
    const ran = world.run?.(argv) ?? { exitCode: 1, stdout: '' }
    return { value: { stderr: '', ...ran, isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', ($s, e) => (world.toasts?.push((e as { text: string }).text), { value: undefined }) as never)
  return store
}

const PANE_PROPS = {
  title: 'Bridge',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const openKeysOf = async (ui: { findAll: (q: { type?: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => key.startsWith('open:'))

describe('pane', () => {
  test('lists sessions and subagents; pin moves a row first, park moves it to a collapsed group', async ($, on) => {
    const store = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
    await $.command.run({ command: 'bridge', args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'bridge' })

    // phase 2: Active (needs-you first) before Working.
    expect(await openKeysOf(ui)).toEqual(['open:c3', 'open:b2', 'open:r9', 'open:a1'])
    expect((await ui.find({ key: 'view:sub1' }))?.text).toMatch(/Scan repo/)

    await ui.press({ key: 'pin:c3' })
    expect(await openKeysOf(ui)).toEqual(['open:c3', 'open:b2', 'open:r9', 'open:a1'])
    expect(store.get('pref:c3')).toEqual({ isPinned: true })

    await ui.press({ key: 'park:b2' })
    expect(await openKeysOf(ui)).toEqual(['open:c3', 'open:r9', 'open:a1'])
    expect((await ui.find({ key: 'shelf:parked' }))?.text).toMatch(/^Parked \(1\) ─+ ⌄$/)

    await ui.press({ key: 'shelf:parked' })
    expect(await openKeysOf(ui)).toEqual(['open:c3', 'open:r9', 'open:a1', 'open:b2'])

    await ui.press({ key: 'open:b2' })
    expect(await ui.find({ text: 'beta: resume unavailable (session id unknown)' })).toBeDefined()
    expect(await ui.find({ text: /claude --resume/ })).toBeUndefined()
  })

  test('live-shaped rows: this session is highlighted, another press copies the cd + resume line, pins key by session id', async ($, on) => {
    const store = engine(on, { listing: LIVE, registry: REGISTRY, selfId: 'c3de9793-28c5-485f-9503-34c223907488', agents: [] })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
    await $.command.run({ command: 'bridge', args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'bridge' })
    // phase 2: the own card is marked by its fill, other cards have none.
    expect((await ui.find({ key: 'row:3507a9' }))?.props.backgroundColor).toBe(snapToRasterGrid(PALETTES.dark.fill)) // live capture v2: own-card fill snaps to the Raster grid
    expect((await ui.find({ key: 'row:7f00aa' }))?.props.backgroundColor).toBeUndefined()
    await ui.press({ key: 'open:7f00aa' })
    expect(await ui.find({ text: "cd '/Users/x/o'\\''brien proto' && claude --resume 48e83fdf-5cd2-459c-8466-3adacbeb5572" })).toBeDefined()
    await ui.press({ key: 'pin:3507a9' })
    expect(store.get('pref:c3de9793-28c5-485f-9503-34c223907488')).toEqual({ isPinned: true })
  })

  test('a refused registry read keeps the names and says resume is unavailable', async ($, on) => {
    engine(on, { listing: LIVE, isProcessRefused: true, agents: [] })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
    await $.command.run({ command: 'bridge', args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'bridge' })
    expect(await ui.find({ text: /Session registry unreadable/ })).toBeDefined()
    await ui.press({ key: 'open:3507a9' })
    expect(await ui.find({ text: 'webshop-88: resume unavailable (session id unknown)' })).toBeDefined()
    expect(await ui.find({ text: /3507a9/ })).toBeUndefined()
  })

  test('a card draws its title, status and actions as separate elements; the actions show only on hover', async ($, on) => {
    engine(on, { listing: LIVE, registry: REGISTRY, agents: [] })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
    await $.command.run({ command: 'bridge', args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'bridge' })
    const row = await ui.find({ key: 'row:7f00aa' })
    // phase 2: the idle slot is the age; the actions read Pin, Snooze, Park, Settle.
    expect((await ui.find({ key: 'open:7f00aa' }))?.text).not.toMatch(/now|Pin|Park/)
    expect(row?.text).toMatch(/now/)
    expect((await ui.find({ key: 'pin:7f00aa' }))?.text).toBe('Pin')
    expect((await ui.find({ key: 'park:7f00aa' }))?.text).toBe('Park')
    const hidden = (await ui.findAll({ type: 'Box' })).filter(one => one.props.display === 'none')
    expect(hidden.length).toBe(3)
    // The harness strips `hover`; the engine validated the reveal (it refuses a misplaced one).
    for (const one of hidden) expect(one.text).toMatch(/^Pin(SnoozeParkSettle)?$/)
  })

  test('stored pins and parks come back in a new session', async ($, on) => {
    engine(on, { selfId: 'zz', agents: [], store: new Map<string, unknown>([['pref:r9', { isPinned: true }], ['pref:a1', { isParked: true }], ['other', 1]]) })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
    await $.command.run({ command: 'bridge', args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'bridge' })
    // phase 2: a parked session that works is back on its shelf (Working); needs-you first in Active.
    expect(await openKeysOf(ui)).toEqual(['open:r9', 'open:c3', 'open:b2', 'open:a1'])
  })

  test('a ListAgents refusal shows as a notice, not an empty list', async ($, on) => {
    engine(on, { selfId: 'zz', agents: [], deny: 'not here' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
    await $.command.run({ command: 'bridge', args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'bridge' })
    expect(await ui.find({ text: /ListAgents refused: not here/ })).toBeDefined()
  })
})

describe('row press focuses the hosting tab', () => {
  const PROBE = 'pid=,tty=,command='
  /** Every world answers the refresh's batched probe of pids 1 and 2; `press` answers the rest. */
  const worldOf = (probe: string, press: (argv: readonly string[]) => { exitCode: number; stdout: string } | undefined, env: Record<string, string> = {}) => ({
    listing: LIVE, registry: REGISTRY, agents: [], toasts: [] as string[], copies: [] as string[], ran: [] as string[][], env,
    run: (argv: readonly string[]) => {
      if (argv[0] === 'ps' && argv[1] === 'eww') return { exitCode: 0, stdout: probe }
      return press(argv) ?? { exitCode: 1, stdout: '' }
    },
  })
  const GHOSTTY_TABLE = '1 0 launchd\n10 1 /Applications/Ghostty.app/Contents/MacOS/ghostty\n11 10 login\n12 11 -zsh\n1 12 claude\n'
  /** A Ghostty session; the pane runs in Ghostty unless `env` says otherwise. */
  const ghosttyWorld = (answer: string, env: Record<string, string> = { TERM_PROGRAM: 'ghostty' }) => worldOf(
    '    1 ttys001 claude --x TERM_PROGRAM=ghostty SECRET_TOKEN=abc\n',
    argv => {
      if (argv[0] === 'ps') return { exitCode: 0, stdout: GHOSTTY_TABLE }
      // The pane's own chain: its $PPID, then the table.
      if (argv[0] === 'sh' && argv[2] === OWN_ARGV[2]) return { exitCode: 0, stdout: `12\n${GHOSTTY_TABLE}` }
      if (argv[0] === 'osascript') return { exitCode: 0, stdout: answer }
      return undefined
    },
    env,
  )
  const cmuxWorld = (env: Record<string, string>, exitCode = 0) => worldOf(
    '1 ttys001 claude --x CMUX_WORKSPACE_ID=W1 CMUX_SURFACE_ID=S1 TERM_PROGRAM=ghostty\n',
    argv => (argv[0] === 'sh' && argv[1] === '-c' ? { exitCode, stdout: '' } : undefined),
    env,
  )
  type World = ReturnType<typeof worldOf>
  /** Starts the session (its refresh caches the probe), mounts the pane, forgets what the refresh ran, then presses. */
  const pressIn = async ($: Parameters<TestBody>[0], on: On, world: World) => {
    forgetCmuxCli()
    forgetKnown()
    engine(on, world)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
    await $.command.run({ command: 'bridge', args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'bridge' })
    const refreshed = [...world.ran]
    world.ran.length = 0
    await ui.press({ key: 'open:3507a9' })
    return { ui, refreshed }
  }
  const LINE = "cd '/Users/x/Webshop' && claude --resume c3de9793-28c5-485f-9503-34c223907488"

  test('the refresh probes the registry pids in one batched call', async ($, on) => {
    const { refreshed } = await pressIn($, on, cmuxWorld({ CMUX_WORKSPACE_ID: 'W0', CMUX_BUNDLED_CLI_PATH: '/c/cmux' }))
    // the cross-check now runs once before the first refresh.
    expect(refreshed.filter(argv => argv[0] !== 'claude')).toEqual([['ps', 'eww', '-o', PROBE, '-p', '1,2']])
  })

  test('same app: a cached cmux session from a pane inside cmux runs exactly one call with the exact argv, no toast', async ($, on) => {
    const world = cmuxWorld({ CMUX_WORKSPACE_ID: 'W0', CMUX_BUNDLED_CLI_PATH: '/c/cmux', TERM_PROGRAM: 'ghostty' })
    const { ui } = await pressIn($, on, world)
    expect(world.ran).toEqual([['sh', '-c', CMUX_SWITCH_SCRIPT, '/c/cmux', 'W1', 'S1', '1']])
    expect(world.toasts).toEqual([])
    expect(world.copies).toEqual([])
    expect(await ui.find({ text: /claude --resume/ })).toBeUndefined()
    expect((await ui.find({ key: 'row:3507a9' }))?.text).not.toMatch(/cmux/)
  })

  test('another app: a Ghostty pane pressing a live cmux session makes no call and no copy; the note names cmux', async ($, on) => {
    const world = cmuxWorld({ TERM_PROGRAM: 'ghostty' })
    const { ui } = await pressIn($, on, world)
    expect(world.ran).toEqual([])
    expect(world.copies).toEqual([])
    expect(world.toasts).toEqual([])
    expect(await ui.find({ text: 'webshop-88 runs in cmux' })).toBeDefined()
    expect(await ui.find({ text: /claude --resume/ })).toBeUndefined()
  })

  test('a row in another app is dimmed and tagged with its app, inside the spaced row', async ($, on) => {
    const { ui } = await pressIn($, on, cmuxWorld({ TERM_PROGRAM: 'ghostty' }))
    // phase 2: the working one-liner reads project, title, slot; the app is named by the press note.
    expect((await ui.find({ key: 'row:3507a9' }))?.text).toMatch(/^W  Webshop webshop-.*\s+Working now$/)
    expect((await ui.find({ key: 'note' }))?.text).toBe('webshop-88 runs in cmux')
    expect((await ui.find({ key: 'open:3507a9' }))?.props.dimColor).toBe(true)
  })

  test('another app: a cmux pane pressing a live Ghostty session makes no call; the note names Ghostty', async ($, on) => {
    const world = ghosttyWorld('ok\n', { CMUX_WORKSPACE_ID: 'W0', TERM_PROGRAM: 'ghostty' })
    const { ui } = await pressIn($, on, world)
    expect(world.ran).toEqual([])
    expect(world.copies).toEqual([])
    expect(await ui.find({ text: 'webshop-88 runs in Ghostty' })).toBeDefined()
  })

  test('a dead cmux pid fails the chained call: the note under the list says so, the line is copied, no toast', async ($, on) => {
    const world = cmuxWorld({ CMUX_WORKSPACE_ID: 'W0', CMUX_BUNDLED_CLI_PATH: '/c/cmux' }, 75)
    const { ui } = await pressIn($, on, world)
    expect(world.ran.length).toBe(1)
    expect(world.copies).toEqual([LINE])
    expect(world.toasts).toEqual([])
    expect(await ui.find({ text: `session not running. Copied: ${LINE}` })).toBeDefined()
  })

  test('same app: a unique Ghostty folder focuses with one osascript call and copies nothing, no toast', async ($, on) => {
    const world = ghosttyWorld('ok\n')
    await pressIn($, on, world)
    expect(world.ran.length).toBe(1)
    expect(world.ran[0]![0]).toBe('osascript')
    expect(world.ran[0]![2]).toContain('"/Users/x/Webshop"')
    expect(world.copies).toEqual([])
    expect(world.toasts).toEqual([])
  })

  test('two Ghostty tabs in the folder: no focus; the failed step and the copied line show inline, no toast', async ($, on) => {
    const world = ghosttyWorld('2\n')
    const { ui } = await pressIn($, on, world)
    expect(world.copies).toEqual([LINE])
    expect(world.toasts).toEqual([])
    // phase 2
    expect(await ui.find({ text: `Ghostty: the folder is shared by 2 tabs. Copied: ${LINE}` })).toBeDefined()
  })

  test('a dead target keeps the fallback: the press probes once, then copies and says so inline', async ($, on) => {
    const world = worldOf('', () => undefined)
    const { ui } = await pressIn($, on, world)
    // phase 2: with no terminal recognised for the pane, nothing is probed; the line is copied and the note says why.
    expect(world.ran).toEqual([])
    expect(world.copies.length).toBe(1)
    expect(world.toasts).toEqual([])
    expect(await ui.find({ text: /this terminal is not supported for switching\. Copied: cd / })).toBeDefined()
  })
})

describe('/bridge sound', () => {
  test('sound on and off store the setting and reply with a label; a bad value is an error', () => {
    expect(paneSettingOf('sound off')).toEqual({ key: KEYS.sound, value: false, label: 'Needs-you chime: off' })
    expect(paneSettingOf(' Sound ON ')).toEqual({ key: KEYS.sound, value: true, label: 'Needs-you chime: on' })
    for (const bad of ['sound', 'sound loud', 'sound on off']) expect(paneSettingOf(bad)).toEqual({ error: `Unknown setting. Use: /bridge ${PANE_ARGS_HINT}` })
    expect(PANE_ARGS_HINT).toContain('sound on|off')
  })
  test('sound is on by default; a stored boolean is read back; anything else resets', () => {
    expect(loadStored(new Map()).stored.settings.sound).toBeUndefined()
    expect(loadStored(new Map([[KEYS.sound, false]])).stored.settings.sound).toBe(false)
    expect(loadStored(new Map([[KEYS.sound, true]])).stored.settings.sound).toBe(true)
    expect(loadStored(new Map([[KEYS.sound, 'loud']])).resetKeys).toEqual([KEYS.sound])
  })
})
