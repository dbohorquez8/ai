// Black-box checks for WS-138 (orchestration progress in Bridge, re-scoped: the orchestrator reports its tickets to Bridge's ticket tool),
// compiled from docs/features/012-ws-138-bridge-orch-progress/validation-plan.md (v2.0, 2026-10-24). Re-translated (Step 5a) against the locked contract
// surface of plan.md (L-1 to L-13, R-1 to R-17).
//
// Every check reaches the tool only through the adapters below (F-report, F-readback, F-workerRef, F-rollup, F-limit), and every
// drawn outcome through the module entry (hooks/register.tsx) with the host stubbed at the lowest boundary. Test names are the plan's
// Intent lines (a variant adds a suffix in brackets); NH tests carry their id. Failures are the bar: the feature is not built yet.
//
// Not expressible here (the Bridge runner has no file read and no live pane): the S layer (README, CHANGELOG) runs in
// tests/ws138-published-text.test.ts at the Workspace root; the O layer (live captures) is the Owner's.
//
// Id map, in file order:
// 1 reporting:     AC-01 AC-02 AC-03 AC-60 AC-61 AC-62 AC-63 AC-04 AC-05 AC-06 AC-07 AC-08 AC-09
// 2 appearing:     AC-10 AC-11 AC-12 AC-13 AC-14
// 3 bar and count: AC-15 AC-16 AC-17 AC-18 AC-19 AC-20 AC-21 AC-22 AC-23 AC-24 AC-25
// 4 group chip:    AC-26 AC-27 AC-28 AC-29 AC-30
// 5 ticket rows:   AC-31 AC-32 AC-33 AC-34 AC-35 AC-36 AC-37 AC-38 AC-39 AC-40 AC-41
// 6 keeping:       AC-42 AC-43 AC-44 AC-45 AC-46
// 7 Waiting:       AC-47 AC-48 AC-49 AC-50 AC-51 AC-52 AC-53 AC-54
// 8 other cards:   AC-55 AC-56
// 9 text, rights:  AC-57 AC-58 AC-59
// then edge cases, regression, NH-1 to NH-20.
import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'

import { REGISTRY_SCRIPT, REGISTRY_SEPARATOR } from '../hooks/pane-policy'
import { BRANCH_SCRIPT, TITLE_SCRIPT } from '../hooks/card-policy'
import { PALETTES } from '../hooks/core/palette'
import { loadStored, PANE_ARGS_HINT } from '../hooks/core/persist'
import { cellWidth } from '../hooks/core/width'
import { paneViewOf } from '../hooks/core/view'
import * as progressNs from '../hooks/core/progress'
import type { CardView, Child, ChildStatus, PaneView, Seg, Session } from '../hooks/core/types'
import { FLOW_HOST_LOG, IDLE_STATUS_LINE, SIX_WORKER_MORE, SIX_WORKER_ROWS } from './fixtures/ws138/baseline'

tier('builtin')

const MAXBAR = 12
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = 1_800_000_000_000
const T0 = NOW - 90 * MIN
const P = PALETTES.dark
type Hue = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet' | 'gray' | 'none'
const hueOf = (color?: string): Hue => ((Object.entries(P.text).find(([, hex]) => hex === color)?.[0] as Hue | undefined) ?? 'none')
const rep = <T>(value: T, n: number): T[] => Array.from({ length: n }, () => value)

// ================================================================ pure side: the view the pane draws (Waiting rules, other cards)
const kid = (label: string, status: ChildStatus, at: number, ago = 2, id?: string): Child =>
  ({ id: id ?? `w-${label.replace(/\W+/g, '-')}`, label, status, since: NOW - ago * MIN, startedAt: T0 + at * MIN })
const sess = (over: Partial<Session> & { id: string }): Session => ({
  prefId: over.id, name: over.id, activityAt: NOW - MIN, raw: 'idle', statusSince: NOW - 2 * HOUR, title: `${over.id} title`, project: 'proj', isSelf: false, ...over,
})
type V = { report?: unknown; width?: number; own?: Partial<Session>; finishedAt?: number; workingShelf?: boolean; others?: Session[]; inactiveOpen?: boolean; snoozedOpen?: boolean; ownEntry?: { snoozedUntil?: number; snoozedAt?: number; wokeAt?: number } }
const view = (children: Child[], o: V = {}): PaneView => {
  const base = loadStored(new Map()).stored
  const stored = {
    ...base,
    entries: { ...base.entries, ...(o.ownEntry ? { own: o.ownEntry } : {}) },
    collapsed: { ...base.collapsed, ...(o.inactiveOpen ? { inactive: false } : {}), ...(o.snoozedOpen ? { snoozed: false } : {}) },
    settings: { ...base.settings, workingShelf: o.workingShelf ?? false },
  }
  return paneViewOf({
    sessions: [sess({ id: 'own', isSelf: true, title: 'Orchestrate the release train with many parts to it, long enough to be cut', ...o.own }), ...(o.others ?? [])],
    stored, finished: o.finishedAt === undefined ? {} : { own: o.finishedAt }, children, now: NOW, width: o.width ?? 44, ...({ report: o.report ?? null } as object),
    caps: { trueColor: true, pictures: false }, bell: 0, palette: P, projectColors: new Map([['proj', '#88aacc']]),
  })
}
const cardOf = (v: PaneView, pick: (c: CardView) => boolean = c => c.isSelected): CardView => v.shelves.flatMap(s => s.cards).find(pick)!
const ownOf = (v: PaneView) => cardOf(v)
const plain = (segs: readonly Seg[]) => segs.map(s => (s.kind === 'spinner' ? '⠋' : s.text)).join('')
const statusOf = (v: PaneView) => plain(ownOf(v).lines[0]!)
const rowsOfView = (v: PaneView) => ownOf(v).children?.rows ?? []

