// Black-box checks for WS-138 (orchestration progress in Bridge), compiled from
// docs/features/012-ws-138-bridge-orch-progress/validation-plan.md. Re-translated after /ddd:plan locked the interfaces (plan.md,
// "Locked Contracts", "Interfaces & Contracts" and "Re-translation decisions").
// Pure rules are driven through paneViewOf (the view the pane draws); drawn text, redraw timing, presses and sound
// are driven through the module entry (hooks/register.tsx) with the host stubbed at the lowest boundary. The locked pure rules
// ticketProgressOf and barCellsOf (hooks/core/progress.ts, new) are imported for the status-level checks (R-7); the Bridge runner allows no
// dynamic import, so until that module exists this file does not load.
// Failures are the bar: the feature is not built yet. Test names are the validation plan's Intent lines.
import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

import { REGISTRY_SCRIPT, REGISTRY_SEPARATOR } from '../hooks/pane-policy'
import { BRANCH_SCRIPT, TITLE_SCRIPT } from '../hooks/card-policy'
import { PALETTES } from '../hooks/core/palette'
import { loadStored, PANE_ARGS_HINT } from '../hooks/core/persist'
import { cellWidth } from '../hooks/core/width'
import { barCellsOf, ticketProgressOf } from '../hooks/core/progress'
import { paneViewOf } from '../hooks/core/view'
import type { CardView, Child, ChildStatus, PaneView, Seg, Session } from '../hooks/core/types'
import { BUSY_STATUS_LINE, FLOW_HOST_LOG, IDLE_STATUS_LINE, SIX_WORKER_MORE, SIX_WORKER_ROWS } from './fixtures/ws138/baseline'

tier('builtin')

// Id map, in file order (a test carries its Intent line as its name; NH tests also carry their id):
// 1 detection:       AC-01 AC-02 AC-03 AC-04 AC-05 AC-06 AC-07 AC-08 AC-09 AC-10 AC-11 (11 has two tests: remount, tickets off)
// 2 ticket status:   AC-12 AC-13 (two tests: view, raw statuses) AC-14 AC-15
// 3 bar and count:   AC-16 AC-17 (two tests) AC-18 (two tests: widths, cell glyphs) AC-19 AC-20 (two tests: hues, ticket statuses) AC-21 (three tests: same-prefix, cross-prefix, WS-9/WS-10 ties)
//                    AC-22 (two tests: pane, one-line card) AC-23 AC-24 AC-25 (two tests: hues, ticket statuses) AC-26
// 4 ticket rows:     AC-27 AC-28 (two tests) AC-29 AC-30 AC-31 AC-32 AC-33 AC-34 AC-35 AC-36 AC-37
// 5 waiting:         AC-38 (three tests) AC-39 AC-40 (two tests) AC-41 AC-42 (two tests) AC-43 (two tests) AC-44 AC-45, Waiting vs snoozed and Woke (edge)
// 6 other sessions:  AC-46 (two tests) AC-47
// 7 text/permission: AC-48 (two H tests) AC-49 (H test) TC-1 (test) TC-2 (root suite)
// Spec compliance and edge-case tests follow, then NH-1 to NH-14 (one test each).
//
// The runner imports code files only and has no file read, so the S layer (README, CHANGELOG, manifest, README sentence) cannot run here.
// Its baselines are frozen from 6c505cf, to be committed before dispatch, beside this file in fixtures/ws138/ (README.baseline.md,
// CHANGELOG.baseline.md, plugin.baseline.json, hooks.baseline.json, README-reads.baseline.txt) for the Workspace-root suite. The frozen pane
// literals and the frozen host-call log (FLOW_HOST_LOG) are in fixtures/ws138/baseline.ts, also frozen from 6c505cf.

// The testing module has no todo; use one when the runner offers it, else register nothing.
const todo: (name: string) => void = (test as unknown as { todo?: (name: string) => void }).todo ?? (() => {})

/** The longest bar the plan allows (L-2: `MAXBAR = 12` in hooks/core/progress.ts, set after the 44-column capture). One constant; cases derive from it. */
const MAXBAR = 12

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = 1_800_000_000_000
const T0 = NOW - 90 * MIN
const PFX = ['WS-', 'APP-'] as const
const P = PALETTES.dark

// ---------------------------------------------------------------- pure side: paneViewOf
type Hue = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet' | 'gray' | 'none'
type TStatus = 'working' | 'needs-you' | 'failed' | 'done' | 'stopped'
const CHILD_OF: Record<TStatus, ChildStatus> = { working: 'working', 'needs-you': 'needs-you', failed: 'failed', done: 'done', stopped: 'idle' }

/** A worker: label is its description; `at` is its start in minutes after T0; `ago` is minutes in its status. */
const kid = (label: string, status: ChildStatus, at: number, ago = 2, id?: string): Child =>
  ({ id: id ?? `w-${label.replace(/\W+/g, '-')}`, label, status, since: NOW - ago * MIN, startedAt: T0 + at * MIN })
/** One worker for a ticket: `scan <ID> alpha`, never starting with the id. */
const tk = (ticket: string, status: TStatus, at: number, word = 'alpha'): Child => kid(`scan ${ticket} ${word}`, CHILD_OF[status], at)

const sess = (over: Partial<Session> & { id: string }): Session => ({
  prefId: over.id, name: over.id, activityAt: NOW - MIN, raw: 'idle', statusSince: NOW - 2 * HOUR, title: `${over.id} title`, project: 'proj', isSelf: false, ...over,
})
type V = { width?: number; prefixes?: readonly string[]; own?: Partial<Session>; finishedAt?: number; workingShelf?: boolean; others?: Session[]; inactiveOpen?: boolean; snoozedOpen?: boolean; ownEntry?: { snoozedUntil?: number; snoozedAt?: number; wokeAt?: number } }
const view = (children: Child[], o: V = {}): PaneView => {
  const base = loadStored(new Map()).stored
  const prefixes = o.prefixes ?? PFX
  const stored = {
    ...base,
    entries: { ...base.entries, ...(o.ownEntry ? { own: o.ownEntry } : {}) },
    collapsed: { ...base.collapsed, ...(o.inactiveOpen ? { inactive: false } : {}), ...(o.snoozedOpen ? { snoozed: false } : {}) },
    settings: { ...base.settings, workingShelf: o.workingShelf ?? false, ...(prefixes.length > 0 ? { tickets: prefixes } : {}) },
  }
  return paneViewOf({
    sessions: [sess({ id: 'own', isSelf: true, title: 'Orchestrate the release train with many parts to it, long enough to be cut', ...o.own }), ...(o.others ?? [])],
    stored, finished: o.finishedAt === undefined ? {} : { own: o.finishedAt }, children, now: NOW, width: o.width ?? 44,
    caps: { trueColor: true, pictures: false }, bell: 0, palette: P, projectColors: new Map([['proj', '#88aacc']]),
  })
}
const cardOf = (v: PaneView, pick: (c: CardView) => boolean = c => c.isSelected): CardView => v.shelves.flatMap(s => s.cards).find(pick)!
const ownOf = (v: PaneView) => cardOf(v)
const plain = (segs: readonly Seg[]) => segs.map(s => (s.kind === 'spinner' ? '⠋' : s.text)).join('')
const hueOf = (color?: string): Hue => ((Object.entries(P.text).find(([, hex]) => hex === color)?.[0] as Hue | undefined) ?? 'none')
const COUNT = /(?<![\d/])(\d+\/\d+)(?![\d/])/
const countIn = (text: string): string | null => COUNT.exec(text)?.[1] ?? null
const countOf = (segs: readonly Seg[]) => countIn(plain(segs))
/**
 * The bar's cells between the title and the count (to the end of the line when there is no count), each as the hue it is drawn in.
 * A cell is counted by its colour, never by its glyph: a coloured background (a blank cell) counts, a non-blank glyph in a status hue counts.
 * The status and project runs are not part of the bar.
 */
const barOf = (line: readonly Seg[]): Hue[] => {
  const title = line.findIndex(s => s.kind === 'text' && s.role === 'title')
  if (title < 0) return []
  let end = line.length
  line.forEach((s, i) => { if (i > title && s.kind === 'text' && /\d+\/\d+/.test(s.text)) end = i })
  return line.slice(title + 1, end).flatMap(s => {
    if (s.kind !== 'text' || s.role === 'status' || s.role === 'project') return []
    const bg = hueOf(s.bg)
    const fg = hueOf(s.color)
    return [...s.text].flatMap(c => (bg !== 'none' ? [bg] : c.trim() !== '' && fg !== 'none' ? [fg] : []))
  })
}
/** The line carries a segment with the role `title`: `barOf` reads nothing without one, so an absence check asserts it first. */
const hasTitle = (line: readonly Seg[]) => line.some(s => s.kind === 'text' && s.role === 'title')
const rep = (hue: Hue, n: number): Hue[] => Array.from({ length: n }, () => hue)
const rowsOf = (v: PaneView) => ownOf(v).children?.rows ?? []
const stripRow = (text: string) => text.replace(/^[\s│┃|●▸]*/, '')
const LEAD = /^((?:WS|APP|app)-\d+)(?![\p{L}\p{N}])/u
/** A row's lead: its ticket id when it starts with one, else its first two words (a worker's row). */
const leadOf = (text: string) => { const s = stripRow(text); return LEAD.exec(s)?.[1] ?? s.split(/\s+/).slice(0, 2).join(' ') }
const leads = (v: PaneView) => rowsOf(v).map(r => leadOf(plain(r.text)))
const rowFor = (v: PaneView, id: string) => rowsOf(v).find(r => leadOf(plain(r.text)) === id)
const rowText = (v: PaneView, id: string) => { const r = rowFor(v, id); return r ? plain(r.text) : '' }
const dotHue = (segs: readonly Seg[] | undefined): Hue => hueOf((segs ?? []).find(s => s.kind === 'text' && s.text.includes('●'))?.color as string | undefined)
const WIDTHS = Array.from({ length: 120 }, (_, i) => 120 - i)
const lineAt = (kids: Child[], width: number, o: V = {}) => ownOf(view(kids, { ...o, width })).lines[1] ?? []
/** The bar at the first (widest) width that draws exactly `n` cells; at 44 columns when no width does. */
const barWith = (kids: Child[], n: number, o: V = {}): Hue[] => {
  for (const w of WIDTHS) { const cells = barOf(lineAt(kids, w, o)); if (cells.length === n) return cells }
  return barOf(lineAt(kids, 44, o))
}
const tickets = (n: number, status: TStatus = 'working') => Array.from({ length: n }, (_, i) => tk(`WS-${11 + i}`, status, i))
const runsOf = (hues: readonly Hue[]) => hues.filter((h, i, all) => h !== all[i - 1])
/** Pane widths from `from` down to `to`, widest first. */
const sweep = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i)
const roleOf = (s: Seg) => (s.kind === 'text' ? (s.role as string | undefined) : undefined)
/** The title line as tokens, adjacent repeats collapsed: a role name, `sp` for a role-less all-space text, `other` for any other role-less text, `spin` for a spinner. */
const tokensOf = (line: readonly Seg[]): string[] =>
  line.map(s => (s.kind === 'spinner' ? 'spin' : roleOf(s) ?? (/^ +$/.test(s.text) ? 'sp' : 'other'))).filter((t, i, all) => t !== all[i - 1])
