import { describe, expect, mock, test, tier } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

import { REGISTRY_SCRIPT, REGISTRY_SEPARATOR } from '../hooks/sidebar-policy'
import type { RegistryEntry } from '../hooks/sidebar-policy'
import {
  askedAtOf, asksOwner, badgeOf, contextTokensOf, BRANCH_SCRIPT, collapsedOf, colorsOf, EMPTY_ACTIVE, FIELD, fit, ITEM, itemsOf, mergedTitle, projectNameOf,
  shelfHeaderOf, shelvesOf, sinceOf, staleDirsOf, staleTitlesOf, statusLabelOf, statusTextOf, TITLE_SCRIPT, titleOf, transcriptOf,
} from '../hooks/card-policy'
import { relativeTimeLabel } from '../hooks/relative-time'
import { automaticProjectColor, projectColorsById } from '../hooks/project-colors'
import type { Row } from '../types'
import { PALETTES, projectColorsOf } from '../hooks/core/palette'
import { DEFAULT_COLLAPSED, snapToRasterGrid } from '../hooks/core/types'

tier('builtin')

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Adapted from MIT-licensed tests; see THIRD_PARTY_NOTICES.md.
describe('relativeTimeLabel', () => {
  const NOW = 1_000_000_000
  test("reads 'now' under a minute", () => {
    expect(relativeTimeLabel(NOW - 30_000, NOW)).toBe('now')
  })
  test('steps through minutes, hours, days, and weeks', () => {
    expect(relativeTimeLabel(NOW - 5 * MINUTE, NOW)).toBe('5m')
    expect(relativeTimeLabel(NOW - 3 * HOUR, NOW)).toBe('3h')
    expect(relativeTimeLabel(NOW - 2 * DAY, NOW)).toBe('2d')
    expect(relativeTimeLabel(NOW - 20 * DAY, NOW)).toBe('2w')
  })
  test('floors rather than rounds, so a label never overstates age', () => {
    expect(relativeTimeLabel(NOW - (59 * MINUTE + 59_000), NOW)).toBe('59m')
    expect(relativeTimeLabel(NOW - (23 * HOUR + 59 * MINUTE), NOW)).toBe('23h')
  })
  test("treats a future timestamp as 'now'", () => {
    expect(relativeTimeLabel(NOW + 5 * MINUTE, NOW)).toBe('now')
  })
})