// ================================================================ host side: the module entry
const FIELD_SEP = '\u001f'
const ITEM_SEP = '\u001e'
const TUE_10 = new Date(2026, 9, 13, 10, 0, 0).getTime()
type Sess = { name: string; status?: 'busy' | 'waiting' | 'idle' | 'completed'; cwd?: string; ageMs?: number; sinceMs?: number; title?: string; branch?: string }
const refOf = (name: string) => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(6, '0').slice(-6)
const idOf = (name: string) => `${refOf(name)}00-0000-4000-8000-000000000000`
const S = (name: string, x: Omit<Sess, 'name'> = {}): Sess => ({ name, ...x })
type Spec = { name: string; description: string; isDeferred?: boolean; inputSchema?: unknown }
type World = {
  agents?: unknown[]; agentsFail?: boolean; store?: Map<string, unknown>; views?: Array<Record<string, unknown>>
  host?: string[]; texts?: string[]; selfName?: string
  /** Every tool the module registered, as registered (AC-01, AC-02). */
  tools?: Spec[]
  /** Programs the process runner refuses (exit 127): everything but `sh`, `ps` and `claude` (AC-59). */
  refuseOtherPrograms?: boolean
  /** A worker's permission check is put to the person (`ask`), as the engine does for a real open prompt. */
  ask?: boolean
  /** The time the session registry reports as now, once a test has moved the clock before the pane mounts (the mock clock refuses a multi-day move with live 5 s timers, so such a move happens before the session starts). */
  baseMs?: number
}
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
  const reg = (name: string, ...rest: unknown[]) => {
    const hook = rest.pop() as (...a: unknown[]) => unknown
    ;(on as unknown as (...a: unknown[]) => void)(name, ...rest, (...a: unknown[]) => hook(...a))
  }
  reg('store.get', ($s: unknown, e: { key: string }) => ({ value: current.store.get(e.key) }))
  reg('store.set', ($s: unknown, e: { key: string; value: unknown }) => (current.store.set(e.key, e.value), { value: undefined }))
  reg('store.delete', ($s: unknown, e: { key: string }) => (current.store.delete(e.key), { value: undefined }))
  reg('store.keys', () => ({ value: [...current.store.keys()] }))
  reg('session.start', ($s: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  reg('session.end', ($s: unknown, e: { sessionId: string }) => ({ sessionId: e.sessionId }))
  reg('session.compact', ($s: unknown, e: { messages: unknown[] }) => ({ messages: e.messages }))
  reg('session.id', () => ({ value: idOf(self()) }))
  reg('tool.call', { tool: 'ListAgents' }, () => ({ result: listingOf(current.sessions) }))
  reg('tool.register', ($s: unknown, e: Spec) => (current.world.tools?.push(e), { value: { tool: e.name } }))
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
  // The engine's own answer for a call to a mod's tool is "ask" (a permission prompt); only a hook of the mod can turn it into "allow" (AC-59).
  reg('tool.check', ($s: unknown, e: { tool: string }, next: (e: unknown) => unknown) => (current.world.ask || e.tool.startsWith('mcp__bridge__') ? { decision: 'ask' } : next(e)))
  reg('classic.Stop', () => ({}))
  reg('classic.StopFailure', () => ({}))
  reg('classic.UserPromptSubmit', () => ({}))
  for (const name of HOST_READ_EVENTS) {
    reg(name, ($s: unknown, e: unknown, next: (e: unknown) => unknown) => (current.world.host?.push(`${name} ${payloadOf(e)}`), next(e)))
  }
  for (const name of HOST_REFUSED_EVENTS) {
    reg(name, ($s: unknown, e: unknown) => (current.world.host?.push(`${name} ${payloadOf(e)}`), { deny: 'recorded' }))
  }
  ;(on as unknown as (name: string, hook: unknown) => void)('process.spawn', async function* ($s: unknown, e: unknown) { current.world.host?.push(`process.spawn ${payloadOf(e)}`); return { deny: 'recorded' } })
  reg('fs.stat', ($s: unknown, e: { path: string }) => (current.world.host?.push(`fs.stat ${e.path}`), { deny: 'ENOENT' }))
  reg('fs.exists', ($s: unknown, e: { path: string }) => (current.world.host?.push(`fs.exists ${e.path}`), { value: false }))
  reg('process.run', ($s: unknown, e: { argv: readonly string[] }) => {
    const argv = e.argv
    current.world.host?.push(`process.run ${argv.join(' ')}`)
    const done = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (current.world.refuseOtherPrograms && !['sh', 'ps', 'claude'].includes(argv[0] ?? '')) return { value: { exitCode: 127, stdout: '', stderr: 'not found', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'sh' && argv[2] === REGISTRY_SCRIPT) return done(registryOf(current.sessions, current.world.baseMs ?? current.base))
    if (argv[0] === 'sh' && argv[2] === TITLE_SCRIPT) {
      return done(argv.slice(4).map(spec => {
        const found = current.sessions.find(one => idOf(one.name) === (spec.split('/').at(-1) ?? ''))
        const ai = found?.title ? JSON.stringify({ type: 'ai-title', aiTitle: found.title }) : ''
        return `${ai}${FIELD_SEP}${FIELD_SEP}${ITEM_SEP}`
      }).join(''))
    }
    if (argv[0] === 'sh' && argv[2] === BRANCH_SCRIPT) {
      return done(argv.slice(4).map(dir => `${current.sessions.find(one => (one.cwd ?? `/p/${one.name}`) === dir)?.branch ?? ''}${FIELD_SEP}${ITEM_SEP}`).join(''))
    }
    if (argv[0] === 'ps') return done(current.sessions.map((s, i) => `${i + 1} ttys00${i + 1} claude --x TERM_PROGRAM=ghostty`).join('\n') + '\n')
    if (argv[0] === 'claude' && argv[1] === 'agents') return done('[]')
    return done('ok\n')
  })
  return { store: current.store, clock, mounts: 0, pending: undefined }
}
type Ui = any
const mountPane = async ($: any, on: On, sessions: Sess[], world: World, cols = 44, before?: (clock: ReturnType<typeof mock.clock>) => Promise<void>) => {
  const { store, clock, mounts, pending } = engine(on, sessions, world)
  await pending
  if (before) await before(clock)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
  await $.command.run({ command: 'bridge', args: '' } as never)
  const ui: Ui = await $.ui.mount({
    plugin: 'bridge', surface: 'terminal', component: 'Pane',
    props: { title: 'Bridge', isFocused: false, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as never,
    requestId: mounts === 0 ? 'bridge' : `bridge-${mounts}`,
  })
  return { ui, store, clock }
}
/** One redraw: the pane refreshes every 5 seconds, so exactly 5000 ms. */
const redraw = async (clock: { advance: (ms: number) => Promise<unknown> }, ui: Ui) => { await clock.advance(5000); await ui.advance(5000) }

// ---------------------------------------------------------------- the adapters the plan names (Open Questions rows 1 to 4)
type State = 'planned' | 'in progress' | 'done'
type Tk = { id: string; state: State; worker?: string }
const tk = (id: string, state: State, worker?: string): Tk => ({ id, state, ...(worker !== undefined ? { worker } : {}) })
/** Open Questions row 3 (provisional shape, /ddd:plan locks it): one entry per ticket, states spelled `planned`, `in_progress`, `done`. */
const wire = (t: Tk) => ({ id: t.id, state: t.state === 'in progress' ? 'in_progress' : t.state, ...(t.worker !== undefined ? { worker: t.worker } : {}) })
/** Open Questions row 1 (provisional): a report names a worker by its listed id. */
const F_workerRef = (worker: { id: string }): string => worker.id
type Answer = { text: string; refused: boolean }
const NO_ANSWER: Answer = { text: '', refused: false }
const answerOf = (res: any): Answer => {
  if (!res || typeof res !== 'object') return NO_ANSWER
  const refused = typeof res.deny === 'string' || res.isError === true
  const raw = typeof res.deny === 'string' ? res.deny : typeof res.text === 'string' ? res.text : res.result === undefined ? '' : typeof res.result === 'string' ? res.result : JSON.stringify(res.result)
  return { text: raw, refused }
}
/** The tool as registered (`mcp__bridge__<name>`); the provisional name until the module registers one. A call to a tool nobody implements throws in the engine and reads as no answer (see F_call). */
const toolOf = (world: World) => `mcp__bridge__${world.tools?.[0]?.name ?? 'report_tickets'}`
const F_call = async ($: any, world: World, input: Record<string, unknown>, agentId?: string): Promise<Answer> => {
  try { return answerOf(await $.tool.call({ tool: toolOf(world), ...input, ...(agentId !== undefined ? { agentId } : {}) } as never)) } catch (e) {
    // Only "nobody implements this tool" reads as no answer (the tool does not exist yet); any other engine error is a harness defect and surfaces.
    if (/no implementation for tool\.call/.test(String(e))) return NO_ANSWER
    throw e
  }
}
/** Open Questions row 3: the report adapter; the main conversation unless `agentId` is given. */
const F_report = ($: any, world: World, tickets: readonly Tk[], epic?: string, agentId?: string) =>
  F_call($, world, { all_tickets: tickets.map(wire), ...(epic !== undefined ? { epic } : {}) }, agentId)
/** The same call with raw (possibly malformed) entries. */
const F_reportRaw = ($: any, world: World, all_tickets: unknown[], epic?: unknown) => F_call($, world, { all_tickets, ...(epic !== undefined ? { epic } : {}) })
/** Open Questions row 3: the read-back adapter (AC-62). */
const F_readback = ($: any, world: World, agentId?: string) => F_call($, world, { read_back: true }, agentId)
/** Open Questions row 2: a listed subagent of a worker, through the parent link the host lists. */
const F_rollup = (id: string, parentId: string, status: string, description: string, startMin: number, extra: object = {}) => H_AGENT(id, status, description, startMin, { parentId, ...extra })
// F_limit (Open Questions row 4): no check can be expressed until /ddd:plan locks the usage-limit signal; see the placeholders under "Edge cases".

const H_AGENT = (id: string, status: string, description: string, startMin: number, extra: object = {}) =>
  ({ id, description, type: 'Explore', status, startedAt: TUE_10 - 60 * MIN + startMin * MIN, statusSince: TUE_10 - 2 * MIN, ...extra })
const TIT = 'Release 42'
const own = (x: Omit<Sess, 'name'> = {}) => S('own', { title: TIT, ...x })
const mk = (w: World = {}): World => ({ tools: [], texts: [], agents: [], store: new Map<string, unknown>(), ...w })
const withPrefixes = (w: World = {}): World => mk({ ...w, store: new Map<string, unknown>([['setting:tickets', ['WS-', 'APP-']], ...(w.store ?? [])]) })

/** `before` runs after the engine is stubbed and before the session starts: no timer is live yet, so the clock may move by days. */
type RigOpts = { world?: World; sessions?: Sess[]; cols?: number; before?: (w: World, clock: ReturnType<typeof mock.clock>) => Promise<void> }
const rig = async ($: any, on: On, o: RigOpts = {}) => {
  const world = o.world ?? mk()
  if (!world.tools) world.tools = []
  const sessions = o.sessions ?? [own()]
  const cols = o.cols ?? 44
  const m = await mountPane($, on, sessions, world, cols, o.before ? clock => o.before!(world, clock) : undefined)
  return {
    $, on, world, sessions, cols, ...m,
    report: (t: readonly Tk[], epic?: string) => F_report($, world, t, epic),
    readback: () => F_readback($, world),
    redraw: () => redraw(m.clock, m.ui),
    lines: (name = 'own') => cardLines(m.ui, name),
    title: async (name = 'own') => ((await cardLines(m.ui, name))[1] ?? ''),
  }
}
type Rig = Awaited<ReturnType<typeof rig>>
/** Mount the pane again over the same world and store (resume, reload, a second session). */
const remount = (r: Rig, patch: { selfName?: string; cols?: number; sessions?: Sess[] } = {}) => {
  if (patch.selfName !== undefined) r.world.selfName = patch.selfName
  return rig(r.$, r.on, { world: r.world, sessions: patch.sessions ?? r.sessions, cols: patch.cols ?? r.cols })
}

// ---------------------------------------------------------------- drawn-outcome readers
const cardLines = async (ui: Ui, name = 'own') => {
  const lines: string[] = []
  for (const key of ['line1', 'line2', 'line3']) {
    const one = await ui.find({ key: `${key}:${refOf(name)}` })
    if (one) lines.push(one.text as string)
  }
  return lines
}
const COUNT = /(?<![\d/])(\d+\/\d+)(?![\d/])/
const countIn = (text: string): string | null => COUNT.exec(text)?.[1] ?? null
const walk = (el: any, fn: (e: any) => void) => { if (el && typeof el === 'object') { fn(el); for (const c of el.children ?? []) walk(c, fn) } }
/** The bar's cells of an element, left to right: each `━` or `╸` with the hue it is drawn in. */
const cellsOfEl = (el: any): Array<{ glyph: string; hue: Hue }> => {
  const out: Array<{ glyph: string; hue: Hue }> = []
  walk(el, e => {
    if (e.type !== 'Text') return
    const text = (e.children ?? []).filter((c: unknown) => typeof c === 'string').join('')
    for (const c of text) if (c === '━' || c === '╸') out.push({ glyph: c, hue: hueOf(e.props?.color as string | undefined) })
  })
  return out
}
const titleCells = async (ui: Ui, name = 'own') => cellsOfEl(await ui.find({ key: `line2:${refOf(name)}` }))
const hues = (cells: ReadonlyArray<{ hue: Hue }>) => cells.map(c => c.hue)
const glyphs = (cells: ReadonlyArray<{ glyph: string }>) => cells.map(c => c.glyph).join('')
/** The title of a card's title line: the text of its first button (the card's open button). */
const titleOfLine = async (ui: Ui, name = 'own') => {
  const el = await ui.find({ key: `line2:${refOf(name)}` })
  let found = ''
  walk(el, e => { if (!found && e.type === 'Button') found = String(e.props?.label ?? '') })
  return found
}
const ownRowText = async (ui: Ui, name = 'own') => String((await ui.find({ key: `row:${refOf(name)}` }))?.text ?? '')
const ownRowCells = async (ui: Ui, name = 'own') => cellsOfEl(await ui.find({ key: `row:${refOf(name)}` }))
const ROW_START = /^\s*[│┃|]/
const spinnerless = (t: string) => t.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '').replace(/\s+/g, ' ').trim()
const drawnRows = async (ui: Ui): Promise<string[]> => {
  const texts = (await ui.findAll({ type: 'Box' })).map((e: any) => String(e.text ?? '')).filter((t: string) => ROW_START.test(t))
  return texts.filter((t: string, i: number) => !texts.slice(0, i).some((before: string) => before.trim() === t.trim()))
}
/** Each drawn row's text and the hue of its first dot, in row order. */
const rowInfo = async (ui: Ui): Promise<Array<{ text: string; hue: Hue }>> => {
  const dotsIn = (el: any): Hue[] => {
    const out: Hue[] = []
    walk(el, e => {
      if (e.type === 'Text' && (e.children ?? []).filter((c: unknown) => typeof c === 'string').join('').includes('●')) out.push(hueOf(e.props?.color as string | undefined))
    })
    return out
  }
  const boxes = (await ui.findAll({ type: 'Box' })).filter((e: any) => ROW_START.test(String(e.text ?? '')))
  const firsts = boxes.filter((e: any, i: number) => !boxes.slice(0, i).some((before: any) => String(before.text).trim() === String(e.text).trim()))
  return firsts.map((e: any) => ({ text: String(e.text), hue: dotsIn(e)[0] ?? 'none' }))
}
const rowOfId = (rows: Array<{ text: string; hue: Hue }>, id: string) => rows.find(r => has(r.text, id))
const allText = async (ui: Ui): Promise<string[]> => (await ui.findAll({ type: 'Text' })).map((e: any) => String(e.text ?? ''))
const moreLine = async (ui: Ui) => (await allText(ui)).map(t => /\+(\d+) more/.exec(t)?.[0]).find(Boolean) ?? null
/** Ticket rows drawn outside any element that is hidden until the pointer hovers. */
const visibleRows = async (ui: Ui): Promise<string[]> => {
  const root = (await ui.findAll({ type: 'Box' }))[0]
  const out: string[] = []
  const go = (el: any, hidden: boolean) => {
    if (!el || typeof el !== 'object') return
    const isHidden = hidden || el.props?.display === 'none'
    if (!isHidden && el.type === 'Box' && ROW_START.test(String(el.text ?? ''))) out.push(String(el.text))
    for (const c of el.children ?? []) go(c, isHidden)
  }
  go(root, false)
  return out.filter((t, i) => !out.slice(0, i).some(before => before.trim() === t.trim()))
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** `id` as a whole token (not glued into a longer id). */
const has = (text: string, id: string) => new RegExp(`(?<![\\w-])${esc(id)}(?![\\w-])`).test(text)
const clauses = (text: string) => text.split(/[;\n.]/).map(c => c.trim()).filter(Boolean)
/** The stretch of an answer that belongs to one id: from the id to the next of `ids` (format-neutral). */
const segmentOf = (text: string, id: string, ids: readonly string[]) => {
  const start = text.search(new RegExp(`(?<![\\w-])${esc(id)}(?![\\w-])`))
  if (start < 0) return ''
  const after = ids.filter(o => o !== id).map(o => { const at = text.indexOf(o, start + id.length); return at < 0 ? text.length : at }).sort((a, b) => a - b)
  return text.slice(start, after[0] ?? text.length)
}
const num = (text: string, n: number) => new RegExp(`(?<![\\w-])${n}(?![\\w-])`).test(text)
const IN_PROGRESS = /in[ _-]progress/i

/** 25 interleaved states: 8 done, 6 in progress, 2 attention (in progress with a failed worker), 9 planned (F-25). */
const STATES25 = ['planned', 'done', 'ip', 'planned', 'attn', 'done', 'planned', 'ip', 'done', 'planned', 'ip', 'done', 'planned', 'attn', 'ip', 'done', 'planned', 'done', 'ip', 'planned', 'done', 'planned', 'ip', 'done', 'planned'] as const
/** Ids that share no prefix: letters differ per ticket. */
const uid = (i: number) => `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}-${i + 1}`
type Kind = 'done' | 'ip' | 'attn' | 'planned'
/** A report of the given kinds in a fixed scrambled order, with the failed workers its attention tickets name. */
const many = (kinds: readonly Kind[]): { tickets: Tk[]; agents: unknown[] } => {
  const tickets: Tk[] = []
  const agents: unknown[] = []
  kinds.forEach((kind, i) => {
    const id = uid(i)
    if (kind === 'attn') { agents.push(H_AGENT(`w-${i}`, 'failed', `fix ${id} alpha`, i)); tickets.push(tk(id, 'in progress', F_workerRef({ id: `w-${i}` }))) }
    else tickets.push(tk(id, kind === 'ip' ? 'in progress' : kind, undefined))
  })
  return { tickets, agents }
}
const kindsOf = (counts: { done?: number; ip?: number; attn?: number; planned?: number }): Kind[] => {
  const list: Kind[] = [...rep<Kind>('done', counts.done ?? 0), ...rep<Kind>('ip', counts.ip ?? 0), ...rep<Kind>('attn', counts.attn ?? 0), ...rep<Kind>('planned', counts.planned ?? 0)]
  // A fixed stride permutation, so the report order is neither grouped nor sorted.
  const n = list.length
  const step = [7, 11, 13, 17, 19].find(s => n % s !== 0) ?? 1
  return list.map((_, i) => list[(i * step) % n]!)
}
const THREE = [tk('AB-1', 'done'), tk('CD-2', 'in progress'), tk('EF-3', 'planned')]
const F25 = () => many(STATES25.map(s => s as Kind))
/** Whether the own card shows a bar (any bar glyph on its title line). */
const hasBar = async (ui: Ui, name = 'own') => (await titleCells(ui, name)).length > 0
const SIX = () => [
  H_AGENT('s1', 'running', 'review docs', 0), H_AGENT('s2', 'completed', 'lint pass', 1), H_AGENT('s3', 'failed', 'trim fixtures', 2),
  H_AGENT('s4', 'running', 'scan WS-11 alpha', 3), H_AGENT('s5', 'running', 'tidy shelf', 4), H_AGENT('s6', 'killed', 'port notes', 5),
]
const BASE_ROWS = SIX_WORKER_ROWS.map(spinnerless)
const askFor = async ($: any, world: World, agentId: string) => {
  world.ask = true
  try { await $.tool.check({ tool: 'Bash', input: { command: 'ls' }, agentId, tool_use_id: `tu-${agentId}` } as never) } finally { world.ask = false }
}
const sessionEnd = ($: any, reason: string, name = 'own') => $.session.end({ reason, sessionId: idOf(name), resume: { id: idOf(name) } } as never)
/** The one lifecycle adapter (R-9; engine facts L-5). `/clear` and an in-process `/resume`: session end with the reason and the old id, then the session id switches with NO session start (the pane only redraws). Any other end: the process stops and a new one starts (a session start under `to`, else the same id); the store is kept. */
const F_lifecycle = async (r: Rig, o: { end: string; from?: string; to?: string; sessions?: Sess[] }) => {
  await sessionEnd(r.$, o.end, o.from ?? r.world.selfName ?? r.sessions[0]?.name ?? 'own')
  if (o.sessions) r.sessions.splice(0, r.sessions.length, ...o.sessions)
  if (o.end === 'clear' || o.end === 'resume') {
    if (o.to === undefined) throw new Error('F_lifecycle: a clear or an in-process resume switches the session id; name the new one with `to`')
    r.world.selfName = o.to
    return r
  }
  return remount(r, { ...(o.to !== undefined ? { selfName: o.to } : {}), ...(o.sessions ? { sessions: o.sessions } : {}) })
}
const EMPTY_TEXT = 'The stored list is empty.'
/** R-5: an empty read-back is exactly the locked sentence, and no id reported earlier leaks into it. */
const emptyReadback = (text: string, earlierIds: readonly string[]) => ({ exact: text === EMPTY_TEXT, leaked: earlierIds.filter(id => has(text, id)) })
const EMPTY_OK = { exact: true, leaked: [] as string[] }
const THREE_IDS = ['AB-1', 'CD-2', 'EF-3']

// ---------------------------------------------------------------- the locked answers (plan L-2)
const SUFFIX = ' The ticket list did not change.'
const refusal = (core: string) => `Refused: ${core}${SUFFIX}`
const WORKER_REFUSAL = refusal('only the main conversation can report tickets or read them back.')
const STATE_HELP = 'use planned, in_progress or done.'
/** An accepted answer's parts (R-4): split on line breaks only; the done part is the line starting `Done tickets removed:`. */
const partsOf = (a: string) => {
  const ls = a.split('\n')
  const removed = ls.find(l => l.startsWith('Removed ')) ?? ''
  const done = ls.find(l => l.startsWith('Done tickets removed:')) ?? ''
  const idsAfter = (l: string, mark: string) => (l.includes(mark) ? l.slice(l.indexOf(mark) + mark.length).split(', ').map(s => s.trim()).filter(Boolean) : [])
  return { first: ls[0] ?? '', removedCount: /^Removed (\d+)/.exec(removed)?.[1] ?? null, open: idsAfter(removed, ': '), done: idsAfter(done, ': '), cleared: /cleared (\d+)/.exec(ls[0] ?? '')?.[1] ?? null }
}
const sorted = (list: readonly string[]) => [...list].sort()

// ---------------------------------------------------------------- a stored report seeded before the pane mounts (R-7)
// The tool registers at session start, so no report can be made before it. A report that must be days old is put in the shared store
// under the locked key and shape (L-2, L-3): `tickets:<session id>` -> `{ v: 1, at, tickets, epic? }`.
const keyOf = (name: string) => `tickets:${idOf(name)}`
const recordOf = (tickets: readonly Tk[], at: number, epic?: string) => ({ v: 1, at, tickets: tickets.map(wire), ...(epic !== undefined ? { epic } : {}) })
const withRecord = (name: string, tickets: readonly Tk[], at: number, w: World = {}): World =>
  mk({ ...w, store: new Map<string, unknown>([[keyOf(name), recordOf(tickets, at)], ...(w.store ?? [])]) })

// ================================================================ 1. Reporting tickets (tool)
/** The first sentence of the registered description, as locked in plan L-1 (the Bridge runner cannot import the new `hooks/core/report.ts` before it exists, so the sentence is written out). */
const FIRST_SENTENCE = 'Send every ticket each time you call this, done ones included, because each report replaces the previous list whole.'
describe('1. reporting tickets', () => {
  const describedBy = async ($: any, on: On) => (await rig($, on)).world.tools![0]?.description ?? ''
  // AC-01
  test('The main conversation sees Bridge\'s ticket tool from its first turn without searching', async ($, on) => {
    const r = await rig($, on)
    expect({ names: r.world.tools!.map(t => t.name), deferred: r.world.tools!.map(t => t.isDeferred) }).toEqual({ names: ['report_tickets'], deferred: [false] })
  })
  // AC-02: the description captured as registered
  test('The tool description tells the orchestrator to send every ticket each time', async ($, on) => {
    expect((await describedBy($, on)).split(/(?<=[.!?])\s/)[0]).toBe(FIRST_SENTENCE)
  })
  // AC-02
  test('The tool description tells the orchestrator to send every ticket each time (state and worker)', async ($, on) => {
    const d = await describedBy($, on)
    expect({ state: d.includes('its state (planned, in_progress or done)'), worker: d.includes('that worker\'s agentId from the Agent tool result') }).toEqual({ state: true, worker: true })
  })
  // AC-02
  test('The tool description tells the orchestrator to send every ticket each time (report again when a state changes)', async ($, on) => {
    expect((await describedBy($, on)).includes('Report again whenever a ticket\'s state changes')).toBe(true)
  })
  // AC-02
  test('The tool description tells the orchestrator to send every ticket each time (at most one report per turn)', async ($, on) => {
    expect((await describedBy($, on)).includes('make at most one report per turn')).toBe(true)
  })
  // AC-03
  test('The orchestrator reports a valid list and the tool answers that it was accepted with its ticket count', async ($, on) => {
    const r = await rig($, on)
    expect((await r.report(THREE)).text.split('\n')[0]).toBe('Accepted: 3 tickets.')
  })
  // AC-03
  test('The orchestrator reports a valid list and the tool answers that it was accepted with its ticket count (one ticket)', async ($, on) => {
    const r = await rig($, on)
    expect((await r.report([tk('AB-1', 'planned')])).text.split('\n')[0]).toBe('Accepted: 1 ticket.')
  })
  const FOUR = [tk('AB-1', 'done'), tk('CD-2', 'in progress'), tk('EF-3', 'planned'), tk('GH-4', 'planned')]
  const leave = async ($: any, on: On) => {
    const r = await rig($, on)
    await r.report(FOUR)
    return partsOf((await r.report([tk('CD-2', 'in progress'), tk('JK-5', 'planned')])).text)
  }
  // AC-60
  test('The orchestrator leaves tickets out of a report and the answer names each removed ticket, done ones separately', async ($, on) => {
    const p = await leave($, on)
    expect({ open: sorted(p.open), done: p.done }).toEqual({ open: ['EF-3', 'GH-4'], done: ['AB-1'] })
  })
  // AC-60
  test('The orchestrator leaves tickets out of a report and the answer names each removed ticket, done ones separately (done part)', async ($, on) => {
    const p = await leave($, on)
    expect({ done: p.done, doneAlsoInOpenPart: p.open.includes('AB-1') }).toEqual({ done: ['AB-1'], doneAlsoInOpenPart: false })
  })
  // AC-60: a kept ticket is not named as removed
  test('The orchestrator leaves tickets out of a report and the answer names each removed ticket, done ones separately (kept CD-2 not named as removed)', async ($, on) => {
    const p = await leave($, on)
    expect({ removedNamed: p.done.includes('AB-1'), keptInRemoved: [...p.open, ...p.done].includes('CD-2') }).toEqual({ removedNamed: true, keptInRemoved: false })
  })
  // AC-60: a new ticket is not named as removed
  test('The orchestrator leaves tickets out of a report and the answer names each removed ticket, done ones separately (new JK-5 not named as removed)', async ($, on) => {
    const p = await leave($, on)
    expect({ removedNamed: p.done.includes('AB-1'), newInRemoved: [...p.open, ...p.done].includes('JK-5') }).toEqual({ removedNamed: true, newInRemoved: false })
  })
  // AC-60 (I-1: the stated number counts every removed ticket, done ones included)
  test('The orchestrator leaves tickets out of a report and the answer names each removed ticket, done ones separately (removed count)', async ($, on) => {
    expect((await leave($, on)).removedCount).toBe('3')
  })
  // AC-61
  test('The orchestrator sends an empty report and the answer says how many tickets it cleared', async ($, on) => {
    const r = await rig($, on)
    await r.report(F25().tickets)
    expect(partsOf((await r.report([])).text).first).toBe('Accepted: 0 tickets; cleared 25 tickets.')
  })
  // AC-61 + AC-60 (I-2): the clearing answer names all 25 removed ids
  test('The orchestrator sends an empty report and the answer says how many tickets it cleared (names all 25 removed ids)', async ($, on) => {
    const r = await rig($, on)
    const { tickets } = F25()
    await r.report(tickets)
    const p = partsOf((await r.report([])).text)
    expect({ named: sorted([...p.open, ...p.done]), removedCount: p.removedCount }).toEqual({ named: sorted(tickets.map(t => t.id)), removedCount: '25' })
  })
  // AC-61 + AC-60 (I-2): the 8 done ids sit in a separate done part
  test('The orchestrator sends an empty report and the answer says how many tickets it cleared (the 8 done ids in a separate done part)', async ($, on) => {
    const r = await rig($, on)
    const { tickets } = F25()
    await r.report(tickets)
    const p = partsOf((await r.report([])).text)
    const doneIds = tickets.filter(t => t.state === 'done').map(t => t.id)
    expect({ doneIds: doneIds.length, inDonePart: sorted(p.done), doneIdsInOpenPart: p.open.filter(id => doneIds.includes(id)) }).toEqual({ doneIds: 8, inDonePart: sorted(doneIds), doneIdsInOpenPart: [] })
  })
  // AC-61
  test('The orchestrator sends an empty report and the answer says how many tickets it cleared (three tickets)', async ($, on) => {
    const r = await rig($, on)
    await r.report(THREE)
    expect(partsOf((await r.report([])).text).first).toBe('Accepted: 0 tickets; cleared 3 tickets.')
  })
  const IDS62 = ['ZZ-9', 'AB-1', 'MM-5']
  const LIST62 = [tk('ZZ-9', 'planned'), tk('AB-1', 'done', F_workerRef({ id: 'w-a' })), tk('MM-5', 'in progress', F_workerRef({ id: 'w-m' }))]
  // AC-62
  test('The orchestrator asks for a read-back and gets the stored list unchanged', async ($, on) => {
    const r = await rig($, on)
    await r.report(LIST62, 'EP-7')
    const a = (await r.readback()).text
    const seg = (id: string) => segmentOf(a, id, [...IDS62, 'EP-7'])
    expect({ zz: /planned/i.test(seg('ZZ-9')), ab: /done/i.test(seg('AB-1')) && seg('AB-1').includes('w-a'), mm: IN_PROGRESS.test(seg('MM-5')) && seg('MM-5').includes('w-m') })
      .toEqual({ zz: true, ab: true, mm: true })
  })
  // AC-62: the locked read-back format (L-2)
  test('The orchestrator asks for a read-back and gets the stored list unchanged (locked format)', async ($, on) => {
    const r = await rig($, on)
    await r.report(LIST62, 'EP-7')
    expect((await r.readback()).text).toBe('Stored list: 3 tickets, epic EP-7.\nZZ-9 planned\nAB-1 done, worker w-a\nMM-5 in_progress, worker w-m')
  })
  // AC-62
  test('The orchestrator asks for a read-back and gets the stored list unchanged (report order and epic)', async ($, on) => {
    const r = await rig($, on)
    await r.report(LIST62, 'EP-7')
    const a = (await r.readback()).text
    const at = IDS62.map(id => a.search(new RegExp(`(?<![\\w-])${esc(id)}(?![\\w-])`)))
    expect({ ordered: at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1]!)), epic: has(a, 'EP-7') }).toEqual({ ordered: true, epic: true })
  })
  // AC-62
  test('The orchestrator asks for a read-back and gets the stored list unchanged (nothing changes by reading)', async ($, on) => {
    const r = await rig($, on)
    await r.report(LIST62, 'EP-7')
    const first = (await r.readback()).text
    expect({ listed: IDS62.every(id => has(first, id)), same: (await r.readback()).text === first }).toEqual({ listed: true, same: true })
  })
  // AC-62
  test('The orchestrator asks for a read-back and gets the stored list unchanged (empty list says so)', async ($, on) => {
    const r = await rig($, on)
    expect(emptyReadback((await r.readback()).text, IDS62)).toEqual(EMPTY_OK)
  })
  // AC-62: a worker's request is refused as in AC-04
  test('The orchestrator asks for a read-back and gets the stored list unchanged (a worker\'s read-back is refused)', async ($, on) => {
    const r = await rig($, on)
    await r.report(LIST62)
    const refused = await F_readback($, r.world, 'a1')
    expect({ refused: refused.refused, text: refused.text }).toEqual({ refused: true, text: WORKER_REFUSAL })
  })

  /** AC-63 (R-7): the store already holds the report from `ageMs` before the session starts; the first draw is read with no clock move. */
  const returned = ($: any, on: On, ageMs: number, tickets: readonly Tk[] = THREE) => rig($, on, { world: withRecord('own', tickets, TUE_10 - ageMs) })
  /** Positive control, read last: the tool takes a report, so the checks before it ran against a live tool. */
  const toolLive = async (r: Rig) => /^Accepted: \d+ tickets?\./.test((await r.report(THREE)).text)
  const DAY4 = [tk('ZZ-9', 'planned'), tk('YY-8', 'done')]
  // AC-63
  test('A ticket list left more than 7 days without a report is gone when the session comes back', async ($, on) => {
    const back = await returned($, on, 7 * DAY + MIN)
    expect({ count: countIn(await back.title()), bar: await hasBar(back.ui), live: await toolLive(back) }).toEqual({ count: null, bar: false, live: true })
  })
  // AC-63
  test('A ticket list left more than 7 days without a report is gone when the session comes back (read-back)', async ($, on) => {
    const back = await returned($, on, 7 * DAY + MIN)
    expect({ ...emptyReadback((await back.readback()).text, THREE_IDS), live: await toolLive(back) }).toEqual({ ...EMPTY_OK, live: true })
  })
  // AC-63 (I-5): an accepted report renews the period. The list is 2 s from its 7th day; a report accepted now renews it, so it survives the next redraw (5 s).
  test('A ticket list left more than 7 days without a report is gone when the session comes back (renewal: progress still shows)', async ($, on) => {
    const back = await returned($, on, 7 * DAY - 2000)
    const accepted = (await back.report(DAY4)).text.split('\n')[0]
    await back.redraw()
    expect({ accepted, count: countIn(await back.title()), bar: await hasBar(back.ui) }).toEqual({ accepted: 'Accepted: 2 tickets.', count: '1/2', bar: true })
  })
  // AC-63 (I-5)
  test('A ticket list left more than 7 days without a report is gone when the session comes back (renewal: read-back lists the new tickets)', async ($, on) => {
    const back = await returned($, on, 7 * DAY - 2000)
    await back.report(DAY4)
    await back.redraw()
    const a = (await back.readback()).text
    expect({ renewed: ['ZZ-9', 'YY-8'].map(id => has(a, id)), old: THREE_IDS.some(id => has(a, id)) }).toEqual({ renewed: [true, true], old: false })
  })
  // AC-63 (I-4): the age runs from the report, not from the session start: a list 4 days and 1 minute old is kept
  test('A ticket list left more than 7 days without a report is gone when the session comes back (age runs from the report, not the session start)', async ($, on) => {
    const back = await returned($, on, 4 * DAY + MIN)
    expect({ count: countIn(await back.title()), bar: await hasBar(back.ui) }).toEqual({ count: '1/3', bar: true })
  })
  // AC-63 open-session case (closes validation Known Gap 4): the pane stays open while the list passes its 7th day. Substitute for a 7-day clock move, which the harness cannot make with the pane alive: the list is 2 s short of 7 days when the session starts, and one redraw (5 s) carries it over.
  test('A ticket list left more than 7 days without a report is gone when the session comes back (a pane left open while the list expires)', async ($, on) => {
    const open = await returned($, on, 7 * DAY - 2000)
    const before = countIn(await open.title())
    await open.redraw()
    expect({ before, after: countIn(await open.title()), bar: await hasBar(open.ui) }).toEqual({ before: '1/3', after: null, bar: false })
  })
  // AC-63 open-session case
  test('A ticket list left more than 7 days without a report is gone when the session comes back (a pane left open: the read-back is empty)', async ($, on) => {
    const open = await returned($, on, 7 * DAY - 2000)
    const before = has((await open.readback()).text, 'AB-1')
    await open.redraw()
    expect({ before, ...emptyReadback((await open.readback()).text, THREE_IDS) }).toEqual({ before: true, ...EMPTY_OK })
  })
  // AC-63
  test('A ticket list left more than 7 days without a report is gone when the session comes back (progress returns with a new report)', async ($, on) => {
    const back = await returned($, on, 7 * DAY + MIN)
    const before = countIn(await back.title())
    await back.report(THREE)
    await back.redraw()
    expect({ before, after: countIn(await back.title()) }).toEqual({ before: null, after: '1/3' })
  })
  // AC-04
  test('A worker calls the ticket tool and the call is refused', async ($, on) => {
    const r = await rig($, on)
    await r.report([tk('AB-1', 'done'), tk('CD-2', 'planned')])
    const a = await F_report($, r.world, [tk('GH-4', 'planned'), tk('JK-5', 'planned'), tk('LM-6', 'done')], undefined, 'a1')
    expect({ refused: a.refused, text: a.text }).toEqual({ refused: true, text: WORKER_REFUSAL })
  })
  // AC-04
  test('A worker calls the ticket tool and the call is refused (a teammate in the session)', async ($, on) => {
    const r = await rig($, on)
    await r.report([tk('AB-1', 'done'), tk('CD-2', 'planned')])
    const a = await F_report($, r.world, [tk('GH-4', 'planned')], undefined, 'teammate-1@team')
    expect({ refused: a.refused, text: a.text }).toEqual({ refused: true, text: WORKER_REFUSAL })
  })
  // AC-04
  test('A worker calls the ticket tool and the call is refused (the list does not change)', async ($, on) => {
    const r = await rig($, on)
    await r.report([tk('AB-1', 'done'), tk('CD-2', 'planned')])
    await F_report($, r.world, [tk('GH-4', 'planned'), tk('JK-5', 'planned'), tk('LM-6', 'done')], undefined, 'a1')
    const back = (await r.readback()).text
    expect({ kept: has(back, 'AB-1') && has(back, 'CD-2'), others: ['GH-4', 'JK-5', 'LM-6'].some(id => has(back, id)) }).toEqual({ kept: true, others: false })
  })

  /** A refusal case: the answer is the locked refusal text (L-2), and the list of the accepted first report is unchanged. */
  const refuses = (label: string, send: (r: Rig) => Promise<Answer>, core: string) =>
    // AC-05
    test(`The orchestrator sends a malformed ticket and the report is refused naming the problem (${label})`, async ($, on) => {
      const r = await rig($, on)
      await r.report([tk('AB-1', 'done'), tk('CD-2', 'planned')])
      const a = await send(r)
      const back = (await r.readback()).text
      expect({ refused: a.refused, text: a.text, unchanged: has(back, 'AB-1') && has(back, 'CD-2') && !has(back, 'QX-9') }).toEqual({ refused: true, text: refusal(core), unchanged: true })
    })
  const raw = (r: Rig, tickets: unknown[], epic?: unknown) => F_reportRaw(r.$, r.world, tickets, epic)
  refuses('missing id', r => raw(r, [{ state: 'planned' }]), 'ticket 1 has no id.')
  refuses('empty id', r => raw(r, [{ id: '', state: 'planned' }]), 'ticket 1 has an empty id.')
  refuses('id of only spaces', r => raw(r, [{ id: '   ', state: 'planned' }]), 'ticket 1 has an empty id.')
  refuses('25-character id', r => raw(r, [{ id: 'A'.repeat(23) + '-1', state: 'planned' }]), 'ticket 1\'s id is longer than 24 characters.')
  refuses('25-character epic', r => raw(r, [wire(tk('QX-9', 'planned'))], 'E'.repeat(25)), 'the epic is longer than 24 characters.')
  refuses('epic of only spaces', r => raw(r, [wire(tk('QX-9', 'planned'))], '   '), 'the epic is empty.')
  refuses('worker of only spaces', r => raw(r, [{ id: 'QX-9', state: 'planned', worker: '   ' }]), 'ticket QX-9 has an empty worker.')
  refuses('state blocked', r => raw(r, [{ id: 'QX-9', state: 'blocked' }]), `ticket QX-9 has state "blocked"; ${STATE_HELP}`)
  refuses('no state', r => raw(r, [{ id: 'QX-9' }]), `ticket QX-9 has no state; ${STATE_HELP}`)
  refuses('an entry that is not an object', r => raw(r, ['QX-9']), 'ticket 1 is not an object.')
  refuses('the list is missing', r => F_call(r.$, r.world, { epic: 'EP-1' }), 'all_tickets is missing; send every ticket, or an empty list to clear the list.')
  refuses('the list is not a list', r => F_call(r.$, r.world, { all_tickets: 'QX-9' }), 'all_tickets must be a list.')
  // AC-05: two bad tickets, the first problem is named (the first ticket's state, not the second's empty id)
  test('The orchestrator sends a malformed ticket and the report is refused naming the problem (two problems, the first is named)', async ($, on) => {
    const r = await rig($, on)
    const a = await raw(r, [{ id: 'QX-9', state: 'blocked' }, { id: '', state: 'planned' }])
    expect({ refused: a.refused, text: a.text }).toEqual({ refused: true, text: refusal(`ticket QX-9 has state "blocked"; ${STATE_HELP}`) })
  })
  // AC-05: leaving out the epic or a ticket's worker is allowed
  test('The orchestrator sends a malformed ticket and the report is refused naming the problem (no epic and no worker is accepted)', async ($, on) => {
    const r = await rig($, on)
    const a = await raw(r, [{ id: 'AB-1', state: 'planned' }])
    expect({ refused: a.refused, text: a.text }).toEqual({ refused: false, text: 'Accepted: 1 ticket.' })
  })
  // AC-05: the 24-character boundary
  test('The orchestrator sends a malformed ticket and the report is refused naming the problem (24-character id and epic are accepted)', async ($, on) => {
    const r = await rig($, on)
    const a = await raw(r, [{ id: 'A'.repeat(22) + '-1', state: 'planned' }], 'E'.repeat(24))
    expect({ refused: a.refused, text: a.text }).toEqual({ refused: false, text: 'Accepted: 1 ticket.' })
  })
  // AC-05: spaces around an id are removed
  test('The orchestrator sends a malformed ticket and the report is refused naming the problem (spaces around an id are trimmed)', async ($, on) => {
    const r = await rig($, on)
    await raw(r, [{ id: ' AB-1 ', state: 'planned' }, { id: 'CD-2', state: 'planned' }])
    expect((await r.report([tk('AB-1', 'planned'), tk('CD-2', 'planned')])).text).toBe('Accepted: 2 tickets.')
  })
  // AC-06
  test('The orchestrator lists the same ticket twice and the report is refused naming it', async ($, on) => {
    const r = await rig($, on)
    await r.report([tk('AB-1', 'done')])
    const a = await r.report([tk('AB-1', 'planned'), tk('CD-2', 'planned'), tk('AB-1', 'done')])
    const back = (await r.readback()).text
    expect({ refused: a.refused, text: a.text, unchanged: has(back, 'AB-1') && !has(back, 'CD-2') }).toEqual({ refused: true, text: refusal('ticket AB-1 is listed twice.'), unchanged: true })
  })
  // AC-06
  test('The orchestrator lists the same ticket twice and the report is refused naming it (equal after trimming)', async ($, on) => {
    const r = await rig($, on)
    await r.report([tk('CD-2', 'done')])
    const a = await raw(r, [{ id: 'AB-1', state: 'planned' }, { id: ' AB-1', state: 'planned' }])
    expect({ refused: a.refused, text: a.text }).toEqual({ refused: true, text: refusal('ticket AB-1 is listed twice.') })
  })
  // AC-06
  test('The orchestrator lists the same ticket twice and the report is refused naming it (letter case makes two tickets)', async ($, on) => {
    const r = await rig($, on)
    const a = await r.report([tk('ab-1', 'planned'), tk('AB-1', 'planned')])
    expect({ refused: a.refused, text: a.text }).toEqual({ refused: false, text: 'Accepted: 2 tickets.' })
  })
  const hundreds = (n: number) => Array.from({ length: n }, (_, i) => tk(uid(i), 'planned'))
  // AC-07
  test('The orchestrator sends more than 200 tickets and the report is refused stating the limit', async ($, on) => {
    const r = await rig($, on)
    const a = await r.report(hundreds(201))
    expect({ refused: a.refused, text: a.text }).toEqual({ refused: true, text: refusal('201 tickets; a report holds at most 200.') })
  })
  // AC-07
  test('The orchestrator sends more than 200 tickets and the report is refused stating the limit (200 are accepted)', async ($, on) => {
    const r = await rig($, on)
    const a = await r.report(hundreds(200))
    expect({ refused: a.refused, text: a.text }).toEqual({ refused: false, text: 'Accepted: 200 tickets.' })
  })
  // AC-07
  test('The orchestrator sends more than 200 tickets and the report is refused stating the limit (the list stays)', async ($, on) => {
    const r = await rig($, on)
    await r.report(hundreds(200))
    await r.report(hundreds(201))
    const back = (await r.readback()).text
    expect({ first: has(back, uid(0)), last: has(back, uid(199)), over: has(back, uid(200)) }).toEqual({ first: true, last: true, over: false })
  })
  // AC-08
  test('An accepted report becomes the whole ticket list', async ($, on) => {
    const r = await rig($, on)
    await r.report([tk('AB-1', 'done', F_workerRef({ id: 'w-a' })), tk('CD-2', 'planned')], 'EP-1')
    await r.report([tk('ZZ-9', 'in progress', F_workerRef({ id: 'w-z' })), tk('CD-2', 'done')])
    const a = (await r.readback()).text
    const seg = (id: string) => segmentOf(a, id, ['ZZ-9', 'CD-2'])
    expect({
      order: a.search(/ZZ-9/) >= 0 && a.search(/ZZ-9/) < a.search(/CD-2/),
      zz: IN_PROGRESS.test(seg('ZZ-9')) && seg('ZZ-9').includes('w-z'), cd: /done/i.test(seg('CD-2')),
    }).toEqual({ order: true, zz: true, cd: true })
  })
  // AC-08
  test('An accepted report becomes the whole ticket list (nothing earlier remains)', async ($, on) => {
    const r = await rig($, on)
    await r.report([tk('AB-1', 'done', F_workerRef({ id: 'w-a' })), tk('CD-2', 'planned')], 'EP-1')
    await r.report([tk('ZZ-9', 'in progress', F_workerRef({ id: 'w-z' })), tk('CD-2', 'done')])
    const a = (await r.readback()).text
    expect({ listed: has(a, 'ZZ-9'), oldTicket: has(a, 'AB-1'), oldEpic: has(a, 'EP-1') }).toEqual({ listed: true, oldTicket: false, oldEpic: false })
  })
  // AC-09
  test('An accepted empty report empties the ticket list', async ($, on) => {
    const r = await rig($, on)
    await r.report(THREE)
    const before = has((await r.readback()).text, 'AB-1')
    await r.report([])
    expect({ before, ...emptyReadback((await r.readback()).text, THREE_IDS) }).toEqual({ before: true, ...EMPTY_OK })
  })
})