/** The text of the segments with role `bar`, joined. */
const barText = (line: readonly Seg[]) => line.filter(s => roleOf(s) === 'bar').map(s => (s.kind === 'text' ? s.text : '')).join('')
/** The cells of the status slot on a one-line card: from the first spinner or `status` segment to the end. */
const slotOfLine = (line: readonly Seg[]) => { const i = line.findIndex(s => s.kind === 'spinner' || roleOf(s) === 'status'); return i < 0 ? [] : line.slice(i) }
/** The ticket status of each of N bar cells, from the locked pure rules (hooks/core/progress.ts, plan L-4 and L-6). */
const statusCells = async (kids: Child[], n: number): Promise<string[]> => {
  const progress = ticketProgressOf(kids, PFX)
  return progress ? barCellsOf(progress.tickets, n) : []
}
const runsOfStatus = (cells: readonly string[]) => cells.filter((c, i, all) => c !== all[i - 1])
const countRuns = (cells: readonly string[]) => runsOfStatus(cells).map(s => [s, cells.filter(c => c === s).length] as const)

// ---------------------------------------------------------------- host side: the module entry
const FIELD_SEP = '\u001f'
const ITEM_SEP = '\u001e'
const TUE_10 = new Date(2026, 9, 13, 10, 0, 0).getTime()
const DAY = 24 * HOUR
type Sess = { name: string; status?: 'busy' | 'waiting' | 'idle' | 'completed'; cwd?: string; ageMs?: number; sinceMs?: number; title?: string }
const refOf = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(6, '0').slice(-6)
const idOf = (name: string) => `${refOf(name)}00-0000-4000-8000-000000000000`
const S = (name: string, x: Omit<Sess, 'name'> = {}): Sess => ({ name, ...x })
type World = {
  agents?: unknown[]; agentsFail?: boolean; store?: Map<string, unknown>; views?: Array<Record<string, unknown>>
  host?: string[]; texts?: string[]; selfName?: string; ask?: boolean
}
/**
 * File, process and network events of the host layer (the event names the Claude Code types declare for files, programs, network and
 * tool servers). Reads answer with the host's default; the rest are refused. `fs.stat`, `fs.exists` and `process.run` have their own stubs below.
 */
const HOST_READ_EVENTS = ['fs.read', 'fs.list', 'fs.ancestors', 'settings.read', 'session.repo', 'session.messages', 'prompt.read'] as const
const HOST_REFUSED_EVENTS = ['fs.write', 'http.fetch', 'mcp.call', 'mcp.connect', 'model.complete', 'model.classify', 'model.fork', 'audio.speak', 'session.authorize', 'env.set'] as const
const payloadOf = (e: unknown): string => { try { return JSON.stringify(e) ?? '' } catch { return String(e) } }
const registryOf = (sessions: Sess[], now: number) =>
  sessions.map((s, i) => JSON.stringify({
    pid: i + 1, startedAt: now - DAY, updatedAt: now - (s.ageMs ?? 0), statusSince: now - (s.sinceMs ?? s.ageMs ?? 0),
    sessionId: idOf(s.name), cwd: s.cwd ?? `/p/${s.name}`, kind: 'interactive', name: s.name, status: s.status ?? 'idle',
  })).join(REGISTRY_SEPARATOR) + REGISTRY_SEPARATOR
const listingOf = (sessions: Sess[]) => ({ listing: 'text', sections: [{ kind: 'sessions', total: sessions.length, rows: sessions.map(s => ({ name: s.name, ref: refOf(s.name), status: s.status ?? 'idle' })) }] })

