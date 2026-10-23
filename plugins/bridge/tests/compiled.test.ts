// Black-box tests of the pane, compiled from its validation plan.
// Unit (U) and harness-render (H) rows only. Live-Ghostty (G), live-tmux (T) and manual visual check (O) rows are todos.
// Black-box: the pane is driven through the module entry (hooks/register.tsx) with the process runner,
// file reads and clock stubbed at the lowest boundary. The implementation is not built yet; failures are the bar.
import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

import { REGISTRY_SCRIPT, REGISTRY_SEPARATOR } from '../hooks/pane-policy'
import { BRANCH_SCRIPT, TITLE_SCRIPT } from '../hooks/card-policy'
import { PANE_COLUMNS } from '../hooks/register'
import { PALETTES, contrastRatio, projectColorsOf, themeModeOf } from '../hooks/core/palette'
import { PANE_ARGS_HINT } from '../hooks/core/persist'
import { cellWidth } from '../hooks/core/width'
import { spinnerCells } from '../hooks/core/sprites'
import { hexToColor, snapToRasterGrid } from '../hooks/core/types'

tier('builtin')

// The testing module has no todo; use one when the runner offers it, else register nothing.
const todo: (name: string) => void = (test as unknown as { todo?: (name: string) => void }).todo ?? (() => {})

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const TUE_10 = new Date(2026, 9, 13, 10, 0, 0).getTime()
const GREEN = '\u001f'
const FIELD_SEP = '\u001f'
const ITEM_SEP = '\u001e'

type Sess = {
  name: string; status?: 'busy' | 'waiting' | 'idle' | 'completed'; cwd?: string; ageMs?: number; sinceMs?: number
  title?: string; prompt?: string; branch?: string | null; reason?: string; app?: 'ghostty' | 'tmux' | 'cmux' | 'terminal'; ctx?: number; startedAgoMs?: number
  /** The transcript's last model id (third TITLE_SCRIPT field), e.g. 'claude-opus-5-5'. */
  model?: string
}
// phase 2: the low six hex digits, so names that differ in their last character (done10, done11) get distinct refs.
const refOf = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(6, '0').slice(-6)
const idOf = (name: string) => `${refOf(name)}00-0000-4000-8000-000000000000`
const S = (name: string, x: Omit<Sess, 'name'> = {}): Sess => ({ name, ...x })

type World = {
  now?: number; store?: Map<string, unknown>; selfName?: string; agents?: unknown[]; env?: Record<string, string>
  term?: 'ghostty' | 'unknown'; truecolor?: boolean; copies?: string[]; toasts?: string[]; views?: Array<Record<string, unknown>>; ran?: string[][]; reads?: string[][]
  focusCalls?: string[]; focusFails?: string; focusAnswer?: string; gh?: 'ok' | 'absent'; ghCalls?: string[][]; registryRaw?: string; listingBroken?: boolean
  transcriptReads?: number; storeRaw?: string; hidden?: boolean
  /** Every `$.process.run`, counted; every `$.ui.blit` the pane sent. */
  runs?: number; blits?: Array<{ key: string; cells: string }>
  /** What `claude agents --json` prints (the 30 s cross-check). */
  agentsJson?: unknown[]
  /** The Claude theme `$.config.list()` reports (absent: none readable). */
  theme?: string
  // files `$.fs` sees (path to mtime), and each icon conversion the pane ran.
  files?: Record<string, number>; converts?: string[][]
  /** Rows of a ListAgents `subagents` section (the own session's agent loops). */
  subagentRows?: unknown[]
}
const PANE_PROPS = (cols: number, placement: 'dock' | 'inline' = 'dock') => ({
  title: 'Bridge', isFocused: false, bodyColumns: cols, placement, scroll: { offset: 0, bodyRows: 40 }, view: {},
})
// phase 2: registry times are relative to the mount time, so `updatedAt` stays fixed between refreshes.
const registryOf = (sessions: Sess[], now: number) =>
  sessions.map((s, i) => JSON.stringify({
    pid: i + 1, startedAt: now - (s.startedAgoMs ?? DAY), updatedAt: now - (s.ageMs ?? 0), statusSince: now - (s.sinceMs ?? s.ageMs ?? 0),
    sessionId: idOf(s.name), cwd: s.cwd ?? `/p/${s.name}`, kind: 'interactive', name: s.name, status: s.status ?? 'idle', reason: s.reason,
    contextPercent: s.ctx,
  })).join(REGISTRY_SEPARATOR) + REGISTRY_SEPARATOR
const listingOf = (sessions: Sess[], subagentRows: unknown[] = []) => ({
  listing: 'text',
  sections: [
    ...(subagentRows.length ? [{ kind: 'subagents', total: subagentRows.length, rows: subagentRows }] : []),
    { kind: 'sessions', total: sessions.length, rows: sessions.map(s => ({ name: s.name, ref: refOf(s.name), status: s.status ?? 'idle' })) },
  ],
})
// phase 2: a session with no app of its own runs in the pane's terminal (an unknown one in the unknown world).
const probeOf = (sessions: Sess[], term: World['term'] = 'ghostty') => sessions.map((s, i) => {
  const env = s.app === undefined && term === 'unknown' ? 'TERM_PROGRAM=someterm' : { ghostty: 'TERM_PROGRAM=ghostty', tmux: 'TMUX=/tmp/t TERM_PROGRAM=tmux', cmux: 'CMUX_WORKSPACE_ID=W1 CMUX_SURFACE_ID=S1 TERM_PROGRAM=ghostty', terminal: 'TERM_PROGRAM=Apple_Terminal' }[s.app ?? 'ghostty']
  return `${i + 1} ttys00${i + 1} claude --x ${env}`
}).join('\n') + '\n'

type Current = { sessions: Sess[]; world: World; store: Map<string, unknown>; base: number }
const registered = new WeakMap<object, { current: Current; clock: ReturnType<typeof mock.clock>; mounts: number }>()
// Hooks must be registered before the first `$` call, so each test registers once and every later mount swaps the state they read.
const engine = (on: On, sessions: Sess[], world: World) => {
  const known = registered.get(on as object)
  if (known) {
    known.current.sessions = sessions; known.current.world = world; known.current.store = world.store ?? new Map<string, unknown>()
    // phase 2: the clock move is awaited by mountPane, so the session starts at the world's time.
    const pending = (world.now ?? TUE_10) > known.clock.now() ? known.clock.set(world.now ?? TUE_10) : undefined
    known.current.base = Math.max(world.now ?? TUE_10, known.clock.now())
    return { store: known.current.store, clock: known.clock, fresh: false, mounts: ++known.mounts, pending }
  }
  const current: Current = { sessions, world, store: world.store ?? new Map<string, unknown>(), base: world.now ?? TUE_10 }
  const clock = mock.clock(on, { now: world.now ?? TUE_10 })
  registered.set(on as object, { current, clock, mounts: 0 })
  const now = () => clock.now()
  const store = () => current.store
  const self = () => current.world.selfName ?? current.sessions[0]?.name ?? 'x'
  on('store.get', ($s, e) => ({ value: e.key === 'layout' && current.world.storeRaw !== undefined ? current.world.storeRaw : store().get(e.key) }) as never)
  on('store.set', ($s, e) => (store().set(e.key, e.value), { value: undefined }) as never)
  on('store.delete', ($s, e) => (store().delete(e.key), { value: undefined }) as never)
  on('store.keys', () => ({ value: [...store().keys()] }) as never)
  on('session.start', ($s, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: idOf(self()) }))
  on('tool.call', { tool: 'ListAgents' }, () => ({ result: current.world.listingBroken ? { listing: 'text', sections: [{ kind: 'sessions', rows: current.sessions.map(s => ({ name: s.name })) }] } : listingOf(current.sessions, current.world.subagentRows) }) as never)
  on('agent.list', () => ({ value: current.world.agents ?? [] }) as never)
  // phase 2: the own card's context comes from $.session.usage().
  on('session.usage', () => {
    const own = current.sessions.find(one => one.name === self())
    return { value: { startedAt: 0, context: { window: 200_000, ...(own?.ctx === undefined ? {} : { percent: own.ctx }) }, rateLimits: [] } } as never
  })
  on('config.list', () => ({ value: current.world.theme === undefined ? [] : [{ key: 'theme', label: 'Theme', kind: 'enum', value: current.world.theme, provider: { kind: 'core' }, isLocked: false }] }) as never)
  on('ui.blit', ($s, e) => {
    const blit = e as { key: string; cells?: string }
    current.world.blits?.push({ key: blit.key, cells: blit.cells ?? '' })
    return { value: current.world.hidden ? { deny: 'not mounted' } : {} } as never
  })
  on('ui.copy', ($s, e) => (current.world.copies?.push((e as { text: string }).text), { value: { isCopied: true } }) as never)
  on('ui.view', ($s, e, next) => (current.world.views ? (current.world.views.push(e as Record<string, unknown>), { value: {} }) : next(e)) as never)
  on('ui.toast', ($s, e) => (current.world.toasts?.push((e as { text: string }).text), { value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('env.get', ($s, e) => {
    const name = (e as { name: string }).name
    const base: Record<string, string> = current.world.term === 'unknown' ? { TERM_PROGRAM: 'someterm' } : { TERM_PROGRAM: 'ghostty' }
    if (current.world.truecolor !== false) base.COLORTERM = 'truecolor'
    return { value: { ...base, ...current.world.env }[name] } as never
  })
  // the project folders' files; a missing path rejects as ENOENT.
  // the stop hook the engine raises; nothing beneath the plugins in a test.
  on('classic.Stop', () => ({}) as never)
  // the stop-failure hook the engine raises on an API error.
  on('classic.StopFailure', () => ({}) as never)
  // the next prompt clears Failed (an interrupted turn has no Stop).
  on('classic.UserPromptSubmit', () => ({}) as never)
  on('fs.stat', ($s, e) => {
    const mtimeMs = current.world.files?.[(e as { path: string }).path]
    return (mtimeMs === undefined ? { deny: 'ENOENT' } : { value: { kind: 'file', size: 1, mtimeMs, isLink: false } }) as never
  })
  on('fs.exists', ($s, e) => ({ value: current.world.files?.[(e as { path: string }).path] !== undefined }) as never)
  on('process.run', ($s, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    current.world.runs = (current.world.runs ?? 0) + 1
    if (argv[0] === 'sh' && argv[3] === 'bridge' && String(argv[2]).includes('sips')) {
      current.world.converts?.push(argv.slice(4))
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
    }
    const done = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never
    if (argv[0] === 'sh' && argv[2] === REGISTRY_SCRIPT) return done(0, current.world.registryRaw ?? registryOf(current.sessions, current.base))
    if (argv[0] === 'sh' && argv[2] === TITLE_SCRIPT) {
      current.world.reads?.push(['titles', ...argv.slice(4)]); current.world.transcriptReads = (current.world.transcriptReads ?? 0) + 1
      const out = argv.slice(4).map(spec => {
        // phase 2: the argument is `<mode>:<slug>/<session id>`; the id is after the slash.
        const id = spec.split('/').at(-1) ?? ''
        const s = current.sessions.find(one => idOf(one.name) === id)
        // phase 2: the reader prints the transcript records themselves, then the model match.
        const ai = s?.title ? JSON.stringify({ type: 'ai-title', aiTitle: s.title }) : ''
        const prompt = s?.prompt ? JSON.stringify({ type: 'last-prompt', lastPrompt: s.prompt }) : ''
        const model = s?.model ? `"model":"${s.model}"` : ''
        return `${ai}${FIELD_SEP}${prompt}${FIELD_SEP}${model}${ITEM_SEP}`
      }).join('')
      return done(0, out)
    }
    if (argv[0] === 'sh' && argv[2] === BRANCH_SCRIPT) {
      const out = argv.slice(4).map(dir => {
        const s = current.sessions.find(one => (one.cwd ?? `/p/${one.name}`) === dir)
        return s?.branch === null ? `${FIELD_SEP}${ITEM_SEP}` : `${s?.branch ?? 'main'}${FIELD_SEP}${dir}/.git${ITEM_SEP}`
      }).join('')
      return done(0, out)
    }
    if (argv[0] === 'ps') return done(0, probeOf(current.sessions, current.world.term))
    if (argv[0] === 'claude' && argv[1] === 'agents') return done(0, JSON.stringify(current.world.agentsJson ?? []))
    if (argv[0] === 'gh') {
      current.world.ghCalls?.push([...argv])
      return current.world.gh === 'absent' ? done(127, '') : done(0, '[{"number":42}]')
    }
    current.world.ran?.push([...argv])
    if (argv[0] === 'osascript' || argv[0] === 'tmux' || argv[0] === 'sh') current.world.focusCalls?.push(argv.join(' '))
    return done(current.world.focusFails ? 1 : 0, current.world.focusFails ?? current.world.focusAnswer ?? 'ok\n')
  })
  return { store: current.store, clock, fresh: true, mounts: 0, pending: undefined }
}

type Ui = any
// the Working shelf is a setting, off by default; tests of the shelf turn it on.
const SHELF_ON = ['setting:workingShelf', true] as const
const shelfOn = () => ({ store: new Map<string, unknown>([SHELF_ON]) })

const mountPane = async ($: any, on: On, sessions: Sess[], world: World = {}, cols = 44, placement: 'dock' | 'inline' = 'dock') => {
  const { store, clock, mounts, pending } = engine(on, sessions, world)
  await pending
  const requestId = mounts === 0 ? 'bridge' : `bridge-${mounts}`
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
  await $.command.run({ command: 'bridge', args: '' } as never)
  const ui: Ui = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', component: 'Pane', props: PANE_PROPS(cols, placement) as never, requestId })
  return { ui, store, clock, world }
}
// settings are `/bridge` arguments; this types the command with them.
const paneCommand = async ($: any, args: string) => $.command.run({ command: 'bridge', args } as never)
const textOf = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map((one: any) => one.text as string).join('\n')
// phase 2: the harness text has no newlines, so a card's lines are read through their `line1:`/`line2:`/`line3:` keys.
const linesById = async (ui: Ui, id: string) => {
  const lines: string[] = []
  for (const key of ['line1', 'line2', 'line3']) {
    const one = await ui.find({ key: `${key}:${id}` })
    if (one) lines.push(one.text as string)
  }
  return lines.join('\n')
}
const rowText = async (ui: Ui, name: string) => linesById(ui, refOf(name))
// the creature art column is gone; the project icon is drawn inside line 1 (its text counts there).
/** Which project icon a card draws: its picture (an Image), its monogram (a keyed Text box), or none. */
const iconKindOf = async (ui: Ui, name: string) => ((await ui.find({ key: `icon:${refOf(name)}` })) ? 'picture' : (await ui.find({ key: `monogram:${refOf(name)}` })) ? 'monogram' : 'none')
/** A world where the pane can cache pictures (HOME is known) and the given project files exist. */
const withFiles = (files: Record<string, number>, extra: World = {}): World => ({ ...extra, files, converts: [], env: { HOME: '/h', ...extra.env } })
const blitsOf = (world: World, key: string) => (world.blits ?? []).filter(one => one.key === key)
// the open Active header is three presses (name and rule, `↕`, chevron) in one `header:` row.
const headerText = async (ui: Ui, shelf: string) => ((await ui.find({ key: `header:${shelf}` }))?.text ?? (await ui.find({ key: `shelf:${shelf}` }))?.text ?? '') as string
// the sort mode is chosen from the menu the Active header's `↕` opens.
const pickSort = async (ui: Ui, mode: string) => { await ui.press({ key: 'sort' }); await ui.press({ key: `sort:${mode}` }) }
const hasText = async (ui: Ui, text: string | RegExp) => (await ui.find({ text })) !== undefined
const orderOf = async (ui: Ui) => {
  const out: Record<string, string[]> = {}
  let shelf = ''
  for (const one of await ui.findAll({})) {
    const key = (one.key ?? '') as string
    if (key.startsWith('shelf:')) { shelf = key.slice(6); out[shelf] ??= [] }
    else if (key.startsWith('open:')) (out[shelf] ??= []).push(key.slice(5))
  }
  return out
}
const refs = (...names: string[]) => names.map(refOf)
const press = (ui: Ui, key: string) => ui.press({ key })
const widest = (text: string) => Math.max(0, ...text.split('\n').map(l => [...l].length))
const AGENT = (id: string, status: string, description?: string, extra: object = {}) => ({ id, description, type: 'Explore', status, ...extra })

// ---------------------------------------------------------------- 1. Shelf headers
describe('1. shelf headers', () => {
  test('A person glances at a shelf header (name in muted style)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { status: 'idle' })])
    const header = await ui.find({ key: 'shelf:active' })
    expect(header?.text).toMatch(/^Active/)
    const name = (await ui.findAll({ type: 'Text' })).find((one: any) => one.text === 'Active' || /^Active\b/.test(one.text))
    expect(name?.props.dimColor).toBe(true)
  })
  test('A person glances at a shelf header (thin rule fills the remaining line)', async ($, on) => {
    for (const cols of [44, 70]) {
      const { ui } = await mountPane($, on, [S('alpha')], {}, cols)
      const header = await headerText(ui, 'active')
      expect(header).toMatch(/^Active ─+/)
      expect([...header].length).toBe(cols - 2)
    }
  })
  test('A person glances at a shelf header (chevron at the right end)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha')])
    expect(await headerText(ui, 'active')).toMatch(/[⌃⌄]$/)
    // the open chevron is ⌃ after the sort mark, the collapsed one is ⌄.
    expect(await headerText(ui, 'active')).toMatch(/─ ↕ ⌃$/)
    await press(ui, 'shelf:active')
    expect(await headerText(ui, 'active')).toMatch(/─ ⌄$/)
  })
  // the chevron points up when open and down when collapsed.
  test('A person opens or collapses a shelf (chevron up when open, down when collapsed)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a', { status: 'idle' }), S('b', { status: 'idle', cwd: '/q' })])
    expect(await headerText(ui, 'active')).toMatch(/⌃$/)
    await press(ui, 'shelf:active')
    expect(await headerText(ui, 'active')).toMatch(/⌄$/)
    await press(ui, 'shelf:active')
    expect(await headerText(ui, 'active')).toMatch(/⌃$/)
  })
  test('A person sees a collapsed shelf (count in brackets)', async ($, on) => {
    const sessions = Array.from({ length: 23 }, (_, i) => S(`done${i}`, { status: 'idle' }))
    const store = new Map<string, unknown>(sessions.map(s => [`pref:${idOf(s.name)}`, { isSettled: true }]))
    const { ui } = await mountPane($, on, sessions, { store })
    expect(await headerText(ui, 'settled')).toContain('Settled (23)')
  })
  test('A person sees an open shelf (no count)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a'), S('b'), S('c')])
    expect(await headerText(ui, 'active')).not.toContain('(')
  })
  test('A person presses a header (toggles open and closed)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a'), S('b')])
    await press(ui, 'shelf:active')
    expect((await orderOf(ui)).active ?? []).toEqual([])
    expect(await headerText(ui, 'active')).toMatch(/\(2\)/)
    await press(ui, 'shelf:active')
    expect((await orderOf(ui)).active).toEqual(refs('a', 'b').sort((x, y) => 0))
  })
  test('A person has no parked sessions (empty shelf not drawn)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a')])
    expect(await hasText(ui, /Parked/)).toBe(false)
  })
  test('A person scans the pane (one blank line between shelves)', async ($, on) => {
    const store = new Map<string, unknown>([[`pref:${idOf('p')}`, { isPinned: true }], SHELF_ON])
    const { ui } = await mountPane($, on, [S('p'), S('a'), S('w', { status: 'busy' })], { store })
    // phase 2: the blank line is the section's top margin, so it is counted on the sections.
    const sections = (await ui.findAll({ type: 'Box' })).filter((one: any) => (one.key ?? '').startsWith('section:'))
    expect(sections.length).toBe(3)
    expect(sections.filter((one: any) => one.props.marginTop === 1).length).toBe(2)
    expect(sections[0]!.props.marginTop ?? 0).toBe(0)
  })
  test('First use (default open and collapsed set)', async ($, on) => {
    const prefs = (key: string) => new Map<string, unknown>([[`pref:${idOf(key)}`, key === 'pin' ? { isPinned: true } : key === 'snz' ? { snoozedUntil: TUE_10 + 5 * HOUR } : key === 'prk' ? { isParked: true } : key === 'stl' ? { isSettled: true } : {}]])
    const store = new Map<string, unknown>([...prefs('pin'), ...prefs('snz'), ...prefs('prk'), ...prefs('stl'), SHELF_ON])
    const { ui } = await mountPane($, on, [S('pin'), S('act', { status: 'waiting' }), S('wrk', { status: 'busy' }), S('ina', { ageMs: 7 * HOUR }), S('snz'), S('prk'), S('stl')], { store })
    const order = await orderOf(ui)
    for (const open of ['pinned', 'active', 'working']) expect(order[open]?.length).toBe(1)
    for (const closed of ['inactive', 'snoozed', 'parked', 'settled']) { expect(order[closed] ?? []).toEqual([]); expect(await headerText(ui, closed)).toMatch(/\(1\)/) }
  })
})