// ================================================================ Unit rules (R-1, R-2, R-8): the pure ticket model and bar rules
// Imported from hooks/core/progress.ts (plan L-7) and drawn through hooks/core/view.ts and layout.ts. The Bridge runner cannot import a module
// that does not exist, so these checks reach the new functions through a namespace import of the two modules that already exist; hooks/core/report.ts
// (L-2) is exercised through the tool entry (sections 1 and 6, the edge cases and NH-11/NH-20).
const pg = progressNs as any
type Color = 'done' | 'in_progress' | 'attention' | 'planned'
const ck = (id: string, status: ChildStatus, startMin: number, parentId?: string, label = id): Child =>
  ({ id, label, status, since: NOW - 2 * MIN, startedAt: T0 + startMin * MIN, ...(parentId !== undefined ? { parentId } : {}) })
const rpt = (tickets: readonly Tk[], epic?: string) => ({ v: 1, at: NOW, tickets: tickets.map(wire), ...(epic !== undefined ? { epic } : {}) })
const progressOf = (tickets: readonly Tk[], children: readonly Child[] = [], epic?: string) => pg.ticketProgressOf(rpt(tickets, epic), children)
const colorsOf = (list: readonly Color[]) => list.map(color => ({ color }))
const runsOf = (list: readonly Color[], n: number): Array<[string, number]> => pg.barRunsOf(colorsOf(list), n).map((r: { color: string; length: number }) => [r.color, r.length])
const repeatColor = (color: Color, n: number): Color[] => rep(color, n)
/** The title line of the own card drawn by the view (pure): its bar cells, count and the title segment. */
const lineOf = (tickets: readonly Tk[], o: { epic?: string; width: number; title?: string; children?: Child[] }) => {
  const v = view(o.children ?? [], { width: o.width, own: { title: o.title ?? TIT }, report: rpt(tickets, o.epic) })
  const segs = ownOf(v).lines[1] ?? []
  const text = plain(segs)
  const bar = segs.filter(s => s.kind === 'text' && s.role === 'bar').map(s => (s.kind === 'text' ? s.text : '')).join('')
  const title = segs.find(s => s.kind === 'text' && s.role === 'title')
  return { text, width: cellWidth(text), cells: [...bar].length, count: countIn(text), title: title && title.kind === 'text' ? title.text.trim() : '' }
}
const THREE_T = [tk('AB-1', 'done'), tk('CD-2', 'planned'), tk('EF-3', 'planned')]

describe('unit rules: the ticket model', () => {
  // R-1 (OA-2): a report names a worker by its listed id only
  // AC-34
  test('A ticket\'s worker and its rolled-up subagents get no child rows of their own (unit: a report names a worker by its id)', () => {
    expect(pg.workerOf('w-a', [ck('w-b', 'working', 1), ck('w-a', 'working', 0)])?.id).toBe('w-a')
  })
  // AC-38
  test('A ticket whose named worker is not listed shows its reported state without age or attention (unit: a description or a name is not a worker id)', () => {
    const listed = [{ ...ck('w-a', 'failed', 0, undefined, 'fix AB-1 alpha'), name: 'alpha-runner' } as Child]
    expect([pg.workerOf('fix AB-1 alpha', listed), pg.workerOf('alpha-runner', listed)]).toEqual([undefined, undefined])
  })
  // Edge: named worker matches several listed workers (the host lists one id twice)
  test('Edge: named worker matches several listed workers; the one started last wins (unit)', () => {
    const twice = [ck('w-a', 'working', 1, undefined, 'older'), ck('w-a', 'failed', 5, undefined, 'newer')]
    expect(pg.workerOf('w-a', twice)?.label).toBe('newer')
  })
  // Edge: a tie goes to the one listed later
  test('Edge: named worker matches several listed workers; a tie goes to the later-listed one (unit)', () => {
    const tie = [ck('w-a', 'working', 3, undefined, 'first listed'), ck('w-a', 'failed', 3, undefined, 'second listed')]
    expect(pg.workerOf('w-a', tie)?.label).toBe('second listed')
  })
  // R-2: roll-ups follow parent links to any depth
  const chain = [ck('w-a', 'working', 0), ck('w-sub', 'working', 1, 'w-a'), ck('w-gc', 'failed', 2, 'w-sub')]
  // AC-34
  test('A ticket\'s worker and its rolled-up subagents get no child rows of their own (unit: a grandchild is claimed and none is loose)', () => {
    const p = progressOf([tk('AB-1', 'in progress', 'w-a')], chain)
    expect({ claimed: p?.tickets[0]?.claimed.map((c: Child) => c.id).sort(), loose: p?.loose.map((c: Child) => c.id) }).toEqual({ claimed: ['w-a', 'w-gc', 'w-sub'], loose: [] })
  })
  // Terms "Attention" (rolled-up subagent), AC-18
  test('Each bar segment takes its ticket\'s color (unit: a failed grandchild puts the ticket in attention, word Failed)', () => {
    const t = progressOf([tk('AB-1', 'in progress', 'w-a')], chain)?.tickets[0]
    expect({ color: t?.color, word: t?.word }).toEqual({ color: 'attention', word: 'Failed' })
  })
  // AC-32
  test('A ticket row shows id, colored dot, state word and its worker\'s age (unit: a rolled-up subagent that needs you gives Needs you over Failed)', () => {
    const kids = [ck('w-top', 'failed', 0), ck('w-sub', 'needs-you', 1, 'w-top')]
    expect(progressOf([tk('TOP-6', 'in progress', 'w-top')], kids)?.tickets[0]?.word).toBe('Needs you')
  })
  // AC-35
  test('Workers that belong to no ticket keep their child rows after the ticket rows (unit: a child whose parent is not listed is loose)', () => {
    const kids = [ck('w-a', 'working', 0), ck('c-orphan', 'working', 1, 'w-gone'), ck('c-free', 'working', 2)]
    expect(progressOf([tk('AB-1', 'in progress', 'w-a')], kids)?.loose.map((c: Child) => c.id)).toEqual(['c-orphan', 'c-free'])
  })
  // Edge: one worker named by two tickets
  test('Edge: one worker named by two tickets; both claim it and nothing is loose (unit)', () => {
    const p = progressOf([tk('AB-1', 'in progress', 'w-a'), tk('CD-2', 'in progress', 'w-a')], [ck('w-a', 'failed', 0)])
    expect({ colors: p?.tickets.map((t: { color: string }) => t.color), claimed: p?.tickets.map((t: { claimed: unknown[] }) => t.claimed.length), loose: p?.loose.length }).toEqual({ colors: ['attention', 'attention'], claimed: [1, 1], loose: 0 })
  })
  // AC-16
  test('The count shows done tickets over all tickets, planned included (unit)', () => {
    const p = progressOf([tk('A1-1', 'done'), tk('B2-2', 'planned'), tk('C3-3', 'in progress'), tk('D4-4', 'done'), tk('E5-5', 'planned')])
    expect({ done: p?.done, total: p?.total }).toEqual({ done: 2, total: 5 })
  })
  // AC-16
  test('The count shows done tickets over all tickets, planned included (unit: all planned)', () => {
    const p = progressOf([tk('A1-1', 'planned'), tk('B2-2', 'planned'), tk('C3-3', 'planned'), tk('D4-4', 'planned')])
    expect({ done: p?.done, total: p?.total }).toEqual({ done: 0, total: 4 })
  })
  // NH-1 / NH-4: no report or no ticket gives no progress
  test('NH-4 An accepted report with no tickets shows no progress (unit: no report and an empty report give no ticket progress)', () => {
    expect([pg.ticketProgressOf(null, []), pg.ticketProgressOf(rpt([]), [])]).toEqual([null, null])
  })
  // AC-18
  test('Each bar segment takes its ticket\'s color (unit)', () => {
    const p = progressOf([tk('A1-1', 'done'), tk('B2-2', 'in progress'), tk('C3-3', 'planned'), tk('D4-4', 'in progress', 'w-d')], [ck('w-d', 'failed', 0)])
    const colors = p?.tickets.map((t: { color: Color }) => t.color)
    expect({ colors, hues: colors?.map((c: Color) => pg.TICKET_HUE[c]) }).toEqual({ colors: ['done', 'in_progress', 'planned', 'attention'], hues: ['green', 'blue', 'gray', 'red'] })
  })
  // AC-18 / NH-14
  test('NH-14 A done ticket with a Failed worker is not in attention and is green (unit)', () => {
    const t = progressOf([tk('AB-1', 'done', 'w-a')], [ck('w-a', 'failed', 0)])?.tickets[0]
    expect({ color: t?.color, word: t?.word }).toEqual({ color: 'done', word: 'Done' })
  })
  // NH-12
  test('NH-12 A worker the person stopped (killed) does not put its ticket in attention (unit: a stopped worker is listed idle)', () => {
    const t = progressOf([tk('AB-1', 'in progress', 'w-a')], [ck('w-a', 'idle', 0)])?.tickets[0]
    expect({ color: t?.color, word: t?.word }).toEqual({ color: 'in_progress', word: 'In progress' })
  })
  // AC-38 / NH-13
  test('NH-13 A named worker that is not listed is never in attention (unit)', () => {
    const t = progressOf([tk('AB-1', 'in progress', 'w-gone')], [ck('w-other', 'failed', 0)])?.tickets[0]
    expect({ color: t?.color, word: t?.word, worker: t?.worker }).toEqual({ color: 'in_progress', word: 'In progress', worker: undefined })
  })
  // AC-33
  test('Ticket rows list attention first, then in progress, then the rest in report order (unit)', () => {
    const kids = [ck('w-d', 'failed', 0), ck('w-f', 'failed', 1)]
    const p = progressOf([tk('A1-1', 'done'), tk('B1-2', 'planned'), tk('C1-3', 'in progress'), tk('D1-4', 'in progress', 'w-d'), tk('E1-5', 'in progress'), tk('F1-6', 'in progress', 'w-f')], kids)
    expect(p?.rows.map((t: { id: string }) => t.id)).toEqual(['D1-4', 'F1-6', 'C1-3', 'E1-5', 'A1-1', 'B1-2'])
  })
})