type Current = { sessions: Sess[]; world: World; store: Map<string, unknown>; base: number }
const registered = new WeakMap<object, { current: Current; clock: ReturnType<typeof mock.clock>; mounts: number }>()
const engine = (on: On, sessions: Sess[], world: World) => {
  const known = registered.get(on as object)
  if (known) {
    known.current.sessions = sessions; known.current.world = world; known.current.store = world.store ?? new Map<string, unknown>()
    const pending = TUE_10 > known.clock.now() ? known.clock.set(TUE_10) : undefined
    known.current.base = Math.max(TUE_10, known.clock.now())
    return { store: known.current.store, clock: known.clock, mounts: ++known.mounts, pending }
  }
  const current: Current = { sessions, world, store: world.store ?? new Map<string, unknown>(), base: TUE_10 }
  const clock = mock.clock(on, { now: TUE_10 })
  registered.set(on as object, { current, clock, mounts: 0 })
  const self = () => current.world.selfName ?? current.sessions[0]?.name ?? 'x'
  // `reg` wraps registration only: the hook is registered as given, matcher arguments first.
  const reg = (name: string, ...rest: unknown[]) => {
    const hook = rest.pop() as (...a: unknown[]) => unknown
    ;(on as unknown as (...a: unknown[]) => void)(name, ...rest, (...a: unknown[]) => hook(...a))
  }
  reg('store.get', ($s: unknown, e: { key: string }) => ({ value: current.store.get(e.key) }))
  reg('store.set', ($s: unknown, e: { key: string; value: unknown }) => (current.store.set(e.key, e.value), { value: undefined }))
  reg('store.delete', ($s: unknown, e: { key: string }) => (current.store.delete(e.key), { value: undefined }))
  reg('store.keys', () => ({ value: [...current.store.keys()] }))
  reg('session.start', ($s: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  reg('session.id', () => ({ value: idOf(self()) }))
  reg('tool.call', { tool: 'ListAgents' }, () => ({ result: listingOf(current.sessions) }))
  reg('agent.list', () => (current.world.agentsFail ? { deny: 'unreadable' } : { value: current.world.agents ?? [] }))
  reg('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  reg('config.list', () => ({ value: [] }))
  reg('ui.blit', () => ({ value: {} }))
  reg('ui.copy', () => ({ value: { isCopied: true } }))
  reg('ui.view', ($s: unknown, e: unknown, next: (e: unknown) => unknown) => (current.world.views ? (current.world.views.push(e as Record<string, unknown>), { value: {} }) : next(e)))
  reg('ui.toast', ($s: unknown, e: unknown) => (current.world.texts?.push(JSON.stringify(e)), { value: undefined }))
  reg('ui.open', () => ({ value: { isPlaced: true } }))
  reg('command.register', ($s: unknown, e: unknown) => (current.world.texts?.push(JSON.stringify(e)), { value: undefined }))
  reg('env.get', ($s: unknown, e: { name: string }) => ({ value: ({ TERM_PROGRAM: 'ghostty', COLORTERM: 'truecolor', HOME: '/h' } as Record<string, string>)[e.name] }))
  reg('tool.check', ($s: unknown, e: unknown, next: (e: unknown) => unknown) => (current.world.ask ? { decision: 'ask' } : next(e)))
  reg('classic.Stop', () => ({}))
  reg('classic.StopFailure', () => ({}))
  reg('classic.UserPromptSubmit', () => ({}))
  // A recording stub for every other file, process and network event of the host layer (the testing module offers no catch-all):
  // one line per call, `<event> <payload>`, in `world.host`. Reads and listings take the host's default answer; writes, spawns and network calls are refused.
  for (const name of HOST_READ_EVENTS) {
    reg(name, ($s: unknown, e: unknown, next: (e: unknown) => unknown) => (current.world.host?.push(`${name} ${payloadOf(e)}`), next(e)))
  }
  for (const name of HOST_REFUSED_EVENTS) {
    reg(name, ($s: unknown, e: unknown) => (current.world.host?.push(`${name} ${payloadOf(e)}`), { deny: 'recorded' }))
  }
  // `process.spawn` streams: its hook is an async generator, so it is registered without the wrapper.
  ;(on as unknown as (name: string, hook: unknown) => void)('process.spawn', async function* ($s: unknown, e: unknown) { current.world.host?.push(`process.spawn ${payloadOf(e)}`); return { deny: 'recorded' } })
  reg('fs.stat', ($s: unknown, e: { path: string }) => (current.world.host?.push(`fs.stat ${e.path}`), { deny: 'ENOENT' }))
  reg('fs.exists', ($s: unknown, e: { path: string }) => (current.world.host?.push(`fs.exists ${e.path}`), { value: false }))
  reg('process.run', ($s: unknown, e: { argv: readonly string[] }) => {
    const argv = e.argv
    current.world.host?.push(`process.run ${argv.join(' ')}`)
    const done = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'sh' && argv[2] === REGISTRY_SCRIPT) return done(registryOf(current.sessions, current.base))
    if (argv[0] === 'sh' && argv[2] === TITLE_SCRIPT) {
      return done(argv.slice(4).map(spec => {
        const found = current.sessions.find(one => idOf(one.name) === (spec.split('/').at(-1) ?? ''))
        const ai = found?.title ? JSON.stringify({ type: 'ai-title', aiTitle: found.title }) : ''
        return `${ai}${FIELD_SEP}${FIELD_SEP}${ITEM_SEP}`
      }).join(''))
    }
    if (argv[0] === 'sh' && argv[2] === BRANCH_SCRIPT) return done(argv.slice(4).map(() => `${FIELD_SEP}${ITEM_SEP}`).join(''))
    if (argv[0] === 'ps') return done(current.sessions.map((s, i) => `${i + 1} ttys00${i + 1} claude --x TERM_PROGRAM=ghostty`).join('\n') + '\n')
    if (argv[0] === 'claude' && argv[1] === 'agents') return done('[]')
    return done('ok\n')
  })
  return { store: current.store, clock, mounts: 0, pending: undefined }
}
type Ui = any
const mountPane = async ($: any, on: On, sessions: Sess[], world: World = {}, cols = 44) => {
  const { store, clock, mounts, pending } = engine(on, sessions, world)
  await pending
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
  await $.command.run({ command: 'bridge', args: '' } as never)
  const ui: Ui = await $.ui.mount({
    plugin: 'bridge', surface: 'terminal', component: 'Pane',
    props: { title: 'Bridge', isFocused: false, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as never,
    requestId: mounts === 0 ? 'bridge' : `bridge-${mounts}`,
  })
  return { ui, store, clock, world }
}
const withPrefixes = (extra: World = {}): World => ({ ...extra, store: new Map<string, unknown>([['setting:tickets', [...PFX]], ...(extra.store ?? [])]) })
/** One redraw: the pane refreshes every 5 seconds, so exactly 5000 ms. */
const redraw = async (clock: { advance: (ms: number) => Promise<unknown> }, ui: Ui) => { await clock.advance(5000); await ui.advance(5000) }
const linesById = async (ui: Ui, id: string) => {
  const lines: string[] = []
  for (const key of ['line1', 'line2', 'line3']) {
    const one = await ui.find({ key: `${key}:${id}` })
    if (one) lines.push(one.text as string)
  }
  return lines
}
const cardLines = (ui: Ui, name = 'own') => linesById(ui, refOf(name))
const H_AGENT = (id: string, status: string, description: string, startMin: number, extra: object = {}) =>
  ({ id, description, type: 'Explore', status, startedAt: TUE_10 - 60 * MIN + startMin * MIN, statusSince: TUE_10 - 2 * MIN, ...extra })
/**
 * The drawn worker or ticket rows under the cards, found by what they show (a row starts with the tree glyph), never by element key.
 * A row's nested boxes repeat its text, so a text already taken is not taken twice.
 */
const ROW_START = /^\s*[│┃|]/
const drawnRows = async (ui: Ui): Promise<string[]> => {
  const texts = (await ui.findAll({ type: 'Box' })).map((e: any) => String(e.text ?? '')).filter((t: string) => ROW_START.test(t))
  return texts.filter((t: string, i: number) => !texts.slice(0, i).some((before: string) => before.trim() === t.trim()))
}
const hLeads = async (ui: Ui) => (await drawnRows(ui)).map(leadOf)
/** The hue of the status dot in each drawn row, in row order: the dot's colour read from the row's own element tree. */
const rowDotHues = async (ui: Ui): Promise<Hue[]> => {
  const dotsIn = (el: any): Hue[] => {
    if (el === null || typeof el !== 'object') return []
    const own = el.type === 'Text' && String(el.text ?? (el.children ?? []).filter((c: unknown) => typeof c === 'string').join('')).includes('●') ? [hueOf(el.props?.color as string | undefined)] : []
    return [...own, ...(el.children ?? []).flatMap(dotsIn)]
  }
  const boxes = (await ui.findAll({ type: 'Box' })).filter((e: any) => ROW_START.test(String(e.text ?? '')))
  const firsts = boxes.filter((e: any, i: number) => !boxes.slice(0, i).some((before: any) => String(before.text).trim() === String(e.text).trim()))
  return firsts.flatMap((e: any) => dotsIn(e).slice(0, 1))
}
const allText = async (ui: Ui): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map((e: any) => String(e.text ?? ''))
const ownCount = async (ui: Ui) => countIn((await cardLines(ui))[1] ?? '')
const ownStatus = async (ui: Ui) => (await cardLines(ui))[0] ?? ''
/** The own card is drawn: its title shows on its lines. */
const ownTitleDrawn = async (ui: Ui, title: string) => (await cardLines(ui)).join('\n').includes(title)
const THREE = (): unknown[] => [H_AGENT('a1', 'running', 'scan WS-11 alpha', 0), H_AGENT('a2', 'running', 'fix WS-12 beta', 1), H_AGENT('a3', 'running', 'port APP-3 gamma', 2)]
/** A worker's open question through the host, as the existing child-row Needs you tests raise it: the permission check answers `ask`. */
const askFor = async ($: any, world: World, agentId: string) => {
  world.ask = true
  await $.tool.check({ tool: 'Bash', command: 'ls', agentId, tool_use_id: `tu-${agentId}` } as never)
}
/**
 * The flow both runtime contract checks count, from before the mount: mount the pane with workers on three tickets, run `/bridge tickets WS-`,
 * 13 redraws (65 s of fake time, so the 30 s agents cross-check and the 60 s pull-request read both run). Returns every recorded file,
 * process and network call, sorted, and the mounted pane, so a check can prove the flow reached the feature's state (R-16).
 */
const flowHostLog = async ($: any, on: On): Promise<{ log: string[]; ui: Ui }> => {
  const world: World = { agents: THREE(), host: [] }
  const { ui, clock } = await mountPane($, on, [S('own')], world)
  await $.command.run({ command: 'bridge', args: 'tickets WS-' } as never)
  for (let i = 0; i < 13; i++) await redraw(clock, ui)
  return { log: [...world.host!].sort(), ui }
}
/** What the flow shows after the 13 redraws: prefix `WS-` makes WS-11 and WS-12 two tickets (APP-3 is no ticket), and the idle own card with running workers reads Waiting. */
const flowReached = async (ui: Ui) => ({ count: await ownCount(ui), waiting: /Waiting/.test(await ownStatus(ui)) })
const eventNames = (lines: readonly string[]) => [...new Set(lines.map(line => line.split(' ')[0]!))].sort()
const distinct = (lines: readonly string[]) => [...new Set(lines)].sort()

// ================================================================ 1. Detection (AC-01 to AC-11)
describe('1. detection', () => {
  test('Owner with ticket prefixes set sees ticket progress once the own session\'s workers span two tickets', () => {
    const v = view([tk('WS-11', 'working', 0), tk('WS-12', 'done', 1)])
    expect({ count: countOf(ownOf(v).lines[1]!), leads: leads(v) }).toEqual({ count: '1/2', leads: ['WS-11', 'WS-12'] })
  })
  test('Owner whose workers all work on one ticket sees the card unchanged', () => {
    const v = view([tk('WS-11', 'working', 0, 'a'), tk('WS-11', 'done', 1, 'b'), tk('WS-11', 'working', 2, 'c'), tk('WS-11', 'failed', 3, 'd')])
    expect({ count: countOf(ownOf(v).lines[1]!), rows: rowsOf(v).length }).toEqual({ count: null, rows: 4 })
  })
  test('Owner whose workers name no ticket sees the card unchanged', () => {
    const v = view([kid('review docs', 'working', 0), kid('lint pass', 'done', 1), kid('trim fixtures', 'working', 2)])
    expect({ count: countOf(ownOf(v).lines[1]!), rows: rowsOf(v).length }).toEqual({ count: null, rows: 3 })
  })
  test('Owner with ticket prefixes off sees no ticket progress even when worker text holds ids', () => {
    const v = view([tk('WS-138', 'working', 0), tk('WS-139', 'working', 1)], { prefixes: [] })
    expect({ count: countOf(ownOf(v).lines[1]!), rows: rowsOf(v).map(r => plain(r.text).includes('WS-1')) }).toEqual({ count: null, rows: [true, true] })
  })
  test('Owner sees `WS-7` and `WS-07` counted as two tickets', () => {
    const v = view([tk('WS-7', 'working', 0), tk('WS-07', 'working', 1)])
    expect(countOf(ownOf(v).lines[1]!)).toBe('0/2')
  })
  test('Owner whose worker text has the wrong letter case gets no ticket from it', () => {
    // `ws-138` and `APP-14` match no prefix (case); `app-12`, `app-13` match prefix `app`: two tickets.
    const v = view([kid('scan ws-138 a', 'working', 0), kid('scan app-12 b', 'working', 1), kid('scan app-13 c', 'working', 2), kid('scan APP-14 d', 'working', 3)], { prefixes: ['WS-', 'app'] })
    expect(countOf(ownOf(v).lines[1]!)).toBe('0/2')
  })
  test('Owner sees a worker that names two tickets counted toward the first only', () => {
    const v = view([kid('do WS-1 and WS-2', 'working', 0), kid('WS-3 scan', 'working', 1)])
    expect({ count: countOf(ownOf(v).lines[1]!), leads: leads(v) }).toEqual({ count: '0/2', leads: ['WS-1', 'WS-3'] })
  })
  test('Owner sees ids glued inside longer words ignored', () => {
    const v = view([kid('scan XWS-12 a', 'working', 0), kid('scan WS-12b b', 'working', 1), kid('scan (WS-12) c', 'working', 2), kid('scan WS-12. d', 'working', 3), kid('scan WS-13 e', 'working', 4)])
    expect(countOf(ownOf(v).lines[1]!)).toBe('0/2')
  })
  test('Owner sees a worker\'s agent type never used as its ticket', async ($, on) => {
    // Two real tickets plus a worker whose only id is its type: the type adds no third ticket.
    const agents = [H_AGENT('a1', 'running', 'scan WS-11 alpha', 0), H_AGENT('a2', 'running', 'fix WS-12 beta', 1), H_AGENT('a3', 'running', 'tidy the shelf', 2, { type: 'WS-99-runner' })]
    const { ui } = await mountPane($, on, [S('own')], withPrefixes({ agents }))
    expect(await ownCount(ui)).toBe('0/2')
  })
  test('Owner sees ticket progress appear within one redraw of a second ticket being listed', async ($, on) => {
    const world = withPrefixes({ agents: [H_AGENT('a1', 'running', 'scan WS-11 alpha', 0)] })
    const { ui, clock } = await mountPane($, on, [S('own')], world)
    const before = await ownCount(ui)
    world.agents = [H_AGENT('a1', 'running', 'scan WS-11 alpha', 0), H_AGENT('a2', 'running', 'fix WS-12 beta', 1)]
    await redraw(clock, ui)
    expect({ before, after: await ownCount(ui) }).toEqual({ before: null, after: '0/2' })
  })
  test('Owner sees ticket progress disappear within one redraw once fewer than two tickets remain', async ($, on) => {
    const two = [H_AGENT('a1', 'running', 'scan WS-11 alpha', 0), H_AGENT('a2', 'completed', 'fix WS-12 beta', 1)]
    const first = await mountPane($, on, [S('own')], withPrefixes({ agents: two }))
    const shown = await ownCount(first.ui)
    // A mod reload drops the forgotten finished worker: the remount lists only WS-11.
    const again = await mountPane($, on, [S('own')], withPrefixes({ agents: [two[0]] }))
    expect({ shown, afterReload: await ownCount(again.ui) }).toEqual({ shown: '1/2', afterReload: null })
  })
  test('Owner sees ticket progress disappear within one redraw once fewer than two tickets remain (tickets off)', async ($, on) => {
    const { ui, clock } = await mountPane($, on, [S('own')], withPrefixes({ agents: THREE() }))
    const shown = await ownCount(ui)
    await $.command.run({ command: 'bridge', args: 'tickets off' } as never)
    await redraw(clock, ui)
    expect({ shown, after: await ownCount(ui) }).toEqual({ shown: '0/3', after: null })
  })
})

// ================================================================ 2. Ticket status (AC-12 to AC-15)
describe('2. ticket status', () => {
  test('Owner sees a ticket marked Needs you when any of its workers needs them', () => {
    // The worker that needs them started first; the newest worker is Done, the middle one Working: only "any worker needs you wins" gives red.
    const v = view([
      kid('ask WS-11 old', 'needs-you', 0), kid('scan WS-11 mid', 'working', 1), kid('scan WS-11 new', 'done', 2),
      tk('WS-12', 'working', 3),
    ])
    expect(dotHue(rowFor(v, 'WS-11')?.text)).toBe('red')
  })
  test('Owner sees a ticket marked Working while any worker runs and none needs them', () => {
    const v = view([
      kid('scan WS-11 old', 'failed', 0), kid('scan WS-11 new', 'working', 1),
      kid('scan WS-12 a', 'working', 2), kid('scan WS-12 b', 'done', 3),
      kid('scan WS-13 a', 'working', 4),
    ])
    expect(['WS-11', 'WS-12', 'WS-13'].map(id => dotHue(rowFor(v, id)?.text))).toEqual(['yellow', 'yellow', 'yellow'])
  })
  test('Owner sees a ticket marked Working while any worker runs and none needs them (raw pending and waiting)', async ($, on) => {
    // The host's raw statuses `pending` and `waiting` read as Working, so each ticket (older run Failed or Done) is Working: two ticket rows, two yellow dots.
    const agents = [
      H_AGENT('a1', 'failed', 'scan WS-11 old', 0), H_AGENT('a2', 'pending', 'scan WS-11 new', 1),
      H_AGENT('a3', 'completed', 'scan WS-12 old', 2), H_AGENT('a4', 'waiting', 'scan WS-12 new', 3),
    ]
    const { ui } = await mountPane($, on, [S('own')], withPrefixes({ agents }))
    expect({ leads: await hLeads(ui), dots: await rowDotHues(ui) }).toEqual({ leads: ['WS-11', 'WS-12'], dots: ['yellow', 'yellow'] })
  })
  test('Owner sees a finished ticket take the result of its newest run', () => {
    const v = view([
      kid('scan WS-11 a', 'failed', 0), kid('scan WS-11 b', 'done', 2),
      kid('scan WS-12 a', 'done', 4), kid('scan WS-12 b', 'failed', 6),
      kid('scan WS-13 a', 'done', 8), kid('scan WS-13 b', 'idle', 9),
      kid('scan WS-14 a', 'done', 10), kid('scan WS-14 b', 'failed', 10),
    ])
    expect(['WS-11', 'WS-12', 'WS-13', 'WS-14'].map(id => dotHue(rowFor(v, id)?.text))).toEqual(['green', 'red', 'gray', 'red'])
  })
  test('Owner sees a ticket\'s status follow its worker within one redraw', async ($, on) => {
    const world = withPrefixes({ agents: [H_AGENT('a1', 'running', 'scan WS-11 alpha', 0), H_AGENT('a2', 'running', 'fix WS-12 beta', 1)] })
    const { ui, clock } = await mountPane($, on, [S('own')], world)
    const before = { count: await ownCount(ui), working: ((await drawnRows(ui)).find(t => leadOf(t) === 'WS-11') ?? '').includes('Working') }
    world.agents = [H_AGENT('a1', 'completed', 'scan WS-11 alpha', 0), H_AGENT('a2', 'running', 'fix WS-12 beta', 1)]
    await redraw(clock, ui)
    const after = { count: await ownCount(ui), working: ((await drawnRows(ui)).find(t => leadOf(t) === 'WS-11') ?? '').includes('Working') }
    expect({ before, after }).toEqual({ before: { count: '0/2', working: true }, after: { count: '1/2', working: false } })
  })
})

// ================================================================ 3. Progress bar and count (AC-16 to AC-26)
describe('3. progress bar and count', () => {
  const three = () => [tk('WS-11', 'working', 0), tk('WS-12', 'done', 1), tk('WS-13', 'failed', 2)]
  test('Owner reads the bar at the end of the own title line, with the count after it', () => {
    // No chip on this card: the title line is exactly title, spacer, bar cells, one space, count (R-19).
    const line = ownOf(view(three())).lines[1]!
    const last = line[line.length - 1]
    const glue = line[line.length - 2]
    expect({
      tokens: tokensOf(line),
      glue: glue?.kind === 'text' ? glue.text : null,
      count: last?.kind === 'text' ? last.text : null,
      barCells: [...barText(line)].every(c => c === '━' || c === '╸') && barText(line).length >= 5,
    }).toEqual({ tokens: ['title', 'sp', 'bar', 'sp', 'count'], glue: ' ', count: countOf(line), barCells: true })
  })
  test('Owner reads chip, title, bar and count on the title line and the status where it always was', () => {
    // The title line's segments, in order: the chip text, one title segment, one spacer, bar segments, one ' ', one count segment last (R-19).
    const line = ownOf(view(three(), { own: { title: 'WS-138 Orchestrate' } })).lines[1]!
    const title = line.findIndex(s => roleOf(s) === 'title')
    const spacer = line[title + 1]
    const last = line[line.length - 1]!
    expect({
      chip: plain(line.slice(0, title)),
      roles: line.map(roleOf).filter(Boolean).filter((r, i, all) => r !== all[i - 1]),
      title: line[title]!.kind === 'text' ? (line[title] as { text: string }).text : null,
      spacer: spacer?.kind === 'text' && roleOf(spacer) === undefined && spacer.color === undefined && /^ +$/.test(spacer.text),
      glue: tokensOf(line).slice(-3, -1),
      count: last.kind === 'text' ? [roleOf(last), /^\d+\/\d+$/.test(last.text)] : null,
    }).toEqual({ chip: '▐WS-138▌ ', roles: ['title', 'bar', 'count'], title: 'Orchestrate', spacer: true, glue: ['bar', 'sp'], count: ['count', true] })
  })
  test('Owner reads chip, title, bar and count on the title line and the status where it always was (status and age unmoved)', () => {
    // The expected line is frozen from the pre-feature code (fixtures/ws138/baseline.ts): the same card, prefixes off, no workers.
    const withBar = view(three(), { own: { title: 'WS-138 Orchestrate', raw: 'busy', statusSince: NOW - 5 * MIN } })
    expect(plain(ownOf(withBar).lines[0]!)).toBe(BUSY_STATUS_LINE)
  })
  test('Owner sees each ticket get an equal share of the bar, extras to the first tickets', () => {
    const mix = (statuses: TStatus[]) => statuses.map((s, i) => tk(`WS-${11 + i}`, s, i))
    const expand = (hues: Hue[], widths: number[]) => hues.flatMap((h, i) => rep(h, widths[i]!))
    // Widths derive from MAXBAR (literals below are for MAXBAR 12); no case uses N > MAXBAR (R-2).
    expect([
      barWith(mix(['working', 'done', 'stopped']), MAXBAR - 1),
      barWith(mix(['working', 'done', 'stopped', 'failed']), MAXBAR - 2),
      barWith(mix(['working', 'done', 'stopped', 'failed', 'needs-you']), 5),
      barWith(mix(['working', 'done']), MAXBAR),
    ]).toEqual([
      expand(['yellow', 'green', 'gray'], [4, 4, 3]),
      expand(['yellow', 'green', 'gray', 'red'], [3, 3, 2, 2]),
      ['yellow', 'green', 'gray', 'red', 'red'],
      expand(['yellow', 'green'], [6, 6]),
    ])
  })
  test('Owner sees each ticket get an equal share of the bar, extras to the first tickets (cell glyphs)', () => {
    // R-5: every cell is `━`, each segment's last cell `╸`, coloured by foreground, no background, no separator cell. N = 11, T = 3: 4, 4, 3.
    const kids = [tk('WS-11', 'working', 0), tk('WS-12', 'done', 1), tk('WS-13', 'stopped', 2)]
    const line = WIDTHS.map(w => lineAt(kids, w)).find(l => barOf(l).length === MAXBAR - 1) ?? lineAt(kids, 44)
    expect({ text: barText(line), bg: line.filter(s => roleOf(s) === 'bar').some(s => s.kind === 'text' && s.bg !== undefined) }).toEqual({ text: '━━━╸━━━╸━━╸', bg: false })
  })
  test('Owner reads the count as tickets done over all tickets', () => {
    const v = view([tk('WS-11', 'done', 0), tk('WS-12', 'done', 1), tk('WS-13', 'working', 2), tk('WS-14', 'failed', 3), tk('WS-15', 'stopped', 4)])
    expect(countOf(ownOf(v).lines[1]!)).toBe('2/5')
  })
  test('Owner sees each segment in its ticket\'s status color', () => {
    // Needs you and Failed are both red, so each case holds only one of them; their order is the plan's run-length re-translation (see the plan).
    const at = (statuses: TStatus[]) => statuses.map((s, i) => tk(`WS-${11 + i}`, s, i))
    expect([
      runsOf(barOf(ownOf(view(at(['working', 'needs-you', 'done', 'stopped']))).lines[1]!)),
      runsOf(barOf(ownOf(view(at(['working', 'failed', 'done', 'stopped']))).lines[1]!)),
    ]).toEqual([['yellow', 'red', 'green', 'gray'], ['yellow', 'red', 'green', 'gray']])
  })
  test('Owner sees each segment in its ticket\'s status color (ticket status of each cell)', async () => {
    // R-7: the same two cases at the status level, where Needs you and Failed are told apart (8 cells, 2 per ticket).
    const at = (statuses: TStatus[]) => statuses.map((s, i) => tk(`WS-${11 + i}`, s, i))
    expect([
      await statusCells(at(['working', 'needs-you', 'done', 'stopped']), 8),
      await statusCells(at(['working', 'failed', 'done', 'stopped']), 8),
    ]).toEqual([
      ['working', 'working', 'needs-you', 'needs-you', 'done', 'done', 'stopped', 'stopped'],
      ['working', 'working', 'failed', 'failed', 'done', 'done', 'stopped', 'stopped'],
    ])
  })
  test('Owner sees tickets ordered by when their first worker started', () => {
    // WS-12 and WS-14 start at the same moment (a same-prefix tie, where every reading of the tie rule agrees); WS-14 is listed first.
    const v = view([
      tk('WS-15', 'working', 1, 'early'), tk('WS-15', 'done', 9, 'late'), tk('WS-11', 'working', 3), tk('WS-14', 'working', 0), tk('WS-12', 'working', 0),
    ])
    expect(leads(v)).toEqual(['WS-12', 'WS-14', 'WS-15', 'WS-11'])
  })
  test('Owner sees tickets ordered by when their first worker started (tie across prefixes)', () => {
    // R-6: APP-3 and WS-12 start together, WS-12 listed first: the id breaks the tie by code units, so APP-3 comes first.
    const v = view([tk('WS-12', 'working', 0), tk('APP-3', 'working', 0), tk('WS-11', 'working', 4)])
    expect(leads(v)).toEqual(['APP-3', 'WS-12', 'WS-11'])
  })
  test('Owner sees tickets ordered by when their first worker started (tie WS-9 and WS-10)', () => {
    // R-6: the tie is code-unit order, not number order: WS-10 before WS-9.
    const v = view([tk('WS-9', 'working', 0), tk('WS-10', 'working', 0), tk('WS-11', 'working', 4)])
    expect(leads(v)).toEqual(['WS-10', 'WS-9', 'WS-11'])
  })
  test('Owner always sees the whole count, however narrow the pane', () => {
    const kids = [...tickets(9, 'working'), ...[20, 21, 22].map((n, i) => tk(`WS-${n}`, 'done', 20 + i))]
    expect([44, 30, 20, 14, 10].map(w => countOf(lineAt(kids, w)))).toEqual(['3/12', '3/12', '3/12', '3/12', '3/12'])
  })
  test('Owner always sees the whole count, however narrow the pane (one-line own card)', () => {
    // R-26: own busy card on the Working shelf, 12 tickets, long project and title. Panes from 44 down to the smallest supported one-line pane:
    // slot cells (read at a wide width; the spinner is one cell) + 1 space + count cells + 2.
    const kids = [...tickets(9, 'working'), ...[20, 21, 22].map((n, i) => tk(`WS-${n}`, 'done', 20 + i))]
    const o = { workingShelf: true, own: { raw: 'busy', statusSince: NOW - 5 * MIN, project: 'a-very-long-project-name-for-the-sweep' } } satisfies V
    const oneLine = (width: number) => ownOf(view(kids, { ...o, width })).lines[0] ?? []
    const wide = oneLine(80)
    const slot = plain(slotOfLine(wide))
    const smallest = cellWidth(slot) + 1 + '3/12'.length + 2
    const broken = sweep(44, smallest).filter(w => {
      const line = oneLine(w)
      const text = plain(line)
      const project = line.find(s => roleOf(s) === 'project')
      const title = line.find(s => roleOf(s) === 'title')
      const projectCut = project?.kind === 'text' && project.text !== plain(wide.filter(s => roleOf(s) === 'project'))
      const titleLeft = title?.kind === 'text' && title.text !== ''
      const bar = line.some(s => roleOf(s) === 'bar')
      return !text.endsWith(`3/12 ${slot}`) || (projectCut && titleLeft) || bar
    })
    expect({ slotDrawn: slot !== '', lines: ownOf(view(kids, { ...o, width: 44 })).lines.length, broken }).toEqual({ slotDrawn: true, lines: 1, broken: [] })
  })
  test('Owner sees the title shorten first, and the bar shrink only once the title is at its minimum', () => {
    const kids = tickets(4)
    const own = { title: 'WS-138 Orchestrate the release train with many parts to it' }
    // The sweep starts at 44 and ends at the smallest supported pane for chip WS-138 (9 cells) and count 0/4: 9 + 2 + 1 + 3 + 2 = 17 (R-18).
    const series = sweep(44, 17).map(w => {
      const line = lineAt(kids, w, { own })
      const title = line.find(s => s.kind === 'text' && s.role === 'title')
      return { w, n: barOf(line).length, title: title && title.kind === 'text' ? title.text : '', chip: plain(line).includes('WS-138') }
    })
    const first = series[0]?.title.charAt(0) ?? ''
    const violations = series.filter(p => p.n > 0 && p.n < MAXBAR && p.title !== `${first}…`)
    const atCap = series.some(p => p.n === MAXBAR && p.title.endsWith('…'))
    // At the widths just below where N falls under 5 (count only), the chip is whole and the title is still its first character and `…`.
    const drop = series.findIndex(p => p.n === 0)
    const floor = (drop < 0 ? [] : series.slice(drop, drop + 4)).filter(p => p.title !== `${first}…` || !p.chip).map(p => p.w)
    expect({ atCap, violations, floor }).toEqual({ atCap: true, violations: [], floor: [] })
  })
  test('Owner in a very narrow pane sees the count only', () => {
    const kids = tickets(4)
    // The sweep covers panes from 44 down to the smallest supported one for a card with no chip and count 0/4: 2 + 1 + 3 + 2 = 8 columns (R-18).
    const series = sweep(44, 8).map(w => ({ w, n: barOf(lineAt(kids, w)).length, count: countOf(lineAt(kids, w)), titled: hasTitle(lineAt(kids, w)) }))
    const smallest = Math.min(...series.filter(p => p.n > 0).map(p => p.n))
    const partial = series.filter(p => p.n > 0 && p.n < 5).map(p => p.w)
    const drop = series.find(p => p.n < 5)
    // `barOf` reads nothing on a line without a title segment, so every width must carry one for "no cells" to mean no bar.
    const untitled = series.filter(p => !p.titled).map(p => p.w)
    expect({ smallest, partial, untitled, drop: drop ? { n: drop.n, count: drop.count } : null }).toEqual({ smallest: 5, partial: [], untitled: [], drop: { n: 0, count: '0/4' } })
  })
  test('Owner with more tickets than bar cells sees one run per status, in a fixed order', () => {
    const at = (statuses: TStatus[]) => statuses.map((s, i) => tk(`WS-${11 + i}`, s, i))
    const crowded1 = at(['failed', 'done', 'working', 'done', 'needs-you', 'done', 'working', 'done', 'done', 'working', 'done', 'done'])
    // Done 7, Working 3 and two red tickets of one kind: N = 5 gives Done 3, Working 1, red 1 (floors 2, 1, 0; leftovers to Done and the red status).
    const crowded1Needs = at(['needs-you', 'done', 'working', 'done', 'needs-you', 'done', 'working', 'done', 'done', 'working', 'done', 'done'])
    const crowded1Failed = at(['failed', 'done', 'working', 'done', 'failed', 'done', 'working', 'done', 'done', 'working', 'done', 'done'])
    const crowded2 = at(['stopped', ...rep('green', 9).map(() => 'done' as TStatus)])
    const crowded3 = at(['failed', 'done', 'working', 'failed', 'done', 'working'])
    expect([
      { cells: barWith(crowded1, 5), count: countOf(lineAt(crowded1, 120)) },
      { cells: barWith(crowded1Needs, 5), count: countOf(lineAt(crowded1Needs, 120)) },
      { cells: barWith(crowded1Failed, 5), count: countOf(lineAt(crowded1Failed, 120)) },
      { cells: barWith(crowded2, 6), count: countOf(lineAt(crowded2, 120)) },
      { cells: barWith(crowded3, 5), count: countOf(lineAt(crowded3, 120)) },
    ]).toEqual([
      { cells: ['green', 'green', 'yellow', 'red', 'red'], count: '7/12' },
      { cells: ['green', 'green', 'green', 'yellow', 'red'], count: '7/12' },
      { cells: ['green', 'green', 'green', 'yellow', 'red'], count: '7/12' },
      { cells: [...rep('green', 5), 'gray'], count: '9/10' },
      { cells: ['green', 'green', 'yellow', 'yellow', 'red'], count: '2/6' },
    ])
  })
  test('Owner with more tickets than bar cells sees one run per status, in a fixed order (ticket status runs)', async () => {
    // R-7: the runs as TicketStatus[] from the locked pure rules, so Needs you and Failed (both red) are told apart.
    const at = (statuses: TStatus[]) => statuses.map((s, i) => tk(`WS-${11 + i}`, s, i))
    const crowded1 = at(['failed', 'done', 'working', 'done', 'needs-you', 'done', 'working', 'done', 'done', 'working', 'done', 'done'])
    const crowded1Needs = at(['needs-you', 'done', 'working', 'done', 'needs-you', 'done', 'working', 'done', 'done', 'working', 'done', 'done'])
    const crowded1Failed = at(['failed', 'done', 'working', 'done', 'failed', 'done', 'working', 'done', 'done', 'working', 'done', 'done'])
    const crowded2 = at(['stopped', ...Array.from({ length: 9 }, () => 'done' as TStatus)])
    const crowded3 = at(['failed', 'done', 'working', 'failed', 'done', 'working'])
    expect([
      countRuns(await statusCells(crowded1, 5)),
      countRuns(await statusCells(crowded1Needs, 5)),
      countRuns(await statusCells(crowded1Failed, 5)),
      countRuns(await statusCells(crowded2, 6)),
      countRuns(await statusCells(crowded3, 5)),
    ]).toEqual([
      [['done', 2], ['working', 1], ['needs-you', 1], ['failed', 1]],
      [['done', 3], ['working', 1], ['needs-you', 1]],
      [['done', 3], ['working', 1], ['failed', 1]],
      [['done', 5], ['stopped', 1]],
      [['done', 2], ['working', 2], ['failed', 1]],
    ])
  })
  test('Owner sees workers without a ticket leave the bar and count alone', () => {
    const v = view([tk('WS-11', 'done', 0), tk('WS-12', 'working', 1), kid('review docs', 'working', 2), kid('lint pass', 'done', 3), kid('trim fixtures', 'working', 4)])
    expect({ count: countOf(ownOf(v).lines[1]!), hues: runsOf(barOf(ownOf(v).lines[1]!)) }).toEqual({ count: '1/2', hues: ['green', 'yellow'] })
  })
})

// ================================================================ 4. Ticket rows (AC-27 to AC-37)
describe('4. ticket rows', () => {
  const twoTickets = () => [tk('WS-11', 'done', 0, 'a'), tk('WS-11', 'working', 1, 'b'), tk('WS-11', 'working', 2, 'c'), tk('WS-12', 'working', 3)]
  test('Owner sees one row per ticket under the own card instead of one per worker', () => {
    expect(leads(view(twoTickets()))).toEqual(['WS-11', 'WS-12'])
  })
  test('Owner reads a ticket row: id, status dot, newest worker\'s description, and its status or age', () => {
    const v = view([kid('scan WS-11 alpha', 'done', 0, 30), kid('fix WS-11 beta', 'working', 4, 2), kid('plan WS-12 gamma', 'working', 5)])
    // WS-11 has two workers, so ` ×2` may follow the description (R-21).
    expect(stripRow(rowText(v, 'WS-11'))).toMatch(/^WS-11\s+●\s+fix WS-11 beta(?: ×2)?\s+.*Working 2m\s*$/)
  })
  test('Owner reads a ticket row: id, status dot, newest worker\'s description, and its status or age (Stopped reads age only)', () => {
    // R-21: a Stopped newest worker shows its age only, in gray, as a child row does; no Idle or Stopped word.
    const v = view([tk('WS-11', 'working', 0), kid('plan WS-12 old', 'done', 1, 30), kid('stop WS-12 new', 'idle', 5, 3)])
    const row = stripRow(rowText(v, 'WS-12'))
    expect({ shape: /^WS-12\s+●\s+stop WS-12 new ×2\s+3m\s*$/.test(row), word: /Idle|Stopped/.test(row) }).toEqual({ shape: true, word: false })
  })
  test('Owner sees a Done ticket\'s dot in green, while a finished child row\'s dot stays gray', () => {
    const v = view([tk('WS-11', 'done', 0), tk('WS-12', 'working', 1), kid('review docs', 'done', 2)])
    expect({ ticket: dotHue(rowFor(v, 'WS-11')?.text), child: dotHue(rowFor(v, 'review docs')?.text) }).toEqual({ ticket: 'green', child: 'gray' })
  })
  test('Owner sees how many workers a ticket has when it has more than one', () => {
    const v = view(twoTickets())
    // `×3` sits after the description (the newest worker's, `scan WS-11 c`) and before the status (R-21).
    expect([/scan WS-11 c ×3\s+.*Working 2m\s*$/.test(rowText(v, 'WS-11')), rowText(v, 'WS-12').includes('×')]).toEqual([true, false])
  })
  test('Owner sees workers without a ticket keep their own rows after the ticket rows', () => {
    const v = view([tk('WS-11', 'working', 0), tk('WS-12', 'working', 1), kid('review docs', 'working', 2), kid('lint pass', 'working', 3)])
    // No-ticket rows keep the child-row order (urgency, then newest first): the later-started `lint pass` comes before `review docs` (R-22).
    expect(leads(v)).toEqual(['WS-11', 'WS-12', 'lint pass', 'review docs'])
  })
  test('Owner sees at most five rows, then "+K more"', () => {
    const pair = (n: number) => [tk(`WS-${n}`, 'working', n, 'a'), tk(`WS-${n}`, 'done', n + 20, 'b')]
    const four = [...pair(11), ...pair(12), ...pair(13), ...pair(14)]
    const seven = [...four, ...pair(15), ...pair(16), ...pair(17)]
    const shape = (kids: Child[]) => { const v = view(kids); return { rows: rowsOf(v).length, more: ownOf(v).children?.more } }
    expect([
      shape([...four, kid('review docs', 'working', 40)]),
      shape([...four, kid('review docs', 'working', 40), kid('lint pass', 'working', 41), kid('trim fixtures', 'working', 42)]),
      shape(seven),
    ]).toEqual([{ rows: 5, more: undefined }, { rows: 5, more: '+2 more' }, { rows: 5, more: '+2 more' }])
  })
  test('Owner presses a ticket row and the newest worker\'s transcript opens', async ($, on) => {
    const agents = [H_AGENT('w1', 'completed', 'scan WS-11 alpha', 0), H_AGENT('w2', 'running', 'fix WS-11 beta', 4), H_AGENT('w3', 'running', 'plan WS-12 gamma', 5)]
    const world: World = withPrefixes({ agents, views: [] })
    const { ui } = await mountPane($, on, [S('own')], world)
    const buttons = (await ui.findAll({ type: 'Button' })).filter((b: any) => leadOf(b.text ?? '') === 'WS-11')
    if (buttons.length === 1) await ui.press({ key: buttons[0].key })
    expect(world.views).toEqual([{ agentId: 'w2' }])
  })
  test('Owner sees ticket rows without hovering over the card', async ($, on) => {
    const { ui } = await mountPane($, on, [S('own')], withPrefixes({ agents: THREE() }))
    expect(await hLeads(ui)).toEqual(['WS-11', 'WS-12', 'APP-3'])
  })
  test('Owner without ticket progress sees the child rows exactly as before', () => {
    // The expected rows are frozen from the pre-feature code (fixtures/ws138/baseline.ts), not computed by the layout code under test.
    const kids = [kid('review docs', 'working', 0), kid('lint pass', 'done', 1), kid('trim fixtures', 'failed', 2), kid('scan WS-11 alpha', 'working', 3), kid('tidy shelf', 'working', 4), kid('port notes', 'idle', 5)]
    const shape = (v: PaneView) => ({ rows: rowsOf(v).map(r => plain(r.text)), more: ownOf(v).children?.more })
    const frozen = { rows: SIX_WORKER_ROWS, more: SIX_WORKER_MORE }
    // (a) prefixes off; (b) prefixes on with a single ticket among the workers.
    expect([shape(view(kids, { prefixes: [] })), shape(view(kids))]).toEqual([frozen, frozen])
  })
  test('Owner sees the count but no bar on a one-line own card', () => {
    const v = view(tickets(3), { workingShelf: true, own: { raw: 'busy', statusSince: NOW - 5 * MIN } })
    const card = ownOf(v)
    const line = card.lines[0]!
    // The count sits directly before the status slot, exactly one space apart (L-3b).
    const before = plain(line.slice(0, line.length - slotOfLine(line).length))
    expect({ lines: card.lines.length, count: countOf(line), titled: hasTitle(line), bar: barOf(line).length, gap: /3 $/.test(before) && /\d\/3 $/.test(before) })
      .toEqual({ lines: 1, count: '0/3', titled: true, bar: 0, gap: true })
  })
  test('Owner sees ticket rows under a one-line own card too', () => {
    const v = view(tickets(3), { workingShelf: true, own: { raw: 'busy', statusSince: NOW - 5 * MIN } })
    expect(leads(v)).toEqual(['WS-11', 'WS-12', 'WS-13'])
  })
})

// ================================================================ 5. Waiting (AC-38 to AC-45)
describe('5. waiting', () => {
  const running = () => [kid('scan alpha', 'working', 0)]
  test('Owner whose session went idle while its workers run sees "Waiting" in green', async ($, on) => {
    const agents = [H_AGENT('a1', 'running', 'scan alpha', 0)]
    const { ui } = await mountPane($, on, [S('own', { status: 'idle' })], { agents })
    expect(await ownStatus(ui)).toMatch(/Waiting/)
  })
  test('Owner whose session went idle while its workers run sees "Waiting" in green (finished, unseen)', () => {
    const v = view(running(), { finishedAt: NOW - MIN })
    expect(plain(ownOf(v).lines[0]!)).toMatch(/Waiting/)
  })
  test('Owner whose session went idle while its workers run sees "Waiting" in green (drawn color)', () => {
    const seg = ownOf(view(running())).lines[0]!.find(s => s.kind === 'text' && s.text.includes('Waiting'))
    expect(seg && seg.kind === 'text' ? hueOf(seg.color) : 'none').toBe('green')
  })
  test('Owner sees Waiting with no tickets, one ticket or several, and with prefixes off', () => {
    const words = [
      view(running()), view([tk('WS-11', 'working', 0)]), view(tickets(3)), view(tickets(3), { prefixes: [] }),
    ].map(v => /Waiting/.test(plain(ownOf(v).lines[0]!)))
    expect(words).toEqual([true, true, true, true])
  })
  test('Owner whose only active worker needs them sees Needs you, not Waiting', () => {
    const v = view([kid('ask alpha', 'needs-you', 0), kid('scan beta', 'done', 1)], { own: { childNeedAt: NOW - MIN } })
    const line = plain(ownOf(v).lines[0]!)
    expect({ needs: /Needs you/.test(line), waiting: /Waiting/.test(line) }).toEqual({ needs: true, waiting: false })
  })
  test('Owner whose only active worker needs them sees Needs you, not Waiting (open question through the host)', async ($, on) => {
    // The rolled-up Needs you comes from the worker's own open question, not from a field set on the card.
    const world: World = { agents: [H_AGENT('a1', 'running', 'ask alpha', 0)] }
    const { ui } = await mountPane($, on, [S('own', { status: 'idle' })], world)
    await askFor($, world, 'a1')
    const line = await ownStatus(ui)
    expect({ needs: /Needs you/.test(line), waiting: /Waiting/.test(line) }).toEqual({ needs: true, waiting: false })
  })
  test('Owner sees Working, Needs you, Failed, Background and Check? kept while workers run', () => {
    const task = [{ id: 'b1', kind: 'Command' as const, label: 'npm test', firstSeenAt: NOW - 30 * MIN }]
    const word = (own: Partial<Session>) => /Working|Needs you|Failed|Background|Check\?|Waiting/.exec(plain(ownOf(view(running(), { own })).lines[0]!))?.[0]
    expect([
      word({ raw: 'busy', statusSince: NOW - 5 * MIN }),
      word({ raw: 'waiting' }),
      word({ raw: 'failed' }),
      word({ background: task, isTurnOver: true, statusSince: NOW - 5 * MIN }),
      word({ background: task, isTurnOver: true, statusSince: NOW - 30 * MIN }),
    ]).toEqual(['Working', 'Needs you', 'Failed', 'Background', 'Check?'])
  })
  test('Owner sees Waiting end within one redraw of the last worker finishing', async ($, on) => {
    const world: World = { agents: [H_AGENT('a1', 'running', 'scan alpha', 0)] }
    const { ui, clock } = await mountPane($, on, [S('own', { status: 'idle' })], world)
    const during = /Waiting/.test(await ownStatus(ui))
    world.agents = [H_AGENT('a1', 'completed', 'scan alpha', 0)]
    await redraw(clock, ui)
    expect([during, /Waiting/.test(await ownStatus(ui))]).toEqual([true, false])
  })
  test('Owner sees Waiting end within one redraw of the last worker finishing (own session done)', async ($, on) => {
    const sessions = [S('own', { status: 'busy' })]
    const world: World = { agents: [H_AGENT('a1', 'running', 'scan alpha', 0)] }
    const { ui, clock } = await mountPane($, on, sessions, world)
    sessions[0]!.status = 'completed'
    sessions[0]!.sinceMs = -1000
    await redraw(clock, ui)
    const during = /Waiting/.test(await ownStatus(ui))
    world.agents = [H_AGENT('a1', 'completed', 'scan alpha', 0)]
    await redraw(clock, ui)
    const after = await ownStatus(ui)
    expect({ during, waiting: /Waiting/.test(after), done: /Done/.test(after) }).toEqual({ during: true, waiting: false, done: true })
  })
  test('Owner sees a Waiting card stay on the shelf it would have when idle', () => {
    const v = view(running(), { workingShelf: true })
    const card = ownOf(v)
    expect({ shelf: card.shelf, lines: card.lines.length, waiting: /Waiting/.test(plain(card.lines[0]!)) }).toEqual({ shelf: 'active', lines: 3, waiting: true })
  })
  test('Owner sees a Waiting card stay on the shelf it would have when idle (idle for 7 hours)', () => {
    const own = { statusSince: NOW - 7 * HOUR, activityAt: NOW - 7 * HOUR }
    const without = ownOf(view([], { own, workingShelf: true, inactiveOpen: true }))
    const withWorker = ownOf(view(running(), { own, workingShelf: true, inactiveOpen: true }))
    expect({ shelf: withWorker.shelf, waiting: /Waiting/.test(plain(withWorker.lines[0]!)) }).toEqual({ shelf: without.shelf, waiting: true })
  })
  test('Owner hears no sound when the card enters or leaves Waiting', async ($, on) => {
    const played: unknown[] = []
    on('audio.play', ($p, e) => (played.push((e as { clip: unknown }).clip), { value: undefined }) as never)
    const sessions = [S('own', { status: 'idle' })]
    // Sound is on, and the pane is primed: the first 30-second cross-check has run, before which no chime can play at all.
    const world: World = { agents: [], store: new Map<string, unknown>([['setting:sound', true]]) }
    const { ui, clock } = await mountPane($, on, sessions, world)
    await clock.advance(35_000); await ui.advance(35_000)
    // Positive control: the same harness plays exactly one sound when the own card turns Needs you.
    sessions[0]!.status = 'waiting'
    sessions[0]!.sinceMs = -1000
    await redraw(clock, ui)
    const control = played.length
    sessions[0]!.status = 'idle'
    sessions[0]!.sinceMs = 0
    await redraw(clock, ui)
    world.agents = [H_AGENT('a1', 'running', 'scan alpha', 0)]
    await redraw(clock, ui)
    world.agents = [H_AGENT('a1', 'completed', 'scan alpha', 0)]
    await redraw(clock, ui)
    expect({ control, waitingChanges: played.length - control }).toEqual({ control: 1, waitingChanges: 0 })
  })
  test('Owner whose session Claude Code reports as waiting for them still sees Needs you', () => {
    const line = plain(ownOf(view(running(), { own: { raw: 'waiting' } })).lines[0]!)
    expect({ needs: /Needs you/.test(line), waiting: /Waiting/.test(line) }).toEqual({ needs: true, waiting: false })
  })
  test('Waiting vs snoozed and Woke', () => {
    // R-27 (L-8): own idle with a running worker. (a) snoozed: the slot shows the time left, not Waiting. (b) woken: the slot reads Waiting, no Woke.
    const snoozed = plain(ownOf(view(running(), { snoozedOpen: true, ownEntry: { snoozedUntil: NOW + 3 * HOUR, snoozedAt: NOW - HOUR } })).lines[0]!)
    // Control for (b): the same woken card with no worker shows the Woke mark, so its absence below is the feature's doing.
    const wokenEntry = { snoozedUntil: NOW - 5 * MIN, snoozedAt: NOW - HOUR, wokeAt: NOW - 2 * MIN }
    const woken = plain(ownOf(view(running(), { ownEntry: wokenEntry })).lines[0]!)
    const control = plain(ownOf(view([], { ownEntry: wokenEntry })).lines[0]!)
    expect({ snoozed: [/Waiting/.test(snoozed), /\d+[hm]/.test(snoozed)], woken: [/Waiting/.test(woken), /Woke/.test(woken)], control: /Woke/.test(control) })
      .toEqual({ snoozed: [false, true], woken: [true, false], control: true })
  })
})

// ================================================================ 6. Other sessions (AC-46, AC-47)
describe('6. other sessions', () => {
  test('Owner sees ticket progress and ticket rows only on their own card', async ($, on) => {
    const sessions = [S('own'), S('other', { title: 'WS-12 refactor' })]
    const { ui } = await mountPane($, on, sessions, withPrefixes({ agents: THREE() }))
    expect({ own: await ownCount(ui), other: countIn((await cardLines(ui, 'other')).join('\n')), rows: await hLeads(ui) }).toEqual({ own: '0/3', other: null, rows: ['WS-11', 'WS-12', 'APP-3'] })
  })
  test('Owner sees ticket progress and ticket rows only on their own card (bar and rows on the other card)', () => {
    const v = view(tickets(3), { others: [sess({ id: 'other', title: 'WS-12 refactor' })] })
    const other = cardOf(v, c => !c.isSelected)
    expect({ own: countOf(ownOf(v).lines[1]!), titled: hasTitle(other.lines[1]!), cells: barOf(other.lines[1]!).length, count: countOf(other.lines[1]!), rows: other.children === undefined })
      .toEqual({ own: '0/3', titled: true, cells: 0, count: null, rows: true })
  })
  test('Owner sees other cards keep exactly their usual status while own workers run', async ($, on) => {
    const sessions = [S('own'), S('other', { status: 'idle' }), S('third', { status: 'completed', cwd: '/q' })]
    const { ui } = await mountPane($, on, sessions, { agents: [H_AGENT('a1', 'running', 'scan alpha', 0)], selfName: 'own' })
    const words = async (name: string) => /Waiting/.test(((await cardLines(ui, name))[0]) ?? '')
    expect([await words('own'), await words('other'), await words('third')]).toEqual([true, false, false])
  })
})

// ================================================================ 7. Published text and permissions (AC-48, AC-49, TC-1, TC-2)
describe('7. published text and permissions', () => {
  test('Owner publishes Bridge with no mention of BB in the text this feature adds', async ($, on) => {
    // The drawn pane (ticket progress and Waiting on, worker text with no BB in it) and the /bridge hint and messages hold no banned name.
    const world: World = withPrefixes({ agents: THREE(), texts: [] })
    const { ui } = await mountPane($, on, [S('own', { status: 'idle' })], world)
    await $.command.run({ command: 'bridge', args: 'no-such-setting' } as never)
    const texts = [...(await cardLines(ui)), ...(await drawnRows(ui)), ...(await allText(ui)), PANE_ARGS_HINT, ...(world.texts ?? [])]
    const banned = /\bBB\b|getbb|bb-sidebar/
    const shown = texts.some(t => /\d\/3/.test(t)) && texts.some(t => /Waiting/.test(t))
    expect({ banned: texts.filter(t => banned.test(t)), shown }).toEqual({ banned: [], shown: true })
  })
  test('Owner publishes Bridge with no mention of BB in the text this feature adds (worker text untouched)', () => {
    // Exclusion clause: displayed worker text is left alone, even when it names BB.
    const v = view([kid('BB fix WS-11', 'working', 0), tk('WS-12', 'working', 1)])
    expect(stripRow(rowText(v, 'WS-11'))).toMatch(/BB fix WS-11/)
  })
  // AC-48 S and AC-49 S run in tests/ws138-published-text.test.ts (Workspace root suite; this runner has no file read).
  test('Owner turns on ticket progress and Waiting without a new permission or another tool', async ($, on) => {
    // Which programs run over the whole flow (mount, `/bridge tickets WS-`, 13 redraws), not how often (R-15): the sorted distinct commands equal
    // the distinct commands of the literal frozen from 6c505cf. The flow must have reached the feature's state (R-16).
    const { log, ui } = await flowHostLog($, on)
    const programs = log.filter(line => line.startsWith('process.run '))
    expect({ programs: distinct(programs), reached: await flowReached(ui) })
      .toEqual({ programs: distinct(FLOW_HOST_LOG.filter(line => line.startsWith('process.run '))), reached: { count: '0/2', waiting: true } })
  })
  test('(Technical Contract) Ticket progress and Waiting read no file and start no program beyond Bridge\'s existing ones', async ($, on) => {
    // Which files and programs, not how often (R-15): the sorted distinct lines of every file, process and network call the host layer sees over the
    // same flow equal the distinct lines of the literal frozen from 6c505cf, and every event name is one the literal has.
    // `watching` is the control that the recorder saw the flow at all.
    const { log, ui } = await flowHostLog($, on)
    expect({ lines: distinct(log), newEvents: eventNames(log).filter(name => !eventNames(FLOW_HOST_LOG).includes(name)), watching: log.some(line => line.startsWith('process.run ')), reached: await flowReached(ui) })
      .toEqual({ lines: distinct(FLOW_HOST_LOG), newEvents: [], watching: true, reached: { count: '0/2', waiting: true } })
  })
  // TC-2 runs in tests/ws138-published-text.test.ts (Workspace root suite; this runner has no file read).
})

// ================================================================ Spec compliance tests (promised by the plan)
describe('spec compliance', () => {
  test('Description before name (AC-07, Terms)', async ($, on) => {
    // a1: description holds WS-1, name holds WS-2. a2: no description, so the name is searched. a3: neither, only a type id.
    const agents = [
      H_AGENT('a1', 'running', 'do WS-1 first', 0, { name: 'WS-2 helper' }),
      H_AGENT('a2', 'running', '', 1, { description: undefined, name: 'plan WS-3 gamma' }),
      H_AGENT('a3', 'running', '', 2, { description: undefined, name: undefined, type: 'WS-9-runner' }),
    ]
    const { ui } = await mountPane($, on, [S('own')], withPrefixes({ agents }))
    expect({ count: await ownCount(ui), leads: (await hLeads(ui)).slice(0, 2) }).toEqual({ count: '0/2', leads: ['WS-1', 'WS-3'] })
  })
  test('Kept finished workers count (AC-01)', async ($, on) => {
    // The host drops the finished WS-12 worker from its list; Bridge keeps it, so the second ticket stays.
    const world = withPrefixes({ agents: [H_AGENT('a1', 'running', 'scan WS-11 alpha', 0), H_AGENT('a2', 'completed', 'fix WS-12 beta', 1)] })
    const { ui, clock } = await mountPane($, on, [S('own')], world)
    const shown = await ownCount(ui)
    world.agents = [H_AGENT('a1', 'running', 'scan WS-11 alpha', 0)]
    await redraw(clock, ui)
    expect({ shown, after: await ownCount(ui) }).toEqual({ shown: '1/2', after: '1/2' })
  })
  test('Unicode boundaries and brackets (éWS-12, WS-12é, 「WS-12」, full-width digits)', () => {
    // Only the bracketed id is a ticket (a letter or digit of any script glues an id; full-width digits are no digits): WS-12 and WS-13.
    const v = view([kid('scan éWS-12 a', 'working', 0), kid('scan WS-12é b', 'working', 1), kid('scan 「WS-12」 c', 'working', 2), kid('scan WS-１２ d', 'working', 3), kid('scan WS-13 e', 'working', 4)])
    expect(countOf(ownOf(v).lines[1]!)).toBe('0/2')
  })
  test('Wide descriptions in ticket rows (emoji, CJK, Arabic) never exceed the pane and end in an ellipsis', () => {
    const v = view([
      kid(`scan WS-11 ${'日本語の説明'.repeat(8)}`, 'working', 0), kid(`fix WS-12 ${'😀'.repeat(30)}`, 'working', 1), kid(`plan WS-13 ${'مرحبا بالعالم '.repeat(8)}`, 'working', 2),
    ])
    const rows = rowsOf(v).map(r => plain(r.text))
    expect({ leads: leads(v), fits: rows.every(t => cellWidth(t) <= 44), cut: rows.every(t => t.includes('…')) }).toEqual({ leads: ['WS-11', 'WS-12', 'WS-13'], fits: true, cut: true })
  })
  test('Missing start time (Error)', async ($, on) => {
    // Two workers have no start time; each starts when Bridge first listed it (R-12), here the same moment. WS-12 started an hour before:
    // order WS-12, then WS-11 and WS-13 (same first-listed time, tie by id).
    const agents = [
      H_AGENT('a1', 'running', 'scan WS-11 alpha', 0, { startedAt: undefined }),
      H_AGENT('a2', 'running', 'fix WS-12 beta', 1),
      H_AGENT('a3', 'running', 'port WS-13 gamma', 2, { startedAt: undefined }),
    ]
    const { ui } = await mountPane($, on, [S('own')], withPrefixes({ agents }))
    expect({ count: await ownCount(ui), leads: await hLeads(ui) }).toEqual({ count: '0/3', leads: ['WS-12', 'WS-11', 'WS-13'] })
  })
})

// ================================================================ Edge cases
// VS Code extension edge: not compiled here; the plan lists it under "Checks that stay out of the compiled runner" (the adapter harness in
// tests/adapters.test.ts draws the same shared card renderer, and the only VS Code-specific outcome, rows without hover, is AC-34 above).
describe('edge cases', () => {
  test('Ingress: cold pane open', async ($, on) => {
    const { ui } = await mountPane($, on, [S('own', { status: 'idle' })], withPrefixes({ agents: [H_AGENT('a1', 'running', 'scan WS-11 alpha', 0), H_AGENT('a2', 'running', 'fix WS-12 beta', 1)] }))
    expect({ count: await ownCount(ui), leads: await hLeads(ui), waiting: /Waiting/.test(await ownStatus(ui)) }).toEqual({ count: '0/2', leads: ['WS-11', 'WS-12'], waiting: true })
  })
  test('Ticket prefixes changed mid-session', async ($, on) => {
    const agents = [H_AGENT('a1', 'running', 'scan WS-11 alpha', 0), H_AGENT('a2', 'running', 'fix WS-12 beta', 1)]
    const world: World = { agents, store: new Map<string, unknown>([['setting:tickets', ['APP-']]]) }
    const { ui, clock } = await mountPane($, on, [S('own')], world)
    const before = await ownCount(ui)
    await $.command.run({ command: 'bridge', args: 'tickets WS-' } as never)
    await redraw(clock, ui)
    expect({ before, after: await ownCount(ui) }).toEqual({ before: null, after: '0/2' })
  })
  test('More than 20 finished workers', () => {
    // The 22nd-oldest finished worker is forgotten by the host list and by Bridge's 20-worker cap: WS-1 has no worker left.
    const old = [tk('WS-1', 'done', 0, 'a'), tk('WS-1', 'done', 1, 'b')]
    const rest = Array.from({ length: 20 }, (_, i) => tk(i % 2 ? 'WS-2' : 'WS-3', 'done', 5 + i, `n${i}`))
    const kept = [...old, ...rest].slice(2)
    const before = countOf(ownOf(view([...old, ...rest])).lines[1]!)
    expect({ before, after: countOf(ownOf(view(kept)).lines[1]!) }).toEqual({ before: '3/3', after: '2/2' })
  })
  test('A ticket\'s earliest worker is forgotten', () => {
    const both = [tk('WS-11', 'done', 0, 'old'), tk('WS-12', 'working', 2), tk('WS-11', 'working', 5, 'new')]
    const forgotten = both.slice(1)
    expect([leads(view(both)), leads(view(forgotten))]).toEqual([['WS-11', 'WS-12'], ['WS-12', 'WS-11']])
  })
  test('Two workers of different tickets started at the same moment', () => {
    // Drawn twice, with the worker list in opposite orders: the tie order is the same on both redraws.
    const listed = [tk('WS-15', 'working', 3), tk('WS-12', 'working', 3), tk('WS-13', 'working', 6)]
    expect([leads(view(listed)), leads(view([...listed].reverse()))]).toEqual([['WS-12', 'WS-15', 'WS-13'], ['WS-12', 'WS-15', 'WS-13']])
  })
  test('Two workers of one ticket started at the same moment', () => {
    const v = view([kid('WS-11 first', 'done', 4), kid('WS-11 second', 'failed', 4), tk('WS-12', 'working', 6)])
    expect({ dot: dotHue(rowFor(v, 'WS-11')?.text), text: stripRow(rowText(v, 'WS-11')).includes('second') }).toEqual({ dot: 'red', text: true })
  })
  test('Newest worker Working while an older one failed', () => {
    const v = view([kid('scan WS-11 old', 'failed', 0), kid('scan WS-11 new', 'working', 4), tk('WS-12', 'done', 5)])
    expect(runsOf(barOf(ownOf(v).lines[1]!))).toEqual(['yellow', 'green'])
  })
  test('Every ticket Done and no worker running', () => {
    const v = view(tickets(3, 'done'))
    const line = ownOf(v).lines[1]!
    expect({ count: countOf(line), hues: [...new Set(barOf(line))], waiting: /Waiting/.test(plain(ownOf(v).lines[0]!)) }).toEqual({ count: '3/3', hues: ['green'], waiting: false })
  })
  test('Waiting card keeps its full form with the Working shelf on', () => {
    // Working shelf on, own idle with a running worker: the card stays a full three-line card on the Active shelf (AC-43) and Waiting is in its
    // status slot. A one-line card never shows Waiting (the one-line form holds only Working cards, AC-41): see the plan's Known Gaps.
    const card = ownOf(view([kid('scan alpha', 'working', 0)], { workingShelf: true }))
    expect({ lines: card.lines.length, waiting: /Waiting/.test(plain(card.lines[0]!)) }).toEqual({ lines: 3, waiting: true })
  })
  test('Worker list cannot be read on a redraw', async ($, on) => {
    const world: World = withPrefixes({ agents: THREE() })
    const { ui, clock } = await mountPane($, on, [S('own')], world)
    // The own card is idle with three running workers, so it reads Waiting; a failed read of the list changes none of the three.
    const state = async () => ({ count: await ownCount(ui), rows: (await hLeads(ui)).length, waiting: /Waiting/.test(await ownStatus(ui)) })
    const before = await state()
    world.agentsFail = true
    await redraw(clock, ui)
    const afterOne = await state()
    // No time limit: three more failed redraws change nothing either (L-10).
    for (let i = 0; i < 3; i++) await redraw(clock, ui)
    const same = { count: '0/3', rows: 3, waiting: true }
    expect({ before, afterOne, afterFour: await state() }).toEqual({ before: same, afterOne: same, afterFour: same })
  })
  test('Failed read, prefixes off', async ($, on) => {
    // R-24: prefixes off, own busy, three running workers with pinned start times (the clock is mocked, so no age text changes across the redraws).
    const world: World = { agents: [H_AGENT('a1', 'running', 'scan alpha', 0), H_AGENT('a2', 'running', 'fix beta', 1), H_AGENT('a3', 'running', 'port gamma', 2)] }
    const { ui, clock } = await mountPane($, on, [S('own', { status: 'busy' })], world)
    const first = await drawnRows(ui)
    world.agentsFail = true
    await redraw(clock, ui)
    const failed = await drawnRows(ui)
    for (let i = 0; i < 3; i++) await redraw(clock, ui)
    const stillFailed = await drawnRows(ui)
    // A read that succeeds with an empty list still clears the running workers.
    world.agentsFail = false
    world.agents = []
    await redraw(clock, ui)
    expect({ shown: first.length, failed: failed.join('\n'), stillFailed: stillFailed.join('\n'), cleared: (await drawnRows(ui)).length })
      .toEqual({ shown: 3, failed: first.join('\n'), stillFailed: first.join('\n'), cleared: 0 })
  })
  test('Question during a failed read', async ($, on) => {
    // R-25: workers running, the list read fails, then a worker raises a permission question: the own card reads Needs you on the next redraw,
    // and the child rows stay as last read until a read succeeds.
    const world: World = withPrefixes({ agents: THREE() })
    const { ui, clock } = await mountPane($, on, [S('own')], world)
    const rows = await drawnRows(ui)
    world.agentsFail = true
    await redraw(clock, ui)
    await askFor($, world, 'a1')
    await redraw(clock, ui)
    expect({ needs: /Needs you/.test(await ownStatus(ui)), rows: (await drawnRows(ui)).join('\n') }).toEqual({ needs: true, rows: rows.join('\n') })
  })
  test('Stopped worker', () => {
    // R-21: a Stopped newest worker shows its age only (no word), on the child row and on the ticket row; the bar segment is gray; the ticket is Stopped.
    const kids = [tk('WS-11', 'working', 0), kid('plan WS-12 old', 'done', 1, 30), kid('stop WS-12 new', 'idle', 5, 3)]
    const ticketRow = stripRow(rowText(view(kids), 'WS-12'))
    const childRow = stripRow(plain(rowsOf(view(kids, { prefixes: [] })).find(r => plain(r.text).includes('stop WS-12 new'))?.text ?? []))
    expect({
      ticket: [/\s3m\s*$/.test(ticketRow), /Idle|Stopped/.test(ticketRow)],
      child: [/\s3m\s*$/.test(childRow), /Idle|Stopped/.test(childRow)],
      dot: dotHue(rowFor(view(kids), 'WS-12')?.text),
      bar: runsOf(barOf(ownOf(view(kids)).lines[1]!)),
    }).toEqual({ ticket: [true, false], child: [true, false], dot: 'gray', bar: ['yellow', 'gray'] })
  })
  test('Session resumed with workers already running', async ($, on) => {
    const { ui } = await mountPane($, on, [S('own', { status: 'idle' })], withPrefixes({ agents: THREE() }))
    expect([/Waiting/.test(await ownStatus(ui)), await ownCount(ui)]).toEqual([true, '0/3'])
  })
})

// ================================================================ Null hypothesis (NH-1 to NH-14)
describe('null hypothesis', () => {
  test('NH-1 Owner with prefixes off and two ids in worker text sees no ticket progress', () => {
    const v = view([tk('WS-11', 'working', 0), tk('WS-12', 'working', 1)], { prefixes: [] })
    expect({ count: countOf(ownOf(v).lines[1]!), titled: hasTitle(ownOf(v).lines[1]!), bar: barOf(ownOf(v).lines[1]!).length, rows: rowsOf(v).length }).toEqual({ count: null, titled: true, bar: 0, rows: 2 })
  })
  test('NH-2 Owner with only one ticket among many workers sees no ticket progress', () => {
    const v = view([tk('WS-11', 'working', 0, 'a'), tk('WS-11', 'working', 1, 'b'), tk('WS-11', 'done', 2, 'c'), tk('WS-11', 'working', 3, 'd')])
    expect({ count: countOf(ownOf(v).lines[1]!), rows: rowsOf(v).length }).toEqual({ count: null, rows: 4 })
  })
  test('NH-3 Owner whose workers name no ticket sees no ticket progress', () => {
    const v = view([kid('review docs', 'working', 0), kid('lint pass', 'working', 1), kid('trim fixtures', 'done', 2)])
    expect({ count: countOf(ownOf(v).lines[1]!), rows: rowsOf(v).length }).toEqual({ count: null, rows: 3 })
  })
  test('NH-4 Owner whose ids sit only in agent types sees no ticket progress', async ($, on) => {
    const agents = [H_AGENT('a1', 'running', '', 0, { description: undefined, type: 'WS-11' }), H_AGENT('a2', 'running', '', 1, { description: undefined, type: 'WS-12' })]
    const { ui } = await mountPane($, on, [S('own', { title: 'Release train' })], withPrefixes({ agents }))
    // The own card is drawn (its title shows), so a missing count is not a missing card.
    expect({ count: await ownCount(ui), drawn: await ownTitleDrawn(ui, 'Release train') }).toEqual({ count: null, drawn: true })
  })
  test('NH-5 Owner whose worker text has ids in the wrong case sees no ticket progress', () => {
    const v = view([kid('scan ws-11 a', 'working', 0), kid('scan ws-12 b', 'working', 1)])
    expect(countOf(ownOf(v).lines[1]!)).toBeNull()
  })
  test('NH-6 Owner whose ids are glued inside words sees no ticket progress', () => {
    const v = view([kid('scan XWS-11 a', 'working', 0), kid('scan WS-12b b', 'working', 1)])
    expect(countOf(ownOf(v).lines[1]!)).toBeNull()
  })
  test('NH-7 Owner sees no ticket progress on another session\'s card', async ($, on) => {
    const sessions = [S('own'), S('other', { title: 'WS-12' })]
    const { ui } = await mountPane($, on, sessions, withPrefixes({ agents: THREE() }))
    const other = (await cardLines(ui, 'other')).join('\n')
    expect({ own: await ownCount(ui), other: countIn(other), rows: await hLeads(ui) }).toEqual({ own: '0/3', other: null, rows: ['WS-11', 'WS-12', 'APP-3'] })
  })
  test('NH-8 Owner whose workers have all finished sees Idle or Done, not Waiting', () => {
    const v = view([kid('scan alpha', 'done', 0), kid('scan beta', 'failed', 1), kid('scan gamma', 'idle', 2)])
    expect(/Waiting/.test(plain(ownOf(v).lines[0]!))).toBe(false)
  })
  test('NH-9 Owner whose only live worker needs them sees Needs you, not Waiting', () => {
    const v = view([kid('ask alpha', 'needs-you', 0)], { own: { childNeedAt: NOW - MIN } })
    const line = plain(ownOf(v).lines[0]!)
    expect({ needs: /Needs you/.test(line), waiting: /Waiting/.test(line) }).toEqual({ needs: true, waiting: false })
  })
  test('NH-10 Owner whose session Claude Code reports as waiting sees Needs you, not Waiting', () => {
    const v = view([kid('scan alpha', 'working', 0)], { own: { raw: 'waiting' } })
    expect(plain(ownOf(v).lines[0]!)).toMatch(/Needs you/)
  })
  test('NH-11 Owner sees no Waiting on another session\'s idle card while own workers run', async ($, on) => {
    const { ui } = await mountPane($, on, [S('own'), S('other', { status: 'idle' })], { agents: [H_AGENT('a1', 'running', 'scan alpha', 0)], selfName: 'own' })
    expect([/Waiting/.test((await cardLines(ui, 'own'))[0] ?? ''), /Waiting/.test((await cardLines(ui, 'other'))[0] ?? '')]).toEqual([true, false])
  })
  test('NH-12 Owner whose session is still working sees Working, not Waiting', () => {
    const v = view([kid('scan alpha', 'working', 0)], { own: { raw: 'busy', statusSince: NOW - 5 * MIN } })
    expect(plain(ownOf(v).lines[0]!)).toMatch(/Working/)
  })
  test('NH-13 Owner with no workers at all sees the card exactly as before', async ($, on) => {
    const { ui } = await mountPane($, on, [S('own', { status: 'idle', title: 'Release train' })], withPrefixes({ agents: [] }))
    expect({ count: await ownCount(ui), rows: (await drawnRows(ui)).length, waiting: /Waiting/.test(await ownStatus(ui)), drawn: await ownTitleDrawn(ui, 'Release train') })
      .toEqual({ count: null, rows: 0, waiting: false, drawn: true })
  })
  test('NH-14 Owner sees nothing invented when the worker list was never readable', async ($, on) => {
    const { ui } = await mountPane($, on, [S('own', { status: 'idle', title: 'Release train' })], withPrefixes({ agentsFail: true }))
    // The own card is drawn and reads as an idle card does; the unreadable list invents no count, rows or Waiting.
    expect({ count: await ownCount(ui), rows: (await drawnRows(ui)).length, waiting: /Waiting/.test(await ownStatus(ui)), drawn: await ownTitleDrawn(ui, 'Release train'), status: await ownStatus(ui) })
      .toEqual({ count: null, rows: 0, waiting: false, drawn: true, status: IDLE_STATUS_LINE })
  })
})

// Rendered / Visual (O): real colours and the 44-column look are Owner captures, not automatable here.
todo('AC-20 (O) real status colours of the bar in a live 44-column pane -- Owner capture; the hue table is asserted above')
todo('AC-29 (O) Done ticket dot vs finished child dot, live -- Owner capture; the dot hues are asserted above')
todo('AC-38 (O) green Waiting on the Active shelf, live -- Owner capture; the drawn colour is asserted above')