// ---------------------------------------------------------------- 2. Cards
describe('2. cards', () => {
  test('A person reads line 1 (project name first)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { cwd: '/p/kiosk-web' })])
    expect(await rowText(ui, 'alpha')).toMatch(/^K  kiosk-web/) // the icon, then one space, then the project
  })
  test('A person reads line 1 (status slot right-aligned)', async ($, on) => {
    for (const cols of [44, 70]) {
      const { ui } = await mountPane($, on, [S('alpha', { status: 'waiting' })], {}, cols)
      const first = (await rowText(ui, 'alpha')).split('\n')[0]!
      expect(first).toMatch(/Needs you\u00a0\ue0b4\s*$/)
      // line 1, icon included, fills the pane exactly.
      expect(cellWidth(first)).toBe(cols - 2)
    }
  })
  test('A person reads line 2 (title in normal text colour)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { title: 'Fix the login bug' })])
    expect(await rowText(ui, 'alpha')).toContain('Fix the login bug')
    const title = (await ui.findAll({ type: 'Text' })).find((one: any) => one.text.includes('Fix the login bug'))
    expect(title?.props.dimColor).not.toBe(true)
  })
  test('A person reads line 3 (branch mark and branch, muted)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { branch: 'main' })])
    expect((await rowText(ui, 'alpha')).split('\n')[2]).toMatch(/^\s*\S\s*main/)
    const branch = (await ui.findAll({ type: 'Text' })).find((one: any) => /main/.test(one.text))
    expect(branch?.props.dimColor).toBe(true)
  })
  test('A person reads line 3 (details after the branch when they fit)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { branch: 'main', ctx: 40 })], {}, 70)
    expect((await rowText(ui, 'alpha')).split('\n')[2]).toMatch(/main.*40%/)
  })
  test('A person reads details (order: child badge, model, PR number, context %)', async ($, on) => {
    const world: World = { agents: [AGENT('s1', 'running', 'Scan')], ghCalls: [] }
    // phase 2: the model comes from the transcript's model field; the PR lookup's first run is 60 s after start.
    const { ui, clock } = await mountPane($, on, [S('alpha', { branch: 'feat', ctx: 40, model: 'claude-opus-5-5' })], world, 90)
    await clock.advance(61_000); await ui.advance(61_000)
    expect((await rowText(ui, 'alpha')).split('\n')[2]).toMatch(/●.*(opus|sonnet|haiku).*PR #42.*40%/i)
  })
  test('A person narrows the pane (details drop from the end; the branch drops last)', async ($, on) => {
    const world: World = { agents: [AGENT('s1', 'running', 'Scan')] }
    let last = ''
    for (const cols of [90, 70, 56, 44, 34, 24, 18, 12]) {
      const { ui } = await mountPane($, on, [S('alpha', { branch: 'feat', ctx: 40 })], world, cols)
      const line = (await rowText(ui, 'alpha')).split('\n')[2] ?? ''
      if (/feat/.test(last) === false && last !== '') expect(line).not.toMatch(/feat/)
      if (/feat/.test(line)) { expect(line).toBeDefined() } else { expect(line).not.toMatch(/40%|PR #42/) }
      last = line
    }
  })
  test('A person has a long title (no wrap; ellipsis)', async ($, on) => {
    const long = 'x'.repeat(200)
    for (const cols of [30, 44, 110]) {
      const { ui } = await mountPane($, on, [S('alpha', { title: long, branch: long })], {}, cols)
      const text = await rowText(ui, 'alpha')
      expect(widest(text)).toBeLessThanOrEqual(cols)
      expect(text).toContain('…')
    }
  })
  test('A person opens a non-git folder (no branch mark, no branch)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { branch: null })])
    const line3 = (await rowText(ui, 'alpha')).split('\n')[2] ?? ''
    expect(line3).not.toMatch(/main/)
    expect(line3).not.toMatch(/^\s*\S\s*$/)
  })
  test('A person has a generated title (generated title shown)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { title: 'Generated', prompt: 'last prompt' })])
    expect(await rowText(ui, 'alpha')).toContain('Generated')
  })
  test('A person has no generated title (falls back to the last prompt)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { prompt: 'last prompt' })])
    expect(await rowText(ui, 'alpha')).toContain('last prompt')
  })
  test('A person has neither (falls back to the session name)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha')])
    expect((await rowText(ui, 'alpha')).split('\n')[1]).toContain('alpha')
  })
  test('A person has working sessions (working card is one line)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { status: 'busy', title: 'T' })], shelfOn())
    const text = await rowText(ui, 'alpha')
    expect(text.split('\n').length).toBe(1)
    expect(text).toMatch(/Working/)
  })
  test('Session in another terminal app (card dimmed)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine'), S('other', { app: 'tmux' })])
    expect((await ui.find({ key: `open:${refOf('other')}` }))?.props.dimColor).toBe(true)
    expect((await ui.find({ key: `open:${refOf('mine')}` }))?.props.dimColor).not.toBe(true)
  })
  test('Session in another terminal app (app name on line 1; the status slot keeps the right edge)', async ($, on) => {
    const wide = await mountPane($, on, [S('mine'), S('other', { app: 'tmux', status: 'waiting' })], {}, 70)
    expect((await rowText(wide.ui, 'other')).split('\n')[0]).toMatch(/^(?!.*tmux).*Needs you\u00a0\ue0b4\s*$/)
    const narrow = await mountPane($, on, [S('mine'), S('other', { app: 'tmux', status: 'waiting' })], {}, 26) // the icon no longer narrows line 1 at 30
    const line = (await rowText(narrow.ui, 'other')).split('\n')[0]!
    expect(line).not.toMatch(/tmux/)
    expect(line).toMatch(/Needs you\u00a0\ue0b4\s*$/)
  })
})

// the Working shelf is a setting, off by default.
describe('1b. working shelf setting', () => {
  // the setting is `/bridge working-shelf on|off`; the pane has no settings rows.
  test('"/bridge working-shelf on|off" sets the Working shelf, off by default, persisted under setting:workingShelf', async ($, on) => {
    const { ui, store } = await mountPane($, on, [S('mine'), S('w', { status: 'busy' })])
    expect(await ui.find({ key: 'setting:workingShelf' })).toBeUndefined()
    expect(await ui.find({ key: 'shelf:working' })).toBeUndefined()
    expect(await paneCommand($, 'working-shelf on')).toMatchObject({ text: 'Working shelf: on' })
    expect(store.get('setting:workingShelf')).toBe(true)
    expect((await orderOf(ui)).working).toEqual(refs('w'))
    const restarted = await mountPane($, on, [S('mine'), S('w', { status: 'busy' })], { store })
    expect((await orderOf(restarted.ui)).working).toEqual(refs('w'))
    expect(await paneCommand($, 'working-shelf off')).toMatchObject({ text: 'Working shelf: off' })
    expect(store.get('setting:workingShelf')).toBe(false)
    expect((await orderOf(restarted.ui)).active).toContain(refOf('w'))
  })
  test('"/bridge glyphs auto|nerd|plain" persists the override; plain keeps capped pills readable', async ($, on) => {
    const { ui, store } = await mountPane($, on, [S('alpha', { status: 'waiting' })])
    expect(await paneCommand($, 'glyphs plain')).toMatchObject({ text: 'Glyphs: plain' })
    expect(store.get('setting:glyphs')).toBe('plain')
    expect(await rowText(ui, 'alpha')).toMatch(/▐[!\u00a0]+Needs you\u00a0▌/)
  })
  // an unknown argument changes nothing and names the forms.
  test('"/bridge" with an unknown argument (error naming the forms; nothing stored)', async ($, on) => {
    const { store } = await mountPane($, on, [S('mine')])
    const before = [...store.entries()]
    expect(await paneCommand($, 'icons maybe')).toMatchObject({ text: `Unknown setting. Use: /bridge ${PANE_ARGS_HINT}` })
    expect([...store.entries()]).toEqual(before)
  })
  test('With the setting off, a working session is a full Active card with the Working slot', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine'), S('w', { status: 'busy', sinceMs: 5 * MIN, branch: 'main' })])
    const order = await orderOf(ui)
    expect(order.working).toBeUndefined()
    expect(order.active).toContain(refOf('w'))
    const lines = (await rowText(ui, 'w')).split('\n')
    expect(lines.length).toBe(3)
    expect(lines[0]).toMatch(/^W  w\s.*Working 5m$/)
    expect(await iconKindOf(ui, 'w')).toBe('monogram')
    expect(await ui.find({ key: `spin:${refOf('w')}` })).toBeDefined()
  })
  test('The own full Active card animates its spinner on the selected fill', async ($, on) => {
    const { ui, clock, world } = await mountPane($, on, [S('mine', { status: 'busy' })], { blits: [] })
    expect((await orderOf(ui)).active).toEqual(refs('mine'))
    expect(await ui.find({ key: 'scene' })).toBeUndefined()
    for (let i = 0; i < 3; i++) { await clock.advance(250); await ui.advance(250) }
    const sent = blitsOf(world, `spin:${refOf('mine')}`).map(one => one.cells)
    expect(new Set(sent).size).toBeGreaterThan(1)
    const onFill = new Set(Object.values(PALETTES).flatMap(shade => Array.from({ length: 10 }, (_, f) => spinnerCells(f, shade.text.yellow, hexToColor(snapToRasterGrid(shade.fill))))))
    for (const cells of sent) expect(onFill.has(cells)).toBe(true)
  })
})