describe('unit rules: the bar', () => {
  const FIVE_COLORS: Color[] = ['done', 'planned', 'in_progress', 'done', 'planned']
  // AC-17
  test('Each ticket gets its own bar segment when tickets fit (unit: five tickets)', () => {
    expect(runsOf(FIVE_COLORS, MAXBAR)).toEqual([['done', 3], ['planned', 3], ['in_progress', 2], ['done', 2], ['planned', 2]])
  })
  // AC-17
  test('Each ticket gets its own bar segment when tickets fit (unit: one ticket, then as many tickets as cells)', () => {
    expect({ one: runsOf(['planned'], MAXBAR), twelve: runsOf(rep<Color>('planned', MAXBAR), MAXBAR).map(r => r[1]) }).toEqual({ one: [['planned', 12]], twelve: rep(1, MAXBAR) })
  })
  // AC-17
  test('Each ticket gets its own bar segment when tickets fit (unit: cell colors follow the report order)', () => {
    expect(pg.barCellsOf(colorsOf(FIVE_COLORS), MAXBAR)).toEqual([...repeatColor('done', 3), ...repeatColor('planned', 3), ...repeatColor('in_progress', 2), ...repeatColor('done', 2), ...repeatColor('planned', 2)])
  })
  // AC-19: N = 10, T = 12, three of each color
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned (unit: ten cells, twelve tickets)', () => {
    const list: Color[] = [...repeatColor('planned', 3), ...repeatColor('attention', 3), ...repeatColor('in_progress', 3), ...repeatColor('done', 3)]
    expect(runsOf(list, 10)).toEqual([['done', 3], ['in_progress', 3], ['attention', 2], ['planned', 2]])
  })
  // AC-19: N = 12, T = 40
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned (unit: 39 done and one planned)', () => {
    expect(runsOf([...repeatColor('planned', 1), ...repeatColor('done', 39)], MAXBAR)).toEqual([['done', 11], ['planned', 1]])
  })
  // AC-19: N = 5, T = 100
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned (unit: five cells, a hundred tickets)', () => {
    const list: Color[] = [...repeatColor('planned', 2), ...repeatColor('in_progress', 48), ...repeatColor('attention', 2), ...repeatColor('done', 48)]
    expect(runsOf(list, 5)).toEqual([['done', 1], ['in_progress', 2], ['attention', 1], ['planned', 1]])
  })
  // AC-19: T = 13 with no attention ticket
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned (unit: thirteen tickets, no attention run)', () => {
    const runs = runsOf([...repeatColor('planned', 4), ...repeatColor('in_progress', 4), ...repeatColor('done', 5)], MAXBAR)
    expect({ colors: runs.map(r => r[0]), total: runs.reduce((sum, r) => sum + r[1], 0) }).toEqual({ colors: ['done', 'in_progress', 'planned'], total: MAXBAR })
  })
  // AC-20: F-25 at N = 12
  test('Twenty-five tickets fit a 12-cell bar in the docked pane (unit: the runs)', () => {
    const { tickets } = F25()
    const kids = tickets.filter(t => t.worker !== undefined).map(t => ck(t.worker!, 'failed', 0))
    const p = progressOf(tickets, kids)
    expect({ runs: runsOf(p?.tickets.map((t: { color: Color }) => t.color), MAXBAR), count: `${p?.done}/${p?.total}` }).toEqual({ runs: [['done', 4], ['in_progress', 3], ['attention', 1], ['planned', 4]], count: '8/25' })
  })
  // AC-23: the bar shrinks one cell per column once the title is at its minimum
  test('A narrow title line shortens the title first and the bar only after the title is at its minimum (unit: bar width)', () => {
    const m = cellWidth(pg.titleMinOf(TIT))
    expect({ min: pg.titleMinOf(TIT), widths: [27, 26, 19, 18, 17, 13, 12, 11].map(w => pg.barWidthOf(w, 0, m, 3)) }).toEqual({ min: 'R…', widths: [12, 12, 12, 11, 10, 6, 5, 4] })
  })
  // AC-23: through the drawn title line
  test('A narrow title line shortens the title first and the bar only after the title is at its minimum (unit: drawn line)', () => {
    const scenes = []
    for (let width = 44; width >= 12; width--) scenes.push({ width, ...lineOf(THREE_T, { width }) })
    const atMin = (s: { title: string }) => cellWidth(s.title) === 2
    const firstCut = scenes.find(s => s.title !== TIT)
    const violations = [
      ...scenes.filter(s => s.cells > 0 && s.cells < MAXBAR && !atMin(s)).map(s => `bar ${s.cells} before the title is at its minimum at ${s.width}`),
      ...scenes.filter(s => s.title !== '' && cellWidth(s.title) < 2).map(s => `title under 2 cells at ${s.width}`),
      ...scenes.slice(1).filter((s, i) => { const p = scenes[i]!; return atMin(s) && atMin(p) && s.cells >= 5 && p.cells >= 5 && p.cells - s.cells !== p.width - s.width }).map(s => `bar not 1 cell per column at ${s.width}`),
    ]
    expect({ full: scenes[0]!.cells, whole: scenes[0]!.title, firstCut: firstCut ? { ellipsis: firstCut.title.endsWith('…'), cells: firstCut.cells } : null, violations })
      .toEqual({ full: MAXBAR, whole: TIT, firstCut: { ellipsis: true, cells: MAXBAR }, violations: [] })
  })
  // AC-25 / NH-16: N = 5 draws a 5-cell bar, N = 4 draws none
  test('A title line with fewer than 5 bar cells shows the count only (unit: the 5-cell boundary)', () => {
    const k = cellWidth('1/3')
    expect({ five: pg.barWidthOf(5 + 2 + 2 + k, 0, 2, k), four: pg.barWidthOf(4 + 2 + 2 + k, 0, 2, k) }).toEqual({ five: 5, four: 4 })
  })
  // AC-25 / NH-16: through the drawn title line, with an epic chip so the chip can drop
  test('A title line with fewer than 5 bar cells shows the count only (unit: drawn line, chip then title dropped)', () => {
    const scenes = []
    for (let width = 44; width >= 6; width--) scenes.push({ width, ...lineOf(THREE_T, { width, epic: 'AID-300', title: 'Orchestrate the release train with many parts' }) })
    const hasChip = (s: { text: string }) => s.text.includes('◆AID-300')
    const violations = [
      ...scenes.filter(s => s.count && s.cells > 0 && s.cells < 5).map(s => `a ${s.cells}-cell bar at ${s.width}`),
      ...scenes.filter(s => s.count && s.cells === 0 && s.title !== '' && cellWidth(s.title) > 2).map(s => `title above its minimum on a count-only line at ${s.width}`),
      ...scenes.filter(s => s.count && s.title === '' && hasChip(s)).map(s => `title dropped before the chip at ${s.width}`),
      ...scenes.filter(s => s.cells === 0 && s.count && !/1\/3\s*$/.test(s.text)).map(s => `count not at the line's end at ${s.width}`),
    ]
    expect({
      five: scenes.some(s => s.cells === 5), countOnly: scenes.some(s => s.cells === 0 && s.count), chipDropped: scenes.some(s => s.count && !hasChip(s) && s.title !== ''),
      titleDropped: scenes.some(s => s.count && s.title === ''), violations,
    }).toEqual({ five: true, countOnly: true, chipDropped: true, titleDropped: true, violations: [] })
  })
})

describe('unit rules: the group chip', () => {
  const chipOf = (ids: readonly string[], epic?: string) => pg.groupChipOf({ tickets: ids.map(id => ({ id, state: 'planned' })), ...(epic !== undefined ? { epic } : {}) })
  // AC-26
  test('A report that names an epic shows the epic chip (unit)', () => {
    expect(chipOf(['WS-1', 'APP-2'], 'AID-300')).toBe('◆AID-300')
  })
  // AC-27
  test('Tickets sharing one letters prefix show that prefix as the chip (unit)', () => {
    expect(chipOf(['AID-12', 'AID-40'])).toBe('AID')
  })
  // AC-27
  test('Tickets sharing one letters prefix show that prefix as the chip (unit: one ticket)', () => {
    expect(chipOf(['AID-1'])).toBe('AID')
  })
  // AC-27
  test('Tickets sharing one letters prefix show that prefix as the chip (unit: letter case differs, no chip)', () => {
    expect(chipOf(['aid-3', 'AID-4'])).toBe(null)
  })
  const none = (label: string, ids: string[]) =>
    // AC-28
    test(`Tickets without one shared prefix show no group chip (unit: ${label})`, () => {
      expect(chipOf(ids)).toBe(null)
    })
  none('two trackers', ['WS-1', 'APP-2'])
  none('a misshaped id', ['WS-1', 'WS-2a'])
  none('an id of digits', ['WS-1', '123'])
  none('underscores', ['WS_1', 'WS_2'])
})

// ================================================================ 2. When ticket progress appears
describe('2. when ticket progress appears', () => {
  // AC-10
  test('The orchestrator reports tickets and the own card shows ticket progress within 5 seconds', async ($, on) => {
    const r = await rig($, on)
    await r.report(THREE)
    await r.redraw()
    expect({ count: countIn(await r.title()), bar: await hasBar(r.ui) }).toEqual({ count: '1/3', bar: true })
  })
  // AC-10
  test('The orchestrator reports tickets and the own card shows ticket progress within 5 seconds (rows)', async ($, on) => {
    const r = await rig($, on)
    await r.report(THREE)
    await r.redraw()
    const rows = await drawnRows(r.ui)
    expect(['AB-1', 'CD-2', 'EF-3'].map(id => rows.filter(t => has(t, id)).length)).toEqual([1, 1, 1])
  })
  const withBranch = (): Sess[] => [own({ branch: 'WS-12-fix' })]
  const sixWorld = () => withPrefixes({ agents: SIX() })
  // AC-11
  test('A session with no report shows no ticket progress and its usual chip and child rows', async ($, on) => {
    const r = await rig($, on, { world: sixWorld(), sessions: withBranch() })
    const line = await r.title()
    expect({ bar: await hasBar(r.ui), count: countIn(line), chip: /WS-12/.test(line) }).toEqual({ bar: false, count: null, chip: true })
  })
  // AC-11
  test('A session with no report shows no ticket progress and its usual chip and child rows (child rows)', async ($, on) => {
    const r = await rig($, on, { world: sixWorld(), sessions: withBranch() })
    expect({ rows: (await drawnRows(r.ui)).map(spinnerless), more: await moreLine(r.ui) }).toEqual({ rows: BASE_ROWS, more: SIX_WORKER_MORE })
  })
  // AC-12
  test('The ticket list becomes empty and the own card returns to its usual chip and child rows within 5 seconds', async ($, on) => {
    const r = await rig($, on, { world: sixWorld(), sessions: withBranch() })
    await r.report(THREE)
    await r.redraw()
    const shown = countIn(await r.title())
    await r.report([])
    await r.redraw()
    const line = await r.title()
    expect({ shown, bar: await hasBar(r.ui), count: countIn(line), chip: /WS-12/.test(line), rows: (await drawnRows(r.ui)).map(spinnerless) })
      .toEqual({ shown: '1/3', bar: false, count: null, chip: true, rows: BASE_ROWS })
  })
  // AC-13
  test('Workers named after tickets never create ticket progress without a report', async ($, on) => {
    const agents = [H_AGENT('a1', 'running', 'fix WS-11', 0), H_AGENT('a2', 'running', 'WS-12 build', 1), H_AGENT('a3', 'running', 'port APP-3', 2), H_AGENT('a4', 'running', 'scan WS-14', 3)]
    const r = await rig($, on, { world: withPrefixes({ agents }) })
    expect({ bar: await hasBar(r.ui), count: countIn(await r.title()) }).toEqual({ bar: false, count: null })
  })
  // AC-13
  test('Workers named after tickets never create ticket progress without a report (four child rows as before)', async ($, on) => {
    const agents = [H_AGENT('a1', 'running', 'fix WS-11', 0), H_AGENT('a2', 'running', 'WS-12 build', 1), H_AGENT('a3', 'running', 'port APP-3', 2), H_AGENT('a4', 'running', 'scan WS-14', 3)]
    const r = await rig($, on, { world: withPrefixes({ agents }) })
    const rows = await drawnRows(r.ui)
    expect({ count: rows.length, names: ['fix WS-11', 'WS-12 build', 'port APP-3', 'scan WS-14'].map(n => rows.some(t => t.includes(n))) }).toEqual({ count: 4, names: [true, true, true, true] })
  })
  const progressShows = async (r: Rig) => {
    await r.report(THREE)
    await r.redraw()
    const rows = await drawnRows(r.ui)
    return { count: countIn(await r.title()), bar: await hasBar(r.ui), rows: ['AB-1', 'CD-2', 'EF-3'].every(id => rows.some(t => has(t, id))) }
  }
  // AC-14
  test('Ticket progress appears whatever the ticket prefixes setting holds (prefixes off)', async ($, on) => {
    expect(await progressShows(await rig($, on))).toEqual({ count: '1/3', bar: true, rows: true })
  })
  // AC-14
  test('Ticket progress appears whatever the ticket prefixes setting holds (prefixes set)', async ($, on) => {
    expect(await progressShows(await rig($, on, { world: withPrefixes() }))).toEqual({ count: '1/3', bar: true, rows: true })
  })
  // AC-14
  test('Ticket progress appears whatever the ticket prefixes setting holds (prefixes that match no id)', async ($, on) => {
    expect(await progressShows(await rig($, on, { world: mk({ store: new Map<string, unknown>([['setting:tickets', ['ZZ-']]]) }) }))).toEqual({ count: '1/3', bar: true, rows: true })
  })
})