// Adapted from MIT-licensed tests (the projectColorStyle case is not copied); see THIRD_PARTY_NOTICES.md.
describe('project colors', () => {
  test('assigns distinct automatic colors beyond the former eight-color palette', () => {
    const ids = Array.from({ length: 200 }, (_, index) => `project-${index}`)
    const colors = projectColorsById(ids, {})
    expect(new Set(colors.values()).size).toBe(ids.length)
    expect(projectColorsById([...ids].reverse(), {})).toEqual(colors)
    for (const id of ids) expect(colors.get(id)).toMatch(/^#[0-9a-f]{6}$/)
  })
  test('keeps custom choices and avoids assigning them to another project automatically', () => {
    const color = automaticProjectColor('automatic')
    const colors = projectColorsById(['automatic', 'custom'], { custom: color })
    expect(colors.get('custom')).toBe(color)
    expect(colors.get('automatic')).not.toBe(color)
    expect(projectColorsById(['custom'], {}).get('custom')).toBe(automaticProjectColor('custom'))
  })
})

const rowOf = (id: string, status: string, extra: Partial<Row> = {}): Row => ({ id, name: id, kind: 'sessions', type: 'session', status, ...extra })

describe('card policy', () => {
  test('shelves: pinned wins over working, parked goes apart, the rest by status, listing order kept', () => {
    const rows = [rowOf('a', 'busy'), rowOf('b', 'idle'), rowOf('c', 'busy'), rowOf('d', 'waiting'), rowOf('e', 'idle')]
    const shelves = shelvesOf(rows, { c: { isPinned: true }, e: { isParked: true } })
    expect(Object.fromEntries(Object.entries(shelves).map(([name, list]) => [name, list.map(row => row.id)]))).toEqual({
      pinned: ['c'], working: ['a'], active: ['b', 'd'], parked: ['e'],
    })
  })

  test('a shelf header carries its count and fills the width with a rule', () => {
    expect(shelfHeaderOf('active', 3, false, 30)).toBe(`Active (3) ${'─'.repeat(17)} ⌄`)
    expect(shelfHeaderOf('parked', 1, true, 30)).toBe(`Parked (1) ${'─'.repeat(17)} ›`)
    expect([...shelfHeaderOf('working', 12, false, 40)].length).toBe(40)
  })

  test('the stored shelf state reads back over the default; junk is ignored', () => {
    expect(collapsedOf(undefined)).toEqual({ parked: true })
    expect(collapsedOf({ active: true, parked: false, bogus: true, working: 'yes' })).toEqual({ parked: false, active: true })
  })

  test('the status slot: word, tone and time in state; Needs you is a pill', () => {
    expect(statusLabelOf('busy')).toEqual({ word: 'Working', tone: 'warning' })
    expect(statusLabelOf('waiting')).toEqual({ word: 'Needs you', tone: 'error', isPill: true })
    expect(statusLabelOf('idle')).toEqual({ word: 'Idle', tone: 'subtle' })
    expect(statusTextOf(statusLabelOf('busy'), 0, 5 * MINUTE)).toBe('Working · 5m')
    expect(statusTextOf(statusLabelOf('idle'), undefined, 0)).toBe('Idle')
  })

  test('time in state survives rewrites of the same status and restarts on a change', () => {
    const first = sinceOf({}, [rowOf('a', 'busy', { statusUpdatedAt: 100 }), rowOf('b', 'idle')], 500)
    expect(first).toEqual({ a: { status: 'busy', at: 100 }, b: { status: 'idle', at: 500 } })
    const same = sinceOf(first, [rowOf('a', 'busy', { statusUpdatedAt: 900 })], 1000)
    expect(same).toEqual({ a: { status: 'busy', at: 100 } })
    expect(sinceOf(same, [rowOf('a', 'idle', { statusUpdatedAt: 950 })], 1000)).toEqual({ a: { status: 'idle', at: 950 } })
  })

  test('fit cuts with an ellipsis and never overflows', () => {
    expect(fit('abcdef', 10)).toBe('abcdef')
    expect(fit('abcdef', 4)).toBe('abc…')
    expect(fit('abcdef', 1)).toBe('…')
    expect(fit('abcdef', 0)).toBe('')
  })

  test('titles: the AI title, else the last prompt\'s first line; a broken record is skipped', () => {
    const ai = JSON.stringify({ type: 'ai-title', aiTitle: ' Fix the cards ' })
    const prompt = JSON.stringify({ type: 'last-prompt', lastPrompt: '\n  first   line \nsecond' })
    expect(titleOf(ai, prompt)).toEqual({ title: 'Fix the cards', isAi: true })
    expect(titleOf('', prompt)).toEqual({ title: 'first line' })
    expect(titleOf('{"type":"ai-ti', JSON.stringify({ type: 'last-prompt', leafUuid: 'x' }))).toEqual({})
    expect(itemsOf(`a${FIELD}b${ITEM}${FIELD}${ITEM}`)).toEqual([['a', 'b'], ['', '']])
  })
  // amend 2026-10-19: AC-17 -- a /rename title (custom-title record) wins over the AI title
  test('titles: a /rename title is read before the AI title', () => {
    const custom = JSON.stringify({ type: 'custom-title', customTitle: ' WS-84 sidebar soft limit ' })
    expect(titleOf(custom, '')).toEqual({ title: 'WS-84 sidebar soft limit', isAi: true })
  })

  test('the transcript path follows the project slug; an odd session id is never read', () => {
    expect(transcriptOf({ sessionId: 'c3de-01', cwd: "/Users/x/o'brien proto" })).toBe('-Users-x-o-brien-proto/c3de-01')
    expect(transcriptOf({ sessionId: '../../etc', cwd: '/x' })).toBeUndefined()
  })

  test('title cache: only sessions whose updatedAt moved are read; a tail with no AI title keeps the known one', () => {
    const entry = (sessionId: string, updatedAt: number): RegistryEntry => ({ sessionId, name: sessionId, cwd: '/r/p', status: 'idle', kind: 'interactive', pid: 1, startedAt: 1, updatedAt })
    const known = { s1: { at: 10, title: 'Known', isAi: true }, s2: { at: 20, title: 'prompt' } }
    expect(staleTitlesOf([entry('s1', 10), entry('s2', 21), entry('s3', 5)], known)).toEqual([
      { sessionId: 's2', at: 21, arg: 'full:-r-p/s2' },
      { sessionId: 's3', at: 5, arg: 'full:-r-p/s3' },
    ])
    expect(staleTitlesOf([entry('s1', 11)], known)[0]!.arg).toBe('tail:-r-p/s1')
    expect(mergedTitle(known.s1, 11, { title: 'a prompt' })).toEqual({ at: 11, title: 'Known', isAi: true })
    expect(mergedTitle(known.s1, 11, { title: 'New', isAi: true })).toEqual({ at: 11, title: 'New', isAi: true })
  })

  test('branch cache: a directory is read again only when its newest session moves', () => {
    const entry = (cwd: string, updatedAt: number): RegistryEntry => ({ sessionId: cwd, name: cwd, cwd, status: 'idle', kind: 'interactive', pid: 1, startedAt: 1, updatedAt })
    const places = { '/a': { at: 30, project: 'a' } }
    expect(staleDirsOf([entry('/a', 10), entry('/a', 30), entry('/b', 5)], places)).toEqual([{ cwd: '/b', at: 5 }])
    expect(staleDirsOf([entry('/a', 31)], places)).toEqual([{ cwd: '/a', at: 31 }])
  })

  test('a worktree belongs to its main checkout\'s project', () => {
    expect(projectNameOf('/r/Workspace/.worktrees/ws-84', '/r/Workspace/.git')).toBe('Workspace')
    expect(projectNameOf('/r/bare/wt', '/r/thing.git')).toBe('thing')
    expect(projectNameOf('/r/plain/', undefined)).toBe('plain')
  })

  test('the child badge: up to three discs, most urgent first, and the count', () => {
    const child = (status: string) => ({ id: status, name: status, type: 'Explore', status, depth: 1 })
    expect(badgeOf(['completed', 'running', 'failed', 'running'].map(child))).toEqual({ dots: ['error', 'warning', 'warning'], count: 4 })
  })
})

// A live-shaped world: this session (busy, not listed by ListAgents), an idle one, a waiting worktree one.
const NOW = 1_800_000_000_000
const SELF = 'aaaaaaaa-0000-0000-0000-000000000001'
const IDLE = 'dddddddd-0000-0000-0000-000000000002'
const WAIT = 'cccccccc-0000-0000-0000-000000000003'
const entries = (idleAt = NOW - 2 * HOUR) => [
  { pid: 11, startedAt: 1, sessionId: SELF, cwd: '/r/Workspace', kind: 'interactive', name: 'ws-self', status: 'busy', updatedAt: NOW - 5 * MINUTE, statusUpdatedAt: NOW - 5 * MINUTE },
  { pid: 12, startedAt: 2, sessionId: IDLE, cwd: '/r/AI-Docs', kind: 'interactive', name: 'docs-1', status: 'idle', updatedAt: idleAt, statusUpdatedAt: idleAt },
  { pid: 13, startedAt: 3, sessionId: WAIT, cwd: '/r/Workspace/.worktrees/ws-84', kind: 'interactive', name: 'wt-1', status: 'waiting', waitingFor: 'input needed', updatedAt: NOW - MINUTE, statusUpdatedAt: NOW - MINUTE },
]
const registryText = (list: object[]) => list.map(one => JSON.stringify(one)).join(REGISTRY_SEPARATOR) + REGISTRY_SEPARATOR
const LISTING = { listing: 'text', sections: [{ kind: 'sessions', total: 2, rows: [{ name: 'docs-1', ref: 'r2', status: 'idle' }, { name: 'wt-1', ref: 'r3', status: 'busy' }] }] }
const TITLES: Record<string, string> = { [SELF]: 'Fix the cards', [IDLE]: 'Docs title' }
const BRANCHES: Record<string, string> = { '/r/Workspace': 'main\u001f/r/Workspace/.git', '/r/AI-Docs': 'main\u001f/r/AI-Docs/.git', '/r/Workspace/.worktrees/ws-84': 'ws-84\u001f/r/Workspace/.git' }
const AGENTS = [
  { id: 'sub1', description: 'Scan repo', type: 'Explore', status: 'running' },
  { id: 'sub2', description: 'Write notes', type: 'general-purpose', status: 'completed' },
]

type World = { listing?: unknown; registry?: string; agents?: unknown[]; store?: Map<string, unknown>; reads: string[][] }

const engine = (on: On, world: World) => {
  const store = world.store ?? new Map<string, unknown>()
  // amend 2026-10-18: AC-08a -- these cards were written with the Working shelf on; it is a setting now, off by default.
  if (!store.has('setting:workingShelf')) store.set('setting:workingShelf', true)
  mock.clock(on, { now: NOW })
  on('store.get', ($s, e) => ({ value: store.get(e.key) }))
  on('store.set', ($s, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', ($s, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.start', ($s, e) => ({ cwd: e.cwd }) as never)
  on('session.id', () => ({ value: SELF }))
  on('tool.call', { tool: 'ListAgents' }, () => ({ result: world.listing ?? LISTING }) as never)
  on('agent.list', () => ({ value: world.agents ?? AGENTS }) as never)
  on('env.get', () => ({ value: undefined }) as never)
  on('process.run', ($s, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    const done = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never
    if (argv[0] === 'sh' && argv[2] === REGISTRY_SCRIPT) return done(world.registry ?? registryText(entries()))
    if (argv[0] === 'sh' && argv[2] === TITLE_SCRIPT) {
      world.reads.push(['titles', ...argv.slice(4)])
      return done(argv.slice(4).map(arg => {
        const title = Object.entries(TITLES).find(([id]) => arg.endsWith(id))?.[1]
        return `${title ? JSON.stringify({ type: 'ai-title', aiTitle: title }) : ''}${FIELD}${ITEM}`
      }).join(''))
    }
    if (argv[0] === 'sh' && argv[2] === BRANCH_SCRIPT) {
      world.reads.push(['branches', ...argv.slice(4)])
      return done(argv.slice(4).map(dir => `${BRANCHES[dir] ?? FIELD}${ITEM}`).join(''))
    }
    return done('', 1)
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  return store
}

const PANE_PROPS = { title: 'Bridge', isFocused: false, bodyColumns: 44, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }

const mounted = async ($: Parameters<TestBody>[0], on: On, world: World) => {
  const store = engine(on, world)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as never)
  await $.command.run({ command: 'bridge', args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'bridge', surface: 'terminal', component: 'Pane', props: PANE_PROPS as never, requestId: 'bridge' })
  return { ui, store }
}

const openKeysOf = async (ui: { findAll: (q: { type?: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(one => one.key ?? '').filter(key => key.startsWith('open:'))

describe('questions to the Owner (needs-you from the transcript)', () => {
  test('asksOwner: a closing question, a request phrase or an A/B choice list asks; a plain report does not', () => {
    expect(asksOwner('I checked the logs.\n\nShould we ship it now?')).toBe(true)
    expect(asksOwner('Two ways to go.\n\n**Which one do you prefer?**')).toBe(true)
    expect(asksOwner('The fix is ready. Let me know if you want the PR opened.')).toBe(true)
    expect(asksOwner('Pick one:\n\n**(A) Ship** — fast.\n\n**(B) Wait** — safer.')).toBe(true)
    expect(asksOwner('🔵 Do you prefer tabs or spaces?\n\n🔴 NEEDS YOU: reply with tabs or spaces.')).toBe(true)
    expect(asksOwner('Do you want the PR?\n\nNotes follow.\n\nAll done.')).toBe(false)
    expect(asksOwner('Done. All 443 tests pass and the branch is pushed.')).toBe(false)
    expect(asksOwner('Why did it fail? A stale cache.\n\nFixed and pushed.')).toBe(false)
    expect(asksOwner('Here is the check:\n\n```sh\nread -p "continue?"\n```')).toBe(false)
    expect(asksOwner('')).toBe(false)
  })
  const line = (content: unknown[], type = 'assistant') => JSON.stringify({ type, timestamp: '2026-10-18T20:00:00.000Z', message: { role: type, content } })
  test('askedAtOf: an assistant text-only entry that asks gives its time; a tool call, a user entry or a report gives none', () => {
    expect(askedAtOf(line([{ type: 'text', text: 'Should I merge it?' }]))).toBe(Date.parse('2026-10-18T20:00:00.000Z'))
    expect(askedAtOf(line([{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'Should I merge it?' }]))).toBe(Date.parse('2026-10-18T20:00:00.000Z'))
    expect(askedAtOf(line([{ type: 'text', text: 'Should I merge it?' }, { type: 'tool_use', name: 'Bash', input: {} }]))).toBeUndefined()
    expect(askedAtOf(line([{ type: 'text', text: 'Merged and pushed.' }]))).toBeUndefined()
    expect(askedAtOf(line([{ type: 'tool_result', content: 'ok?' }], 'user'))).toBeUndefined()
    expect(askedAtOf('not json')).toBeUndefined()
    expect(askedAtOf('')).toBeUndefined()
  })
})

describe('context tokens from the transcript (AC-94)', () => {
  test('contextTokensOf sums uncached, cache-written and cache-read input; the first count of each kind wins', () => {
    expect(contextTokensOf('"input_tokens":2 "cache_creation_input_tokens":1265 "cache_read_input_tokens":362786 ')).toBe(364053)
    expect(contextTokensOf('"input_tokens":5 "cache_read_input_tokens":10 "input_tokens":999 ')).toBe(15)
    expect(contextTokensOf('')).toBeUndefined()
  })
  test('the reader prints the last main-thread usage as its fifth field', () => {
    expect(TITLE_SCRIPT).toContain('grep -vF \'"isSidechain":true\'')
    expect(TITLE_SCRIPT).toContain('"$a" "$p" "$m" "$l" "$u"')
  })
})

describe('session cards', () => {
  test('shelves group the cards, with counts; this session joins from the registry and sits in Working', async ($, on) => {
    const { ui } = await mounted($, on, { reads: [] })
    // phase 2: AC-04, AC-52, AC-76 -- Active is drawn before Working, needs-you first; an open shelf has no count.
    expect(await openKeysOf(ui)).toEqual(['open:r3', 'open:r2', `open:${SELF}`])
    expect((await ui.find({ key: 'shelf:working' }))?.text).toMatch(/^Working ─+ ⌃$/) // amend 2026-10-18: AC-02
    expect((await ui.find({ key: 'header:active' }))?.text).toMatch(/^Active ─+ ↕ ⌃$/) // amend 2026-10-18: AC-02, AC-68
    expect(await ui.find({ key: 'shelf:pinned' })).toBeUndefined()
    expect(await ui.find({ key: 'shelf:parked' })).toBeUndefined()
  })

  // amend 2026-10-18: AC-10 -- the project name is muted; its colour is on the monogram.
  test('a working card is one line: highlight bar, coloured monogram, muted project, title, badge, "Working · 5m"', async ($, on) => {
    const { ui } = await mounted($, on, { reads: [] })
    const row = await ui.find({ key: `row:${SELF}` })
    // phase 2: AC-18, AC-20, AC-28 -- the one-liner reads project, title, then the slot; the own card is marked by its fill.
    expect(row?.text).toMatch(/^W  Workspace Fix the cards\s*Working 5m$/) // amend 2026-10-18: AC-44
    expect(row?.props.backgroundColor).toBe(snapToRasterGrid(PALETTES.dark.fill)) // live capture v2: own-card fill snaps to the Raster grid
    const project = (await ui.findAll({ type: 'Text' })).find(one => one.text === 'Workspace')
    expect(project?.props.dimColor).toBe(true) // amend 2026-10-18: AC-10
    expect(project?.props.color).toBeUndefined() // amend 2026-10-18: AC-10 -- (the first 'Workspace' run is another card's)
    // amend 2026-10-19: Owner demo -- plain text on the own-card fill takes the palette ink, so it reads when the theme and the terminal disagree.
    expect((await ui.findAll({ type: 'Text' })).some(one => one.text === 'Workspace' && one.props.color === PALETTES.dark.ink && one.props.dimColor === true)).toBe(true)
    expect((await ui.findAll({ type: 'Text' })).find(one => one.text.trim() === 'Fix the cards')?.props.color).toBe(PALETTES.dark.ink)
    expect((await ui.findAll({ type: 'Text' })).find(one => one.text === 'W ')?.props.backgroundColor).toBe(projectColorsOf(['Workspace', 'AI-Docs'], 'dark').get('Workspace')) // amend 2026-10-18: AC-10
  })

  test('an idle card is three lines: project and "Idle · 2h", the title, then branch and age', async ($, on) => {
    const { ui } = await mounted($, on, { reads: [] })
    const row = await ui.find({ key: 'row:r2' })
    // phase 2: AC-09, AC-12, AC-26 -- the idle slot is the age alone; line 3 is the branch.
    expect(row?.text).toMatch(/AI-Docs\s+2hDocs title\s+⎇ main\s*$/)
    expect((await ui.find({ key: 'open:r2' }))?.text).toBe('Docs title')
    expect((await ui.findAll({ type: 'Text' })).find(one => one.text === 'AI-Docs')?.props.dimColor).toBe(true) // amend 2026-10-18: AC-10
    expect((await ui.findAll({ type: 'Text' })).find(one => one.text === 'AI-Docs')?.props.color).toBeUndefined() // amend 2026-10-18: AC-10
    expect((await ui.findAll({ type: 'Text' })).find(one => one.text === 'A ')?.props.backgroundColor).toBe(projectColorsOf(['Workspace', 'AI-Docs'], 'dark').get('AI-Docs')) // amend 2026-10-18: AC-10
  })

  test('a waiting card reads "Needs you" as a pill; a worktree shows its main project and its branch; no title falls back to the name', async ($, on) => {
    const { ui } = await mounted($, on, { reads: [] })
    // phase 2: AC-21 -- the pill is palette hex on the red pill fill with the bell.
    // amend 2026-10-18: AC-23, AC-24 -- line 3 is the branch alone; no reason is drawn.
    expect((await ui.find({ key: 'row:r3' }))?.text).toMatch(/Workspace\s+▐![\u00a0]+Needs you\u00a0▌wt-1\s+⎇ ws-84\s*$/)
    expect((await ui.find({ key: 'row:r3' }))?.text).not.toMatch(/input needed/) // amend 2026-10-18: AC-24
    const pill = (await ui.findAll({ type: 'Text' })).find(one => one.props.backgroundColor === PALETTES.dark.pill.red.bg)
    expect(pill?.text).toMatch(/^![\u00a0]+Needs you\u00a0$/)
    expect(pill?.props.color).toBe(PALETTES.dark.pill.red.fg)
  })

  test('subagents nest under this session\'s card behind a left rule', async ($, on) => {
    const { ui } = await mounted($, on, { reads: [] })
    const card = await ui.find({ key: `card:${SELF}` })
    expect(card?.text).toMatch(/│ ● Scan repo\s*.*Working/)
    expect(card?.text).toMatch(/│ ● Write notes\s*.*Done/)
    expect((await ui.find({ key: 'child:sub1' }))?.text).toMatch(/^ {2}│ ● Scan repo/)
    expect((await ui.find({ key: 'card:r2' }))?.text).not.toMatch(/Scan repo/)
    expect(await ui.find({ key: 'view:main' })).toBeUndefined()
  })

  test('a collapsed shelf hides its cards and stays collapsed in a new session', async ($, on) => {
    const { ui, store } = await mounted($, on, { reads: [] })
    await ui.press({ key: 'shelf:active' })
    // phase 2: L5 -- the shelves key holds every shelf.
    expect(store.get('shelves')).toEqual({ ...DEFAULT_COLLAPSED, active: true })
    expect(await openKeysOf(ui)).toEqual([`open:${SELF}`])
    expect((await ui.find({ key: 'shelf:active' }))?.text).toMatch(/^Active \(2\) ─+ ⌄$/) // amend 2026-10-18: AC-02
    await ui.press({ key: 'shelf:active' })
    expect(store.get('shelves')).toEqual({ ...DEFAULT_COLLAPSED, active: false })
  })

  test('a stored collapse comes back at session start', async ($, on) => {
    const { ui } = await mounted($, on, { reads: [], store: new Map<string, unknown>([['shelves', { working: true }]]) })
    // phase 2: AC-76 -- needs-you first in Active.
    expect(await openKeysOf(ui)).toEqual(['open:r3', 'open:r2'])
  })

  test('titles and branches are read once, then only for the session whose updatedAt moved', async ($, on) => {
    const world: World = { reads: [] }
    await mounted($, on, world)
    expect(world.reads).toEqual([
      ['titles', `full:-r-Workspace/${SELF}`, `full:-r-AI-Docs/${IDLE}`, `full:-r-Workspace--worktrees-ws-84/${WAIT}`],
      ['branches', '/r/Workspace', '/r/AI-Docs', '/r/Workspace/.worktrees/ws-84'],
    ])
    world.reads.length = 0
    await $.command.run({ command: 'bridge', args: '' } as never)
    expect(world.reads).toEqual([])
    world.registry = registryText(entries(NOW - HOUR))
    await $.command.run({ command: 'bridge', args: '' } as never)
    expect(world.reads).toEqual([['titles', `tail:-r-AI-Docs/${IDLE}`], ['branches', '/r/AI-Docs']])
  })

  // amend 2026-10-18: AC-47 -- an empty Active shelf has no header; only the scene shows.
  test('no sessions: no Active header, only the all-clear scene', async ($, on) => {
    const { ui } = await mounted($, on, { reads: [], listing: { listing: 'text', sections: [] }, registry: '', agents: [] })
    // phase 2: AC-47b -- the caption is centred under the scene.
    expect(await ui.find({ key: 'shelf:active' })).toBeUndefined() // amend 2026-10-18: AC-47
    expect(await ui.find({ key: 'header:active' })).toBeUndefined() // amend 2026-10-18: AC-47
    expect((await ui.find({ key: 'scene-caption' }))?.text).toContain(EMPTY_ACTIVE)
    expect(await openKeysOf(ui)).toEqual([])
  })
})