// ---------------------------------------------------------------- 3. Status slot
describe('3. status slot', () => {
  test('Session is working (animated spinner)', async ($, on) => {
    // phase 2: the spinner animates by blit, so the frames are read from the blits it sends.
    const { ui, clock, world } = await mountPane($, on, [S('alpha', { status: 'busy' })], { blits: [] })
    expect(await ui.find({ key: `spin:${refOf('alpha')}` })).toBeDefined()
    for (let i = 0; i < 3; i++) { await clock.advance(250); await ui.advance(250) }
    expect(new Set(blitsOf(world, `spin:${refOf('alpha')}`).map(one => one.cells)).size).toBeGreaterThan(1)
  })
  test('Session is working ("Working" with muted elapsed time)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { status: 'busy', sinceMs: 5 * MIN })])
    expect(await rowText(ui, 'alpha')).toMatch(/Working 5m/)
  })
  // the registry rewrites its status time while the word stays `busy`; the age still grows.
  test('D4 A working card whose registry rewrites its status time keeps counting from when it started working', async ($, on) => {
    const sessions = [S('mine', { status: 'busy', sinceMs: 0 })]
    const { ui, clock } = await mountPane($, on, sessions)
    for (let i = 1; i <= 36; i++) {
      sessions[0]!.sinceMs = -i * 5000
      await clock.advance(5000); await ui.advance(5000)
    }
    expect(await rowText(ui, 'mine')).toMatch(/Working 3m/)
    sessions[0]!.status = 'idle'
    sessions[0]!.sinceMs = -37 * 5000
    await clock.advance(5000); await ui.advance(5000)
    expect(await rowText(ui, 'mine')).not.toMatch(/Working/)
  })
  test('Session needs me (filled pill "Needs you" with bell)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { status: 'waiting' })])
    expect(await rowText(ui, 'alpha')).toMatch(/\ue0b6(?:\uf0f3|\u00a0)+Needs you\u00a0\ue0b4/)
  })
  test('Pane is shown with a needs-you card (bell shakes sideways once per 4 s without moving the word)', async ($, on) => {
    const { ui, clock } = await mountPane($, on, [S('alpha', { status: 'waiting' })])
    const seen: string[] = []
    for (let s = 0; s < 4; s++) { seen.push((await rowText(ui, 'alpha')).split('\n')[0]!); await clock.advance(200); await ui.advance(200) }
    const changes = seen.filter((one, i) => i > 0 && one !== seen[i - 1]).length
    expect(changes).toBe(3)
    expect(new Set(seen.map(one => cellWidth(one))).size).toBe(1)
    expect(new Set(seen.map(one => one.indexOf('Needs you'))).size).toBe(1)
  })
  // the needs-you reason is not drawn; line 3 leads with the branch.
  test('Needs-you card line 3 (no reason; the branch at the left)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { status: 'waiting', reason: 'permission prompt', branch: 'main' })], {}, 70)
    expect((await rowText(ui, 'alpha')).split('\n')[2]).toMatch(/^⎇ main\s*$/)
    expect(await rowText(ui, 'alpha')).not.toContain('permission prompt')
  })
  // with no reason, nothing stands in for it.
  test('Needs-you with no reason (no "input needed" fallback)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { status: 'waiting', branch: 'main' })], {}, 70)
    expect((await rowText(ui, 'alpha')).split('\n')[2]).toMatch(/^⎇ main\s*$/)
    expect(await rowText(ui, 'alpha')).not.toContain('input needed')
  })
  test('Session finished unseen (gray "Done" pill with check)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { status: 'completed' })])
    expect(await rowText(ui, 'alpha')).toMatch(/✓\s*Done|Done\s*✓/)
  })
  test('Idle session (age labels, rounding down)', async ($, on) => {
    const cases: [number, string][] = [[0, 'now'], [59_000, 'now'], [MIN, '1m'], [HOUR - 1000, '59m'], [HOUR, '1h'], [DAY - MIN, '23h'], [DAY, '1d'], [13 * DAY, '13d'], [14 * DAY, '2w'], [20 * DAY, '2w']]
    for (const [age, label] of cases) {
      const { ui } = await mountPane($, on, [S('alpha', { ageMs: age, sinceMs: age })])
      // phase 2: an idle card older than 6 h sits on the Inactive shelf, collapsed by default; open it to read the label.
      if (age >= 6 * HOUR) await press(ui, 'shelf:inactive')
      const first = (await rowText(ui, 'alpha')).split('\n')[0]!
      expect(first.trimEnd().endsWith(label)).toBe(true)
    }
  })
  test('Session changed status 5 min ago, pane just opened (timer counts from status entry)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('alpha', { status: 'busy', sinceMs: 5 * MIN, ageMs: 0 })])
    const text = await rowText(ui, 'alpha')
    expect(text).toMatch(/5m/)
    expect(text).not.toMatch(/Working now/)
  })
})

// ---------------------------------------------------------------- 4. Selected card and child rows
describe('4. selected card and child rows', () => {
  const OWN = (extra: Omit<Sess, 'name'> = {}) => S('own', extra)
  test('selected fill is pane-wide, content is inset one cell, and half-row edges frame the card', async ($, on) => {
    const fill = snapToRasterGrid(PALETTES.dark.fill)
    for (const [cols, glyphs] of [[44, 'plain'], [44, 'nerd'], [12, 'plain'], [12, 'nerd']] as const) {
      const store = new Map<string, unknown>([['setting:glyphs', glyphs]])
      const { ui } = await mountPane($, on, [OWN({ status: 'waiting' }), S('other')], { store }, cols)
      const own = refOf('own')
      const top = await ui.find({ key: `card-top:${own}` })
      const bottom = await ui.find({ key: `card-bottom:${own}` })
      for (const [row, glyph] of [[top, '\u2584'], [bottom, '\u2580']] as const) {
        expect(row?.props.width).toBe(cols)
        expect(row?.props.backgroundColor).toBeUndefined()
        expect(row?.text).toBe(glyph.repeat(cols))
        expect((await ui.find({ key: row!.key }))?.props.width).toBe(cols)
      }
      expect((await ui.findAll({ color: fill })).map((one: any) => one.text)).toEqual(expect.arrayContaining(['\u2584'.repeat(cols), '\u2580'.repeat(cols)]))
      expect((await ui.find({ key: `row:${own}` }))?.props.width).toBe(cols)
      expect((await ui.find({ key: `row:${own}` }))?.props.backgroundColor).toBe(fill)
      expect((await ui.find({ key: `header:active` }))?.props.width).toBe(cols)
      expect((await linesById(ui, own)).split('\n')).toHaveLength(3)
      for (const line of (await linesById(ui, own)).split('\n')) expect([...line].length).toBe(Math.max(0, cols - 2))
      // An unselected card has no edge rows and no fill.
      expect(await ui.find({ key: `card-top:${refOf('other')}` })).toBeUndefined()
      expect(await ui.find({ key: `card-bottom:${refOf('other')}` })).toBeUndefined()
      expect((await ui.find({ key: `row:${refOf('other')}` }))?.props.backgroundColor).toBeUndefined()
      const empty = await mountPane($, on, [], {}, cols)
      expect((await empty.ui.find({ key: 'scene-caption' }))?.props.width).toBe(cols)
      if (cols >= 30) expect((await empty.ui.find({ key: 'scene-row' }))?.props.width).toBe(cols)
    }
  })
  test('unselected full cards are three rows with one blank row between; the selected edges take the gap rows', async ($, on) => {
    // own (selected) first: ▄ above it with no gap row; the ▀ row stands in for the gap before the next card.
    const first = await mountPane($, on, [OWN({ ageMs: 0 }), S('other', { ageMs: MIN }), S('third', { ageMs: 2 * MIN })])
    const marginOf = async (ui: any, id: string) => (await ui.find({ key: `card:${refOf(id)}` }))?.props.marginTop ?? 0
    expect(await marginOf(first.ui, 'own')).toBe(0)
    expect(await marginOf(first.ui, 'other')).toBe(0)
    expect(await marginOf(first.ui, 'third')).toBe(1)
    for (const id of ['other', 'third']) expect((await linesById(first.ui, refOf(id))).split('\n')).toHaveLength(3)
    // own in the middle: ▄ replaces its own gap, ▀ replaces the next card's.
    const middle = await mountPane($, on, [S('other', { ageMs: 0 }), OWN({ ageMs: MIN }), S('third', { ageMs: 2 * MIN })], { selfName: 'own' })
    expect(await marginOf(middle.ui, 'other')).toBe(0)
    expect(await marginOf(middle.ui, 'own')).toBe(0)
    expect(await marginOf(middle.ui, 'third')).toBe(0)
    const order = (await middle.ui.findAll({})).map((one: any) => one.key).filter(Boolean)
    const at = (key: string) => order.indexOf(key)
    expect(at(`row:${refOf('other')}`)).toBeLessThan(at(`card-top:${refOf('own')}`))
    expect(at(`card-top:${refOf('own')}`)).toBeLessThan(at(`row:${refOf('own')}`))
    expect(at(`row:${refOf('own')}`)).toBeLessThan(at(`card-bottom:${refOf('own')}`))
    expect(at(`card-bottom:${refOf('own')}`)).toBeLessThan(at(`row:${refOf('third')}`))
  })
  test('with child rows the ▀ row comes first, the children follow it unfilled, and the next card keeps its gap', async ($, on) => {
    const { ui } = await mountPane($, on, [OWN(), S('other')], { agents: [AGENT('a1', 'running', 'Scan')] })
    const own = refOf('own')
    const order = (await ui.findAll({})).map((one: any) => one.key).filter(Boolean)
    expect(order.indexOf(`card-bottom:${own}`)).toBeLessThan(order.indexOf('child:a1'))
    expect(order.indexOf('child:a1')).toBeLessThan(order.indexOf(`row:${refOf('other')}`))
    expect((await ui.find({ key: 'child:a1' }))?.props.width).toBe(44)
    expect((await ui.find({ key: 'child:a1' }))?.props.backgroundColor).toBeUndefined()
    expect((await ui.find({ key: `card:${refOf('other')}` }))?.props.marginTop).toBe(1)
  })
  // the first frame of a child-row spinner matches its blits: the row background, not the card fill.
  test('F7 a Working child row under the selected own card draws its first spinner frame off the selected fill', async ($, on) => {
    const { ui } = await mountPane($, on, [OWN()], { agents: [AGENT('a1', 'running', 'Scan')] })
    const spin = await ui.find({ key: 'spin:a1' })
    expect(spin).toBeDefined()
    const onFill = new Set(Object.values(PALETTES).flatMap(shade => Array.from({ length: 10 }, (_, f) => spinnerCells(f, shade.text.yellow, hexToColor(snapToRasterGrid(shade.fill))))))
    const offFill = new Set(Object.values(PALETTES).flatMap(shade => Array.from({ length: 10 }, (_, f) => spinnerCells(f, shade.text.yellow, 0x01000000))))
    expect(onFill.has(spin!.props.cells)).toBe(false)
    expect(offFill.has(spin!.props.cells)).toBe(true)
  })
  test('compact Working cards keep their one-line form', async ($, on) => {
    const { ui } = await mountPane($, on, [OWN({ status: 'busy' })], { store: new Map<string, unknown>([SHELF_ON]) })
    const own = refOf('own')
    expect(await ui.find({ key: `card-top:${own}` })).toBeUndefined()
    expect(await ui.find({ key: `card-bottom:${own}` })).toBeUndefined()
    expect((await linesById(ui, own)).split('\n')).toHaveLength(1)
  })
  test('Own session has subagents (child rows indented behind a vertical rule)', async ($, on) => {
    const { ui } = await mountPane($, on, [OWN()], { agents: [AGENT('a1', 'running', 'Scan'), AGENT('a2', 'running', 'Read')] })
    const kids = await ui.findAll({ key: 'view:a1' })
    expect(kids[0]?.text).toMatch(/^\s+[│┃|]/)
  })
  test('Reading a child row (dot and description)', async ($, on) => {
    const { ui } = await mountPane($, on, [OWN()], { agents: [AGENT('a1', 'running', 'Scan repo')] })
    expect((await ui.find({ key: 'view:a1' }))?.text).toMatch(/●.*Scan repo/)
  })
  test('Reading a child row (card status word and time in state)', async ($, on) => {
    const { ui } = await mountPane($, on, [OWN()], { agents: [AGENT('a1', 'running', 'Scan', { statusSince: TUE_10 - 2 * MIN })] })
    expect((await ui.find({ key: 'child:a1' }))?.text).toMatch(/Working.*2m/)
  })
  test('Reading states (the card status words and look)', async ($, on) => {
    const states: [string, string][] = [['running', 'Working'], ['waiting', 'Working'], ['completed', 'Done'], ['failed', 'Failed'], ['killed', '']]
    const { ui } = await mountPane($, on, [OWN()], { agents: states.map(([s], i) => AGENT(`k${i}`, s, `d${i}`)) })
    const text = (await Promise.all(states.map((_, i) => ui.find({ key: `child:k${i}` })))).map(row => row?.text ?? '')
    expect(text[0]).toMatch(/Working/)
    expect(text[1]).toMatch(/Working/)
    expect(text[2]).toMatch(/Done/)
    expect(text[3]).toMatch(/Failed/)
    expect(text[4]).not.toMatch(/Working|Done|Failed/)
    expect((await ui.find({ key: 'child:k1' }))?.props.backgroundColor).toBeFalsy()
  })
  test('Own card line 3 (one dot per subagent, up to 3)', async ($, on) => {
    const { ui } = await mountPane($, on, [OWN()], { agents: [AGENT('a1', 'running', 'A'), AGENT('a2', 'running', 'B')] }, 70)
    expect((await rowText(ui, 'own')).split('\n')[2]).toMatch(/●●(?!●)/)
  })
  test('Own card line 3 (dots are followed by the total count)', async ($, on) => {
    const agents = Array.from({ length: 7 }, (_, i) => AGENT(`a${i}`, 'running', `d${i}`))
    const { ui } = await mountPane($, on, [OWN()], { agents }, 70)
    expect((await rowText(ui, 'own')).split('\n')[2]).toContain('●●● 7')
  })
  test('Own session with 8 agents (max 5 rows plus "+3 more")', async ($, on) => {
    for (const [count, more] of [[5, null], [6, '+1 more'], [8, '+3 more']] as const) {
      const agents = Array.from({ length: count }, (_, i) => AGENT(`a${i}`, 'running', `d${i}`))
      const { ui } = await mountPane($, on, [OWN()], { agents })
      expect((await ui.findAll({})).filter((one: any) => (one.key ?? '').startsWith('view:')).length).toBe(Math.min(count, 5))
      if (more) expect(await hasText(ui, more)).toBe(true)
      else expect(await hasText(ui, /more/)).toBe(false)
    }
  })
  test('Other session cards (no child rows, no badge)', async ($, on) => {
    const { ui } = await mountPane($, on, [OWN(), S('other')], { agents: [AGENT('a1', 'running', 'Scan')] })
    expect((await rowText(ui, 'other')).split('\n')[2] ?? '').not.toMatch(/●/)
    expect((await ui.findAll({})).filter((one: any) => (one.key ?? '').startsWith('view:')).length).toBe(1)
  })
})
todo('A person finds own card (filled background on all its lines) -- layer G/U: needs real colour capture and theme luminance table')
todo('Other cards (no background fill) -- layer G: live-Ghostty capture')