// ================================================================ 3. Progress bar and count
describe('3. progress bar and count', () => {
  /** Mount with one report shown after a redraw. */
  const shown = async ($: any, on: On, tickets: readonly Tk[], o: { epic?: string; agents?: unknown[]; cols?: number; world?: World; sessions?: Sess[] } = {}) => {
    const r = await rig($, on, { world: o.world ?? mk({ agents: o.agents ?? [] }), cols: o.cols ?? 44, sessions: o.sessions ?? [own()] })
    await r.report(tickets, o.epic)
    await r.redraw()
    return r
  }
  // AC-15
  test('The own card\'s title line shows chip, title, bar and count in that order with status at the first line\'s end', async ($, on) => {
    const r = await shown($, on, [tk('AID-1', 'done'), tk('AID-2', 'planned')])
    expect(/^\s*AID\s+Release 42\s+[━╸]+ 1\/2\s*$/.test(await r.title())).toBe(true)
  })
  // AC-15
  test('The own card\'s title line shows chip, title, bar and count in that order with status at the first line\'s end (right edge)', async ($, on) => {
    const r = await shown($, on, [tk('AID-1', 'done'), tk('AID-2', 'planned')])
    const lines = await r.lines()
    expect({ shown: countIn(lines[1] ?? ''), sameWidth: cellWidth(lines[1] ?? '') === cellWidth(lines[0] ?? ''), endsWithCount: /1\/2$/.test(lines[1] ?? '') }).toEqual({ shown: '1/2', sameWidth: true, endsWithCount: true })
  })
  // AC-15
  test('The own card\'s title line shows chip, title, bar and count in that order with status at the first line\'s end (first line unchanged)', async ($, on) => {
    const r = await shown($, on, [tk('AID-1', 'done'), tk('AID-2', 'planned')])
    expect({ shown: countIn(await r.title()), first: (await r.lines())[0] }).toEqual({ shown: '1/2', first: IDLE_STATUS_LINE })
  })
  // AC-16
  test('The count shows done tickets over all tickets, planned included', async ($, on) => {
    const r = await shown($, on, [tk('A1-1', 'done'), tk('B2-2', 'planned'), tk('C3-3', 'in progress'), tk('D4-4', 'done'), tk('E5-5', 'planned')])
    expect(countIn(await r.title())).toBe('2/5')
  })
  // AC-16
  test('The count shows done tickets over all tickets, planned included (all planned)', async ($, on) => {
    const r = await shown($, on, [tk('A1-1', 'planned'), tk('B2-2', 'planned'), tk('C3-3', 'planned'), tk('D4-4', 'planned')])
    expect(countIn(await r.title())).toBe('0/4')
  })
  const FIVE = [tk('A1-1', 'done'), tk('B2-2', 'planned'), tk('C3-3', 'in progress'), tk('D4-4', 'done'), tk('E5-5', 'planned')]
  // AC-17
  test('Each ticket gets its own bar segment when tickets fit', async ($, on) => {
    expect(glyphs(await titleCells((await shown($, on, FIVE)).ui))).toBe('━━╸━━╸━╸━╸━╸')
  })
  // AC-17
  test('Each ticket gets its own bar segment when tickets fit (one ticket fills the bar)', async ($, on) => {
    expect(glyphs(await titleCells((await shown($, on, [tk('A1-1', 'planned')])).ui))).toBe('━'.repeat(MAXBAR - 1) + '╸')
  })
  // AC-17
  test('Each ticket gets its own bar segment when tickets fit (as many tickets as cells)', async ($, on) => {
    const twelve = Array.from({ length: MAXBAR }, (_, i) => tk(uid(i), 'planned'))
    expect(glyphs(await titleCells((await shown($, on, twelve)).ui))).toBe('╸'.repeat(MAXBAR))
  })
  // AC-17
  test('Each ticket gets its own bar segment when tickets fit (segment colors follow the report order)', async ($, on) => {
    const cells = await titleCells((await shown($, on, FIVE)).ui)
    expect(hues(cells)).toEqual([...rep('green', 3), ...rep('gray', 3), ...rep('blue', 2), ...rep('green', 2), ...rep('gray', 2)])
  })
  // AC-18
  test('Each bar segment takes its ticket\'s color', async ($, on) => {
    const agents = [H_AGENT('w-d', 'failed', 'fix D4-4 alpha', 0)]
    const r = await shown($, on, [tk('A1-1', 'done'), tk('B2-2', 'in progress'), tk('C3-3', 'planned'), tk('D4-4', 'in progress', F_workerRef({ id: 'w-d' }))], { agents })
    expect(hues(await titleCells(r.ui))).toEqual([...rep('green', 3), ...rep('blue', 3), ...rep('gray', 3), ...rep('red', 3)])
  })
  // AC-18
  test('Each bar segment takes its ticket\'s color (a done ticket with a Failed worker is green)', async ($, on) => {
    const agents = [H_AGENT('w-a', 'failed', 'fix A1-1 alpha', 0)]
    const r = await shown($, on, [tk('A1-1', 'done', F_workerRef({ id: 'w-a' }))], { agents })
    expect(hues(await titleCells(r.ui))).toEqual(rep('green', MAXBAR))
  })
  const crowded = async ($: any, on: On, counts: Parameters<typeof kindsOf>[0]) => {
    const { tickets, agents } = many(kindsOf(counts))
    const r = await shown($, on, tickets, { agents })
    return { r, cells: await titleCells(r.ui) }
  }
  const runHues = (list: Array<[Hue, number]>) => list.flatMap(([h, n]) => rep(h, n))
  /** U-layer deviation: the pure bar rules have no locked names yet, so a case that needs N cells finds the pane width that gives exactly N (sweeping one cell at a time, widest first). Null when no width gives N. */
  const atCells = async ($: any, on: On, n: number, tickets: readonly Tk[], agents: unknown[]) => {
    for (let cols = 44; cols >= 8; cols--) {
      const r = await shown($, on, tickets, { agents, cols, sessions: [own({ title: LONG })] })
      const cells = await titleCells(r.ui)
      if (cells.length === n) return { cols, r, cells }
      if (cells.length === 0 && cols === 44) return null
      if (cells.length > 0 && cells.length < n) return null
    }
    return null
  }
  // AC-19: N = 10, T = 12, three of each color: 2.5 cells each, the two leftover cells go to the earlier colors
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned', async ($, on) => {
    const { tickets, agents } = many(kindsOf({ done: 3, ip: 3, attn: 3, planned: 3 }))
    const at = await atCells($, on, 10, tickets, agents)
    expect({ found: at !== null, runs: at ? hues(at.cells) : null }).toEqual({ found: true, runs: runHues([['green', 3], ['blue', 3], ['red', 2], ['gray', 2]]) })
  })
  // AC-19: N = 5, T = 100
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned (five cells for a hundred tickets)', async ($, on) => {
    const { tickets, agents } = many(kindsOf({ done: 48, ip: 48, attn: 2, planned: 2 }))
    const at = await atCells($, on, 5, tickets, agents)
    expect({ found: at !== null, runs: at ? hues(at.cells) : null }).toEqual({ found: true, runs: runHues([['green', 1], ['blue', 2], ['red', 1], ['gray', 1]]) })
  })
  // AC-19: 4 colors tie on fractions at N = 12; the earlier color takes the leftover cell
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned (twelve cells, four colors tie)', async ($, on) => {
    const { cells } = await crowded($, on, { done: 4, ip: 4, attn: 1, planned: 4 })
    expect(hues(cells)).toEqual(runHues([['green', 4], ['blue', 4], ['red', 1], ['gray', 3]]))
  })
  // AC-19
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned (a color with one ticket keeps a cell)', async ($, on) => {
    const { cells } = await crowded($, on, { done: 39, planned: 1 })
    expect(hues(cells)).toEqual(runHues([['green', 11], ['gray', 1]]))
  })
  // AC-19
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned (two colors take a cell from the longest)', async ($, on) => {
    const { cells } = await crowded($, on, { done: 48, ip: 48, attn: 2, planned: 2 })
    expect(hues(cells)).toEqual(runHues([['green', 5], ['blue', 5], ['red', 1], ['gray', 1]]))
  })
  // AC-19
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned (no run for an absent color)', async ($, on) => {
    const { cells } = await crowded($, on, { done: 6, ip: 4, planned: 3 })
    expect(hues(cells)).toEqual(runHues([['green', 5], ['blue', 4], ['gray', 3]]))
  })
  // AC-19
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned (each run ends in an end mark)', async ($, on) => {
    const { cells } = await crowded($, on, { done: 39, planned: 1 })
    expect(glyphs(cells)).toBe('━'.repeat(10) + '╸╸')
  })
  // AC-19
  test('Crowded tickets show one run per color ordered done, in progress, attention, planned (the count stays exact)', async ($, on) => {
    const { r } = await crowded($, on, { done: 39, planned: 1 })
    expect(countIn(await r.title())).toBe('39/40')
  })
  // AC-20
  test('Twenty-five tickets fit a 12-cell bar in the docked pane', async ($, on) => {
    const { tickets, agents } = F25()
    const r = await shown($, on, tickets, { agents, sessions: [own({ title: 'Twenty char title ok' })] })
    expect(hues(await titleCells(r.ui))).toEqual(runHues([['green', 4], ['blue', 3], ['red', 1], ['gray', 4]]))
  })
  // AC-20
  test('Twenty-five tickets fit a 12-cell bar in the docked pane (count)', async ($, on) => {
    const { tickets, agents } = F25()
    const r = await shown($, on, tickets, { agents, sessions: [own({ title: 'Twenty char title ok' })] })
    expect(countIn(await r.title())).toBe('8/25')
  })
  // AC-20
  test('Twenty-five tickets fit a 12-cell bar in the docked pane (no group chip, title whole)', async ($, on) => {
    const { tickets, agents } = F25()
    const r = await shown($, on, tickets, { agents, sessions: [own({ title: 'Twenty char title ok' })] })
    expect({ count: countIn(await r.title()), starts: /^\s*Twenty char title ok/.test(await r.title()) }).toEqual({ count: '8/25', starts: true })
  })
  // AC-20 O: the live capture of the same state is the Owner's (validation plan, Visual Checks).
  // AC-21
  test('A ticket entering or leaving attention changes its bar color within 5 seconds', async ($, on) => {
    const world = mk({ agents: [H_AGENT('w-a', 'running', 'scan AB-1', 0), H_AGENT('w-c', 'running', 'scan CD-2', 1), H_AGENT('w-e', 'running', 'scan EF-3', 2)] })
    const r = await rig($, on, { world })
    const list = [tk('AB-1', 'in progress', 'w-a'), tk('CD-2', 'in progress', 'w-c'), tk('EF-3', 'in progress', 'w-e')]
    await r.report(list)
    await r.redraw()
    world.agents = [H_AGENT('w-a', 'running', 'scan AB-1', 0), H_AGENT('w-c', 'failed', 'scan CD-2', 1), H_AGENT('w-e', 'running', 'scan EF-3', 2)]
    await r.redraw()
    expect(hues(await titleCells(r.ui))).toEqual(runHues([['blue', 4], ['red', 4], ['blue', 4]]))
  })
  // AC-21
  test('A ticket entering or leaving attention changes its bar color within 5 seconds (leaving: re-reported with a new running worker)', async ($, on) => {
    const world = mk({ agents: [H_AGENT('w-a', 'running', 'scan AB-1', 0), H_AGENT('w-c', 'failed', 'scan CD-2', 1), H_AGENT('w-e', 'running', 'scan EF-3', 2)] })
    const r = await rig($, on, { world })
    await r.report([tk('AB-1', 'in progress', 'w-a'), tk('CD-2', 'in progress', 'w-c'), tk('EF-3', 'in progress', 'w-e')])
    await r.redraw()
    const before = hues(await titleCells(r.ui))
    world.agents = [...(world.agents as unknown[]), H_AGENT('w-n', 'running', 'retry CD-2', 3)]
    await r.report([tk('AB-1', 'in progress', 'w-a'), tk('CD-2', 'in progress', 'w-n'), tk('EF-3', 'in progress', 'w-e')])
    await r.redraw()
    expect({ before, after: hues(await titleCells(r.ui)) }).toEqual({ before: runHues([['blue', 4], ['red', 4], ['blue', 4]]), after: rep('blue', MAXBAR) })
  })
  // AC-22
  test('The count is never shortened or hidden while progress shows', async ($, on) => {
    const tickets = Array.from({ length: 12 }, (_, i) => tk(uid(i), i < 2 ? 'done' : 'planned'))
    const seen: Record<number, string | null> = {}
    for (const cols of [44, 36, 30, 24, 20, 16, 12]) {
      const r = await shown($, on, tickets, { cols, sessions: [own({ title: 'A very long own title of sixty characters, written out in full ok' })] })
      seen[cols] = countIn(await r.title())
    }
    expect(seen).toEqual({ 44: '2/12', 36: '2/12', 30: '2/12', 24: '2/12', 20: '2/12', 16: '2/12', 12: '2/12' })
  })
  const LONG = 'Orchestrate the release train with many parts'
  type Scene = { cols: number; cells: number; title: string }
  const sweepScene = async ($: any, on: On, cols: number, tickets: readonly Tk[], epic?: string, title = LONG): Promise<Scene> => {
    const r = await shown($, on, tickets, { cols, epic, sessions: [own({ title })] })
    return { cols, cells: (await titleCells(r.ui)).length, title: await titleOfLine(r.ui) }
  }
  // AC-23: every width from the one where title + 12-cell bar + count fit, down by one cell
  test('A narrow title line shortens the title first and the bar only after the title is at its minimum', async ($, on) => {
    const tickets = [tk('AB-1', 'done'), tk('CD-2', 'planned'), tk('EF-3', 'planned')]
    const scenes: Scene[] = []
    for (let cols = 44; cols >= 12; cols--) scenes.push(await sweepScene($, on, cols, tickets, undefined, TIT))
    const atMin = (s: Scene) => cellWidth(s.title) === 2
    const firstCut = scenes.find(s => s.title !== TIT)
    const violations = [
      ...scenes.filter(s => s.cells > 0 && s.cells < MAXBAR && !atMin(s)).map(s => `bar ${s.cells} before the title is at its minimum at ${s.cols}`),
      ...scenes.filter(s => s.title !== '' && cellWidth(s.title) < 2).map(s => `title under 2 cells at ${s.cols}`),
      ...scenes.slice(1).filter((s, i) => { const p = scenes[i]!; return atMin(s) && atMin(p) && s.cells >= 5 && p.cells >= 5 && p.cells - s.cells !== p.cols - s.cols }).map(s => `bar not 1 cell per column at ${s.cols}`),
    ]
    expect({
      full: scenes[0]!.cells, wholeTitle: scenes[0]!.title, firstCut: firstCut ? { ellipsis: firstCut.title.endsWith('…'), cells: firstCut.cells } : null,
      shrinks: scenes.some(s => s.cells >= 5 && s.cells < MAXBAR), violations,
    }).toEqual({ full: MAXBAR, wholeTitle: TIT, firstCut: { ellipsis: true, cells: MAXBAR }, shrinks: true, violations: [] })
  })
  const ONE_LINE = (x: Omit<Sess, 'name'> = {}): Sess[] => [S('own', { status: 'busy', sinceMs: 5 * MIN, cwd: '/p/Zproj-long-project-name', title: 'Qtitle words for the sweep', ...x })]
  const oneLineWorld = (w: World = {}) => mk({ ...w, store: new Map<string, unknown>([['setting:workingShelf', true]]) })
  const FOUR = [tk('A1-1', 'done'), tk('B2-2', 'planned'), tk('C3-3', 'planned'), tk('D4-4', 'in progress')]
  const oneLine = async ($: any, on: On, cols: number, tickets: readonly Tk[] = FOUR, epic = 'EP-1') => {
    const r = await rig($, on, { world: oneLineWorld(), sessions: ONE_LINE(), cols })
    await r.report(tickets, epic)
    await r.redraw()
    return { r, text: await ownRowText(r.ui), cells: await ownRowCells(r.ui) }
  }
  // AC-24
  test('A one-line own card shows the count without bar or chip', async ($, on) => {
    const { text, cells } = await oneLine($, on, 44)
    // At 44 columns the 23-cell project leaves the title at its minimum (AC-24 shrinks the title first), so the anchors are first letters searched in order.
    const at: number[] = []
    for (const w of ['Z', 'Q', '1/4', 'Working']) at.push(text.indexOf(w, at.length > 0 ? at[at.length - 1]! + 1 : 0))
    expect({ ordered: at.every(x => x >= 0), bar: cells.length, chip: text.includes('◆') }).toEqual({ ordered: true, bar: 0, chip: false })
  })
  // AC-24
  test('A one-line own card shows the count without bar or chip (narrowing: title, then project, then title dropped; count and status kept)', async ($, on) => {
    const states: Array<{ cols: number; project: 'full' | 'cut' | 'none'; title: 'full' | 'cut' | 'min' | 'none'; count: boolean; status: boolean }> = []
    for (const cols of [44, 40, 36, 32, 28, 26, 24, 22, 20]) {
      const { text } = await oneLine($, on, cols)
      states.push({
        cols, project: text.includes('Zproj-long-project-name') ? 'full' : text.includes('Z') ? 'cut' : 'none',
        title: text.includes('Qtitle words for the sweep') ? 'full' : text.includes('Q…') ? 'min' : text.includes('Q') ? 'cut' : 'none',
        count: text.includes('1/4'), status: text.includes('Working'),
      })
    }
    const violations = [
      ...states.filter(s => !s.count || !s.status).map(s => `count or status cut at ${s.cols}`),
      ...states.filter(s => s.project !== 'full' && (s.title === 'full' || s.title === 'cut')).map(s => `project cut before the title is at its minimum at ${s.cols}`),
      ...states.filter(s => s.title === 'none' && s.project !== 'none').map(s => `title dropped before the project at ${s.cols}`),
    ]
    expect({ countAt44: states[0]!.count, violations }).toEqual({ countAt44: true, violations: [] })
  })
  // AC-25
  test('A title line with fewer than 5 bar cells shows the count only', async ($, on) => {
    const tickets = [tk('AB-1', 'done'), tk('CD-2', 'planned'), tk('EF-3', 'planned')]
    const scenes: Array<Scene & { chip: boolean; count: boolean; text: string }> = []
    // Down to 6 columns: the title is dropped only once the line cannot hold the title minimum, one space and the count (6 cells).
    for (let cols = 44; cols >= 6; cols--) {
      const r = await shown($, on, tickets, { cols, epic: 'AID-300', sessions: [own({ title: LONG })] })
      const text = await r.title()
      scenes.push({ cols, cells: (await titleCells(r.ui)).length, title: await titleOfLine(r.ui), chip: text.includes('◆AID-300'), count: countIn(text) === '1/3', text })
    }
    const violations = [
      ...scenes.filter(s => s.count && s.cells > 0 && s.cells < 5).map(s => `a ${s.cells}-cell bar at ${s.cols}`),
      ...scenes.filter(s => s.count && s.cells === 0 && s.title !== '' && cellWidth(s.title) > 2).map(s => `title above its minimum on a count-only line at ${s.cols}`),
      ...scenes.filter(s => s.count && s.title === '' && s.chip).map(s => `title dropped before the chip at ${s.cols}`),
      ...scenes.filter(s => s.cells === 0 && s.count && !/1\/3\s*$/.test(s.text)).map(s => `count not at the line's end at ${s.cols}`),
    ]
    expect({
      countOnly: scenes.some(s => s.cells === 0 && s.count), chipDropped: scenes.some(s => s.count && !s.chip && s.title !== ''),
      titleDropped: scenes.some(s => s.count && s.title === ''), violations,
    }).toEqual({ countOnly: true, chipDropped: true, titleDropped: true, violations: [] })
  })
  /** The widest width at which the bar has exactly 5 cells (sweeping one cell at a time); null when no width gives 5. */
  const fiveCellWidth = async ($: any, on: On, tickets: readonly Tk[]) => {
    for (let cols = 44; cols >= 8; cols--) {
      const n = (await titleCells((await shown($, on, tickets, { cols, epic: 'AID-300', sessions: [own({ title: LONG })] })).ui)).length
      if (n === 5) return cols
      if ((n > 0 && n < 5) || (cols === 44 && n === 0)) return null
    }
    return null
  }
  const THREE_25 = [tk('AB-1', 'done'), tk('CD-2', 'planned'), tk('EF-3', 'planned')]
  // AC-25 / NH-16: the boundary N = 5
  test('A title line with fewer than 5 bar cells shows the count only (a width gives exactly a 5-cell bar)', async ($, on) => {
    expect({ widthWithFiveCells: (await fiveCellWidth($, on, THREE_25)) !== null }).toEqual({ widthWithFiveCells: true })
  })
  // AC-25 / NH-16
  test('A title line with fewer than 5 bar cells shows the count only (one cell narrower than the 5-cell width draws no bar)', async ($, on) => {
    const cols = await fiveCellWidth($, on, THREE_25)
    const r = cols === null ? null : await shown($, on, THREE_25, { cols: cols - 1, epic: 'AID-300', sessions: [own({ title: LONG })] })
    expect({ found: cols !== null, bar: r === null ? null : await hasBar(r.ui), count: r === null ? null : countIn(await r.title()) }).toEqual({ found: true, bar: false, count: '1/3' })
  })
})

// ================================================================ 4. Group chip
describe('4. group chip', () => {
  const titleWith = async ($: any, on: On, tickets: readonly Tk[], o: { epic?: string; world?: World; sessions?: Sess[] } = {}) => {
    const r = await rig($, on, { world: o.world, sessions: o.sessions })
    await r.report(tickets, o.epic)
    await r.redraw()
    return r.title()
  }
  // AC-26
  test('A report that names an epic shows the epic chip', async ($, on) => {
    expect(/^\s*◆AID-300\b/.test(await titleWith($, on, [tk('WS-1', 'done'), tk('APP-2', 'planned')], { epic: 'AID-300' }))).toBe(true)
  })
  // AC-27
  test('Tickets sharing one letters prefix show that prefix as the chip', async ($, on) => {
    expect(/^\s*AID\s+Release 42/.test(await titleWith($, on, [tk('AID-12', 'done'), tk('AID-40', 'planned')]))).toBe(true)
  })
  // AC-27
  test('Tickets sharing one letters prefix show that prefix as the chip (one ticket)', async ($, on) => {
    expect(/^\s*AID\s+Release 42/.test(await titleWith($, on, [tk('AID-1', 'planned')]))).toBe(true)
  })
  // AC-27
  test('Tickets sharing one letters prefix show that prefix as the chip (letter case differs: no chip)', async ($, on) => {
    const line = await titleWith($, on, [tk('aid-3', 'planned'), tk('AID-4', 'planned')])
    expect({ count: countIn(line), noChip: /^\s*Release 42/.test(line) }).toEqual({ count: '0/2', noChip: true })
  })
  const noChip = (label: string, tickets: Tk[]) =>
    // AC-28
    test(`Tickets without one shared prefix show no group chip (${label})`, async ($, on) => {
      const line = await titleWith($, on, tickets)
      expect({ count: countIn(line) !== null, noChip: /^\s*Release 42/.test(line) }).toEqual({ count: true, noChip: true })
    })
  noChip('two trackers', [tk('WS-1', 'planned'), tk('APP-2', 'planned')])
  noChip('a misshaped id', [tk('WS-1', 'planned'), tk('WS-2a', 'planned')])
  noChip('an id of digits', [tk('WS-1', 'planned'), tk('123', 'planned')])
  noChip('underscores', [tk('WS_1', 'planned'), tk('WS_2', 'planned')])
  const branched = (): Sess[] => [own({ branch: 'WS-12-fix' })]
  // AC-29
  test('While progress shows the own card never shows its branch chip', async ($, on) => {
    const line = await titleWith($, on, [tk('APP-1', 'planned'), tk('CD-2', 'planned')], { world: withPrefixes(), sessions: branched() })
    expect({ count: countIn(line) !== null, branchChip: /WS-12/.test(line) }).toEqual({ count: true, branchChip: false })
  })
  // AC-29
  test('While progress shows the own card never shows its branch chip (the group chip shows instead)', async ($, on) => {
    const line = await titleWith($, on, [tk('APP-1', 'planned'), tk('APP-2', 'planned')], { world: withPrefixes(), sessions: branched() })
    expect({ groupChip: /^\s*APP\b/.test(line), branchChip: /WS-12/.test(line) }).toEqual({ groupChip: true, branchChip: false })
  })
  // AC-30
  test('Cards without progress keep their branch chip as before', async ($, on) => {
    const r = await rig($, on, { world: withPrefixes(), sessions: [own(), S('other', { cwd: '/q', branch: 'WS-77-x', title: 'Other work' })] })
    await r.report(THREE)
    await r.redraw()
    expect({ ownShows: countIn(await r.title()) !== null, otherChip: /WS-77/.test(await r.title('other')) }).toEqual({ ownShows: true, otherChip: true })
  })
})

// ================================================================ 5. Ticket rows
describe('5. ticket rows', () => {
  const rowsWith = async ($: any, on: On, tickets: readonly Tk[], o: { agents?: unknown[]; cols?: number; world?: World } = {}) => {
    const r = await rig($, on, { world: o.world ?? mk({ agents: o.agents ?? [] }), cols: o.cols ?? 44 })
    await r.report(tickets)
    await r.redraw()
    return { r, rows: await rowInfo(r.ui) }
  }
  // AC-31
  test('Progress lists one row per ticket under the own card', async ($, on) => {
    const { rows } = await rowsWith($, on, [tk('AB-1', 'planned'), tk('CD-2', 'planned'), tk('EF-3', 'planned'), tk('GH-4', 'planned')])
    expect({ each: ['AB-1', 'CD-2', 'EF-3', 'GH-4'].map(id => rows.filter(r => has(r.text, id)).length), total: rows.length }).toEqual({ each: [1, 1, 1, 1], total: 4 })
  })
  const AGENTS32 = [
    H_AGENT('w-run', 'running', 'job alpha', 0, { statusSince: TUE_10 - 7 * MIN }), H_AGENT('w-bad', 'failed', 'job beta', 1),
    H_AGENT('w-ask', 'running', 'job gamma', 2), H_AGENT('w-top', 'failed', 'job delta', 3), F_rollup('w-sub', 'w-top', 'running', 'job sub', 4),
  ]
  const LIST32 = [tk('PLN-1', 'planned'), tk('RUN-2', 'in progress', 'w-run'), tk('DON-3', 'done'), tk('BAD-4', 'in progress', 'w-bad'), tk('ASK-5', 'in progress', 'w-ask'), tk('TOP-6', 'in progress', 'w-top')]
  const rows32 = async ($: any, on: On) => {
    const world = mk({ agents: AGENTS32 })
    const r = await rig($, on, { world })
    await askFor($, world, 'w-ask')
    await askFor($, world, 'w-sub')
    await r.report(LIST32)
    await r.redraw()
    return rowInfo(r.ui)
  }
  const word32 = (label: string, id: string, word: RegExp, extra: RegExp = /./) =>
    // AC-32
    test(`A ticket row shows id, colored dot, state word and its worker's age (${label})`, async ($, on) => {
      const row = rowOfId(await rows32($, on), id)
      expect({ found: row !== undefined, word: word.test(row?.text ?? ''), extra: extra.test(row?.text ?? '') }).toEqual({ found: true, word: true, extra: true })
    })
  word32('Planned', 'PLN-1', /Planned/)
  word32('In progress with the worker\'s age', 'RUN-2', /In progress/, /\b7m\b/)
  word32('Done', 'DON-3', /Done/)
  word32('Failed', 'BAD-4', /Failed/)
  word32('Needs you', 'ASK-5', /Needs you/)
  word32('Needs you when a rolled-up subagent asks and the worker failed', 'TOP-6', /Needs you/)
  // AC-32
  test('A ticket row shows id, colored dot, state word and its worker\'s age (dot colors)', async ($, on) => {
    const rows = await rows32($, on)
    const hue = (id: string) => rowOfId(rows, id)?.hue
    expect(['PLN-1', 'RUN-2', 'DON-3', 'BAD-4', 'ASK-5', 'TOP-6'].map(hue)).toEqual(['gray', 'blue', 'green', 'red', 'red', 'red'])
  })
  // AC-32 (R-12, L-10; spec Known Gap 2): a 24-character id with a 59-minute worker age, the widest row (In progress and a 3-cell age)
  const LONG24 = 'ABCDEFGHIJKLMNOPQRSTUVWX'
  const longRow = async ($: any, on: On, cols: number) => {
    const { rows } = await rowsWith($, on, [tk(LONG24, 'in progress', 'w-l')], { agents: [H_AGENT('w-l', 'running', 'scan long', 0, { statusSince: TUE_10 - 59 * MIN })], cols })
    const text = rows[0]?.text ?? ''
    return { text, id: /●\s+(\S+)/.exec(text)?.[1] ?? '', age: /\b59m\b/.test(text) }
  }
  // AC-32
  test('A ticket row shows id, colored dot, state word and its worker\'s age (a 24-character id draws as its first 19 characters and an ellipsis at 44 columns)', async ($, on) => {
    const { id, age } = await longRow($, on, 44)
    expect({ id, age }).toEqual({ id: LONG24.slice(0, 19) + '…', age: true })
  })
  // AC-32: down to a 28-column pane the id keeps at least 7 characters and an ellipsis, and the age drops before the id goes below that
  test('A ticket row shows id, colored dot, state word and its worker\'s age (the id keeps 7 characters and an ellipsis down to 28 columns; the age drops first)', async ($, on) => {
    const seen: Record<number, { id: string; age: boolean }> = {}
    for (const cols of [36, 30, 28]) {
      const { id, age } = await longRow($, on, cols)
      seen[cols] = { id, age }
    }
    expect(seen).toEqual({ 36: { id: LONG24.slice(0, 11) + '…', age: true }, 30: { id: LONG24.slice(0, 9) + '…', age: false }, 28: { id: LONG24.slice(0, 7) + '…', age: false } })
  })
  // AC-32: below that only the dot and the state word are asserted (the 17-cell floor is a 19-column pane)
  test('A ticket row shows id, colored dot, state word and its worker\'s age (the dot and the state word are whole at 22 and 19 columns)', async ($, on) => {
    const seen: Record<number, { dot: boolean; word: boolean }> = {}
    for (const cols of [22, 19]) {
      const { text } = await longRow($, on, cols)
      seen[cols] = { dot: text.includes('●'), word: text.includes('In progress') }
    }
    expect(seen).toEqual({ 22: { dot: true, word: true }, 19: { dot: true, word: true } })
  })
  // AC-32
  test('A ticket row shows id, colored dot, state word and its worker\'s age (no row is wider than the pane)', async ($, on) => {
    const wider: number[] = []
    for (const cols of [44, 36, 30, 28, 22, 19]) {
      const { text } = await longRow($, on, cols)
      if (!text.includes('ABCDEFG') || cellWidth(text) > cols - 2) wider.push(cols)
    }
    expect(wider).toEqual([])
  })
  const AGENTS33 = [H_AGENT('w-d', 'failed', 'job d', 0), H_AGENT('w-f', 'failed', 'job f', 1)]
  // AC-33: the plan's six tickets; the 5-row cap (AC-36) shows the first five, then "+1 more" for the sixth
  test('Ticket rows list attention first, then in progress, then the rest in report order', async ($, on) => {
    const { rows } = await rowsWith($, on, [tk('A1-1', 'done'), tk('B1-2', 'planned'), tk('C1-3', 'in progress'), tk('D1-4', 'in progress', 'w-d'), tk('E1-5', 'in progress'), tk('F1-6', 'in progress', 'w-f')], { agents: AGENTS33 })
    const order = ['D1-4', 'F1-6', 'C1-3', 'E1-5', 'A1-1'].map(id => rows.findIndex(r => has(r.text, id)))
    expect({ order, total: rows.length }).toEqual({ order: [0, 1, 2, 3, 4], total: 5 })
  })
  // AC-33
  test('Ticket rows list attention first, then in progress, then the rest in report order (the sixth ticket shows as +1 more)', async ($, on) => {
    const { r, rows } = await rowsWith($, on, [tk('A1-1', 'done'), tk('B1-2', 'planned'), tk('C1-3', 'in progress'), tk('D1-4', 'in progress', 'w-d'), tk('E1-5', 'in progress'), tk('F1-6', 'in progress', 'w-f')], { agents: AGENTS33 })
    expect({ hiddenPlanned: rows.some(x => has(x.text, 'B1-2')), more: await moreLine(r.ui) }).toEqual({ hiddenPlanned: false, more: '+1 more' })
  })
  // AC-33: with the planned ticket removed, the five rows end with A1-1 and no more line shows
  test('Ticket rows list attention first, then in progress, then the rest in report order (five tickets, no more line)', async ($, on) => {
    const { r, rows } = await rowsWith($, on, [tk('A1-1', 'done'), tk('C1-3', 'in progress'), tk('D1-4', 'in progress', 'w-d'), tk('E1-5', 'in progress'), tk('F1-6', 'in progress', 'w-f')], { agents: AGENTS33 })
    expect({ order: ['D1-4', 'F1-6', 'C1-3', 'E1-5', 'A1-1'].map(id => rows.findIndex(x => has(x.text, id))), more: await moreLine(r.ui) }).toEqual({ order: [0, 1, 2, 3, 4], more: null })
  })
  // AC-33
  test('Ticket rows list attention first, then in progress, then the rest in report order (the rest keep report order)', async ($, on) => {
    const agents = [H_AGENT('w-d', 'failed', 'job d', 0), H_AGENT('w-f', 'failed', 'job f', 1)]
    const { rows } = await rowsWith($, on, [tk('B1-2', 'planned'), tk('A1-1', 'done'), tk('C1-3', 'in progress'), tk('D1-4', 'in progress', 'w-d'), tk('F1-6', 'in progress', 'w-f')], { agents })
    expect(['D1-4', 'F1-6', 'C1-3', 'B1-2', 'A1-1'].map(id => rows.findIndex(r => has(r.text, id)))).toEqual([0, 1, 2, 3, 4])
  })
  // AC-34
  test('A ticket\'s worker and its rolled-up subagents get no child rows of their own', async ($, on) => {
    const agents = [H_AGENT('w-a', 'running', 'job alpha', 0), F_rollup('w-sub', 'w-a', 'running', 'job sub', 1)]
    const { rows } = await rowsWith($, on, [tk('AB-1', 'in progress', F_workerRef({ id: 'w-a' }))], { agents })
    expect({ rows: rows.length, ticket: rows.some(r => has(r.text, 'AB-1') && !/alpha|sub/.test(r.text)), workers: rows.some(r => /alpha|sub/.test(r.text)) }).toEqual({ rows: 1, ticket: true, workers: false })
  })
  // AC-35: the two unclaimed workers' rows are the frozen baseline rows for those workers
  test('Workers that belong to no ticket keep their child rows after the ticket rows', async ($, on) => {
    const agents = [H_AGENT('w-a', 'running', 'job alpha', 0), H_AGENT('w-c', 'running', 'job beta', 1), H_AGENT('s3', 'failed', 'trim fixtures', 2), H_AGENT('s5', 'running', 'tidy shelf', 4)]
    const { rows } = await rowsWith($, on, [tk('AB-1', 'in progress', 'w-a'), tk('CD-2', 'in progress', 'w-c')], { agents })
    const frozen = BASE_ROWS.filter(t => /trim fixtures|tidy shelf/.test(t))
    expect({ lead: rows.slice(0, 2).map(r => ['AB-1', 'CD-2'].some(id => has(r.text, id))), tail: rows.slice(2).map(r => spinnerless(r.text)) }).toEqual({ lead: [true, true], tail: frozen })
  })
  const unclaimed = [H_AGENT('u1', 'running', 'review docs', 10), H_AGENT('u2', 'running', 'lint pass', 11), H_AGENT('u3', 'running', 'trim fixtures', 12)]
  // AC-36
  test('Ticket rows and worker rows together show at most 5 rows then "+K more"', async ($, on) => {
    const { r, rows } = await rowsWith($, on, [tk('A1-1', 'planned'), tk('B2-2', 'planned'), tk('C3-3', 'planned'), tk('D4-4', 'planned')], { agents: unclaimed })
    expect({ rows: rows.length, more: await moreLine(r.ui) }).toEqual({ rows: 5, more: '+2 more' })
  })
  // AC-36
  test('Ticket rows and worker rows together show at most 5 rows then "+K more" (seven tickets)', async ($, on) => {
    const { r, rows } = await rowsWith($, on, Array.from({ length: 7 }, (_, i) => tk(uid(i), 'planned')))
    expect({ rows: rows.length, more: await moreLine(r.ui) }).toEqual({ rows: 5, more: '+2 more' })
  })
  // AC-36
  test('Ticket rows and worker rows together show at most 5 rows then "+K more" (five rows fit without a more line)', async ($, on) => {
    const { r, rows } = await rowsWith($, on, [tk('A1-1', 'planned'), tk('B2-2', 'planned'), tk('C3-3', 'planned')], { agents: unclaimed.slice(0, 2) })
    expect({ rows: rows.length, more: await moreLine(r.ui) }).toEqual({ rows: 5, more: null })
  })
  // AC-37
  test('Pressing a ticket row opens its listed worker\'s transcript', async ($, on) => {
    const world = mk({ agents: [H_AGENT('w-a', 'running', 'job alpha', 0)], views: [] })
    const r = await rig($, on, { world })
    await r.report([tk('AB-1', 'in progress', 'w-a'), tk('CD-2', 'planned'), tk('EF-3', 'in progress', 'w-gone')])
    await r.redraw()
    const found = (await r.ui.findAll({ type: 'Button' })).filter((b: any) => has(String(b.text ?? ''), 'AB-1'))
    if (found.length === 1) await r.ui.press({ key: found[0].key })
    expect({ buttons: found.length, opened: world.views }).toEqual({ buttons: 1, opened: [{ agentId: 'w-a' }] })
  })
  // AC-37 (R-14): a ticket with no worker, and one whose worker is not listed, draw no Button; a press on the row's text opens nothing.
  // The harness raises a press only for a Button, so the press itself may be refused: the outcome asserted is that no transcript is opened.
  test('Pressing a ticket row opens its listed worker\'s transcript (a row with no listed worker has no button and opens nothing)', async ($, on) => {
    const world = mk({ agents: [H_AGENT('w-a', 'running', 'job alpha', 0)], views: [] })
    const r = await rig($, on, { world })
    await r.report([tk('AB-1', 'in progress', 'w-a'), tk('CD-2', 'planned'), tk('EF-3', 'in progress', 'w-gone')])
    await r.redraw()
    const buttons = (await r.ui.findAll({ type: 'Button' })).map((b: any) => String(b.text ?? ''))
    const rowBoxes = (await r.ui.findAll({ type: 'Box' })).filter((b: any) => ROW_START.test(String(b.text ?? '')))
    for (const id of ['CD-2', 'EF-3']) {
      const box = rowBoxes.find((b: any) => has(String(b.text), id))
      let first: any
      walk(box, e => { if (first === undefined && e.type === 'Text') first = e })
      if (first !== undefined) { try { await r.ui.press(first.key !== undefined ? { key: first.key } : { type: 'Text', text: first.text }) } catch { /* a press the harness refuses opens nothing, which is the outcome asserted below */ } }
    }
    expect({ rowsDrawn: ['CD-2', 'EF-3'].map(id => rowBoxes.some((b: any) => has(String(b.text), id))), buttons: ['CD-2', 'EF-3'].map(id => buttons.filter(t => has(t, id)).length), opened: world.views })
      .toEqual({ rowsDrawn: [true, true], buttons: [0, 0], opened: [] })
  })
  // AC-38
  test('A ticket whose named worker is not listed shows its reported state without age or attention', async ($, on) => {
    const { rows } = await rowsWith($, on, [tk('AB-1', 'in progress', 'w-gone')])
    const row = rowOfId(rows, 'AB-1')
    expect({ state: /In progress/.test(row?.text ?? ''), noAge: row !== undefined && !/\b\d+[smhd]\b/.test(row.text), hue: row?.hue }).toEqual({ state: true, noAge: true, hue: 'blue' })
  })
  // AC-38
  test('A ticket whose named worker is not listed shows its reported state without age or attention (bar segment)', async ($, on) => {
    const { r } = await rowsWith($, on, [tk('AB-1', 'in progress', 'w-gone')])
    expect(hues(await titleCells(r.ui))).toEqual(rep('blue', MAXBAR))
  })
  // AC-39
  test('Ticket rows show without hovering over the card', async ($, on) => {
    const { r, rows } = await rowsWith($, on, THREE)
    const visible = await visibleRows(r.ui)
    expect({ drawn: rows.length, visible: ['AB-1', 'CD-2', 'EF-3'].map(id => visible.filter(t => has(t, id)).length) }).toEqual({ drawn: 3, visible: [1, 1, 1] })
  })
  // AC-40
  test('A one-line own card shows its ticket rows under it', async ($, on) => {
    const r = await rig($, on, { world: mk({ store: new Map<string, unknown>([['setting:workingShelf', true]]) }), sessions: [S('own', { status: 'busy', sinceMs: 5 * MIN, title: TIT })] })
    await r.report(THREE)
    await r.redraw()
    const rows = await drawnRows(r.ui)
    expect({ oneLine: (await r.lines()).length, rows: ['AB-1', 'CD-2', 'EF-3'].map(id => rows.filter(t => has(t, id)).length) }).toEqual({ oneLine: 1, rows: [1, 1, 1] })
  })
  // AC-41
  test('Without progress child rows list exactly as before', async ($, on) => {
    const r = await rig($, on, { world: mk({ agents: SIX() }) })
    expect({ rows: (await drawnRows(r.ui)).map(spinnerless), more: await moreLine(r.ui) }).toEqual({ rows: BASE_ROWS, more: SIX_WORKER_MORE })
  })
})

// ================================================================ 6. Keeping and clearing a report
describe('6. keeping and clearing a report', () => {
  const reported = async ($: any, on: On) => {
    const r = await rig($, on)
    await r.report(THREE)
    await r.redraw()
    return r
  }
  /** `/clear` (R-9): session end with reason `clear` and the old id, then the id becomes `own-2` with NO session start; the next redraw (5 s) is the first draw after it. */
  const cleared = async ($: any, on: On) => {
    const r = await rig($, on, { sessions: [own()] })
    await r.report(THREE)
    await r.redraw()
    const before = { count: countIn(await r.title()), rows: (await drawnRows(r.ui)).filter(t => THREE_IDS.some(id => has(t, id))).length }
    const after = await F_lifecycle(r, { end: 'clear', from: 'own', to: 'own-2', sessions: [S('own-2', { title: TIT })] })
    await after.redraw()
    return { before, after }
  }
  // AC-42
  test('Running /clear empties the ticket list and the card shows no progress', async ($, on) => {
    const { before, after } = await cleared($, on)
    expect({ before: before.count, count: countIn(await after.title('own-2')), bar: await hasBar(after.ui, 'own-2') }).toEqual({ before: '1/3', count: null, bar: false })
  })
  // AC-42
  test('Running /clear empties the ticket list and the card shows no progress (read-back)', async ($, on) => {
    const { after } = await cleared($, on)
    expect(emptyReadback((await after.readback()).text, THREE_IDS)).toEqual(EMPTY_OK)
  })
  // AC-42: the old list is not carried over to the card of the session that follows /clear
  test('Running /clear empties the ticket list and the card shows no progress (the old list is not on the next session\'s card)', async ($, on) => {
    const { before, after } = await cleared($, on)
    expect({ before, oldRows: (await drawnRows(after.ui)).filter(t => THREE_IDS.some(id => has(t, id))).length, count: countIn(await after.title('own-2')) })
      .toEqual({ before: { count: '1/3', rows: 3 }, oldRows: 0, count: null })
  })
  // AC-42 + OA-1 (R-10, closes validation Known Gap 7): the conversation from before /clear is resumed (a new process, session start with the old id): its list was deleted at /clear
  test('Running /clear empties the ticket list and the card shows no progress (resuming the conversation from before /clear shows none)', async ($, on) => {
    const { before, after } = await cleared($, on)
    const back = await remount(after, { selfName: 'own', sessions: [own()] })
    expect({ before: before.count, count: countIn(await back.title()), bar: await hasBar(back.ui), ...emptyReadback((await back.readback()).text, THREE_IDS) })
      .toEqual({ before: '1/3', count: null, bar: false, ...EMPTY_OK })
  })
  const resumed = async ($: any, on: On) => {
    const r = await reported($, on)
    return F_lifecycle(r, { end: 'prompt_input_exit' })
  }
  // AC-43
  test('A resumed session shows its ticket progress again without a new report', async ($, on) => {
    const back = await resumed($, on)
    expect({ count: countIn(await back.title()), bar: await hasBar(back.ui) }).toEqual({ count: '1/3', bar: true })
  })
  // AC-43
  test('A resumed session shows its ticket progress again without a new report (rows)', async ($, on) => {
    const rows = await drawnRows((await resumed($, on)).ui)
    expect(THREE_IDS.map(id => rows.filter(t => has(t, id)).length)).toEqual([1, 1, 1])
  })
  // AC-43 (R-16): an in-process /resume: session end with reason resume, the id switches to the resumed conversation's with no session start
  test('A resumed session shows its ticket progress again without a new report (in-process resume shows the resumed conversation\'s list, not the previous one\'s)', async ($, on) => {
    const sessions = [S('own-r', { title: TIT }), S('own', { title: TIT })]
    const r = await rig($, on, { world: mk({ selfName: 'own-r' }), sessions })
    await r.report([tk('XY-1', 'done'), tk('XY-2', 'planned')])
    const mine = await remount(r, { selfName: 'own', sessions })
    await mine.report(THREE)
    await mine.redraw()
    const before = countIn(await mine.title())
    const after = await F_lifecycle(mine, { end: 'resume', from: 'own', to: 'own-r', sessions: [S('own-r', { title: TIT })] })
    await after.redraw()
    const rows = await drawnRows(after.ui)
    expect({ before, count: countIn(await after.title('own-r')), previousRows: rows.filter(t => THREE_IDS.some(id => has(t, id))).length, resumedRows: rows.filter(t => has(t, 'XY-1') || has(t, 'XY-2')).length })
      .toEqual({ before: '1/3', count: '1/2', previousRows: 0, resumedRows: 2 })
  })
  // AC-44: the two sessions share the store; each is its own session id
  const twoSessions = async ($: any, on: On) => {
    const sessions = [S('sessA', { title: TIT }), S('sessB', { title: TIT })]
    const world = mk({ selfName: 'sessA' })
    const a = await rig($, on, { world, sessions })
    await a.report([tk('AA-1', 'done'), tk('AB-2', 'planned'), tk('AC-3', 'planned')])
    const b = await remount(a, { selfName: 'sessB' })
    await b.report([tk('BA-1', 'planned'), tk('BB-2', 'planned')])
    const bRead = (await b.readback()).text
    const backA = await remount(b, { selfName: 'sessA' })
    await backA.redraw()
    return { aRead: (await backA.readback()).text, bRead, aCount: countIn(await backA.title('sessA')), backA }
  }
  const A_IDS = ['AA-1', 'AB-2', 'AC-3']
  const B_IDS = ['BA-1', 'BB-2']
  // AC-44
  test('A report in one session never changes another session\'s list', async ($, on) => {
    const { aRead } = await twoSessions($, on)
    expect({ own: A_IDS.every(id => has(aRead, id)), other: B_IDS.some(id => has(aRead, id)) }).toEqual({ own: true, other: false })
  })
  // AC-44
  test('A report in one session never changes another session\'s list (the other session keeps its own two)', async ($, on) => {
    const { bRead } = await twoSessions($, on)
    expect({ own: B_IDS.every(id => has(bRead, id)), other: A_IDS.some(id => has(bRead, id)) }).toEqual({ own: true, other: false })
  })
  // AC-44
  test('A report in one session never changes another session\'s list (the first card shows its own count)', async ($, on) => {
    expect((await twoSessions($, on)).aCount).toBe('1/3')
  })
  // AC-44
  test('A report in one session never changes another session\'s list (a forked resume starts empty)', async ($, on) => {
    const { backA } = await twoSessions($, on)
    backA.sessions.push(S('sessC', { title: TIT }))
    const fork = await remount(backA, { selfName: 'sessC' })
    expect(emptyReadback((await fork.readback()).text, [...A_IDS, ...B_IDS])).toEqual(EMPTY_OK)
  })
  // AC-45
  test('After a Bridge reload the card shows the same ticket progress without a new report', async ($, on) => {
    const r = await reported($, on)
    const again = await remount(r)
    expect({ count: countIn(await again.title()), bar: await hasBar(again.ui) }).toEqual({ count: '1/3', bar: true })
  })
  // AC-45
  test('After a Bridge reload the card shows the same ticket progress without a new report (rows)', async ($, on) => {
    const again = await remount(await reported($, on))
    const rows = await drawnRows(again.ui)
    expect(THREE_IDS.map(id => rows.filter(t => has(t, id)).length)).toEqual([1, 1, 1])
  })
  const compacted = async ($: any, on: On, trigger: string) => {
    const r = await reported($, on)
    await $.session.compact({ trigger, messages: [{ role: 'user', text: 'keep going', toolUses: [] }] } as never)
    await r.redraw()
    return r
  }
  // AC-46
  test('Compacting the conversation keeps the ticket list (manual compact)', async ($, on) => {
    expect(countIn(await (await compacted($, on, 'manual')).title())).toBe('1/3')
  })
  // AC-46
  test('Compacting the conversation keeps the ticket list (automatic compact)', async ($, on) => {
    expect(countIn(await (await compacted($, on, 'auto')).title())).toBe('1/3')
  })
  // AC-46
  test('Compacting the conversation keeps the ticket list (read-back unchanged)', async ($, on) => {
    const r = await compacted($, on, 'manual')
    const back = (await r.readback()).text
    expect(THREE_IDS.every(id => has(back, id))).toBe(true)
  })
})