// ---------------------------------------------------------------- 5. Colours
// phase 2: Known Gap blocker 1 -- the colour rows assert the palette's hex values (core/palette.ts PALETTES).
describe('5. colours', () => {
  const textColorOf = async (ui: Ui, text: string | RegExp) =>
    (await ui.findAll({ type: 'Text' })).find((one: any) => (typeof text === 'string' ? one.text === text : text.test(one.text)))?.props.color as string | undefined
  // the project colour is on the monogram; the project name is muted.
  test('Project colour (stable per project on the monogram, the same in every pane and after a restart)', async ($, on) => {
    const sessions = [S('a', { cwd: '/p/alpha' }), S('b', { cwd: '/p/beta' })]
    const monoColorOf = async (ui: Ui, letter: string) => (await ui.findAll({ type: 'Text' })).find((one: any) => one.text === `${letter} `)?.props.backgroundColor as string | undefined
    const first = await mountPane($, on, sessions, { selfName: 'zz' })
    const want = projectColorsOf(['alpha', 'beta'], 'dark')
    expect(await monoColorOf(first.ui, 'A')).toBe(want.get('alpha'))
    expect(await monoColorOf(first.ui, 'B')).toBe(want.get('beta'))
    expect(want.get('alpha')).not.toBe(want.get('beta'))
    for (const name of [/^alpha$/, /^beta$/]) { // the name is muted, never coloured
      const text = (await first.ui.findAll({ type: 'Text' })).find((one: any) => name.test(one.text))
      expect(text?.props.dimColor).toBe(true)
      expect(text?.props.color).toBeUndefined()
    }
    const second = await mountPane($, on, [...sessions].reverse(), { selfName: 'zz' })
    expect(await monoColorOf(second.ui, 'A')).toBe(want.get('alpha'))
  })
  // the reason is no longer drawn; the needs-you pill carries the red.
  test('Status hues (the drawn Working and needs-you pill colours are the token hex values)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('w', { status: 'busy' }), S('n', { status: 'waiting', reason: 'asks' })], { selfName: 'zz' }, 70)
    expect(await textColorOf(ui, ' Working')).toBe(PALETTES.dark.text.yellow)
    expect(await textColorOf(ui, /Needs you/)).toBe(PALETTES.dark.pill.red.fg)
    expect(PALETTES.dark.text.yellow).toMatch(/^#[0-9a-f]{6}$/)
  })
  test('Dark Claude theme (dark set)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('w', { status: 'busy' })], { selfName: 'zz', theme: 'dark' })
    expect(await textColorOf(ui, ' Working')).toBe(PALETTES.dark.text.yellow)
  })
  test('Light Claude theme (light set)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('w', { status: 'busy' })], { selfName: 'zz', theme: 'light-daltonized' })
    expect(await textColorOf(ui, ' Working')).toBe(PALETTES.light.text.yellow)
    expect(PALETTES.light.text.yellow).not.toBe(PALETTES.dark.text.yellow)
  })
  test('Theme unreadable (dark; the Theme setting overrides)', async ($, on) => {
    const plain = await mountPane($, on, [S('w', { status: 'busy' })], { selfName: 'zz' })
    expect(await textColorOf(plain.ui, ' Working')).toBe(PALETTES.dark.text.yellow)
    const store = new Map<string, unknown>([['setting:theme', 'light']])
    const set = await mountPane($, on, [S('w', { status: 'busy' })], { selfName: 'zz', store, theme: 'dark' })
    expect(await textColorOf(set.ui, ' Working')).toBe(PALETTES.light.text.yellow)
    expect(themeModeOf(undefined, 'auto')).toBe('dark')
  })
  // the Theme setting is `/bridge theme auto|light|dark`, not a footer row.
  test('"/bridge theme light|dark|auto" (stores setting:theme and redraws in that set)', async ($, on) => {
    const { ui, store } = await mountPane($, on, [S('w', { status: 'busy' })], { selfName: 'zz', theme: 'dark' })
    expect(await ui.find({ key: 'setting:theme' })).toBeUndefined()
    expect(await textColorOf(ui, ' Working')).toBe(PALETTES.dark.text.yellow)
    expect(await paneCommand($, 'theme light')).toMatchObject({ text: 'Theme: light' })
    expect(store.get('setting:theme')).toBe('light')
    expect(await textColorOf(ui, ' Working')).toBe(PALETTES.light.text.yellow)
    expect(await paneCommand($, 'THEME Auto')).toMatchObject({ text: 'Theme: auto' })
    expect(store.get('setting:theme')).toBe('auto')
    expect(await textColorOf(ui, ' Working')).toBe(PALETTES.dark.text.yellow)
  })
  // The selected card's half-row edges (runs of ▄ or ▀) are fill-coloured decoration, not text, so they are skipped below.
  test('Contrast (every drawn colour reaches 4.5:1 on the pane background and the own-card fill)', async ($, on) => {
    for (const theme of ['dark', 'light'] as const) {
      const shade = PALETTES[theme]
      const { ui } = await mountPane($, on, [S('mine', { branch: 'main', ctx: 90 }), S('w', { status: 'busy', cwd: '/p/zeta' }), S('n', { status: 'waiting', cwd: '/p/kappa' })], { theme, agents: [AGENT('a1', 'running', 'A'), AGENT('a2', 'waiting', 'B')] }, 70)
      const colors: string[] = (await ui.findAll({ type: 'Text' })).filter((one: any) => !['\ue0b6', '\ue0b4', '▐', '▌'].includes(one.text) && !/^[▄▀]+$/.test(one.text)).map((one: any) => one.props.color as string | undefined).filter((one: string | undefined): one is string => /^#/.test(one ?? ''))
      expect(colors.length).toBeGreaterThan(3)
      for (const color of new Set(colors)) {
        const against = (await ui.findAll({ type: 'Text' })).find((one: any) => one.props.color === color)?.props.backgroundColor as string | undefined
        if (against) expect(contrastRatio(color, against)).toBeGreaterThanOrEqual(4.5)
        else for (const bg of [shade.bg, shade.fill]) expect(contrastRatio(color, bg)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  test('Plain and muted text (no colour on plain text; muted text is dimColor only)', async ($, on) => {
    // an Idle title is muted, so the plain title is read from a needs-you card.
    const { ui } = await mountPane($, on, [S('alpha', { status: 'waiting', title: 'Plain title', branch: 'main' }), S('beta', { title: 'Muted title', cwd: '/q' })], { selfName: 'zz' })
    const title = (await ui.findAll({ type: 'Text' })).find((one: any) => one.text === 'Plain title')
    expect(title).toBeDefined()
    expect(title?.props.color).toBeUndefined()
    expect(title?.props.dimColor).not.toBe(true)
    const muted = (await ui.findAll({ type: 'Text' })).find((one: any) => one.text === 'Muted title')
    expect(muted?.props.dimColor).toBe(true)
    expect(muted?.props.color).toBeUndefined()
    const branch = (await ui.findAll({ type: 'Text' })).find((one: any) => one.text === '⎇ main')
    expect(branch?.props.dimColor).toBe(true)
    expect(branch?.props.color).toBeUndefined()
  })
})

// ---------------------------------------------------------------- 6. Project icons and empty states
// the per-card creature became the project icon.
describe('6. project icons and empty states', () => {
  test('A person sees full cards (icon 2x1, one space, the project; lines 2 and 3 at the left edge)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine'), S('alpha', { title: 'Fix it' })])
    const lines = (await rowText(ui, 'alpha')).split('\n')
    expect(lines.length).toBe(3)
    expect(lines[0]).toMatch(/^A  alpha/)
    expect(lines[1]).toMatch(/^Fix it/)
    expect(lines[2]).toMatch(/^⎇ main/)
    for (const line of lines) expect(cellWidth(line)).toBe(42)
    const mono = await ui.find({ key: `monogram:${refOf('alpha')}` })
    expect(mono?.text).toBe('A ')
  })
  test('The project picture, found from the candidate files, drawn where the terminal draws pictures', async ($, on) => {
    const world = withFiles({ '/p/alpha/favicon.png': 1000, '/p/alpha/icon.svg': 2000 })
    const { ui } = await mountPane($, on, [S('mine'), S('alpha')], world)
    const image = await ui.find({ key: `icon:${refOf('alpha')}` })
    expect([image?.props.columns, image?.props.rows, image?.props.alt, image?.props.source.format]).toEqual([2, 1, 'A', 'png'])
    expect(image?.props.source.file).toMatch(/^\/h\/\.claude\/bridge\/icons\/[0-9a-f]{8}\.png$/)
    // favicon.png comes before icon.svg in the candidate order; one conversion, into the cache.
    expect(world.converts!.map(one => one[1])).toEqual(['/p/alpha/favicon.png'])
    // The Image has no text in the harness: line 1 reads its gap, then the project.
    expect((await rowText(ui, 'alpha')).split('\n')[0]).toMatch(/^ alpha/)
  })
  test('A cached picture is used as is, and a project is looked up at most once per 10 minutes', async ($, on) => {
    const world = withFiles({ '/p/alpha/favicon.png': 1000 })
    const { ui, clock } = await mountPane($, on, [S('alpha')], world)
    const file = (await ui.find({ key: `icon:${refOf('alpha')}` }))?.props.source.file as string
    world.files![file] = 1
    for (let i = 0; i < 6; i++) { await clock.advance(MIN); await ui.advance(MIN) }
    expect(world.converts!.length).toBe(1)
    const again = await mountPane($, on, [S('alpha')], world)
    expect((await again.ui.find({ key: `icon:${refOf('alpha')}` }))?.props.source.file).toBe(file)
    expect(world.converts!.length).toBe(1)
  })
  // the monogram carries the project colour; the project name is muted.
  test('No picture, or a terminal without pictures: the monogram on the project colour', async ($, on) => {
    const none = await mountPane($, on, [S('mine'), S('plugin-tasks')], withFiles({}))
    const mono = await none.ui.find({ key: `monogram:${refOf('plugin-tasks')}` })
    expect(mono?.text).toBe('T ')
    const letter = (await none.ui.findAll({ type: 'Text' })).find((one: any) => one.text === 'T ')
    expect(letter?.props.bold).toBe(true)
    expect(letter?.props.backgroundColor).toMatch(/^#[0-9a-f]{6}$/)
    const project = (await none.ui.findAll({ type: 'Text' })).find((one: any) => one.text.startsWith('plugin-tasks'))
    expect(letter?.props.backgroundColor).toBe(projectColorsOf(['plugin-tasks'], 'dark').get('plugin-tasks'))
    expect(project?.props.dimColor).toBe(true)
    expect(project?.props.color).toBeUndefined()
    const plain = await mountPane($, on, [S('mine'), S('alpha')], withFiles({ '/p/alpha/favicon.png': 1000 }, { term: 'unknown' }))
    expect(await iconKindOf(plain.ui, 'alpha')).toBe('monogram')
  })
  test('Working shelf one-liners (the project icon before the project)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine'), S('w', { status: 'busy' })], shelfOn())
    const line = await rowText(ui, 'w')
    expect(line.split('\n').length).toBe(1)
    expect(line).toMatch(/^W  w /)
    expect(cellWidth(line)).toBe(41) // the one-cell spinner Raster has no text in the harness
    expect(await iconKindOf(ui, 'w')).toBe('monogram')
  })
  // the setting is `/bridge icons on|off`; the pane has no settings rows.
  test('"/bridge icons on|off" (project icons, default on, persisted under setting:icons)', async ($, on) => {
    const { ui, store } = await mountPane($, on, [S('mine'), S('alpha')])
    expect(await hasText(ui, /Show project icons/)).toBe(false)
    expect(await iconKindOf(ui, 'alpha')).toBe('monogram')
    expect(await paneCommand($, 'icons off')).toMatchObject({ text: 'Project icons: off' })
    expect(store.get('setting:icons')).toBe(false)
    expect(await iconKindOf(ui, 'alpha')).toBe('none')
    const restarted = await mountPane($, on, [S('mine'), S('alpha')], { store })
    expect(await iconKindOf(restarted.ui, 'alpha')).toBe('none')
    expect(await paneCommand($, 'Icons ON')).toMatchObject({ text: 'Project icons: on' })
    expect(store.get('setting:icons')).toBe(true)
    expect(await iconKindOf(restarted.ui, 'alpha')).toBe('monogram')
  })
  test('A person turns it off (no icon; the project starts at the left edge)', async ($, on) => {
    const store = new Map<string, unknown>([['setting:icons', false]])
    const { ui } = await mountPane($, on, [S('mine'), S('alpha', { title: 'abcdefghij'.repeat(5) })], { ...withFiles({ '/p/alpha/favicon.png': 1000 }), store })
    const lines = (await rowText(ui, 'alpha')).split('\n')
    expect(lines[0]).toMatch(/^alpha/)
    expect(lines[1]).toMatch(/^\S/)
    expect(await iconKindOf(ui, 'alpha')).toBe('none')
    expect([...lines[0]!].length).toBe(42)
  })
  test('A Done card (finished, not yet seen) has a bold title', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine'), S('d', { status: 'completed', title: 'Shipped it' }), S('i', { title: 'Resting' })])
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.find((one: any) => one.text.startsWith('Shipped it'))?.props.bold).toBe(true)
    expect(texts.find((one: any) => one.text.startsWith('Resting'))?.props.bold).not.toBe(true)
  })
  // bold on a Done, woken or own card; dim on an Idle card; plain on Working and Needs you.
  test('Title weights (bold Done, woken and own; dim Idle; plain Working and Needs you)', async ($, on) => {
    const store = new Map<string, unknown>([[`pref:${idOf('k')}`, { snoozedUntil: TUE_10 - MIN }]])
    const sessions = [
      S('mine', { title: 'Own title' }), S('d', { status: 'completed', title: 'Done title', cwd: '/p/d' }), S('k', { title: 'Woken title', cwd: '/p/k' }),
      S('i', { title: 'Idle title', cwd: '/p/i' }), S('w', { status: 'busy', title: 'Working title', cwd: '/p/w' }), S('n', { status: 'waiting', title: 'Needs title', cwd: '/p/n' }),
    ]
    const { ui } = await mountPane($, on, sessions, { store }, 70)
    const texts = await ui.findAll({ type: 'Text' })
    const titleOf = (title: string) => texts.find((one: any) => one.text === title)?.props
    for (const title of ['Own title', 'Done title', 'Woken title']) {
      expect(titleOf(title)?.bold).toBe(true)
      expect(titleOf(title)?.dimColor).not.toBe(true)
    }
    expect(titleOf('Idle title')?.dimColor).toBe(true)
    expect(titleOf('Idle title')?.bold).not.toBe(true)
    for (const title of ['Working title', 'Needs title']) {
      expect(titleOf(title)).toBeDefined()
      expect(titleOf(title)?.bold).not.toBe(true)
      expect(titleOf(title)?.dimColor).not.toBe(true)
    }
  })
  // background tasks are live rows under the own card, not a `⟳ n` count.
  test('The own card lists its background tasks as rows and shows Background; no source, no rows', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine', { branch: 'feat' })])
    expect(await rowText(ui, 'mine')).not.toContain('Check?')
    await $.classic.Stop({ stop_hook_active: false } as never)
    await ui.advance(10)
    expect(await ui.find({ key: 'task:b1' })).toBeUndefined()
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'npm test', command: 'npm test' }, { id: 'b2', type: 'subagent', status: 'running', description: 'x' }, { id: 'b3', type: 'monitor', status: 'running', description: 'y' }] } as never)
    await ui.advance(10)
    expect(await rowText(ui, 'mine')).not.toContain('⟳')
    expect(await rowText(ui, 'mine')).toContain('Background')
    expect(await ui.find({ key: 'task:b1' })).toBeDefined()
    expect(await ui.find({ key: 'task:b3' })).toBeDefined()
    expect(await ui.find({ key: 'task:b2' })).toBeUndefined()
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
    await ui.advance(10)
    expect(await ui.find({ key: 'task:b1' })).toBeUndefined()
    expect(await rowText(ui, 'mine')).not.toMatch(/Background|Check\?/)
  })
  // a managed plugin can send classic.Stop past every installed plugin, so the
  // own background list comes from the tool calls that start a task and the notifications that end it.
  test('D1 Background work is tracked with no stop hook: Background once the turn ends while the registry still says busy', async ($, on) => {
    on('turn.start', ($s, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
    on('turn.complete', () => ({ text: '' }) as never)
    on('prompt.submit', ($s, e) => ({ text: (e as { text: string }).text }) as never)
    on('tool.call', { tool: 'Bash' }, ($s, e) => ({ result: { stdout: '', stderr: '', interrupted: false, ...((e as { command?: string }).command === 'sleep 240' ? { backgroundTaskId: 'bavp7cqri' } : {}) } }) as never)
    on('tool.call', { tool: 'Monitor' }, () => ({ result: { taskId: 'mon1', timeoutMs: 1000 } }) as never)
    const sessions = [S('mine', { status: 'busy', branch: 'feat' })]
    const { ui, clock } = await mountPane($, on, sessions)
    const refresh = async () => { await clock.advance(6000); await ui.advance(6000) }
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Bash', command: 'sleep 240', description: 'Wait four minutes', run_in_background: true } as never)
    await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
    await $.tool.call({ tool: 'Monitor', description: 'Watch the log', timeout_ms: 1000, agentId: 'a1' } as never)
    await refresh()
    expect(await rowText(ui, 'mine')).toMatch(/Working/)
    expect((await ui.find({ key: 'task:bavp7cqri' }))?.text).toMatch(/Command.*sleep 240/)
    expect(await ui.find({ key: 'task:mon1' })).toBeUndefined()
    await $.turn.complete({ answer: 'started', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await refresh()
    expect(await rowText(ui, 'mine')).toContain('Background')
    await clock.advance(15 * MIN); await ui.advance(15 * MIN)
    expect(await rowText(ui, 'mine')).toContain('Check?')
    await $.prompt.submit({ text: '<task-notification>\n<task-id>bavp7cqri</task-id>\n<status>completed</status>\n</task-notification>', origin: { kind: 'task-notification' }, wait: false } as never)
    await refresh()
    expect(await ui.find({ key: 'task:bavp7cqri' })).toBeUndefined()
    expect(await rowText(ui, 'mine')).not.toMatch(/Background|Check\?/)
  })
  // a managed plugin sends the classic Stop, StopFailure and UserPromptSubmit
  // hooks past every installed plugin, so Failed comes from the main loop's turn end and the person's prompt.
  // the tracker and a Stop snapshot together, TaskStop, /clear and an unseen end.
  const trackerHooks = (on: On) => {
    on('turn.start', ($s, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
    on('turn.complete', () => ({ text: '' }) as never)
    on('session.end', ($s, e) => ({ sessionId: (e as { sessionId: string }).sessionId }) as never)
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }) as never)
    on('tool.call', { tool: 'TaskStop' }, () => ({ result: { message: 'stopped' } }) as never)
  }
  const launch = async ($: any) => {
    await $.turn.start({ text: 'go', turnId: 't1' } as never)
    await $.tool.call({ tool: 'Bash', command: 'npm test', run_in_background: true } as never)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  }
  test('review: a Stop snapshot of a task the tool call already added keeps one row', async ($, on) => {
    trackerHooks(on)
    const { ui, clock } = await mountPane($, on, [S('mine', { status: 'busy' })])
    await launch($)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'npm test', command: 'npm test' }] } as never)
    await clock.advance(6000); await ui.advance(6000)
    expect(await ui.findAll({ key: 'task:b1' })).toHaveLength(1)
    expect(await rowText(ui, 'mine')).toContain('Background')
  })
  test('review: a second turn end with no turn start restarts the Check? silence clock', async ($, on) => {
    trackerHooks(on)
    const { ui, clock } = await mountPane($, on, [S('mine', { status: 'busy' })])
    await launch($)
    await clock.advance(20 * 60_000); await ui.advance(6000)
    expect(await rowText(ui, 'mine')).toContain('Check?')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.advance(6000); await ui.advance(6000)
    expect(await rowText(ui, 'mine')).toContain('Background')
    expect(await rowText(ui, 'mine')).not.toContain('Check?')
  })
  test('review: TaskStop ends the task its input names', async ($, on) => {
    trackerHooks(on)
    const { ui, clock } = await mountPane($, on, [S('mine', { status: 'busy' })])
    await launch($)
    await clock.advance(6000); await ui.advance(6000)
    expect(await ui.find({ key: 'task:b1' })).toBeDefined()
    await $.tool.call({ tool: 'TaskStop', task_id: 'b1' } as never)
    await clock.advance(6000); await ui.advance(6000)
    expect(await ui.find({ key: 'task:b1' })).toBeUndefined()
    expect(await rowText(ui, 'mine')).not.toMatch(/Background|Check\?/)
  })
  test('review: /clear drops the old conversation\'s tasks, Background and subagents', async ($, on) => {
    trackerHooks(on)
    const world: World = { agents: [AGENT('a1', 'completed', 'Scan')] }
    const { ui, clock } = await mountPane($, on, [S('mine', { status: 'busy' })], world)
    await launch($)
    await clock.advance(6000); await ui.advance(6000)
    expect(await rowText(ui, 'mine')).toContain('Background')
    expect(await ui.find({ key: 'view:a1' })).toBeDefined()
    world.agents = []
    await $.session.end({ reason: 'clear', sessionId: idOf('mine'), resume: { id: idOf('mine') } } as never)
    await clock.advance(6000); await ui.advance(6000)
    expect(await ui.find({ key: 'task:b1' })).toBeUndefined()
    expect(await ui.find({ key: 'view:a1' })).toBeUndefined()
    expect(await rowText(ui, 'mine')).not.toMatch(/Background|Check\?/)
  })
  test('review: an idle session with no turn running drops a task whose end went unseen', async ($, on) => {
    trackerHooks(on)
    const sessions = [S('mine', { status: 'busy' })]
    const { ui, clock } = await mountPane($, on, sessions)
    await launch($)
    await clock.advance(6000); await ui.advance(6000)
    expect(await rowText(ui, 'mine')).toContain('Background')
    sessions[0]!.status = 'idle'
    sessions[0]!.sinceMs = -10_000
    await clock.advance(6000); await ui.advance(6000)
    expect(await ui.find({ key: 'task:b1' })).toBeUndefined()
    expect(await rowText(ui, 'mine')).not.toMatch(/Background|Check\?/)
  })
  test('Failed with no classic hook: an API-error turn end marks it; an answered turn or the next prompt clears it', async ($, on) => {
    on('turn.start', ($s, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
    on('turn.complete', () => ({ text: '' }) as never)
    on('prompt.submit', ($s, e) => ({ text: (e as { text: string }).text }) as never)
    const { ui, clock } = await mountPane($, on, [S('mine', { branch: 'feat' })])
    const refresh = async () => { await clock.advance(6000); await ui.advance(6000) }
    const end = (turnId: string, reason: string, agentId?: string) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason, ...(agentId ? { agentId } : {}) } as never)
    await end('s1', 'error', 'a1')
    await refresh()
    expect(await rowText(ui, 'mine')).not.toContain('Failed')
    await end('t1', 'error')
    await refresh()
    expect(await rowText(ui, 'mine')).toContain('✕ Failed')
    await end('t2', 'answer')
    await refresh()
    expect(await rowText(ui, 'mine')).not.toContain('Failed')
    await end('t3', 'error')
    await refresh()
    expect(await rowText(ui, 'mine')).toContain('✕ Failed')
    await $.prompt.submit({ text: '<task-notification>\n<task-id>x</task-id>\n<status>completed</status>\n</task-notification>', origin: { kind: 'task-notification' }, wait: false } as never)
    await refresh()
    expect(await rowText(ui, 'mine')).toContain('✕ Failed')
    await $.prompt.submit({ text: 'try again', origin: { kind: 'composer' }, wait: false } as never)
    await refresh()
    expect(await rowText(ui, 'mine')).not.toContain('Failed')
  })
  test('An API failure in the own session shows Failed until a later turn stops well', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine', { branch: 'feat' })])
    await $.classic.StopFailure({ error: 'server_error' } as never)
    await ui.advance(10)
    expect(await rowText(ui, 'mine')).toContain('✕ Failed')
    await $.classic.Stop({ stop_hook_active: false } as never)
    await ui.advance(10)
    expect(await rowText(ui, 'mine')).not.toContain('Failed')
    // an interrupted turn has no Stop; the next prompt clears Failed.
    await $.classic.StopFailure({ error: 'server_error' } as never)
    await ui.advance(10)
    expect(await rowText(ui, 'mine')).toContain('✕ Failed')
    await $.classic.UserPromptSubmit({ prompt: 'again' } as never)
    await ui.advance(10)
    expect(await rowText(ui, 'mine')).not.toContain('Failed')
  })
  // the claim, a put-away card and a card that appears later are each tested.
  const chimes = (on: On) => {
    const played: unknown[] = []
    on('audio.play', ($p, e) => {
      played.push((e as { clip: unknown }).clip)
      return { value: undefined } as never
    })
    return played
  }
  const refreshTwice = async (clock: { advance: (ms: number) => Promise<unknown> }, ui: Ui) => {
    await clock.advance(6000); await ui.advance(6000)
  }
  test('A card that starts to need the person chimes once and claims it; the first refresh and sound off are silent', async ($, on) => {
    const played = chimes(on)
    const sessions = [S('mine'), S('other', { status: 'waiting' }), S('busy', { status: 'busy' })]
    const { clock, ui, store } = await mountPane($, on, sessions)
    expect(played).toEqual([])
    sessions[2]!.status = 'waiting'
    sessions[2]!.sinceMs = -1000
    await refreshTwice(clock, ui)
    expect(played).toHaveLength(1)
    expect(played[0]).toMatchObject({ mime: 'audio/wav' })
    expect(store.get(`chime:${idOf('busy')}`)).toBe(`needs-you@${TUE_10 + 1000}`)
    await refreshTwice(clock, ui)
    expect(played).toHaveLength(1)
    await $.command.run({ command: 'bridge', args: 'sound off' } as never)
    sessions[2]!.status = 'busy'
    await refreshTwice(clock, ui)
    sessions[2]!.status = 'waiting'
    sessions[2]!.sinceMs = -20_000
    await refreshTwice(clock, ui)
    expect(played).toHaveLength(1)
  })
  test('A change another session already claimed is silent', async ($, on) => {
    const played = chimes(on)
    const store = new Map<string, unknown>([[`chime:${idOf('busy')}`, `needs-you@${TUE_10 + 1000}`]])
    const sessions = [S('mine'), S('busy', { status: 'busy' })]
    const { clock, ui } = await mountPane($, on, sessions, { store })
    sessions[1]!.status = 'waiting'
    sessions[1]!.sinceMs = -1000
    await refreshTwice(clock, ui)
    expect(played).toEqual([])
  })
  test('A parked card that starts to need the person is silent', async ($, on) => {
    const played = chimes(on)
    // Idle while parked: a working session would already have returned from Parked.
    const store = new Map<string, unknown>([[`pref:${idOf('busy')}`, { isParked: true, parkedAt: TUE_10 - HOUR }]])
    const sessions = [S('mine'), S('busy', { status: 'idle' })]
    const { clock, ui } = await mountPane($, on, sessions, { store })
    sessions[1]!.status = 'waiting'
    sessions[1]!.sinceMs = -1000
    await refreshTwice(clock, ui)
    expect(played).toEqual([])
  })
  test('A card that first appears after the first refresh already needing the person chimes', async ($, on) => {
    const played = chimes(on)
    const sessions = [S('mine')]
    const { clock, ui } = await mountPane($, on, sessions)
    await refreshTwice(clock, ui)
    sessions.push(S('late', { status: 'waiting', sinceMs: -1000 }))
    await refreshTwice(clock, ui)
    expect(played).toHaveLength(1)
  })
  // a card missing for one refresh keeps its status; an empty list keeps every claim.
  test('A needs-you card missing for one refresh and back again is silent', async ($, on) => {
    const played = chimes(on)
    const sessions = [S('mine'), S('waits', { status: 'waiting' })]
    const { clock, ui } = await mountPane($, on, sessions)
    await refreshTwice(clock, ui)
    const gone = sessions.pop()!
    await refreshTwice(clock, ui)
    sessions.push(gone)
    await refreshTwice(clock, ui)
    expect(played).toEqual([])
  })
  test('An empty session list prunes no chime claim', async ($, on) => {
    const store = new Map<string, unknown>([['chime:gone', 'needs-you@1']])
    const { clock, ui } = await mountPane($, on, [], { store })
    await refreshTwice(clock, ui)
    expect(store.get('chime:gone')).toBe('needs-you@1')
  })
  test('A live session list prunes the claims of ended sessions', async ($, on) => {
    const store = new Map<string, unknown>([['chime:gone', 'needs-you@1'], [`chime:${idOf('mine')}`, 'needs-you@2']])
    const { clock, ui } = await mountPane($, on, [S('mine')], { store })
    await refreshTwice(clock, ui)
    expect([store.has('chime:gone'), store.has(`chime:${idOf('mine')}`)]).toEqual([false, true])
  })
  test('Active empty and none working (hills scene with 3 plants and sun)', async ($, on) => {
    const { ui } = await mountPane($, on, [])
    expect(await ui.find({ key: 'scene' })).toBeDefined()
  })
  test('Active empty and none working (caption centered)', async ($, on) => {
    const { ui } = await mountPane($, on, [])
    // phase 2: the caption is its own keyed Text.
    const caption = await ui.find({ key: 'scene-caption', text: 'All clear. Time to touch some grass.' })
    expect(caption).toBeDefined()
    const line = caption!.text as string
    const left = line.length - line.trimStart().length
    const right = 42 - line.trimEnd().length
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
  })
  test('Active empty and none working (other shelves still draw)', async ($, on) => {
    const store = new Map<string, unknown>([[`pref:${idOf('z')}`, { snoozedUntil: TUE_10 + 5 * HOUR }]])
    const { ui } = await mountPane($, on, [S('z')], { store })
    expect(await ui.find({ key: 'shelf:snoozed' })).toBeDefined()
  })
  test('Active empty, one working (working scene plus one caption from the list)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('w', { status: 'busy' })], { selfName: 'zz', ...shelfOn() })
    expect(await ui.find({ key: 'scene' })).toBeDefined()
    expect(await hasText(ui, 'All clear. Time to touch some grass.')).toBe(false)
    expect(((await ui.find({ key: 'scene-caption' }))?.text ?? '').length).toBeGreaterThan(0)
  })
  test('Scene appears again (caption differs from the previous time)', async ($, on) => {
    let previous = ''
    // phase 2: the previous caption is the stored one, so the restarts share one store.
    const store = new Map<string, unknown>([SHELF_ON])
    for (let i = 0; i < 20; i++) {
      const { ui } = await mountPane($, on, [S('w', { status: 'busy' })], { selfName: 'zz', store })
      const caption = ((await ui.find({ key: 'scene-caption' }))?.text ?? '') as string
      if (previous) expect(caption).not.toBe(previous)
      previous = caption
    }
  })
  test('Only own session (own card in its shelf; the scene follows the Active-empty rule)', async ($, on) => {
    const working = await mountPane($, on, [S('mine', { status: 'busy' })], shelfOn())
    expect((await orderOf(working.ui)).working).toEqual(refs('mine'))
    expect(await working.ui.find({ key: 'scene' })).toBeDefined()
    const idle = await mountPane($, on, [S('mine')])
    expect((await orderOf(idle.ui)).active).toEqual(refs('mine'))
    expect(await idle.ui.find({ key: 'scene' })).toBeUndefined()
  })
})
todo('colour fidelity of the scene and the project picture (G) -- layer live-Ghostty')