// ================================================================ 7. Waiting
describe('7. waiting', () => {
  const running = () => [kid('scan alpha', 'working', 0)]
  // AC-47
  test('An idle or done own card with a running worker shows Waiting in green (idle)', async ($, on) => {
    const r = await rig($, on, { world: mk({ agents: [H_AGENT('a1', 'running', 'scan alpha', 0)] }), sessions: [S('own', { status: 'idle' })] })
    expect((await r.lines())[0]).toMatch(/Waiting/)
  })
  // AC-47
  test('An idle or done own card with a running worker shows Waiting in green (done, unseen)', () => {
    expect(statusOf(view(running(), { finishedAt: NOW - MIN }))).toMatch(/Waiting/)
  })
  // AC-47
  test('An idle or done own card with a running worker shows Waiting in green (drawn color)', () => {
    const seg = ownOf(view(running())).lines[0]!.find(s => s.kind === 'text' && s.text.includes('Waiting'))
    expect(seg && seg.kind === 'text' ? hueOf(seg.color) : 'none').toBe('green')
  })
  const rawWaiting = (status: string) =>
    // AC-47
    test(`An idle or done own card with a running worker shows Waiting in green (a worker listed as ${status})`, async ($, on) => {
      const r = await rig($, on, { world: mk({ agents: [H_AGENT('a1', status, 'scan alpha', 0)] }), sessions: [S('own', { status: 'idle' })] })
      expect((await r.lines())[0]).toMatch(/Waiting/)
    })
  rawWaiting('running')
  rawWaiting('pending')
  rawWaiting('waiting')
  // AC-47
  test('An idle or done own card with a running worker shows Waiting in green (snoozed card shows its time left)', () => {
    const snoozed = statusOf(view(running(), { snoozedOpen: true, ownEntry: { snoozedUntil: NOW + 3 * HOUR, snoozedAt: NOW - HOUR } }))
    expect({ waiting: /Waiting/.test(snoozed), timeLeft: /\d+[hm]/.test(snoozed) }).toEqual({ waiting: false, timeLeft: true })
  })
  // AC-47
  test('An idle or done own card with a running worker shows Waiting in green (woken card shows Waiting)', () => {
    const entry = { snoozedUntil: NOW - 5 * MIN, snoozedAt: NOW - HOUR, wokeAt: NOW - 2 * MIN }
    const woken = statusOf(view(running(), { ownEntry: entry }))
    const control = statusOf(view([], { ownEntry: entry }))
    expect({ waiting: /Waiting/.test(woken), woke: /Woke/.test(woken), control: /Woke/.test(control) }).toEqual({ waiting: true, woke: false, control: true })
  })
  // AC-48
  test('Waiting shows with or without a report', async ($, on) => {
    const r = await rig($, on, { world: mk({ agents: [H_AGENT('a1', 'running', 'scan alpha', 0)] }), sessions: [S('own', { status: 'idle' })] })
    expect({ waiting: /Waiting/.test((await r.lines())[0] ?? ''), count: countIn(await r.title()) }).toEqual({ waiting: true, count: null })
  })
  // AC-48
  test('Waiting shows with or without a report (with a 2-ticket report)', async ($, on) => {
    const r = await rig($, on, { world: mk({ agents: [H_AGENT('a1', 'running', 'scan alpha', 0)] }), sessions: [S('own', { status: 'idle' })] })
    await r.report([tk('AB-1', 'in progress', 'a1'), tk('CD-2', 'planned')])
    await r.redraw()
    expect({ waiting: /Waiting/.test((await r.lines())[0] ?? ''), count: countIn(await r.title()) }).toEqual({ waiting: true, count: '0/2' })
  })
  // AC-49
  test('A worker that needs you shows Needs you, not Waiting', () => {
    const line = statusOf(view([kid('ask alpha', 'needs-you', 0), kid('scan beta', 'working', 1)], { own: { childNeedAt: NOW - MIN } }))
    expect({ needs: /Needs you/.test(line), waiting: /Waiting/.test(line) }).toEqual({ needs: true, waiting: false })
  })
  const keeps = (label: string, own: Partial<Session>, word: RegExp, expected: string) =>
    // AC-50
    test(`Waiting never replaces Working, Needs you, Failed, Background or Check? (${label})`, () => {
      expect(word.exec(statusOf(view(running(), { own })))?.[0]).toBe(expected)
    })
  const task = [{ id: 'b1', kind: 'Command' as const, label: 'npm test', firstSeenAt: NOW - 30 * MIN }]
  const ANY = /Working|Needs you|Failed|Background|Check\?|Waiting/
  keeps('Working', { raw: 'busy', statusSince: NOW - 5 * MIN }, ANY, 'Working')
  keeps('Needs you', { raw: 'waiting' }, ANY, 'Needs you')
  keeps('Failed', { raw: 'failed' }, ANY, 'Failed')
  keeps('Background', { background: task, isTurnOver: true, statusSince: NOW - 5 * MIN }, ANY, 'Background')
  keeps('Check?', { background: task, isTurnOver: true, statusSince: NOW - 30 * MIN }, ANY, 'Check?')
  // AC-51
  test('When the last running worker finishes the card leaves Waiting within 5 seconds', async ($, on) => {
    const world = mk({ agents: [H_AGENT('a1', 'running', 'scan alpha', 0), H_AGENT('a2', 'running', 'scan beta', 1)] })
    const r = await rig($, on, { world, sessions: [S('own', { status: 'idle' })] })
    world.agents = [H_AGENT('a1', 'completed', 'scan alpha', 0), H_AGENT('a2', 'running', 'scan beta', 1)]
    await r.redraw()
    expect(/Waiting/.test((await r.lines())[0] ?? '')).toBe(true)
  })
  // AC-51
  test('When the last running worker finishes the card leaves Waiting within 5 seconds (the last one finishes)', async ($, on) => {
    const sessions = [S('own', { status: 'busy' })]
    const world = mk({ agents: [H_AGENT('a1', 'running', 'scan alpha', 0), H_AGENT('a2', 'running', 'scan beta', 1)] })
    const r = await rig($, on, { world, sessions })
    sessions[0]!.status = 'completed'
    sessions[0]!.sinceMs = -1000
    world.agents = [H_AGENT('a1', 'completed', 'scan alpha', 0), H_AGENT('a2', 'running', 'scan beta', 1)]
    await r.redraw()
    const during = /Waiting/.test((await r.lines())[0] ?? '')
    world.agents = [H_AGENT('a1', 'completed', 'scan alpha', 0), H_AGENT('a2', 'completed', 'scan beta', 1)]
    await r.redraw()
    const after = (await r.lines())[0] ?? ''
    expect({ during, waiting: /Waiting/.test(after), done: /Done/.test(after) }).toEqual({ during: true, waiting: false, done: true })
  })
  // AC-52
  test('Waiting keeps the card on the shelf it would have with Done or Idle (idle)', () => {
    const card = ownOf(view(running(), { workingShelf: true }))
    expect({ shelf: card.shelf, lines: card.lines.length, waiting: /Waiting/.test(plain(card.lines[0]!)) }).toEqual({ shelf: 'active', lines: 3, waiting: true })
  })
  // AC-52
  test('Waiting keeps the card on the shelf it would have with Done or Idle (done, unseen)', () => {
    const without = ownOf(view([], { finishedAt: NOW - MIN, workingShelf: true }))
    const withWorker = ownOf(view(running(), { finishedAt: NOW - MIN, workingShelf: true }))
    expect({ shelf: withWorker.shelf, waiting: /Waiting/.test(plain(withWorker.lines[0]!)) }).toEqual({ shelf: without.shelf, waiting: true })
  })
  // AC-53
  test('Entering or leaving Waiting rings no sound', async ($, on) => {
    const played: unknown[] = []
    on('audio.play', ($p, e) => (played.push((e as { clip: unknown }).clip), { value: undefined }) as never)
    const sessions = [S('own', { status: 'idle' })]
    const world = mk({ agents: [], store: new Map<string, unknown>([['setting:sound', true]]) })
    const r = await rig($, on, { world, sessions })
    await r.clock.advance(35_000); await r.ui.advance(35_000)
    // Positive control: the same harness plays exactly one sound when the own card turns Needs you.
    sessions[0]!.status = 'waiting'
    sessions[0]!.sinceMs = -1000
    await r.redraw()
    const control = played.length
    sessions[0]!.status = 'idle'
    sessions[0]!.sinceMs = 0
    await r.redraw()
    world.agents = [H_AGENT('a1', 'running', 'scan alpha', 0)]
    await r.redraw()
    world.agents = [H_AGENT('a1', 'completed', 'scan alpha', 0)]
    await r.redraw()
    expect({ control, waitingChanges: played.length - control }).toEqual({ control: 1, waitingChanges: 0 })
  })
  // AC-54
  test('A session Claude Code reports as waiting for you shows Needs you (with a running worker)', () => {
    const line = statusOf(view(running(), { own: { raw: 'waiting' } }))
    expect({ needs: /Needs you/.test(line), waiting: /Waiting/.test(line) }).toEqual({ needs: true, waiting: false })
  })
  // AC-54
  test('A session Claude Code reports as waiting for you shows Needs you (without a worker)', () => {
    const line = statusOf(view([], { own: { raw: 'waiting' } }))
    expect({ needs: /Needs you/.test(line), waiting: /Waiting/.test(line) }).toEqual({ needs: true, waiting: false })
  })
})

// ================================================================ 8. Other sessions
describe('8. other sessions', () => {
  /** The other session reports (it is the main conversation of its own session), then this session's pane mounts. */
  const otherReported = async ($: any, on: On) => {
    const sessions = [S('own', { title: TIT }), S('other', { cwd: '/q', title: 'Other work' })]
    const world = mk({ selfName: 'other' })
    const theirs = await rig($, on, { world, sessions })
    await theirs.report([tk('AB-1', 'done'), tk('CD-2', 'planned'), tk('EF-3', 'planned')], 'EP-1')
    const stored = has((await theirs.readback()).text, 'AB-1')
    const mine = await remount(theirs, { selfName: 'own' })
    await mine.redraw()
    return { mine, stored }
  }
  // AC-55
  test('Other sessions\' cards never show ticket progress', async ($, on) => {
    const { mine, stored } = await otherReported($, on)
    const line = await mine.title('other')
    expect({ stored, bar: await hasBar(mine.ui, 'other'), count: countIn(line), chip: line.includes('◆'), rows: (await drawnRows(mine.ui)).filter(t => has(t, 'AB-1')).length })
      .toEqual({ stored: true, bar: false, count: null, chip: false, rows: 0 })
  })
  // AC-55
  test('Other sessions\' cards never show ticket progress (the own card shows none either)', async ($, on) => {
    const { mine, stored } = await otherReported($, on)
    expect({ stored, bar: await hasBar(mine.ui), count: countIn(await mine.title()) }).toEqual({ stored: true, bar: false, count: null })
  })
  // AC-56
  test('Other sessions\' cards never show Waiting because of workers', async ($, on) => {
    const sessions = [S('own'), S('other', { status: 'idle' }), S('third', { status: 'completed', cwd: '/q' })]
    const r = await rig($, on, { world: mk({ agents: [H_AGENT('a1', 'running', 'scan alpha', 0)], selfName: 'own' }), sessions })
    const waiting = async (name: string) => /Waiting/.test((await r.lines(name))[0] ?? '')
    expect([await waiting('own'), await waiting('other'), await waiting('third')]).toEqual([true, false, false])
  })
})

// ================================================================ 9. Published text and permissions
describe('9. published text and permissions', () => {
  const BANNED = /\b(?:bb|getbb|bb-sidebar|helm|jira)\b/i
  // AC-57 T: the tool's name, description and every answer; S: tests/ws138-published-text.test.ts
  test('The fixed text this feature adds names no other tool or tracker', async ($, on) => {
    const world = mk({ texts: [] })
    const r = await rig($, on, { world })
    const bad = (all: unknown, epic?: unknown) => F_call($, world, { all_tickets: all, ...(epic !== undefined ? { epic } : {}) })
    const answers = [
      (await r.report([tk('AB-1', 'done'), tk('CD-2', 'planned'), tk('EF-3', 'planned')])).text,
      (await r.report([tk('CD-2', 'planned')])).text,
      (await r.readback()).text,
      (await F_report($, world, [tk('GH-4', 'planned')], undefined, 'a1')).text,
      (await F_readback($, world, 'a1')).text,
      (await F_call($, world, { read_back: true, all_tickets: [] })).text,
      (await F_call($, world, { epic: 'EP-1' })).text,
      (await bad('QX-9')).text,
      (await bad(Array.from({ length: 201 }, (_, i) => wire(tk(uid(i), 'planned'))))).text,
      (await bad(['QX-9'])).text,
      (await bad([{ state: 'planned' }])).text,
      (await bad([{ id: '', state: 'planned' }])).text,
      (await bad([{ id: 'A'.repeat(23) + '-1', state: 'planned' }])).text,
      (await bad([wire(tk('AB-1', 'planned')), wire(tk('AB-1', 'done'))])).text,
      (await bad([{ id: 'QX-9' }])).text,
      (await bad([{ id: 'QX-9', state: 'blocked' }])).text,
      (await bad([{ id: 'QX-9', state: 'planned', worker: '   ' }])).text,
      (await bad([wire(tk('QX-9', 'planned'))], '   ')).text,
      (await bad([wire(tk('QX-9', 'planned'))], 'E'.repeat(25))).text,
      (await r.report([])).text,
      (await r.readback()).text,
    ]
    // TODO(translator): AC-57 the store-failure refusal (R-11) needs a store that throws inside the tool call; the harness has no way to make `$.store.set` fail, so that one answer is not scanned.
    const texts = [...world.tools!.flatMap(t => [t.name, t.description, JSON.stringify(t.inputSchema ?? {})]), ...answers, PANE_ARGS_HINT, ...(world.texts ?? [])]
    expect({ banned: texts.filter(t => BANNED.test(t)), described: world.tools!.length === 1, answered: answers.every(a => a !== '') }).toEqual({ banned: [], described: true, answered: true })
  })
  // AC-57: a ticket id such as HELM-1 is reported and drawn as given
  test('The fixed text this feature adds names no other tool or tracker (a reported ticket id HELM-1 is drawn as reported)', async ($, on) => {
    const r = await rig($, on)
    await r.report([tk('HELM-1', 'planned'), tk('HELM-2', 'done')])
    await r.redraw()
    const rows = await drawnRows(r.ui)
    expect({ rows: rows.filter(t => has(t, 'HELM-1')).length, chip: /^\s*HELM\b/.test(await r.title()) }).toEqual({ rows: 1, chip: true })
  })
  // AC-58: the README row is checked at the S layer (tests/ws138-published-text.test.ts); here the command's own messages
  test('The /bridge tickets help text describes only the branch chip', async ($, on) => {
    const world = mk({ texts: [] })
    await rig($, on, { world })
    const reply = await $.command.run({ command: 'bridge', args: 'tickets WS-' } as never)
    const text = `${PANE_ARGS_HINT}\n${JSON.stringify(reply)}\n${(world.texts ?? []).join('\n')}`
    expect({ mentionsBranchChipOnly: /Ticket prefixes: WS-/.test(text), progress: /progress|\bbar\b/i.test(text) }).toEqual({ mentionsBranchChipOnly: true, progress: false })
  })
  // AC-58: the hint and the reply name the branch chip
  test('The /bridge tickets help text describes only the branch chip (names the branch chip in the hint)', async ($, on) => {
    expect(/branch chip/i.test(PANE_ARGS_HINT)).toBe(true)
  })
  // AC-58
  test('The /bridge tickets help text describes only the branch chip (names the branch chip in the reply)', async ($, on) => {
    const world = mk({ texts: [] })
    await rig($, on, { world })
    const reply = await $.command.run({ command: 'bridge', args: 'tickets WS-' } as never)
    expect(/branch chip/i.test(`${JSON.stringify(reply)}\n${(world.texts ?? []).join('\n')}`)).toBe(true)
  })
  // AC-59
  test('Using the ticket tool asks for no permission and Waiting needs no other tool', async ($, on) => {
    const r = await rig($, on)
    const checked = await $.tool.check({ tool: toolOf(r.world), input: { all_tickets: [] } } as never)
    expect((checked as { decision?: string }).decision).toBe('allow')
  })
  // AC-59
  test('Using the ticket tool asks for no permission and Waiting needs no other tool (no other program is needed)', async ($, on) => {
    const world = mk({ agents: [H_AGENT('a1', 'running', 'scan alpha', 0)], refuseOtherPrograms: true })
    const r = await rig($, on, { world, sessions: [S('own', { status: 'idle', title: TIT })] })
    const a = (await r.report([tk('AB-1', 'in progress', 'a1'), tk('CD-2', 'planned')])).text
    await r.redraw()
    expect({ accepted: /accept/i.test(a), count: countIn(await r.title()), waiting: /Waiting/.test((await r.lines())[0] ?? '') }).toEqual({ accepted: true, count: '0/2', waiting: true })
  })
})

// ================================================================ Edge cases
describe('edge cases', () => {
  // Orchestrator never reports: AC-11 fixture with a running worker and an idle own card
  test('Edge: the orchestrator never reports; no progress shows and Waiting shows', async ($, on) => {
    const r = await rig($, on, { world: withPrefixes({ agents: [H_AGENT('a1', 'running', 'fix WS-11 alpha', 0), H_AGENT('a2', 'running', 'fix WS-12 beta', 1)] }), sessions: [S('own', { status: 'idle', title: TIT })] })
    expect({ count: countIn(await r.title()), bar: await hasBar(r.ui), waiting: /Waiting/.test((await r.lines())[0] ?? '') }).toEqual({ count: null, bar: false, waiting: true })
  })
  const shared = async ($: any, on: On, second: string) => {
    const world = mk({ agents: [H_AGENT('w-a', 'running', 'carry tickets', 0, { statusSince: TUE_10 - 4 * MIN })] })
    const r = await rig($, on, { world })
    await r.report([tk('AB-1', 'in progress', 'w-a'), tk('CD-2', 'in progress', 'w-a')])
    await r.redraw()
    if (second === 'failed') {
      world.agents = [H_AGENT('w-a', 'failed', 'carry tickets', 0, { statusSince: TUE_10 - 4 * MIN })]
      await r.redraw()
    }
    return rowInfo(r.ui)
  }
  // Edge: one worker named by two tickets
  test('Edge: one worker named by two tickets; both rows show its age', async ($, on) => {
    const rows = await shared($, on, 'running')
    expect(['AB-1', 'CD-2'].map(id => /\b4m\b/.test(rowOfId(rows, id)?.text ?? ''))).toEqual([true, true])
  })
  // Edge: one worker named by two tickets
  test('Edge: one worker named by two tickets; both turn Failed and red when it fails', async ($, on) => {
    const rows = await shared($, on, 'failed')
    expect(['AB-1', 'CD-2'].map(id => [/Failed/.test(rowOfId(rows, id)?.text ?? ''), rowOfId(rows, id)?.hue])).toEqual([[true, 'red'], [true, 'red']])
  })
  // Edge "named worker matches several listed workers": closed at the unit layer (R-1, 'unit rules: the ticket model').
  // TODO(translator): edge "no signal for a usage-limit stop" and edge "worker stopped by a usage limit" (R-6): plan Open Questions row 4 is open, so no usage-limit signal is locked; a failed worker already counts as attention (AC-18, AC-32).
  // Edge: a report names a forgotten worker (more than 20 finished)
  test('Edge: a report names a worker the pane has forgotten; the row shows its reported state without age and is not red', async ($, on) => {
    const agents = Array.from({ length: 21 }, (_, i) => H_AGENT(`w-${i}`, i === 0 ? 'failed' : 'completed', `old job ${i}`, i))
    const world = mk({ agents })
    const r = await rig($, on, { world })
    await r.report([tk('AB-1', 'in progress', 'w-0')])
    await r.redraw()
    const row = rowOfId(await rowInfo(r.ui), 'AB-1')
    expect({ state: /In progress/.test(row?.text ?? ''), noAge: row !== undefined && !/\b\d+[smhd]\b/.test(row.text), hue: row?.hue }).toEqual({ state: true, noAge: true, hue: 'blue' })
  })
  // Edge: worker fails, ticket reported done (NH-14 asserts the row)
  // Edge: worker stopped by the person
  test('NH-12 A worker the person stopped (killed) does not put its ticket in attention', async ($, on) => {
    const world = mk({ agents: [H_AGENT('w-a', 'killed', 'job alpha', 0)] })
    const r = await rig($, on, { world })
    await r.report([tk('AB-1', 'in progress', 'w-a')])
    await r.redraw()
    const row = rowOfId(await rowInfo(r.ui), 'AB-1')
    expect({ word: /In progress/.test(row?.text ?? ''), hue: row?.hue, bar: hues(await titleCells(r.ui)) }).toEqual({ word: true, hue: 'blue', bar: rep('blue', MAXBAR) })
  })
  // Edge: every ticket done and no worker running
  test('Edge: every ticket done and no worker running; bar all green, count total/total, status Done', async ($, on) => {
    const sessions = [S('own', { status: 'busy', title: TIT })]
    const r = await rig($, on, { sessions })
    await r.report([tk('AB-1', 'done'), tk('CD-2', 'done'), tk('EF-3', 'done')])
    sessions[0]!.status = 'completed'
    sessions[0]!.sinceMs = -1000
    await r.redraw()
    const first = (await r.lines())[0] ?? ''
    expect({ bar: hues(await titleCells(r.ui)), count: countIn(await r.title()), done: /Done/.test(first), waiting: /Waiting/.test(first) })
      .toEqual({ bar: rep('green', MAXBAR), count: '3/3', done: true, waiting: false })
  })
  // Edge: every ticket done; the list stays
  test('Edge: every ticket done and no worker running; the read-back still lists the three tickets', async ($, on) => {
    const r = await rig($, on)
    await r.report([tk('AB-1', 'done'), tk('CD-2', 'done'), tk('EF-3', 'done')])
    await r.redraw()
    const back = (await r.readback()).text
    expect(['AB-1', 'CD-2', 'EF-3'].every(id => has(back, id))).toBe(true)
  })
  // Edge: the worker list cannot be read on a redraw
  test('Edge: the worker list cannot be read on a redraw; Waiting stays and the ticket list is unchanged', async ($, on) => {
    const world = mk({ agents: [H_AGENT('w-a', 'running', 'job alpha', 0, { statusSince: TUE_10 - 7 * MIN })] })
    const r = await rig($, on, { world, sessions: [S('own', { status: 'idle', title: TIT })] })
    await r.report([tk('AB-1', 'in progress', 'w-a'), tk('CD-2', 'planned')])
    await r.redraw()
    world.agentsFail = true
    await r.redraw()
    expect({ waiting: /Waiting/.test((await r.lines())[0] ?? ''), count: countIn(await r.title()), red: hues(await titleCells(r.ui)).includes('red') }).toEqual({ waiting: true, count: '0/2', red: false })
  })
  // Edge: the worker list cannot be read on a redraw; age keeps counting
  test('Edge: the worker list cannot be read on a redraw; the age keeps counting', async ($, on) => {
    const world = mk({ agents: [H_AGENT('w-a', 'running', 'job alpha', 0, { statusSince: TUE_10 - 7 * MIN })] })
    const r = await rig($, on, { world })
    await r.report([tk('AB-1', 'in progress', 'w-a')])
    await r.redraw()
    world.agentsFail = true
    for (let i = 0; i < 12; i++) await r.redraw()
    expect(/\b8m\b/.test(rowOfId(await rowInfo(r.ui), 'AB-1')?.text ?? '')).toBe(true)
  })
  // Edge: two sessions report at once (interleaved)
  test('Edge: two sessions report at once; each read-back is its own last report', async ($, on) => {
    const sessions = [S('sessA', { title: TIT }), S('sessB', { title: TIT })]
    const a = await rig($, on, { world: mk({ selfName: 'sessA' }), sessions })
    await a.report([tk('AA-1', 'planned')])
    const b = await remount(a, { selfName: 'sessB' })
    await b.report([tk('BA-1', 'planned')])
    const a2 = await remount(b, { selfName: 'sessA' })
    await a2.report([tk('AA-2', 'planned')])
    const b2 = await remount(a2, { selfName: 'sessB' })
    await b2.report([tk('BA-2', 'planned')])
    const bRead = (await b2.readback()).text
    const aRead = (await (await remount(b2, { selfName: 'sessA' })).readback()).text
    expect({ a: [has(aRead, 'AA-2'), has(aRead, 'AA-1'), has(aRead, 'BA-2')], b: [has(bRead, 'BA-2'), has(bRead, 'BA-1'), has(bRead, 'AA-2')] })
      .toEqual({ a: [true, false, false], b: [true, false, false] })
  })
  // Edge: two reports in one turn
  test('Edge: two reports in one turn are both accepted and the last one stands', async ($, on) => {
    const r = await rig($, on)
    const first = await r.report([tk('AB-1', 'planned')])
    const second = await r.report([tk('CD-2', 'planned'), tk('EF-3', 'planned')])
    const back = (await r.readback()).text
    expect({ both: [/accept/i.test(first.text), /accept/i.test(second.text)], last: [has(back, 'CD-2'), has(back, 'EF-3'), has(back, 'AB-1')] }).toEqual({ both: [true, true], last: [true, true, false] })
  })
  // R-17: two reports started without awaiting the first (the calls are serialized, L-4)
  test('Edge: two reports started together; the second reads the list the first wrote', async ($, on) => {
    const r = await rig($, on)
    const [first, second] = await Promise.all([r.report([tk('AB-1', 'planned'), tk('CD-2', 'planned')]), r.report([tk('CD-2', 'planned')])])
    const back = (await r.readback()).text
    expect({ first: first.text.split('\n')[0], removed: partsOf(second.text).open, back: [has(back, 'CD-2'), has(back, 'AB-1')] }).toEqual({ first: 'Accepted: 2 tickets.', removed: ['AB-1'], back: [true, false] })
  })
  // Standard category Empty: a report with an empty worker list
  test('Edge: a report with an empty worker list shows reported states without age and no Waiting', async ($, on) => {
    const r = await rig($, on, { sessions: [S('own', { status: 'idle', title: TIT })] })
    await r.report([tk('AB-1', 'in progress', 'w-gone'), tk('CD-2', 'done')])
    await r.redraw()
    const rows = await rowInfo(r.ui)
    expect({ words: [/In progress/.test(rowOfId(rows, 'AB-1')?.text ?? ''), /Done/.test(rowOfId(rows, 'CD-2')?.text ?? '')], age: rows.some(row => /\b\d+[smhd]\b/.test(row.text)), waiting: /Waiting/.test((await r.lines())[0] ?? '') })
      .toEqual({ words: [true, true], age: false, waiting: false })
  })
  // Standard category Unicode-RTL: wide and right-to-left ids
  const wideRow = (label: string, id: string) =>
    test(`Edge: a 24-character ${label} id is accepted and its row is cut by cell width with an ellipsis`, async ($, on) => {
      const r = await rig($, on)
      const a = await r.report([tk(id, 'planned')])
      await r.redraw()
      const row = (await rowInfo(r.ui))[0]?.text ?? ''
      expect({ accepted: /accept/i.test(a.text), fits: row !== '' && cellWidth(row) <= 44, cut: row.includes('…') }).toEqual({ accepted: true, fits: true, cut: true })
    })
  wideRow('CJK', '日本語のチケット番号'.repeat(3).slice(0, 24))
  wideRow('right-to-left', 'مرحبا بالعالم الجميل جدا'.slice(0, 24))
})

// ================================================================ Regression
describe('regression', () => {
  const THREE_WORKERS = (): unknown[] => [H_AGENT('a1', 'running', 'scan WS-11 alpha', 0), H_AGENT('a2', 'running', 'fix WS-12 beta', 1), H_AGENT('a3', 'running', 'port APP-3 gamma', 2)]
  const flow = async ($: any, on: On, reports: boolean) => {
    const world: World = mk({ agents: THREE_WORKERS(), host: [] })
    const r = await rig($, on, { world, sessions: [S('own')] })
    await $.command.run({ command: 'bridge', args: 'tickets WS-' } as never)
    if (reports) await r.report([tk('WS-11', 'in progress', 'a1'), tk('WS-12', 'in progress', 'a2'), tk('APP-3', 'in progress', 'a3')])
    for (let i = 0; i < 13; i++) await r.redraw()
    return { log: [...world.host!].sort(), count: countIn(await r.title()), waiting: /Waiting/.test((await r.lines())[0] ?? '') }
  }
  const distinct = (lines: readonly string[]) => [...new Set(lines)].sort()
  // Regression: host calls without a report equal the frozen log (the flow reached: no progress without a report, Waiting)
  test('Regression: the host calls without a report equal the frozen pre-feature log', async ($, on) => {
    const { log, count, waiting } = await flow($, on, false)
    expect({ lines: distinct(log), count, waiting }).toEqual({ lines: distinct(FLOW_HOST_LOG), count: null, waiting: true })
  })
  // Regression: host calls with a report equal the frozen log (the flow reached: progress and Waiting)
  test('Regression: the host calls with a report equal the frozen pre-feature log', async ($, on) => {
    const { log, count, waiting } = await flow($, on, true)
    expect({ lines: distinct(log), count, waiting }).toEqual({ lines: distinct(FLOW_HOST_LOG), count: '0/3', waiting: true })
  })
})

// ================================================================ Null hypothesis
describe('null hypothesis', () => {
  /** R-7: the store already holds a report `ageMs` old when the session starts. */
  const sevenDays = ($: any, on: On, ageMs: number) => rig($, on, { world: withRecord('own', THREE, TUE_10 - ageMs) })
  const none = async (r: Rig) => ({ bar: await hasBar(r.ui), count: countIn(await r.title()), rows: (await drawnRows(r.ui)).filter(t => /[A-Z]{2}-\d/.test(t)).length })
  // NH-1
  test('NH-1 No report in the session: no bar, count, group chip or ticket rows', async ($, on) => {
    const r = await rig($, on, { world: mk({ agents: [H_AGENT('a1', 'running', 'review docs', 0), H_AGENT('a2', 'completed', 'lint pass', 1)] }) })
    expect(await none(r)).toEqual({ bar: false, count: null, rows: 0 })
  })
  // NH-2
  test('NH-2 Workers named after tickets and no report, prefixes set: no progress', async ($, on) => {
    const agents = [H_AGENT('a1', 'running', 'fix WS-11', 0), H_AGENT('a2', 'running', 'WS-12 build', 1), H_AGENT('a3', 'running', 'scan WS-14', 2)]
    expect(await none(await rig($, on, { world: withPrefixes({ agents }) }))).toEqual({ bar: false, count: null, rows: 0 })
  })
  // NH-3
  test('NH-3 A refused report leaves the card identical to the redraw before it', async ($, on) => {
    const r = await rig($, on)
    await r.report(THREE)
    await r.redraw()
    const before = { lines: await r.lines(), rows: await drawnRows(r.ui) }
    await F_reportRaw($, r.world, [{ id: 'QX-9', state: 'blocked' }])
    await r.redraw()
    expect({ shown: countIn(before.lines[1] ?? ''), same: { lines: await r.lines(), rows: await drawnRows(r.ui) } }).toEqual({ shown: '1/3', same: before })
  })
  // NH-4
  test('NH-4 An accepted report with no tickets shows no progress', async ($, on) => {
    const r = await rig($, on)
    await r.report(THREE)
    await r.redraw()
    const shownBefore = countIn(await r.title())
    await r.report([])
    await r.redraw()
    expect({ shownBefore, after: await none(r) }).toEqual({ shownBefore: '1/3', after: { bar: false, count: null, rows: 0 } })
  })
  // NH-5
  test('NH-5 A report made in another session only shows no progress on the own card', async ($, on) => {
    const sessions = [S('own', { title: TIT }), S('other', { cwd: '/q', title: 'Other work' })]
    const theirs = await rig($, on, { world: mk({ selfName: 'other' }), sessions })
    await theirs.report(THREE)
    const stored = has((await theirs.readback()).text, 'AB-1')
    const mine = await remount(theirs, { selfName: 'own' })
    await mine.redraw()
    expect({ stored, shown: await none(mine) }).toEqual({ stored: true, shown: { bar: false, count: null, rows: 0 } })
  })
  // NH-6
  test('NH-6 No worker shows Working: the own card shows Done or Idle, never Waiting', () => {
    const line = statusOf(view([kid('scan a', 'done', 0), kid('scan b', 'idle', 1), kid('scan c', 'failed', 2)], { finishedAt: NOW - MIN }))
    expect({ waiting: /Waiting/.test(line), done: /Done|Idle/.test(line) }).toEqual({ waiting: false, done: true })
  })
  // NH-7
  test('NH-7 Only a Needs-you worker: no Waiting', () => {
    const line = statusOf(view([kid('ask alpha', 'needs-you', 0)], { own: { childNeedAt: NOW - MIN } }))
    expect({ waiting: /Waiting/.test(line), needs: /Needs you/.test(line) }).toEqual({ waiting: false, needs: true })
  })
  // NH-8
  test('NH-8 Another session\'s workers running and the own session has none: no Waiting on any card', async ($, on) => {
    const sessions = [S('own', { status: 'idle' }), S('other', { status: 'busy', cwd: '/q' })]
    const r = await rig($, on, { world: mk({ agents: [], selfName: 'own' }), sessions })
    expect([/Waiting/.test((await r.lines('own'))[0] ?? ''), /Waiting/.test((await r.lines('other'))[0] ?? '')]).toEqual([false, false])
  })
  // NH-9
  test('NH-9 An accepted report that removes nothing names no removed ticket', async ($, on) => {
    const r = await rig($, on)
    await r.report(THREE)
    const a = (await r.report([tk('AB-1', 'done'), tk('CD-2', 'done'), tk('EF-3', 'in progress')])).text
    expect(a).toBe('Accepted: 3 tickets.')
  })
  // NH-10
  test('NH-10 An empty report on an already empty list states no positive cleared count', async ($, on) => {
    const r = await rig($, on)
    const a = (await r.report([])).text
    expect(a).toBe('Accepted: 0 tickets.')
  })
  // NH-11
  test('NH-11 A list exactly 7 days old is kept and its progress shows on return', async ($, on) => {
    expect(countIn(await (await sevenDays($, on, 7 * DAY)).title())).toBe('1/3')
  })
  // NH-11
  test('NH-11 A list exactly 7 days old is kept and its read-back lists the tickets', async ($, on) => {
    const back = (await (await sevenDays($, on, 7 * DAY)).readback()).text
    expect(THREE_IDS.every(id => has(back, id))).toBe(true)
  })
  // NH-12: see the edge-case block ("A worker the person stopped (killed)")
  // NH-13
  test('NH-13 A named worker that is not listed is never in attention', async ($, on) => {
    const r = await rig($, on, { world: mk({ agents: [H_AGENT('w-other', 'failed', 'job other', 0)] }) })
    await r.report([tk('AB-1', 'in progress', 'w-gone')])
    await r.redraw()
    const row = rowOfId(await rowInfo(r.ui), 'AB-1')
    expect({ state: /In progress/.test(row?.text ?? ''), failed: /Failed|Needs you/.test(row?.text ?? ''), hue: row?.hue }).toEqual({ state: true, failed: false, hue: 'blue' })
  })
  // NH-14
  test('NH-14 A done ticket with a Failed worker is not in attention and is green', async ($, on) => {
    const r = await rig($, on, { world: mk({ agents: [H_AGENT('w-a', 'failed', 'job alpha', 0)] }) })
    await r.report([tk('AB-1', 'done', 'w-a'), tk('CD-2', 'planned')])
    await r.redraw()
    const row = rowOfId(await rowInfo(r.ui), 'AB-1')
    expect({ word: /Done/.test(row?.text ?? ''), failed: /Failed/.test(row?.text ?? ''), hue: row?.hue }).toEqual({ word: true, failed: false, hue: 'green' })
  })
  // NH-15: the same check as AC-53 ("Entering or leaving Waiting rings no sound").
  test('NH-15 Entering or leaving Waiting rings no sound', async ($, on) => {
    const played: unknown[] = []
    on('audio.play', ($p, e) => (played.push((e as { clip: unknown }).clip), { value: undefined }) as never)
    const sessions = [S('own', { status: 'idle' })]
    const world = mk({ agents: [], store: new Map<string, unknown>([['setting:sound', true]]) })
    const r = await rig($, on, { world, sessions })
    await r.clock.advance(35_000); await r.ui.advance(35_000)
    sessions[0]!.status = 'waiting'
    sessions[0]!.sinceMs = -1000
    await r.redraw()
    const control = played.length
    sessions[0]!.status = 'idle'
    sessions[0]!.sinceMs = 0
    await r.redraw()
    world.agents = [H_AGENT('a1', 'running', 'scan alpha', 0)]
    await r.redraw()
    world.agents = [H_AGENT('a1', 'completed', 'scan alpha', 0)]
    await r.redraw()
    expect({ control, waitingChanges: played.length - control }).toEqual({ control: 1, waitingChanges: 0 })
  })
  // NH-16
  test('NH-16 A title line with fewer than 5 bar cells draws no bar glyph', async ($, on) => {
    const r = await rig($, on, { cols: 10 })
    await r.report(THREE)
    await r.redraw()
    expect({ bar: await hasBar(r.ui), count: countIn(await r.title()) }).toEqual({ bar: false, count: '1/3' })
  })
  // NH-17
  test('NH-17 The one-line form draws no bar and no group chip', async ($, on) => {
    const r = await rig($, on, { world: mk({ store: new Map<string, unknown>([['setting:workingShelf', true]]) }), sessions: [S('own', { status: 'busy', sinceMs: 5 * MIN, title: TIT })] })
    await r.report([tk('AID-1', 'done'), tk('AID-2', 'planned')], 'EP-1')
    await r.redraw()
    const text = await ownRowText(r.ui)
    expect({ count: countIn(text), bar: (await ownRowCells(r.ui)).length, chip: text.includes('◆') || /\bAID\b/.test(text) }).toEqual({ count: '1/2', bar: 0, chip: false })
  })
  // NH-18
  test('NH-18 No epic and mixed prefixes show no group chip', async ($, on) => {
    const r = await rig($, on)
    await r.report([tk('WS-1', 'planned'), tk('APP-2', 'planned')])
    await r.redraw()
    const line = await r.title()
    expect({ count: countIn(line), noChip: /^\s*Release 42/.test(line) }).toEqual({ count: '0/2', noChip: true })
  })
  // NH-19
  test('NH-19 Ticket progress showing: no branch chip on the own card', async ($, on) => {
    const r = await rig($, on, { world: withPrefixes(), sessions: [own({ branch: 'WS-12-fix' })] })
    await r.report([tk('APP-1', 'planned'), tk('CD-2', 'planned')])
    await r.redraw()
    const line = await r.title()
    expect({ count: countIn(line), branchChip: /WS-12/.test(line) }).toEqual({ count: '0/2', branchChip: false })
  })
  /** R-7: the list is 2 s short of 7 days; a refused report and a read-back do not renew it, so one redraw (5 s) carries it over the 7th day. */
  const refusedAndRead = async ($: any, on: On) => {
    const r = await sevenDays($, on, 7 * DAY - 2000)
    const refused = await F_reportRaw($, r.world, [{ id: 'QX-9', state: 'blocked' }])
    const read = await r.readback()
    const control = { refused: refused.refused, namesState: /state/.test(refused.text), read: has(read.text, 'AB-1') }
    await r.redraw()
    return Object.assign(r, { control })
  }
  const CONTROL = { refused: true, namesState: true, read: true }
  // NH-20
  test('NH-20 A refused report and a read-back do not renew the 7 days: the list is gone on return', async ($, on) => {
    const back = await refusedAndRead($, on)
    expect({ control: back.control, count: countIn(await back.title()), bar: await hasBar(back.ui) }).toEqual({ control: CONTROL, count: null, bar: false })
  })
  // NH-20
  test('NH-20 A refused report and a read-back do not renew the 7 days: the read-back on return is empty', async ($, on) => {
    const back = await refusedAndRead($, on)
    expect({ control: back.control, ...emptyReadback((await back.readback()).text, THREE_IDS) }).toEqual({ control: CONTROL, ...EMPTY_OK })
  })
})