// ---------------------------------------------------------------- 7. Shelves and lifecycle
describe('7. shelves and lifecycle', () => {
  const pref = (name: string, value: object) => [`pref:${idOf(name)}`, value] as const
  test('A person pins (pinned whatever the status)', async ($, on) => {
    const names = ['a', 'b', 'c', 'd']
    const statuses = ['busy', 'waiting', 'completed', 'idle'] as const
    const store = new Map(names.map(n => pref(n, { isPinned: true })))
    const { ui } = await mountPane($, on, names.map((n, i) => S(n, { status: statuses[i] })), { store })
    expect((await orderOf(ui)).pinned?.sort()).toEqual(refs(...names).sort())
  })
  test('Needs-you session (unpinned: Active, above the others)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('i1'), S('i2', { ageMs: MIN }), S('n', { status: 'waiting' }), S('i3', { ageMs: 2 * MIN })])
    expect((await orderOf(ui)).active![0]).toBe(refOf('n'))
  })
  test('Working session (unpinned: Working)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine'), S('w', { status: 'busy' })], shelfOn())
    expect((await orderOf(ui)).working).toContain(refOf('w'))
  })
  test('Working and needs you (goes to Active)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('w', { status: 'waiting', reason: 'asks' })], { selfName: 'zz' })
    const order = await orderOf(ui)
    expect(order.active).toContain(refOf('w'))
    expect(order.working ?? []).not.toContain(refOf('w'))
  })
  test('Idle 6 h (Inactive)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine'), S('six', { ageMs: 6 * HOUR }), S('five', { ageMs: 6 * HOUR - MIN })])
    const store = new Map<string, unknown>()
    await press(ui, 'shelf:inactive')
    const order = await orderOf(ui)
    expect(order.inactive).toEqual(refs('six'))
    expect(order.active).toContain(refOf('five'))
    expect(store.size).toBe(0)
  })
  test('Idle 7 h but pinned, snoozed, parked or settled (stays where the user put it)', async ($, on) => {
    const store = new Map<string, unknown>([pref('p', { isPinned: true }), pref('s', { snoozedUntil: TUE_10 + HOUR }), pref('k', { isParked: true }), pref('t', { isSettled: true })])
    const { ui } = await mountPane($, on, ['p', 's', 'k', 't'].map(n => S(n, { ageMs: 7 * HOUR })), { store, selfName: 'zz' })
    expect((await orderOf(ui)).inactive ?? []).toEqual([])
    // phase 2: positive twin -- each card is on the shelf the user put it on.
    expect((await orderOf(ui)).pinned).toEqual(refs('p'))
    for (const shelf of ['snoozed', 'parked', 'settled']) expect(await headerText(ui, shelf)).toMatch(/\(1\)/)
  })
  test('Other sessions (Active)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a', { ageMs: HOUR }), S('d', { status: 'completed' })], { selfName: 'zz' })
    expect((await orderOf(ui)).active?.sort()).toEqual(refs('a', 'd').sort())
  })
  test('Hover over a card (Pin/Unpin shown only on hover)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a')])
    const hidden = (await ui.findAll({ type: 'Box' })).filter((one: any) => one.props.display === 'none')
    expect(hidden.some((one: any) => /pin/i.test(one.text))).toBe(true)
  })
  test('Hover over a card (Snooze, Park, Settle only on non-working, non-needs-you cards)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('w', { status: 'busy' }), S('n', { status: 'waiting' }), S('i')], { selfName: 'zz' })
    for (const name of ['w', 'n']) for (const act of ['snooze', 'park', 'settle']) expect(await ui.find({ key: `${act}:${refOf(name)}` })).toBeUndefined()
    for (const act of ['snooze', 'park', 'settle']) expect(await ui.find({ key: `${act}:${refOf('i')}` })).toBeDefined()
  })
  test('Press Pin (card moves to Pinned)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a'), S('b')], { selfName: 'zz' })
    await press(ui, `pin:${refOf('b')}`)
    expect((await orderOf(ui)).pinned).toEqual(refs('b'))
  })
  test('Press Unpin (returns to its status shelf)', async ($, on) => {
    const store = new Map<string, unknown>([pref('w', { isPinned: true }), SHELF_ON])
    const { ui } = await mountPane($, on, [S('w', { status: 'busy' })], { store, selfName: 'zz' })
    await press(ui, `pin:${refOf('w')}`)
    expect((await orderOf(ui)).working).toEqual(refs('w'))
  })
  test('Open snooze (five presets)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a')], { selfName: 'zz' })
    await press(ui, `snooze:${refOf('a')}`)
    for (const label of ['1 hour', '5 hours', 'This evening', 'Tomorrow morning', 'Next week']) expect(await hasText(ui, label)).toBe(true)
  })
  test('Pick presets (wake times: +1h, +5h, 18:00 today, 09:00 tomorrow, 09:00 next Monday)', async ($, on) => {
    const cases: [string, number][] = [
      ['1 hour', TUE_10 + HOUR], ['5 hours', TUE_10 + 5 * HOUR], ['This evening', new Date(2026, 9, 13, 18).getTime()],
      ['Tomorrow morning', new Date(2026, 9, 14, 9).getTime()], ['Next week', new Date(2026, 9, 19, 9).getTime()],
    ]
    for (const [label, wake] of cases) {
      const { ui, store } = await mountPane($, on, [S('a')], { selfName: 'zz' })
      await press(ui, `snooze:${refOf('a')}`)
      await press(ui, `snooze-pick:${label}`)
      expect(JSON.stringify([...store.values()])).toContain(String(wake))
    }
  })
  // phase 2: the Sunday case runs on its own clock; moving one clock five days ahead fires every timer in between.
  test('Pick presets (Next week from Sunday evening is 09:00 the next day)', async ($, on) => {
    const sunday = new Date(2026, 9, 18, 20).getTime()
    const { ui, store } = await mountPane($, on, [S('a')], { selfName: 'zz', now: sunday })
    await press(ui, `snooze:${refOf('a')}`); await press(ui, 'snooze-pick:Next week')
    expect(JSON.stringify([...store.values()])).toContain(String(new Date(2026, 9, 19, 9).getTime()))
  })
  test('After 18:00 (This evening not offered)', async ($, on) => {
    for (const [h, m, offered] of [[17, 59, true], [18, 0, false], [18, 1, false]] as const) {
      const { ui } = await mountPane($, on, [S('a')], { selfName: 'zz', now: new Date(2026, 9, 13, h, m).getTime() })
      await press(ui, `snooze:${refOf('a')}`)
      expect(await hasText(ui, 'This evening')).toBe(offered)
    }
  })
  // phase 2: an hour of simulated time with the scene animating takes longer than the default 5 s.
  test('Pick 5 h preset (card in Snoozed with time left)', { timeoutMs: 30_000 }, async ($, on) => {
    const { ui, clock } = await mountPane($, on, [S('a')], { selfName: 'zz' })
    await press(ui, `snooze:${refOf('a')}`); await press(ui, 'snooze-pick:5 hours')
    await press(ui, 'shelf:snoozed')
    expect(await rowText(ui, 'a')).toMatch(/5h/)
    // phase 2: an hour in minute steps; one harness advance resolves at most 10 000 timer waits and the 100 ms animation timer runs.
    for (let i = 0; i < 60; i++) { await clock.advance(MIN); await ui.advance(MIN) }
    expect(await rowText(ui, 'a')).toMatch(/4h/)
  })
  test('Wake time passes (card returns, "Woke" in the status slot)', { timeoutMs: 30_000 }, async ($, on) => {
    const store = new Map<string, unknown>([pref('a', { snoozedUntil: TUE_10 + HOUR })])
    const { ui, clock } = await mountPane($, on, [S('a')], { store, selfName: 'zz' })
    // phase 2: an hour in minute steps; one harness advance resolves at most 10 000 timer waits and the 100 ms animation timer runs.
    for (let i = 0; i < 61; i++) { await clock.advance(MIN); await ui.advance(MIN) }
    expect((await orderOf(ui)).active).toContain(refOf('a'))
    expect(await rowText(ui, 'a')).toMatch(/Woke/)
  })
  test('A person presses a woken card ("Woke" clears)', async ($, on) => {
    const store = new Map<string, unknown>([pref('a', { snoozedUntil: TUE_10 - MIN })])
    const { ui } = await mountPane($, on, [S('a')], { store, selfName: 'zz' })
    expect(await rowText(ui, 'a')).toMatch(/Woke/)
    await press(ui, `open:${refOf('a')}`)
    expect(await rowText(ui, 'a')).not.toMatch(/Woke/)
  })
  test('Snoozed session starts working or asks (early return marked "Woke")', async ($, on) => {
    const store = new Map<string, unknown>([pref('a', { snoozedUntil: TUE_10 + 5 * HOUR, snoozedStatus: 'idle' })])
    const { ui } = await mountPane($, on, [S('a', { status: 'waiting', title: 'Back early' })], { store, selfName: 'zz' })
    expect((await orderOf(ui)).active).toContain(refOf('a'))
    // `Woke ·` left line 3; a woken needs-you card keeps its pill and is marked by a bold title.
    expect(await rowText(ui, 'a')).toMatch(/Needs you/)
    expect((await rowText(ui, 'a')).split('\n')[2]).not.toMatch(/Woke/)
    expect((await ui.findAll({ type: 'Text' })).find((one: any) => one.text === 'Back early')?.props.bold).toBe(true)
  })
  test('Park (stays in Parked until it works, needs me or finishes)', async ($, on) => {
    for (const [status, returns] of [['busy', true], ['waiting', true], ['completed', true], ['idle', false]] as const) {
      const store = new Map<string, unknown>([pref('a', { isParked: true, parkedStatus: 'idle' })])
      const { ui } = await mountPane($, on, [S('a', { status })], { store, selfName: 'zz' })
      // phase 2: Parked is collapsed by default; open it (when drawn) to read its cards.
      if (await ui.find({ key: 'shelf:parked' })) await press(ui, 'shelf:parked')
      const order = await orderOf(ui)
      expect((order.parked ?? []).includes(refOf('a'))).toBe(!returns)
    }
  })
  test('Settle (stays in Settled until it works, needs me or finishes)', async ($, on) => {
    for (const [status, returns] of [['busy', true], ['waiting', true], ['completed', true], ['idle', false]] as const) {
      const store = new Map<string, unknown>([pref('a', { isSettled: true, settledStatus: 'idle', settledAt: TUE_10 - HOUR })])
      const { ui } = await mountPane($, on, [S('a', { status })], { store, selfName: 'zz' })
      // phase 2: an empty Settled shelf is not drawn, so it is opened only when drawn.
      if (await ui.find({ key: 'shelf:settled' })) await press(ui, 'shelf:settled')
      expect(((await orderOf(ui)).settled ?? []).includes(refOf('a'))).toBe(!returns)
    }
  })
  test('Working or needs-you card (Snooze, Park, Settle not offered; the key path refuses too)', async ($, on) => {
    const { ui, store } = await mountPane($, on, [S('w', { status: 'busy' }), S('n', { status: 'waiting' })], { selfName: 'zz' })
    for (const name of ['w', 'n']) for (const act of ['snooze', 'park', 'settle']) {
      expect(await ui.find({ key: `${act}:${refOf(name)}` })).toBeUndefined()
      await press(ui, `${act}:${refOf(name)}`).catch(() => undefined)
    }
    expect([...store.keys()].filter(k => k.startsWith('pref:'))).toEqual([])
  })
  test('Several settled (most recently settled first)', async ($, on) => {
    const store = new Map<string, unknown>([pref('A', { isSettled: true, settledAt: TUE_10 - 3 * HOUR }), pref('B', { isSettled: true, settledAt: TUE_10 - 2 * HOUR }), pref('C', { isSettled: true, settledAt: TUE_10 - HOUR })])
    const { ui } = await mountPane($, on, [S('A'), S('B'), S('C')], { store, selfName: 'zz' })
    await press(ui, 'shelf:settled')
    expect((await orderOf(ui)).settled).toEqual(refs('C', 'B', 'A'))
  })
  test('Press a Done card (becomes Idle)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a', { status: 'completed' })], { selfName: 'zz' })
    expect(await rowText(ui, 'a')).toMatch(/Done/)
    await press(ui, `open:${refOf('a')}`)
    const text = await rowText(ui, 'a')
    expect(text).not.toMatch(/Done/)
    expect(text).toMatch(/now|\d+[mhdw]/)
  })
})

// ---------------------------------------------------------------- 8. Sorting and order
describe('8. sorting and order', () => {
  const four = [S('a', { ageMs: 4 * MIN, startedAgoMs: 4 * DAY }), S('b', { ageMs: 1 * MIN, startedAgoMs: 2 * DAY }), S('c', { ageMs: 3 * MIN, startedAgoMs: 1 * DAY }), S('d', { ageMs: 2 * MIN, startedAgoMs: 3 * DAY })]
  // the Active header's `↕` toggles a menu of the four modes, the current one ticked.
  // Manual sort removed (no practical ordering in a terminal without drag and drop); only Pinned moves
  test('Open sort control (the header ↕ opens a menu of three modes)', async ($, on) => {
    const { ui } = await mountPane($, on, four, { selfName: 'zz' })
    const sort = await ui.find({ key: 'sort' })
    expect(sort?.text).toBe(' ↕')
    expect(await ui.find({ key: 'sort-menu' })).toBeUndefined()
    await press(ui, 'sort')
    const menu = await ui.find({ key: 'sort-menu' })
    expect(menu?.text).toMatch(/Recent activity[\s\S]*Date created[\s\S]*Project/)
    expect(menu?.text).not.toMatch(/Manual/)
    expect(await ui.find({ key: 'sort:manual' })).toBeUndefined()
    expect((await ui.find({ key: 'sort:recent' }))?.text).toBe('✓ Recent activity')
    for (const mode of ['created', 'project']) expect((await ui.find({ key: `sort:${mode}` }))?.text).toMatch(/^ {2}\S/)
    await press(ui, 'sort')
    expect(await ui.find({ key: 'sort-menu' })).toBeUndefined()
  })
  // choosing a mode sets the sort, closes the menu and moves the tick.
  test('Choosing a sort mode (sets it, closes the menu, ticks it next time)', async ($, on) => {
    const { ui, store } = await mountPane($, on, four, { selfName: 'zz' })
    await press(ui, 'sort')
    await press(ui, 'sort:created')
    expect(await ui.find({ key: 'sort-menu' })).toBeUndefined()
    expect(store.get('sort')).toBe('created')
    expect((await orderOf(ui)).active).toEqual(refs('c', 'b', 'd', 'a'))
    await press(ui, 'sort')
    expect((await ui.find({ key: 'sort:created' }))?.text).toBe('✓ Date created')
    expect((await ui.find({ key: 'sort:recent' }))?.text).toBe('  Recent activity')
  })
  // an empty Active shelf has no header, so no sort control either.
  test('Empty Active shelf (no header, no sort control)', async ($, on) => {
    const { ui } = await mountPane($, on, [])
    expect(await ui.find({ key: 'header:active' })).toBeUndefined()
    expect(await ui.find({ key: 'shelf:active' })).toBeUndefined()
    expect(await ui.find({ key: 'sort' })).toBeUndefined()
    expect(await ui.find({ key: 'scene' })).toBeDefined()
  })
  test('Default (recent activity, newest first)', async ($, on) => {
    const { ui } = await mountPane($, on, four, { selfName: 'zz' })
    expect((await orderOf(ui)).active).toEqual(refs('b', 'd', 'c', 'a'))
  })
  test('Date created (by start, newest first)', async ($, on) => {
    const { ui } = await mountPane($, on, four, { selfName: 'zz' })
    await pickSort(ui, 'created')
    expect((await orderOf(ui)).active).toEqual(refs('c', 'b', 'd', 'a'))
  })
  test('Project (alphabetical groups; newest first within)', async ($, on) => {
    const sessions = [S('a1', { cwd: '/p/zeta', ageMs: 3 * MIN }), S('a2', { cwd: '/p/alpha', ageMs: 2 * MIN }), S('a3', { cwd: '/p/zeta', ageMs: 1 * MIN }), S('a4', { cwd: '/p/alpha', ageMs: 4 * MIN })]
    const { ui } = await mountPane($, on, sessions, { selfName: 'zz' })
    await pickSort(ui, 'project')
    expect((await orderOf(ui)).active).toEqual(refs('a2', 'a4', 'a3', 'a1'))
  })
  // Manual sort removed (no practical ordering in a terminal without drag and drop); only Pinned moves
  test('Active cards (no Move up/down in any mode)', async ($, on) => {
    const { ui } = await mountPane($, on, four, { selfName: 'zz' })
    for (const mode of ['recent', 'created', 'project']) {
      await pickSort(ui, mode)
      for (const ref of (await orderOf(ui)).active!) expect(await ui.find({ key: `move-up:${ref}` })).toBeUndefined()
    }
  })
  test('Pinned (always manual order; Move up/down in every mode)', async ($, on) => {
    const store = new Map<string, unknown>(['p1', 'p2', 'p3'].map(n => [`pref:${idOf(n)}`, { isPinned: true }]))
    const { ui } = await mountPane($, on, [S('p1'), S('p2'), S('p3')], { store, selfName: 'zz' })
    expect(await ui.find({ key: `move-up:${refOf('p2')}` })).toBeDefined()
    expect(await ui.find({ key: `move-down:${refOf('p2')}` })).toBeDefined()
    // Manual sort removed (no practical ordering in a terminal without drag and drop); only Pinned moves: the pinned move still works by one place
    const start = (await orderOf(ui)).pinned!
    await press(ui, `move-up:${start[1]}`)
    expect((await orderOf(ui)).pinned).toEqual([start[1], start[0], start[2]])
  })
  test('Needs-you card (no Move up/down; nothing moves above the needs-you block)', async ($, on) => {
    const sessions = [S('n1', { status: 'waiting' }), S('n2', { status: 'waiting', ageMs: MIN }), S('x1'), S('x2', { ageMs: MIN })]
    const { ui } = await mountPane($, on, sessions, { selfName: 'zz' })
    expect(await ui.find({ key: `move-up:${refOf('n1')}` })).toBeUndefined() // Manual sort removed (no practical ordering in a terminal without drag and drop); only Pinned moves
  })
  test('Any sort mode (needs-you stays above)', async ($, on) => {
    for (const mode of ['recent', 'created', 'project']) {
      const sessions = [S('x1', { ageMs: 0 }), S('n1', { status: 'waiting', ageMs: 5 * MIN }), S('x2', { ageMs: MIN }), S('n2', { status: 'waiting', ageMs: 9 * MIN })]
      const { ui } = await mountPane($, on, sessions, { selfName: 'zz' })
      await pickSort(ui, mode)
      const active = (await orderOf(ui)).active!
      const needs = [refOf('n1'), refOf('n2')]
      expect(active.slice(0, 2).sort()).toEqual(needs.sort())
    }
  })
  test('Several waiting (longest waiting first)', async ($, on) => {
    const sessions = [S('w3', { status: 'waiting', sinceMs: 3 * MIN }), S('w10', { status: 'waiting', sinceMs: 10 * MIN }), S('w1', { status: 'waiting', sinceMs: MIN })]
    const { ui } = await mountPane($, on, sessions, { selfName: 'zz' })
    expect((await orderOf(ui)).active).toEqual(refs('w10', 'w3', 'w1'))
  })
  test('Other shelves (newest activity first)', async ($, on) => {
    const sessions = [S('w1', { status: 'busy', ageMs: 5 * MIN }), S('w2', { status: 'busy', ageMs: MIN }), S('w3', { status: 'busy', ageMs: 3 * MIN })]
    const { ui } = await mountPane($, on, sessions, { selfName: 'zz', ...shelfOn() })
    expect((await orderOf(ui)).working).toEqual(refs('w2', 'w3', 'w1'))
  })
})

// ---------------------------------------------------------------- 9. Needs-you (top line and Next withdrawn)
// the top line (`N need you`, `Next ›`, hotkey n) and Next are withdrawn.
describe('9. no top line', () => {
  test('withdrawn: no top line and no Next button, even with sessions that need the person', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine'), S('a', { status: 'waiting' }), S('b', { status: 'waiting', app: 'tmux' })])
    expect(await hasText(ui, /need you/)).toBe(false)
    expect(await hasText(ui, /Next ›/)).toBe(false)
    expect(await ui.find({ key: 'top' })).toBeUndefined()
    expect(await ui.find({ key: 'next' })).toBeUndefined()
    expect((await ui.findAll({})).some((one: any) => one.props?.hotkey === 'n')).toBe(false)
    expect(await rowText(ui, 'a')).toMatch(/Needs you/)
  })
})

// ---------------------------------------------------------------- 10. Press to focus
describe('10. press to focus', () => {
  const LINE = (name: string) => `cd '/p/${name}' && claude --resume ${idOf(name)}`
  test('Press a same-app card (tab to front)', async ($, on) => {
    const world: World = { ran: [] }
    const { ui } = await mountPane($, on, [S('mine'), S('other')], world)
    await press(ui, `open:${refOf('other')}`)
    expect(world.ran!.filter(a => a[0] === 'osascript').length).toBe(1)
    expect(world.ran![0]!.join(' ')).toContain('/p/other')
  })
  test('Press own card (no terminal focus change)', async ($, on) => {
    const world: World = { ran: [] }
    const { ui } = await mountPane($, on, [S('mine')], world)
    world.ran!.length = 0
    await press(ui, `open:${refOf('mine')}`)
    expect(world.ran).toEqual([])
  })
  test('D6 Pressing own after a child immediately returns to the main conversation', async ($, on) => {
    const world: World = { views: [], agents: [AGENT('a1', 'running', 'Scan')] }
    const { ui } = await mountPane($, on, [S('mine')], world)
    await press(ui, 'view:a1')
    await press(ui, `open:${refOf('mine')}`)
    expect(world.views).toEqual([{ agentId: 'a1' }, {}])
  })
  test('Press own card (clears Done and Woke)', async ($, on) => {
    const store = new Map<string, unknown>([[`pref:${idOf('mine')}`, { snoozedUntil: TUE_10 - MIN }]])
    const { ui } = await mountPane($, on, [S('mine', { status: 'completed' })], { store })
    expect(await rowText(ui, 'mine')).toMatch(/Done|Woke/)
    await press(ui, `open:${refOf('mine')}`)
    expect(await rowText(ui, 'mine')).not.toMatch(/Done|Woke/)
  })
  test('Press an other-app card (no switch; note names the app)', async ($, on) => {
    const world: World = { ran: [] }
    const { ui } = await mountPane($, on, [S('mine'), S('away', { app: 'tmux' })], world)
    world.ran!.length = 0
    await press(ui, `open:${refOf('away')}`)
    expect(world.ran).toEqual([])
    expect(await hasText(ui, /runs in tmux/)).toBe(true)
  })
  test('Focus step fails (resume command copied)', async ($, on) => {
    const world: World = { copies: [], focusFails: 'step failed' }
    const { ui } = await mountPane($, on, [S('mine'), S('other')], world)
    await press(ui, `open:${refOf('other')}`)
    expect(world.copies).toEqual([LINE('other')])
  })
  test('Focus step fails (note names the failed step)', async ($, on) => {
    const world: World = { copies: [], focusFails: 'step failed' }
    const { ui } = await mountPane($, on, [S('mine'), S('other')], world)
    await press(ui, `open:${refOf('other')}`)
    expect(await hasText(ui, /Copied/)).toBe(true)
    expect(await hasText(ui, /step|Ghostty/)).toBe(true)
  })
  test('Any press (no toast)', async ($, on) => {
    for (const w of [{}, { focusFails: 'x' }] as World[]) {
      const world: World = { toasts: [], copies: [], ...w }
      const { ui } = await mountPane($, on, [S('mine'), S('other'), S('away', { app: 'tmux' })], world)
      for (const n of ['mine', 'other', 'away']) await press(ui, `open:${refOf(n)}`)
      expect(world.toasts).toEqual([])
    }
  })
  test('Two tabs share a folder (copies the resume command; note says the folder is shared)', async ($, on) => {
    // phase 2: the Ghostty script succeeds and prints the number of matching tabs.
    const world: World = { copies: [], ran: [], focusAnswer: '2\n' }
    const { ui } = await mountPane($, on, [S('mine'), S('other')], world)
    await press(ui, `open:${refOf('other')}`)
    expect(world.copies).toEqual([LINE('other')])
    expect(await hasText(ui, /folder is shared|tabs in this folder/)).toBe(true)
  })
})
todo('Press focuses the right tab in real Ghostty tabs and real tmux windows -- layer live-Ghostty / live-tmux')
todo('Status changes elsewhere show within 6 s -- layer live-Ghostty')
todo('Press in Ghostty brings the tab front within 2 s -- layer live-Ghostty')
todo('10 sessions animating use at most 5% of one core -- layer live-Ghostty (ps sampling)')

// ---------------------------------------------------------------- 11. Subagents and context
describe('11. subagents and context', () => {
  test('Press a child row (transcript in the main view; a missing transcript gives a note)', async ($, on) => {
    const { ui, world } = await mountPane($, on, [S('mine')], { agents: [AGENT('a1', 'running', 'Scan', { transcriptPath: '/missing.jsonl' })] })
    await press(ui, 'view:a1')
    expect(await hasText(ui, /transcript/i)).toBe(true)
    expect(world.toasts ?? []).toEqual([])
  })
  test('Subagent starts (row within one refresh)', async ($, on) => {
    const world: World = { agents: [] }
    const { ui, clock } = await mountPane($, on, [S('mine')], world)
    expect(await ui.find({ key: 'view:a1' })).toBeUndefined()
    world.agents = [AGENT('a1', 'running', 'Scan')]
    await clock.advance(6000); await ui.advance(6000)
    expect(await ui.find({ key: 'view:a1' })).toBeDefined()
  })
  // ListAgents lists the own subagents in a `subagents` section; none becomes a card.
  test('D3 A subagent listed by ListAgents is a child row, never a session card', async ($, on) => {
    const agents = [AGENT('a715004d2b60f4252', 'completed', 'Count files')]
    const { ui } = await mountPane($, on, [S('mine')], { agents, subagentRows: [{ id: 'a715004d2b60f4252', type: 'general-purpose', status: 'completed' }] })
    expect(await ui.find({ key: 'line1:a715004d2b60f4252' })).toBeUndefined()
    expect(await hasText(ui, /^a715004d2b60f4252$/)).toBe(false)
    expect(await ui.find({ key: 'view:a715004d2b60f4252' })).toBeDefined()
  })
  test('Subagent removed (row gone within one refresh)', async ($, on) => {
    const world: World = { agents: [AGENT('a1', 'running', 'Scan')] }
    const { ui, clock } = await mountPane($, on, [S('mine')], world)
    world.agents = []
    await clock.advance(6000); await ui.advance(6000)
    expect(await ui.find({ key: 'view:a1' })).toBeUndefined()
  })
  // the engine forgets an ended subagent; its row stays Done for the session.
  test('D2 Finished subagents stay listed after the agent list forgets them; the badge keeps counting them', async ($, on) => {
    const world: World = { agents: [AGENT('a1', 'running', 'Count files'), AGENT('a2', 'running', 'Read README')] }
    const { ui, clock } = await mountPane($, on, [S('mine')], world, 70)
    world.agents = [AGENT('a1', 'completed', 'Count files'), AGENT('a2', 'running', 'Read README')]
    await clock.advance(6000); await ui.advance(6000)
    world.agents = [AGENT('a2', 'completed', 'Read README')]
    await clock.advance(6000); await ui.advance(6000)
    world.agents = []
    await clock.advance(6000); await ui.advance(6000)
    expect((await ui.find({ key: 'child:a1' }))?.text).toMatch(/✓ Done/)
    expect((await ui.find({ key: 'child:a2' }))?.text).toMatch(/✓ Done/)
    expect((await rowText(ui, 'mine')).split('\n')[2]).toMatch(/●● 2/)
    world.agents = [AGENT('b1', 'running', 'Next run')]
    await clock.advance(6000); await ui.advance(6000)
    expect(await ui.find({ key: 'view:a1' })).toBeDefined()
    expect(await ui.find({ key: 'view:b1' })).toBeDefined()
  })
  // child rows use the card words, so engine waiting and running are both Working.
  test('Mixed states (failed, then working, then finished; each newest first)', async ($, on) => {
    const agents = [
      AGENT('d1', 'completed', 'd1', { startedAt: 1 }), AGENT('r1', 'running', 'r1', { startedAt: 1 }), AGENT('w1', 'waiting', 'w1', { startedAt: 1 }),
      AGENT('r2', 'running', 'r2', { startedAt: 2 }), AGENT('w2', 'waiting', 'w2', { startedAt: 2 }), AGENT('d2', 'completed', 'd2', { startedAt: 2 }),
    ]
    const { ui } = await mountPane($, on, [S('mine')], { agents })
    const keys = (await ui.findAll({})).map((one: any) => one.key as string).filter((k: string) => k?.startsWith('view:'))
    expect(keys).toEqual(['view:r2', 'view:w2', 'view:r1', 'view:w1', 'view:d2'])
  })
  // a plain percentage, muted below 75, orange from 75, red at 100.
  test('Own card context (plain percentage; muted under 75, orange 75 to 99, red 100)', async ($, on) => {
    const want: [number, 'dim' | 'orange' | 'red'][] = [[0, 'dim'], [74, 'dim'], [75, 'orange'], [99, 'orange'], [100, 'red']]
    for (const [pct, tone] of want) {
      const { ui } = await mountPane($, on, [S('mine', { ctx: pct })], {}, 70)
      expect((await rowText(ui, 'mine')).split('\n')[2]).toMatch(new RegExp(` ${pct}%$`))
      const label = (await ui.findAll({ type: 'Text' })).find((one: any) => one.text === `${pct}%`)
      // phase 2: context colours are the palette's hex values.
      if (tone === 'dim') {
        expect(label?.props.dimColor).toBe(true)
        expect(label?.props.color).toBe(PALETTES.dark.ink) // plain text on the own-card fill takes the palette ink
      } else expect(label?.props.color).toBe(PALETTES.dark.text[tone])
      expect(label?.text).not.toMatch(/[▰▱]/)
    }
  })
  test('Other session, source reports (percent shown)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine'), S('other', { ctx: 33 })], {}, 70)
    expect(await rowText(ui, 'other')).toContain('33%')
  })
  test('Other session, no source (nothing shown, never estimated)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine'), S('other', { title: 'big', prompt: 'x'.repeat(5000) }), S('third', { ctx: 33 })], {}, 70)
    expect(await rowText(ui, 'other')).not.toMatch(/\d+%/)
    // phase 2: positive twin -- the session whose source reports a value shows it, in the same pane.
    expect(await rowText(ui, 'third')).toContain('33%')
  })
})

// ---------------------------------------------------------------- 12. Layers and terminals
describe('12. layers and terminals', () => {
  const scenario = [S('mine'), S('w', { status: 'busy' }), S('n', { status: 'waiting', sinceMs: 5 * MIN }), S('d', { status: 'completed' }), S('i', { ageMs: 7 * HOUR })]
  test('Unknown terminal (lists every session)', async ($, on) => {
    const known = await mountPane($, on, scenario, {})
    const unknown = await mountPane($, on, scenario, { term: 'unknown' })
    expect(Object.values(await orderOf(unknown.ui)).flat().sort()).toEqual(Object.values(await orderOf(known.ui)).flat().sort())
  })
  test('Unknown terminal (shelf, sort and lifecycle rules apply)', async ($, on) => {
    const known = await mountPane($, on, scenario, {})
    const unknown = await mountPane($, on, scenario, { term: 'unknown' })
    expect(await orderOf(unknown.ui)).toEqual(await orderOf(known.ui))
  })
  test('Unknown terminal (every status shows)', async ($, on) => {
    const { ui } = await mountPane($, on, scenario, { term: 'unknown' })
    expect(await rowText(ui, 'w')).toMatch(/Working/)
    expect(await rowText(ui, 'n')).toMatch(/Needs you/)
    expect(await rowText(ui, 'd')).toMatch(/Done/)
  })
  test('Unknown terminal, press (copies the command; note "terminal is not supported for switching")', async ($, on) => {
    const world: World = { copies: [] }
    const { ui } = await mountPane($, on, [S('mine'), S('other')], { ...world, term: 'unknown', copies: world.copies })
    await press(ui, `open:${refOf('other')}`)
    expect(world.copies!.length).toBe(1)
    expect(await hasText(ui, /terminal is not supported for switching/)).toBe(true)
  })
  test('Ghostty not in cmux or tmux (adapter recognises it)', async ($, on) => {
    const world: World = { ran: [] }
    const { ui } = await mountPane($, on, [S('mine'), S('other')], world)
    await press(ui, `open:${refOf('other')}`)
    expect(world.ran![0]![0]).toBe('osascript')
  })
  test('Inside cmux (reports Ghostty too; treated as cmux)', async ($, on) => {
    const world: World = { ran: [], env: { CMUX_WORKSPACE_ID: 'W0', CMUX_BUNDLED_CLI_PATH: '/c/cmux', TERM_PROGRAM: 'ghostty' } }
    const { ui } = await mountPane($, on, [S('mine'), S('other', { app: 'cmux' })], world)
    await press(ui, `open:${refOf('other')}`)
    expect(world.ran![0]![0]).toBe('sh')
    expect(world.ran!.some(a => a[0] === 'osascript')).toBe(false)
  })
  test('24-bit terminal (scenes drawn)', async ($, on) => {
    const { ui } = await mountPane($, on, [])
    expect(await ui.find({ key: 'scene' })).toBeDefined()
  })
  // without 24-bit colour the icon is the monogram, even where a picture exists.
  test('Non-24-bit terminal (project icons fall back to monograms)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine'), S('n', { status: 'waiting' })], withFiles({ '/p/n/favicon.png': 1000 }, { truecolor: false }))
    const lines = (await rowText(ui, 'n')).split('\n')
    expect(lines.length).toBeLessThanOrEqual(3)
    expect(lines[0]).toMatch(/^N  n/)
    expect(await iconKindOf(ui, 'n')).toBe('monogram')
  })
  test('Non-24-bit terminal (scene replaced by the caption alone)', async ($, on) => {
    const { ui } = await mountPane($, on, [], { truecolor: false })
    expect(await ui.find({ key: 'scene' })).toBeUndefined()
    expect(await hasText(ui, 'All clear. Time to touch some grass.')).toBe(true)
    // phase 2: positive twin -- the caption is the scene's own caption element.
    expect((await ui.find({ key: 'scene-caption' }))?.text).toContain('All clear. Time to touch some grass.')
  })
})
// TODO(translator): (static scan that core and drawing modules name no terminal) needs file reads; a mod test cannot import node:fs (runner: hooks modules import only relative files and claude-code). Run it as a repo script instead.
// TODO(translator): (phase 1 focus behaviour unchanged) is covered by the unmodified tests/focus.test.ts, which this file does not duplicate.
// TODO(translator): (88 phase-1 tests still pass) is a property of the runner's result for the other files, not a check.
todo('Press in cmux, tmux, Terminal, iTerm2 (live tmux window selected) -- layer live-tmux')
todo('Non-24-bit path with COLORTERM unset in a real tmux -- layer live-tmux')

// ---------------------------------------------------------------- 13. Performance and safety
describe('13. performance and safety', () => {
  test('Any refresh (token files never opened or read)', async ($, on) => {
    const world: World = { ran: [], reads: [] }
    const { ui, clock } = await mountPane($, on, [S('mine'), S('other')], world)
    await clock.advance(6000); await ui.advance(6000)
    const seen = JSON.stringify([...world.ran!, ...world.reads!])
    expect(seen).not.toMatch(/token|credentials|\.credentials|oauth/i)
    // phase 2: positive twin -- the registry reader globs session files only, and it ran.
    expect(REGISTRY_SCRIPT).toMatch(/sessions\/\*\.json/)
    expect(REGISTRY_SCRIPT).not.toMatch(/\.key|token/i)
    expect(world.runs ?? 0).toBeGreaterThan(0)
  })
  test('50 MB transcript (reads at most 256 KB)', async ($, on) => {
    const world: World = { reads: [] }
    await mountPane($, on, [S('mine', { title: 'big' })], world)
    // The title script tails a bounded window; the stub boundary is the script itself.
    expect(TITLE_SCRIPT).toMatch(/tail -c (65536|[0-9]{1,6})/)
    const bytes = Number(/tail -c (\d+)/.exec(TITLE_SCRIPT)![1])
    expect(bytes).toBeLessThanOrEqual(262144)
  })
  test('Activity time unchanged (no transcript read; a changed time reads once)', async ($, on) => {
    const world: World = { reads: [] }
    const { ui, clock } = await mountPane($, on, [S('mine', { title: 't' })], world)
    const after = world.reads!.length
    expect(after).toBe(1)
    await clock.advance(6000); await ui.advance(6000)
    expect(world.reads!.length).toBe(after)
    // phase 2: positive twin -- a moved activity time reads the transcript once.
    const sessions = [S('mine', { title: 't' })]
    const twin: World = { reads: [] }
    const moved = await mountPane($, on, sessions, twin)
    expect(twin.reads!.length).toBe(1)
    sessions[0]!.ageMs = -10_000
    await moved.clock.advance(6000); await moved.ui.advance(6000)
    expect(twin.reads!.length).toBe(2)
  })
  test('Nothing changed (at most 2 helper processes per refresh)', async ($, on) => {
    const world: World = { ran: [], reads: [] }
    const { ui, clock } = await mountPane($, on, [S('mine'), S('other')], world)
    // phase 2: every process.run is counted (registry, probes, readers, helpers).
    world.runs = 0
    await clock.advance(6000); await ui.advance(6000)
    expect(world.runs).toBeGreaterThanOrEqual(1)
    expect(world.runs).toBeLessThanOrEqual(2)
  })
  test('Pane hidden (animations stop)', async ($, on) => {
    // phase 2: a hidden pane refuses the blit; the timer stops, so no further frame is sent.
    const { ui, clock, world } = await mountPane($, on, [S('mine'), S('w', { status: 'busy' })], { ran: [], blits: [] })
    await clock.advance(500); await ui.advance(500)
    expect(world.blits!.length).toBeGreaterThan(0)
    world.hidden = true
    await clock.advance(200); await ui.advance(200)
    const sent = world.blits!.length
    const before = await textOf(ui)
    await clock.advance(1000); await ui.advance(1000)
    expect(world.blits!.length).toBe(sent)
    expect(await textOf(ui)).toBe(before)
  })
  test('No working or needs-you card visible, no scene (animations stop)', async ($, on) => {
    const { ui, clock, world } = await mountPane($, on, [S('mine'), S('i')], { blits: [] })
    const before = await textOf(ui)
    await clock.advance(1000); await ui.advance(1000)
    expect(await textOf(ui)).toBe(before)
    // phase 2: nothing is blitted; positive twin: a working card in the same harness is.
    expect(world.blits).toEqual([])
    const busy = await mountPane($, on, [S('mine'), S('w', { status: 'busy' })], { blits: [] })
    await busy.clock.advance(1000); await busy.ui.advance(1000)
    expect(busy.world.blits!.length).toBeGreaterThan(0)
  })
  test('Animation running (at most 10 frames per second)', async ($, on) => {
    const { ui, clock, world } = await mountPane($, on, [S('mine'), S('n', { status: 'waiting' }), S('w', { status: 'busy' })], { blits: [] })
    const frames = new Set<string>()
    for (let i = 0; i < 100; i++) { frames.add(await textOf(ui)); await clock.advance(10); await ui.advance(10) }
    expect(frames.size).toBeLessThanOrEqual(10)
    // cards have no creature; the working card's spinner is the Raster that animates.
    const sent = blitsOf(world, `spin:${refOf('w')}`).length
    expect(sent).toBeGreaterThan(0)
    expect(sent).toBeLessThanOrEqual(10)
  })
  test('Branch PR lookup (at most once per 5 min)', async ($, on) => {
    const world: World = { ghCalls: [] }
    const { ui, clock } = await mountPane($, on, [S('mine', { branch: 'feat' })], world)
    for (let i = 0; i < 4; i++) { await clock.advance(MIN); await ui.advance(MIN) }
    expect(world.ghCalls!.length).toBe(1)
    await clock.advance(2 * MIN); await ui.advance(2 * MIN)
    expect(world.ghCalls!.length).toBe(2)
  })
  test('gh missing or not signed in (no lookup, no PR on the card)', async ($, on) => {
    const world: World = { gh: 'absent', ghCalls: [] }
    const { ui, clock } = await mountPane($, on, [S('mine', { branch: 'feat' })], world, 90)
    // phase 2: after the first lookup fails, none follows and no PR shows; positive twin: a signed-in gh shows #42.
    for (let i = 0; i < 7; i++) { await clock.advance(MIN); await ui.advance(MIN) }
    expect(await rowText(ui, 'mine')).not.toMatch(/#\d+/)
    expect(world.ghCalls!.length).toBeLessThanOrEqual(1)
    const ok: World = { gh: 'ok', ghCalls: [] }
    const signed = await mountPane($, on, [S('mine', { branch: 'feat' })], ok, 90)
    await signed.clock.advance(61_000); await signed.ui.advance(61_000)
    expect(await rowText(signed.ui, 'mine')).toMatch(/PR #42/)
  })
})

// ---------------------------------------------------------------- 14. Persistence
describe('14. persistence', () => {
  test('Restart Claude Code (the saved kinds of state survive)', async ($, on) => {
    const sessions = [S('a'), S('b'), S('c'), S('d')]
    const first = await mountPane($, on, sessions, { selfName: 'zz' })
    await press(first.ui, `pin:${refOf('a')}`)
    await press(first.ui, `park:${refOf('b')}`)
    await press(first.ui, `settle:${refOf('c')}`)
    await pickSort(first.ui, 'project') // Manual sort removed (no practical ordering in a terminal without drag and drop); only Pinned moves
    await press(first.ui, 'shelf:active')
    const before = await orderOf(first.ui)
    const second = await mountPane($, on, sessions, { selfName: 'zz', store: first.store })
    expect(await orderOf(second.ui)).toEqual(before)
    expect(await headerText(second.ui, 'active')).toMatch(/⌄$/)
  })
  test('Change in pane A (appears in pane B within 6 s)', async ($, on) => {
    const sessions = [S('a'), S('b')]
    const a = await mountPane($, on, sessions, { selfName: 'zz' })
    const b = await mountPane($, on, sessions, { selfName: 'zz', store: a.store })
    await press(a.ui, `pin:${refOf('a')}`)
    await b.clock.advance(6000); await b.ui.advance(6000)
    expect((await orderOf(b.ui)).pinned).toEqual(refs('a'))
  })
  test('Two panes save different sessions at once (both changes persist)', async ($, on) => {
    const sessions = [S('s1'), S('s2')]
    const a = await mountPane($, on, sessions, { selfName: 'zz' })
    const b = await mountPane($, on, sessions, { selfName: 'zz', store: a.store })
    await Promise.all([press(a.ui, `pin:${refOf('s1')}`), press(b.ui, `park:${refOf('s2')}`)])
    expect(a.store.get(`pref:${idOf('s1')}`)).toMatchObject({ isPinned: true })
    expect(a.store.get(`pref:${idOf('s2')}`)).toMatchObject({ isParked: true })
  })
  test('Two panes save the same entry at once (later save wins; other entries intact)', async ($, on) => {
    const sessions = [S('s1'), S('s2')]
    const a = await mountPane($, on, sessions, { selfName: 'zz' })
    const b = await mountPane($, on, sessions, { selfName: 'zz', store: a.store })
    await press(a.ui, `pin:${refOf('s2')}`)
    await press(a.ui, `pin:${refOf('s1')}`)
    await press(b.ui, `park:${refOf('s1')}`)
    expect(a.store.get(`pref:${idOf('s1')}`)).toMatchObject({ isParked: true })
    expect(a.store.get(`pref:${idOf('s2')}`)).toMatchObject({ isPinned: true })
  })
  test('Entries unseen 30 days (removed)', async ($, on) => {
    const store = new Map<string, unknown>([
      [`pref:${idOf('old')}`, { isPinned: true, seenAt: TUE_10 - 31 * DAY }],
      [`pref:${idOf('young')}`, { isPinned: true, seenAt: TUE_10 - 29 * DAY }],
    ])
    await mountPane($, on, [S('mine')], { store })
    expect(store.has(`pref:${idOf('old')}`)).toBe(false)
    expect(store.has(`pref:${idOf('young')}`)).toBe(true)
  })
  test('Corrupt state file (defaults plus a "saved layout was reset" note)', async ($, on) => {
    // phase 2: the corrupt value is a stored `layout` key, as the persistence contract names it.
    const store = new Map<string, unknown>([['layout', '{garbled']])
    const { ui } = await mountPane($, on, [S('mine')], { store })
    expect(store.has('layout')).toBe(false)
    expect(await hasText(ui, /saved layout was reset/)).toBe(true)
    expect(await headerText(ui, 'active')).toMatch(/↕ ⌃$/)
  })
})

// ---------------------------------------------------------------- Edge cases and dock checks
describe('edge cases and dock checks', () => {
  test('109 columns or not fullscreen (pane inline above the prompt; no line wraps)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine', { title: 'x'.repeat(300) })], {}, 109, 'inline')
    expect(widest(await rowText(ui, 'mine'))).toBeLessThanOrEqual(109)
    // the title is cut with an ellipsis and each line, icon included, is exactly 109 cells.
    const lines = (await rowText(ui, 'mine')).split('\n')
    expect(lines[1]).toContain('…')
    for (const line of lines) expect([...line].length).toBe(107)
  })
  test('Dock requests 44 columns', () => {
    expect(PANE_COLUMNS).toBe(44)
  })
  // project icons, not creatures, are hidden below 30 columns.
  test('Dock narrower than 30 usable columns (icons hidden below 30; setting unchanged)', async ($, on) => {
    const narrow = await mountPane($, on, [S('mine'), S('n', { status: 'waiting' })], {}, 29)
    const wide = await mountPane($, on, [S('mine'), S('n', { status: 'waiting' })], {}, 32)
    expect(await iconKindOf(wide.ui, 'n')).toBe('monogram')
    expect(await iconKindOf(narrow.ui, 'n')).toBe('none')
    expect(narrow.store.get('setting:icons') ?? true).toBe(true)
  })
  test('Edge: Session ends (card gone in one refresh; pin restored on resume within 30 days)', async ($, on) => {
    const store = new Map<string, unknown>([[`pref:${idOf('a')}`, { isPinned: true, seenAt: TUE_10 }]])
    const withA = await mountPane($, on, [S('mine'), S('a')], { store })
    expect((await orderOf(withA.ui)).pinned).toEqual(refs('a'))
    const without = await mountPane($, on, [S('mine')], { store })
    expect(await without.ui.find({ key: `open:${refOf('a')}` })).toBeUndefined()
    const back = await mountPane($, on, [S('mine'), S('a')], { store })
    expect((await orderOf(back.ui)).pinned).toEqual(refs('a'))
  })
  test('Edge: Snooze across restart (card back on a normal shelf with "Woke")', async ($, on) => {
    const store = new Map<string, unknown>([[`pref:${idOf('a')}`, { snoozedUntil: TUE_10 - HOUR }]])
    const { ui } = await mountPane($, on, [S('mine'), S('a')], { store })
    expect((await orderOf(ui)).active).toContain(refOf('a'))
    expect(await rowText(ui, 'a')).toMatch(/Woke/)
  })
  test('Edge: Pinned and snoozed (unpinned, in Snoozed; Unpin not offered)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a')], { selfName: 'zz', store: new Map([[`pref:${idOf('a')}`, { isPinned: true }]]) })
    await press(ui, `snooze:${refOf('a')}`); await press(ui, 'snooze-pick:5 hours')
    expect((await orderOf(ui)).pinned ?? []).toEqual([])
    await press(ui, 'shelf:snoozed')
    expect((await orderOf(ui)).snoozed).toEqual(refs('a'))
  })
  test('Edge: Two sessions, same project (titles and branches differ)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a', { cwd: '/p/same', title: 'One' }), S('b', { cwd: '/p/same', title: 'Two' })], { selfName: 'zz' })
    expect(await rowText(ui, 'a')).toContain('One')
    expect(await rowText(ui, 'b')).toContain('Two')
  })
  test('Edge: Title missing at first (name shown; generated title on the next refresh)', async ($, on) => {
    const sessions = [S('a')]
    const { ui, clock } = await mountPane($, on, sessions, { selfName: 'zz' })
    expect(await rowText(ui, 'a')).toContain('a')
    sessions[0]!.title = 'Generated later'
    // phase 2: a new title means the session wrote its transcript, so its registry updatedAt moves.
    sessions[0]!.ageMs = -6000
    await clock.advance(6000); await ui.advance(6000)
    expect(await rowText(ui, 'a')).toContain('Generated later')
  })
  test('Edge: Session list unreadable or changed (card shows the name; no invented values)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a')], { selfName: 'zz', listingBroken: true })
    // phase 2: a listed row with no ref keeps its name as the card id (phase-1 Row.id rule).
    const text = await linesById(ui, 'a')
    expect(text).toContain('a')
    expect(text).not.toMatch(/\d+%|#\d+/)
  })
  test('Edge: Status sources disagree (most recent change wins)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('a', { status: 'busy', sinceMs: 10 * MIN })], { selfName: 'zz', agents: [] })
    expect(await rowText(ui, 'a')).toMatch(/Working/)
    // phase 2: positive twin -- the cross-check reports a newer change (waiting), which wins over the older registry status.
    const world: World = { agentsJson: [{ sessionId: idOf('a'), name: 'a', cwd: '/p/a', kind: 'interactive', status: 'waiting', pid: 1, startedAt: TUE_10 - DAY }] }
    const later = await mountPane($, on, [S('a', { status: 'busy', sinceMs: 10 * MIN })], { selfName: 'zz', agents: [], ...world })
    await later.clock.advance(31_000); await later.ui.advance(31_000)
    expect(await rowText(later.ui, 'a')).toMatch(/Needs you/)
  })
  test('Edge: Child with no description (row shows the type)', async ($, on) => {
    const { ui } = await mountPane($, on, [S('mine')], { agents: [AGENT('a1', 'running', undefined)] })
    expect((await ui.find({ key: 'view:a1' }))?.text).toContain('Explore')
  })
  // edge "Next with only cross-app needs-you" -- withdrawn with Next.
  test('Edge: Clock jump (snooze times unchanged; ages never negative)', async ($, on) => {
    const store = new Map<string, unknown>([[`pref:${idOf('a')}`, { snoozedUntil: TUE_10 + 5 * HOUR }]])
    // The clock cannot run backwards in the harness, so the jump is a session whose activity lies in the future.
    const { ui } = await mountPane($, on, [S('a'), S('b', { ageMs: -HOUR, sinceMs: -HOUR })], { store, selfName: 'zz' })
    expect((store.get(`pref:${idOf('a')}`) as { snoozedUntil: number }).snoozedUntil).toBe(TUE_10 + 5 * HOUR)
    expect(await rowText(ui, 'b')).not.toMatch(/-\d/)
    // phase 2: positive twin -- a future time reads 'now'.
    expect((await rowText(ui, 'b')).split('\n')[0]).toMatch(/now\s*$/)
  })
  // edge "Many sessions" -- the top line is withdrawn; every needs-you card still shows.
  test('Edge: Many sessions (every needs-you card shows; no top line)', async ($, on) => {
    const many = Array.from({ length: 40 }, (_, i) => S(`s${i}`, { status: i < 3 ? 'waiting' : 'idle', ageMs: i * MIN }))
    const { ui } = await mountPane($, on, many, { selfName: 'zz' })
    expect(await hasText(ui, /need you/)).toBe(false)
    for (const name of ['s0', 's1', 's2']) expect(await rowText(ui, name)).toMatch(/Needs you/)
  })
})
// TODO(translator): Edge "Unicode-RTL / CJK width" needs the display-width function, which the harness does not expose; ASCII is covered elsewhere.
// TODO(translator): Edge "Ghostty without automation permission" needs the adapter's permission-denied signal shape, which the plan does not fix.
todo('Edge: Dock narrower than requested, drag resize redraws within one refresh -- layer live-Ghostty')
todo('Wide fullscreen terminal (pane docked at right at 110 columns) -- layer live-Ghostty')
todo('manual visual check: project icons, hills scene and whole-pane fidelity against pane-dark.jpeg -- layer manual visual check')
todo('manual visual check: colour art quality in dark and light themes -- layer manual visual check')
