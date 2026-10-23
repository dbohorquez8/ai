import { describe, expect, test, tier } from 'claude-code/testing'

import { ageLabel, timeLeftLabel } from '../hooks/core/age'
import { cellWidth, fitCells, padCells } from '../hooks/core/width'
import { finishedAtOf, isWaitingRaw, isWorkingRaw, mergedStatusOf, statusOf, steadySinceOf } from '../hooks/core/status'
import { AGENTS_ARGV, agentsJsonOf, modelIdOf, modelOf, percentOf, sessionsOf, TRANSCRIPT_TAIL_BYTES } from '../hooks/core/sources'
import { applyAction, isWoke, offeredActions, reconcile, returnedOf, shelfOf, wakeOf, INACTIVE_AFTER_MS, SEEN_STAMP_MS } from '../hooks/core/lifecycle'
import { SNOOZE_LABELS, snoozeOptionsAt } from '../hooks/core/snooze'
import { moved, orderShelf } from '../hooks/core/order'
import { DEFAULT_CHECK_AFTER_MINUTES, DEFAULT_SOFT_LIMIT, defaultSoftLimitOf, LARGE_WINDOW_SOFT_LIMIT, KEYS, loadStored, PREF_PREFIX, PRUNE_AFTER_MS, prunedKeys, PANE_ARGS_HINT, paneSettingOf, softLimitOf, windowsOf } from '../hooks/core/persist' // (settings are /bridge arguments)
import { ALL_CLEAR, nextCaption, WORKING_CAPTIONS } from '../hooks/core/captions'
import { backgroundRowOf, CARD_EDGE_BOTTOM, CARD_EDGE_TOP, CARD_GAP_ROWS, childRowOf, fitSegs, headerOf, line1Of, line2Of, line3Of, oneLineOf, ROW_HORIZONTAL_PADDING, sortChildren } from '../hooks/core/layout'
import { glyphModeOf } from '../hooks/adapters/glyphs'
import { parseTicketId } from '../hooks/core/tickets'
import { backgroundOf, endedTaskIdOf, launchedTaskOf, MAX_BACKGROUND_ROWS, reconciledBackgroundOf, taskLabelOf, withoutTask, withTask } from '../hooks/core/background'
import { childrenOf, MAX_KEPT_FINISHED } from '../hooks/core/children'
import { base64Of, chimeClaimOf, chimeSamples, chimeWav, CHIME_RATE, isPutAway, prunedChimeKeys, shouldChimeOf, wavOf } from '../hooks/core/chime'
import type { CardInput } from '../hooks/core/layout'
import { paneViewOf } from '../hooks/core/view'
import { DEFAULT_COLLAPSED, hexToColor, snapToRasterGrid } from '../hooks/core/types'
import { contrastRatio } from '../hooks/core/palette'
import { ICON_MAX_BYTES, ICON_MAX_SIDE, iconCacheNameOf, iconConvertArgv, isIconSizeUsable, PROJECT_ICON_CANDIDATES, projectMonogramLetter, projectRootOf } from '../hooks/core/icons'
import type { Caps, Child, ChildStatus, Entry, Layout, Palette, Seg, Session, ShelfId, SortMode, Status, Stored } from '../hooks/core/types'
import { REFRESH_MS, REGISTRY_SCRIPT, REGISTRY_SEPARATOR, joined, registryOf, rowsOf, withSelf } from '../hooks/pane-policy'
import type { RegistryEntry } from '../hooks/pane-policy'
import { FIELD, ITEM, itemsOf, staleTitlesOf, TITLE_SCRIPT } from '../hooks/card-policy'

tier('builtin')

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// ---- fixtures ----------------------------------------------------------------------------------

const PALETTE: Palette = {
  text: { red: '#ff9f94', orange: '#f7bc95', yellow: '#ecd78a', green: '#98d5ac', blue: '#74d4ff', violet: '#c4b4ff', gray: '#d2d8e2' },
  pill: { red: { fg: '#ffd9d4', bg: '#7a1f1f' }, gray: { fg: '#d2d8e2', bg: '#3a3d46' } },
  waitingRow: '#3a2a1c',
  fill: '#2f313d',
  ink: '#eceef3',
  bg: '#1c1c1c',
}
const TRUE_COLOR: Caps = { trueColor: true, pictures: true }
const NO_COLOR_TERM: Caps = { trueColor: false, pictures: false }
const NOW = 1_800_000_000_000

const S = (over: Partial<Session> & { id: string }): Session => ({
  prefId: over.id, name: over.id, activityAt: NOW - MIN, raw: 'idle', statusSince: NOW - 2 * HOUR, title: `${over.id} title`, project: 'proj', isSelf: false, ...over,
})
const card = (over: Partial<Session> = {}, extra: Partial<CardInput> = {}): CardInput => ({
  s: S({ id: 'a', ...over }), status: 'idle', woke: false, children: [], now: NOW, bell: 0, palette: PALETTE, projectColor: '#88aacc', glyphMode: 'plain', ...extra,
})
const CHILD = (id: string, status: ChildStatus, startedAt = 0, since = NOW - 2 * MIN): Child => ({ id, label: `task ${id}`, status, since, startedAt })

const plain = (segs: readonly Seg[]) => segs.map(seg => (seg.kind === 'spinner' ? '⠋' : seg.text)).join('')
const cells = (segs: readonly Seg[]) => segs.reduce((total, seg) => total + (seg.kind === 'spinner' ? 1 : cellWidth(seg.text)), 0)

const loaded = (raw: Array<[string, unknown]> = []): Stored => loadStored(new Map(raw)).stored
const storedWith = (over: Partial<Stored> = {}): Stored => ({ ...loaded(), ...over })
// the Working shelf is a setting, off by default; tests of the shelf turn it on.
const SHELF_ON = { icons: true, theme: 'auto', workingShelf: true } as const

// ---- width and age --------------------------------------------------------

describe('age labels', () => {
  test('the table, floored, days until 14 days then weeks', () => {
    const at = [0, 59_000, MIN, 59 * MIN + 59_000, 60 * MIN, 23 * HOUR + 59 * MIN, 24 * HOUR, 13 * DAY, 14 * DAY, 20 * DAY]
    expect(at.map(elapsed => ageLabel(NOW - elapsed, NOW))).toEqual(['now', 'now', '1m', '59m', '1h', '23h', '1d', '13d', '2w', '2w'])
  })
  test('a future timestamp reads now, never a negative age', () => {
    expect(ageLabel(NOW + HOUR, NOW)).toBe('now')
    expect(ageLabel(NOW + 1, NOW)).toBe('now')
  })
  test('a status that began 5 minutes before the pane opened reads 5m', () => {
    expect(ageLabel(NOW - 5 * MIN, NOW)).toBe('5m')
  })
  test('time left rounds up and never reads 0m while the card is hidden', () => {
    expect(timeLeftLabel(NOW + 5 * HOUR, NOW)).toBe('5h')
    expect(timeLeftLabel(NOW + 4 * HOUR, NOW)).toBe('4h')
    expect(timeLeftLabel(NOW + 30 * MIN, NOW)).toBe('30m')
    expect(timeLeftLabel(NOW + 1_000, NOW)).toBe('1m')
    expect(timeLeftLabel(NOW + 2 * DAY, NOW)).toBe('2d')
    expect(timeLeftLabel(NOW + 59 * MIN + 30_000, NOW)).toBe('1h')
    expect(timeLeftLabel(NOW - 1, NOW)).toBe('now')
  })
})

describe('display width', () => {
  test('ASCII is one cell, the bell and CJK are two, combining marks and joiners are none', () => {
    expect(cellWidth('abc')).toBe(3)
    expect(cellWidth('')).toBe(0)
    expect(cellWidth('🔔')).toBe(2)
    expect(cellWidth('日本語')).toBe(6)
    expect(cellWidth('é')).toBe(1)
    expect(cellWidth('́')).toBe(0)
    expect(cellWidth('❤️')).toBe(2)
    expect(cellWidth('👨‍👩')).toBe(2)
    expect(cellWidth('⎇ ✓ ● │ ▰▱ ⌄ › ─ …')).toBe(18)
    expect(cellWidth('↕ ⌃')).toBe(3) // text-default pictographs such as the sort mark are one cell
  })
  test('fitCells and padCells never exceed the width, and padCells fills it exactly', () => {
    const texts = ['', 'a', 'hello world', '日本語のタイトル', 'x🔔y🔔z', 'ééé', '👨‍👩‍👧 family', 'العربية title']
    for (const text of texts) {
      for (let width = -1; width <= 30; width++) {
        expect(cellWidth(fitCells(text, width))).toBeLessThanOrEqual(Math.max(0, width))
        expect(cellWidth(padCells(text, width))).toBe(Math.max(0, width))
      }
    }
  })
  test('a cut ends in an ellipsis and keeps a text that fits whole', () => {
    expect(fitCells('abcdef', 4)).toBe('abc…')
    expect(fitCells('abcdef', 6)).toBe('abcdef')
    expect(fitCells('abcdef', 1)).toBe('…')
    expect(fitCells('abcdef', 0)).toBe('')
    expect(fitCells('日本語', 5)).toBe('日本…')
    expect(padCells('ab', 5)).toBe('ab   ')
  })
})

// ---- status and sources -------------------------

describe('status', () => {
  test('raw words: busy, running and working are working; waiting needs the person', () => {
    expect(['busy', 'running', 'working', ' Busy ', 'idle', ''].map(isWorkingRaw)).toEqual([true, true, true, true, false, false])
    expect(['waiting', 'WAITING', 'idle'].map(isWaitingRaw)).toEqual([true, true, false])
  })

  test('statusOf: waiting is needs-you, working is working, failed or error is failed, an unseen finish is done, the rest idle', () => {
    expect(statusOf('waiting', 0, undefined, undefined)).toBe('needs-you')
    expect(statusOf('busy', 0, 500, undefined)).toBe('working')
    expect(statusOf('idle', 0, 500, undefined)).toBe('done')
    expect(statusOf('idle', 0, 500, 499)).toBe('done')
    expect(statusOf('idle', 0, 500, 500)).toBe('idle')
    expect(statusOf('idle', 0, 500, 900)).toBe('idle')
    expect(statusOf('idle', 0, undefined, undefined)).toBe('idle')
    for (const raw of ['killed', 'blocked', 'pending', '']) expect(statusOf(raw, 0, undefined, undefined)).toBe('idle')
    for (const raw of ['failed', 'error', ' Error ']) expect(statusOf(raw, 0, undefined, undefined)).toBe('failed')
    const seen = new Set<Status>(['', 'idle', 'busy', 'waiting', 'failed', 'killed', 'completed'].map(raw => statusOf(raw, 0, 10, undefined)))
    expect([...seen].sort()).toEqual(['done', 'failed', 'needs-you', 'working'])
  })
  test('statusOf: a turn that ended on a question needs the person until the card is pressed after it', () => {
    expect(statusOf('idle', 0, 500, undefined, 500)).toBe('needs-you')
    expect(statusOf('idle', 0, undefined, undefined, 500)).toBe('needs-you')
    expect(statusOf('idle', 0, 500, 600, 500)).toBe('idle')
    expect(statusOf('busy', 0, undefined, undefined, 500)).toBe('working')
  })

  test('mergedStatusOf: the source with the newer change wins; equal words keep the registry since', () => {
    const registry = { raw: 'busy', since: 1000 }
    expect(mergedStatusOf(registry)).toEqual(registry)
    expect(mergedStatusOf(registry, { raw: 'idle', observedAt: 2000 })).toEqual({ raw: 'idle', since: 2000 })
    expect(mergedStatusOf(registry, { raw: 'idle', observedAt: 500 })).toEqual(registry)
    expect(mergedStatusOf(registry, { raw: 'idle', observedAt: 1000 })).toEqual(registry)
    expect(mergedStatusOf(registry, { raw: 'busy', observedAt: 9000 })).toEqual(registry)
    expect(mergedStatusOf({ raw: 'idle', since: 3000 }, { raw: 'busy', observedAt: 2000 })).toEqual({ raw: 'idle', since: 3000 })
  })

  test('finishedAtOf: a done word, or a working or waiting status that ended in idle, stamps the finish', () => {
    const idle = { raw: 'idle', since: 700 }
    expect(finishedAtOf(undefined, idle, undefined)).toBeUndefined()
    expect(finishedAtOf(undefined, idle, 300)).toBe(300)
    expect(finishedAtOf({ raw: 'busy', since: 100 }, idle, 300)).toBe(700)
    expect(finishedAtOf({ raw: 'waiting', since: 100 }, idle, undefined)).toBe(700)
    expect(finishedAtOf({ raw: 'idle', since: 100 }, idle, 300)).toBe(300)
    expect(finishedAtOf({ raw: 'busy', since: 100 }, { raw: 'waiting', since: 800 }, 300)).toBe(300)
    expect(finishedAtOf({ raw: 'busy', since: 100 }, { raw: 'busy', since: 100 }, undefined)).toBeUndefined()
    expect(finishedAtOf({ raw: 'busy', since: 1 }, { raw: 'completed', since: 900 }, 300)).toBe(900)
    expect(finishedAtOf(undefined, { raw: 'done', since: 910 }, undefined)).toBe(910)
  })
})

const AGENTS_JSON = JSON.stringify([
  { id: 'cfa4b1dd', cwd: '/Users/x/Api-Docs', kind: 'background', startedAt: 1789961881841, sessionId: 'cfa4b1dd-4b1a', name: 'Background job', state: 'blocked' },
  { pid: 23214, cwd: '/Users/x/Webshop', kind: 'interactive', startedAt: 1792185979166, sessionId: '197c1f04', name: 'workspace-88', status: 'busy' },
  { pid: 72124, cwd: '/Users/x/Webshop', kind: 'interactive', startedAt: 1792339397668, sessionId: '92558725', name: 'workspace-bf', state: 'waiting', waitingFor: 'permission prompt' },
  { pid: 5, cwd: '/x', kind: 'interactive', startedAt: 7, name: 'no session id', status: 'idle' },
  'junk',
  null,
])

describe('background tasks from tool calls and notifications (live defect D1)', () => {
  test('a background Bash, a Monitor and a Workflow start a task; a foreground or self-ending command does not', () => {
    expect(launchedTaskOf('Bash', { command: 'sleep 240', description: 'Wait' }, { backgroundTaskId: 'b1' })).toEqual({ id: 'b1', type: 'shell', command: 'sleep 240', description: 'Wait' })
    expect(launchedTaskOf('Bash', { command: 'ls' }, { stdout: 'x' })).toBeUndefined()
    expect(launchedTaskOf('Bash', { command: 'x' }, { backgroundTaskId: 'b2', backgroundEndsWithFinalResponse: true })).toBeUndefined()
    expect(launchedTaskOf('Monitor', { description: 'Watch CI' }, { taskId: 'm1', timeoutMs: 1 })).toEqual({ id: 'm1', type: 'monitor', description: 'Watch CI' })
    expect(launchedTaskOf('Workflow', { name: 'review' }, { status: 'async_launched', taskId: 'w1', workflowName: 'deep-review' })).toEqual({ id: 'w1', type: 'workflow', name: 'deep-review' })
    expect(launchedTaskOf('Workflow', {}, { status: 'async_launched', taskId: 'w2', error: 'syntax' })).toBeUndefined()
    expect(launchedTaskOf('Read', {}, { taskId: 'r' })).toBeUndefined()
    expect(launchedTaskOf('Bash', undefined, undefined)).toBeUndefined()
  })
  test('a task notification with an ending status names its task; any other text names none', () => {
    const note = (status: string) => `<task-notification>\n<task-id>bavp7cqri</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>${status}</status>\n<summary>Background command done</summary>\n</task-notification>`
    for (const status of ['completed', 'failed', 'killed', 'Stopped']) expect(endedTaskIdOf(note(status))).toBe('bavp7cqri')
    expect(endedTaskIdOf(note('running'))).toBeUndefined()
    expect(endedTaskIdOf('<task-id>x</task-id><status>completed</status>')).toBeUndefined()
    expect(endedTaskIdOf('hello')).toBeUndefined()
  })
  test('review P1: idle with no turn running drops the tasks first seen before the idle began; busy, shell or a running turn keep them', () => {
    const list = [{ id: 'old', kind: 'Command' as const, label: 'sleep', firstSeenAt: 100 }, { id: 'new', kind: 'Command' as const, label: 'npm', firstSeenAt: 600 }]
    expect(reconciledBackgroundOf(list, { raw: 'idle', isTurnOver: true, idleSince: 500 }).map(one => one.id)).toEqual(['new'])
    for (const raw of ['busy', 'shell', 'waiting']) expect(reconciledBackgroundOf(list, { raw, isTurnOver: true, idleSince: 500 })).toEqual(list)
    expect(reconciledBackgroundOf(list, { raw: 'idle', isTurnOver: false, idleSince: 500 })).toEqual(list)
    expect(reconciledBackgroundOf(list, { raw: 'idle', idleSince: 500 })).toEqual(list)
    expect(reconciledBackgroundOf(list, { raw: 'idle', isTurnOver: true })).toEqual(list)
    expect(reconciledBackgroundOf(null, { raw: 'idle', isTurnOver: true, idleSince: 500 })).toBeNull()
  })
  test('a started task is added once, first seen now; an ended one is taken off; no source stays no source', () => {
    const one = withTask(null, { id: 'b1', type: 'shell', command: 'npm test' }, 100)
    expect(one).toEqual([{ id: 'b1', kind: 'Command', label: 'npm test', firstSeenAt: 100 }])
    expect(withTask(one, { id: 'b1', type: 'shell', command: 'npm test' }, 200)).toEqual(one)
    expect(withoutTask(one, 'b1')).toEqual([])
    expect(withoutTask(null, 'b1')).toBeNull()
  })
  test('the own card reads Background when its turn is over and work is in flight, even while its word says busy', () => {
    expect(statusOf('busy', 0, undefined, undefined, undefined, { background: 1, isTurnOver: true })).toBe('background')
    expect(statusOf('busy', 0, undefined, undefined, undefined, { background: 1, isTurnOver: false })).toBe('working')
    expect(statusOf('busy', 0, undefined, undefined, undefined, { background: 1 })).toBe('working')
    expect(statusOf('busy', 0, undefined, undefined, undefined, { background: 0, isTurnOver: true })).toBe('working')
    expect(statusOf('waiting', 0, undefined, undefined, undefined, { background: 1, isTurnOver: true })).toBe('needs-you')
  })
  test('a live child permission or question rolls up as Needs you; background waiting does not', () => {
    expect(statusOf('busy', 0, undefined, undefined, undefined, { childNeedAt: NOW })).toBe('needs-you')
    expect(statusOf('busy', 0, undefined, undefined, undefined, {})).toBe('working')
    expect(chimeClaimOf('needs-you', { sharedSince: 1, childNeedAt: NOW })).toBe(`needs-you@${NOW}`)
  })
})

describe('child rows kept (live defect D2)', () => {
  const agent = (id: string, status: string) => ({ id, status, description: id, type: 'general-purpose' })
  test('a finished child the list forgot stays as last seen; a running one that vanished is gone', () => {
    const first = childrenOf([agent('a1', 'completed'), agent('a2', 'running')], [], {}, 100)
    const second = childrenOf([], first.list, first.seen, 200)
    expect(second.list.map(child => [child.id, child.status, child.since])).toEqual([['a1', 'done', 100]])
    expect(second.seen.a1).toEqual(first.seen.a1)
    const third = childrenOf([agent('b1', 'failed')], second.list, second.seen, 300)
    expect(third.list.map(child => [child.id, child.status])).toEqual([['b1', 'failed'], ['a1', 'done']])
  })
  test('kept finished children are capped, the newest kept', () => {
    const many = Array.from({ length: MAX_KEPT_FINISHED + 3 }, (_, at) => ({ id: `d${at}`, label: `d${at}`, status: 'done' as const, since: at, startedAt: at }))
    const out = childrenOf([agent('r1', 'running')], many, {}, 1000)
    expect(out.list).toHaveLength(MAX_KEPT_FINISHED + 1)
    expect(out.list.map(child => child.id)).not.toContain('d0')
    expect(out.list.map(child => child.id)).toContain(`d${MAX_KEPT_FINISHED + 2}`)
  })
  test('only a real pending interaction changes a waiting child to Needs you', () => {
    const waiting = agent('wait', 'waiting')
    expect(childrenOf([waiting], [], {}, 100).list[0]?.status).toBe('working')
    const asked = childrenOf([waiting], [], {}, 100, { wait: 99 })
    expect(asked.list[0]?.status).toBe('needs-you')
    expect(sortChildren(asked.list)[0]?.id).toBe('wait')
    expect(plain(childRowOf(asked.list[0]!, 60, NOW, PALETTE).text)).toMatch(/Needs you/)
  })
})

describe('steady status time (live defect D4)', () => {
  test('the same word keeps the earlier start; a new word or no earlier one takes the source time', () => {
    expect(steadySinceOf({ status: 'busy', at: 100 }, 'busy', 900)).toBe(100)
    expect(steadySinceOf({ status: 'Busy', at: 100 }, 'busy ', 900)).toBe(100)
    expect(steadySinceOf({ status: 'busy', at: 100 }, 'idle', 900)).toBe(900)
    expect(steadySinceOf(undefined, 'busy', 900)).toBe(900)
    expect(steadySinceOf({ status: 'busy', at: 0 }, 'busy', 900)).toBe(900)
    expect(steadySinceOf({ status: 'busy', at: 950 }, 'busy', 900)).toBe(900)
    expect(steadySinceOf({ status: 'busy', at: 100 }, 'busy', 0)).toBe(100)
    // review P3: the own session's turn started or ended after the kept start (busy, idle, busy between refreshes).
    expect(steadySinceOf({ status: 'busy', at: 100 }, 'busy', 900, 500)).toBe(500)
    expect(steadySinceOf({ status: 'busy', at: 100 }, 'busy', 900, 50)).toBe(100)
    expect(steadySinceOf({ status: 'busy', at: 100 }, 'idle', 900, 500)).toBe(900)
  })
})

describe('sources', () => {
  test('agentsJsonOf reads the captured 2026-10-18 shape, drops background sessions and entries with no id', () => {
    expect(AGENTS_ARGV).toEqual(['claude', 'agents', '--json'])
    expect(agentsJsonOf(AGENTS_JSON)).toEqual([
      { sessionId: '197c1f04', pid: 23214, cwd: '/Users/x/Webshop', name: 'workspace-88', raw: 'busy', kind: 'interactive', startedAt: 1792185979166 },
      { sessionId: '92558725', pid: 72124, cwd: '/Users/x/Webshop', name: 'workspace-bf', raw: 'waiting', reason: 'permission prompt', kind: 'interactive', startedAt: 1792339397668 },
    ])
  })

  test('agentsJsonOf: junk gives an empty list', () => {
    for (const junk of ['', 'not json', '{"a":1}', '42', 'null', '[1,2]', '{"sessions":[]}']) expect(agentsJsonOf(junk)).toEqual([])
  })

  test('modelOf reads the short family, else the last id segment, and never invents one', () => {
    expect(modelOf('"model":"claude-opus-5-5"')).toBe('opus')
    // review P3: some transcripts mark a 1M window with `[1m]`; the id keeps it, so its window is kept apart.
    expect(modelOf('"model":"claude-opus-4-8[1m]"')).toBe('opus')
    expect(modelIdOf('"model":"claude-opus-4-8[1M]"')).toBe('claude-opus-4-8[1m]')
    expect(modelIdOf('"model":"claude[x]"')).toBeUndefined()
    expect(modelOf('"model":"claude-sonnet-4-5-20250929"')).toBe('sonnet')
    expect(modelOf('"model":"claude-haiku-4-5"')).toBe('haiku')
    expect(modelOf('"model":"claude-fable-1"')).toBe('fable')
    expect(modelOf('"model":"gpt-4o"')).toBe('4o')
    for (const none of ['', '"model":""', '"model":"<synthetic>"', 'no model here', '"model":']) expect(modelOf(none)).toBeUndefined()
  })

  test('the registry also accepts statusSince, reason and contextPercent, only when present', () => {
    const entry = { sessionId: 's', name: 'n', cwd: '/c', status: 'waiting', kind: 'interactive', pid: 4, startedAt: 9 }
    const read = (extra: object) => registryOf(JSON.stringify({ ...entry, ...extra }) + REGISTRY_SEPARATOR)[0]
    expect(read({})).toEqual(entry)
    expect(read({ statusSince: 40, reason: 'dialog open', contextPercent: 62 })).toEqual({ ...entry, statusUpdatedAt: 40, waitingFor: 'dialog open', contextPercent: 62 })
    expect(read({ statusUpdatedAt: 50, statusSince: 40, waitingFor: 'input needed', reason: 'x' })).toEqual({ ...entry, statusUpdatedAt: 50, waitingFor: 'input needed' })
    expect(read({ contextPercent: 'high', statusSince: 'soon' })).toEqual(entry)
  })

  test('the registry reader globs sessions/*.json only, so token files are never opened', () => {
    expect(REGISTRY_SCRIPT).toContain('sessions/*.json')
    expect(REGISTRY_SCRIPT).not.toContain('.key')
    expect(REGISTRY_SCRIPT).not.toMatch(/sessions\/\*[^.]/)
  })

  test('both transcript modes read the last 262 144 bytes and nothing is read whole', () => {
    expect(TRANSCRIPT_TAIL_BYTES).toBe(262_144)
    expect(TITLE_SCRIPT).toContain('tail -c 262144')
    expect(TITLE_SCRIPT).not.toMatch(/grep[^\n]*"\$f"/)
    expect(TITLE_SCRIPT).not.toMatch(/(cat|head|sed|awk|strings)[^\n]*"\$f"/)
    expect([...TITLE_SCRIPT.matchAll(/"\$f"/g)].length).toBe(1)
    expect(TITLE_SCRIPT).toContain(`grep -o '"model":"[^"]*"' | tail -n 1`)
    expect(TITLE_SCRIPT).toContain('\\037%s\\037%s\\036')
  })

  test('a title item has three fields; an old two-field item reads as no model', () => {
    const three = itemsOf(`a${FIELD}b${FIELD}"model":"claude-opus-5-5"${ITEM}`)
    expect(three).toEqual([['a', 'b', '"model":"claude-opus-5-5"']])
    expect(modelOf(three[0]![2] ?? '')).toBe('opus')
    const two = itemsOf(`a${FIELD}b${ITEM}`)
    expect(modelOf(two[0]![2] ?? '')).toBeUndefined()
  })

  test('a transcript is read again only for a session whose updatedAt moved', () => {
    const entry = (updatedAt: number): RegistryEntry => ({ sessionId: 's1', name: 'n', cwd: '/r/p', status: 'idle', kind: 'interactive', pid: 1, startedAt: 1, updatedAt })
    const titles = { s1: { at: 100, title: 'T', isAi: true } }
    expect(staleTitlesOf([entry(100)], titles)).toEqual([])
    expect(staleTitlesOf([entry(101)], titles)).toEqual([{ sessionId: 's1', at: 101, arg: 'tail:-r-p/s1' }])
  })

  test('the registry refresh is 5 s, inside the 6 s bound', () => {
    expect(REFRESH_MS).toBe(5000)
    expect(REFRESH_MS).toBeLessThanOrEqual(6000)
  })
})

describe('sessionsOf', () => {
  const REG: RegistryEntry[] = [
    { sessionId: 'sid-self', name: 'self', cwd: '/r/Webshop', status: 'busy', kind: 'interactive', pid: 11, startedAt: 1000, updatedAt: 5000, statusUpdatedAt: 4000 },
    { sessionId: 'sid-wait', name: 'waiter', cwd: '/r/Api-Docs', status: 'waiting', kind: 'interactive', pid: 12, startedAt: 2000, updatedAt: 6000, statusUpdatedAt: 5500, waitingFor: 'permission prompt', contextPercent: 55 },
    { sessionId: 'sid-bare', name: 'bare', cwd: '', status: '', kind: 'interactive', pid: 0, startedAt: 0 },
  ]
  const LISTING = { sections: [{ kind: 'sessions', total: 2, rows: [{ name: 'waiter', id: 'ref-w', type: 'session', status: 'waiting' }, { name: 'ghost', id: 'ref-g', type: 'session', status: 'idle' }] }] }
  const base = () => ({
    rows: withSelf(joined(rowsOf(LISTING), REG), REG, 'sid-self'),
    registry: REG, listed: [], listedSeen: {}, titles: {}, models: {}, places: {}, prs: {}, selfId: 'sid-self', away: {},
  })

  test('one session per listed row, the own session first, then registry entries with no row; ids are phase-1 card ids', () => {
    const out = sessionsOf(base())
    expect(out.map(s => [s.id, s.prefId, s.sessionId, s.name, s.isSelf])).toEqual([
      ['sid-self', 'sid-self', 'sid-self', 'self', true],
      ['ref-w', 'sid-wait', 'sid-wait', 'waiter', false],
      ['ref-g', 'ref-g', undefined, 'ghost', false],
      ['sid-bare', 'sid-bare', 'sid-bare', 'bare', false],
    ])
  })

  test('the status time stays at its last start while the word is unchanged (live defect D4)', () => {
    const steady = sessionsOf({ ...base(), since: { 'sid-self': { status: 'busy', at: 1500 }, 'sid-wait': { status: 'idle', at: 10 } } })
    expect(steady.find(s => s.prefId === 'sid-self')?.statusSince).toBe(1500)
    expect(steady.find(s => s.prefId === 'sid-wait')?.statusSince).toBe(5500)
    expect(sessionsOf(base()).find(s => s.prefId === 'sid-self')?.statusSince).toBe(4000)
  })

  test('a listed session that neither the rows nor the registry know is added; background never arrives', () => {
    const listed = agentsJsonOf(AGENTS_JSON)
    const out = sessionsOf({ ...base(), listed })
    expect(out.map(s => s.id)).toContain('197c1f04')
    expect(out.map(s => s.id)).toContain('92558725')
    expect(out.map(s => s.id)).not.toContain('cfa4b1dd-4b1a')
  })

  test('values come from their sources and nothing is invented: a bare session has no model, PR, branch, percent or reason', () => {
    const bare = sessionsOf(base()).find(s => s.id === 'sid-bare')!
    expect(bare).toEqual({ id: 'sid-bare', prefId: 'sid-bare', sessionId: 'sid-bare', name: 'bare', activityAt: 0, raw: '', sharedRaw: '', statusSince: 0, title: 'bare', project: '', isSelf: false })
    for (const key of ['model', 'pr', 'branch', 'contextPercent', 'reason', 'away', 'cwd', 'pid', 'startedAt'] as const) expect(key in bare).toBe(false)
  })

  test('model, branch, PR, reason, away and activity are filled where a source reports them', () => {
    const out = sessionsOf({
      ...base(),
      titles: { 'sid-wait': { at: 6000, title: 'Review the PR', isAi: true } },
      models: { 'sid-wait': 'opus' },
      places: { '/r/Api-Docs': { at: 6000, branch: 'main', project: 'Api-Docs' } },
      prs: { '/r/Api-Docs\u0000main': 42, '/r/Api-Docs\u0000other': 7 },
      away: { 'ref-w': 'tmux' },
    })
    const waiter = out.find(s => s.id === 'ref-w')!
    expect(waiter).toEqual({
      // sharedSince, the registry's status time, claims a chime alike in every pane.
      id: 'ref-w', prefId: 'sid-wait', sessionId: 'sid-wait', name: 'waiter', cwd: '/r/Api-Docs', pid: 12, startedAt: 2000, activityAt: 6000, raw: 'waiting', sharedRaw: 'waiting', statusSince: 5500, sharedSince: 5500,
      reason: 'permission prompt', title: 'Review the PR', project: 'Api-Docs', branch: 'main', model: 'opus', pr: 42, contextPercent: 55, isSelf: false, away: 'tmux',
    })
  })

  // soft limit: the colour measures tokens against it
  test('context tokens: transcript tokens for others; the own count follows the live percentage when its window is known', () => {
    const contexts = { 'sid-wait': { tokens: 120_000, model: 'claude-opus-5-5' } }
    expect(sessionsOf({ ...base(), contexts }).find(s => s.id === 'ref-w')!.contextTokens).toBe(120_000)
    expect('contextTokens' in sessionsOf(base()).find(s => s.id === 'ref-w')!).toBe(false)
    const self = sessionsOf(base()).find(s => s.isSelf)!
    const selfSid = self.sessionId ?? self.id
    const own = sessionsOf({ ...base(), selfContext: 20, contexts: { [selfSid]: { tokens: 1, model: 'm' } }, windows: { m: 1_000_000 } }).find(s => s.isSelf)!
    expect(own.contextTokens).toBe(200_000)
  })
  // the default soft limit follows the context window (100k up to 200k, 300k above).
  test('context window: the own session takes it from session usage, another from its model; unknown, none', () => {
    const self = sessionsOf(base()).find(s => s.isSelf)!
    const selfSid = self.sessionId ?? self.id
    const contexts = { [selfSid]: { tokens: 1, model: 'm' }, 'sid-wait': { tokens: 1, model: 'big' } }
    const out = sessionsOf({ ...base(), contexts, windows: { m: 200_000, big: 1_000_000 }, selfWindow: 1_000_000 })
    expect(out.find(s => s.isSelf)!.contextWindow).toBe(1_000_000)
    // review P3: a plain id names a 200k and a 1M window alike; another session's large window needs the `[1m]` marker.
    expect('contextWindow' in out.find(s => s.id === 'ref-w')!).toBe(false)
    const marked = sessionsOf({ ...base(), contexts: { 'sid-wait': { tokens: 1, model: 'big[1m]' } }, windows: { 'big[1m]': 1_000_000 } })
    expect(marked.find(s => s.id === 'ref-w')!.contextWindow).toBe(1_000_000)
    const small = sessionsOf({ ...base(), contexts: { 'sid-wait': { tokens: 1, model: 'big' } }, windows: { big: 200_000 } })
    expect(small.find(s => s.id === 'ref-w')!.contextWindow).toBe(200_000)
    expect(sessionsOf({ ...base(), contexts, windows: { m: 200_000 } }).find(s => s.isSelf)!.contextWindow).toBe(200_000)
    expect('contextWindow' in sessionsOf(base()).find(s => s.id === 'ref-w')!).toBe(false)
  })
  test('context: the own session uses the live value, another session only a registry value', () => {
    const out = sessionsOf({ ...base(), selfContext: 71 })
    expect(out.find(s => s.isSelf)!.contextPercent).toBe(71)
    expect(out.find(s => s.id === 'ref-w')!.contextPercent).toBe(55)
    expect('contextPercent' in out.find(s => s.id === 'ref-g')!).toBe(false)
    expect('contextPercent' in sessionsOf(base()).find(s => s.isSelf)!).toBe(false)
  })
  // another session's percent comes from its transcript tokens over the window Claude Code reported for the same model.
  test('context: another session shows its transcript tokens over a known window for its model, else nothing', () => {
    expect(percentOf({ tokens: 364053, model: 'claude-opus-5-5' }, { 'claude-opus-5-5': 1_000_000 })).toBe(36)
    expect(percentOf({ tokens: 364053, model: 'claude-haiku-5-5' }, { 'claude-opus-5-5': 1_000_000 })).toBeUndefined()
    expect(percentOf(undefined, { 'claude-opus-5-5': 1_000_000 })).toBeUndefined()
    expect(percentOf({ tokens: 10, model: 'm' }, undefined)).toBeUndefined()
  })

  test('the title is the generated title, else the last prompt, else the name', () => {
    const titles = { 'sid-self': { at: 1, title: 'Generated', isAi: true }, 'sid-wait': { at: 1, title: 'last prompt line' } }
    const out = sessionsOf({ ...base(), titles })
    expect(out.map(s => s.title)).toEqual(['Generated', 'last prompt line', 'ghost', 'bare'])
  })

  test('edge "sources disagree": the agent list says idle after the registry said busy, so idle wins from the observed time', () => {
    const listed = [{ sessionId: 'sid-self', cwd: '/r/Webshop', name: 'self', raw: 'idle', kind: 'interactive', startedAt: 1000 }]
    const newer = sessionsOf({ ...base(), listed, listedSeen: { 'sid-self': { raw: 'idle', observedAt: 4500 } } }).find(s => s.isSelf)!
    expect([newer.raw, newer.statusSince]).toEqual(['idle', 4500])
    const older = sessionsOf({ ...base(), listed, listedSeen: { 'sid-self': { raw: 'idle', observedAt: 3500 } } }).find(s => s.isSelf)!
    expect([older.raw, older.statusSince]).toEqual(['busy', 4000])
    const unseen = sessionsOf({ ...base(), listed }).find(s => s.isSelf)!
    expect(unseen.raw).toBe('busy')
  })

  test('edge "session list unreadable": only a name, nothing else, still gives a card', () => {
    const out = sessionsOf({ ...base(), rows: [{ id: 'x1', name: 'only-a-name', kind: 'sessions', type: 'session', status: '' }], registry: [] })
    expect(out).toEqual([{ id: 'x1', prefId: 'x1', name: 'only-a-name', activityAt: 0, raw: '', sharedRaw: '', statusSince: 0, title: 'only-a-name', project: '', isSelf: false }])
  })
  // the background drop reads the registry's own word, which the merge can hide.
  test('sharedRaw keeps the registry word when a newer listed word wins the merge', () => {
    const b = base()
    const entry = b.registry.find(one => one.sessionId === 'sid-wait')!
    const out = sessionsOf({ ...b, registry: b.registry.map(one => (one === entry ? { ...one, status: 'shell' } : one)), listedSeen: { 'sid-wait': { raw: 'idle', observedAt: 9_999_999 } } })
    const waiter = out.find(s => s.prefId === 'sid-wait')!
    expect(waiter.sharedRaw).toBe('shell')
  })
})

// ---- lifecycle, snooze, order, persistence, captions ----------

describe('shelves', () => {
  const at = (over: Partial<Session> = {}) => S({ id: 'x', ...over })
  const shelf = (status: Status, entry?: Entry, over: Partial<Session> = {}, finishedAt?: number) => shelfOf(at(over), status, entry, finishedAt, NOW, true)

  test('a pin wins whatever the status', () => {
    for (const status of ['working', 'needs-you', 'done', 'idle'] as const) expect(shelf(status, { isPinned: true })).toBe('pinned')
  })
  test('needs-you is Active, working is Working, and a working session that asks goes to Active', () => {
    expect(shelf('needs-you')).toBe('active')
    expect(shelf('working')).toBe('working')
    expect(shelf('needs-you', { isParked: true })).toBe('active')
    expect(shelf('working', { isSettled: true })).toBe('working')
  })
  test('idle for 6 hours is Inactive, 5h59m is Active; a user placement keeps it where it is', () => {
    expect(INACTIVE_AFTER_MS).toBe(6 * HOUR)
    expect(shelf('idle', undefined, { activityAt: NOW - 6 * HOUR })).toBe('inactive')
    expect(shelf('idle', undefined, { activityAt: NOW - 6 * HOUR + 1 })).toBe('active')
    expect(shelf('idle', undefined, { activityAt: NOW - (5 * HOUR + 59 * MIN) })).toBe('active')
    const old = { activityAt: NOW - 7 * HOUR }
    expect(shelf('idle', { isPinned: true }, old)).toBe('pinned')
    expect(shelf('idle', { snoozedUntil: NOW + HOUR, snoozedAt: NOW - HOUR }, old)).toBe('snoozed')
    expect(shelf('idle', { isParked: true, parkedAt: NOW - 7 * HOUR }, old)).toBe('parked')
    expect(shelf('idle', { isSettled: true, settledAt: NOW - 7 * HOUR }, old)).toBe('settled')
  })
  test('an idle session of 1 hour and a done session are Active; an unknown activity time is never Inactive', () => {
    expect(shelf('idle', undefined, { activityAt: NOW - HOUR })).toBe('active')
    expect(shelf('done', undefined, { activityAt: NOW - 9 * HOUR }, NOW - 9 * HOUR)).toBe('active')
    expect(shelf('idle', undefined, { activityAt: 0 })).toBe('active')
  })
  test('unpinning returns a working card to Working', () => {
    expect(shelf('working', applyAction({ isPinned: true }, 'pin', NOW))).toBe('working')
  })

  test('with the Working shelf off (the default), live work stays in Active; the other rules hold', () => {
    const off = (status: Status, entry?: Entry) => shelfOf(at(), status, entry, undefined, NOW)
    expect(off('working')).toBe('active')
    expect(shelfOf(at(), 'working', undefined, undefined, NOW, false)).toBe('active')
    expect(off('working', { isPinned: true })).toBe('pinned')
    expect(off('working', { isParked: true, parkedAt: NOW - HOUR })).toBe('active')
    expect(off('working', { isSettled: true, settledAt: NOW - HOUR })).toBe('active')
    expect(off('needs-you')).toBe('active')
    expect(off('idle', { isParked: true, parkedAt: NOW - HOUR })).toBe('parked')
    expect(off('idle', { snoozedUntil: NOW + HOUR, snoozedAt: NOW - HOUR })).toBe('snoozed')
  })
})

describe('snooze and wake', () => {
  const TUE_10 = new Date(2026, 9, 20, 10, 0).getTime()
  const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

  test('five presets in order', () => {
    expect(SNOOZE_LABELS).toEqual(['1 hour', '5 hours', 'This evening', 'Tomorrow morning', 'Next week'])
    expect(snoozeOptionsAt(TUE_10).map(one => one.label)).toEqual([...SNOOZE_LABELS])
  })
  test('wake times on a Tuesday 10:00', () => {
    expect(snoozeOptionsAt(TUE_10).map(one => one.wake)).toEqual([TUE_10 + HOUR, TUE_10 + 5 * HOUR, local(20, 18), local(21, 9), local(26, 9)])
  })
  test('on a Monday 10:00 next week is a week away; on a Sunday 20:00 it is the next day', () => {
    const monday = new Date(2026, 9, 19, 10, 0).getTime()
    expect(snoozeOptionsAt(monday).at(-1)!.wake).toBe(local(26, 9))
    const sunday = new Date(2026, 9, 18, 20, 0).getTime()
    const options = snoozeOptionsAt(sunday)
    expect(options.map(one => one.label)).toEqual(['1 hour', '5 hours', 'Tomorrow morning', 'Next week'])
    expect(options.at(-1)!.wake).toBe(local(19, 9))
    expect(options.at(-2)!.wake).toBe(local(19, 9))
  })
  test('This evening is offered at 17:59 and not at 18:00 or 18:01', () => {
    const has = (hour: number, minute: number) => snoozeOptionsAt(local(20, hour, minute)).some(one => one.label === 'This evening')
    expect([has(17, 59), has(18, 0), has(18, 1)]).toEqual([true, false, false])
  })

  test('a snoozed card wakes by timer, with Woke; early when the session works or asks', () => {
    const entry: Entry = { snoozedUntil: NOW + 5 * HOUR, snoozedAt: NOW }
    expect(wakeOf(entry, 'idle', NOW + 5 * HOUR - 1)).toBeNull()
    expect(wakeOf(entry, 'idle', NOW + 5 * HOUR)).toBe('timer')
    expect(wakeOf(entry, 'working', NOW + MIN)).toBe('attention')
    expect(wakeOf(entry, 'needs-you', NOW + MIN)).toBe('attention')
    expect(wakeOf(undefined, 'needs-you', NOW)).toBeNull()
    expect(wakeOf({ isPinned: true }, 'idle', NOW)).toBeNull()
    expect(isWoke(entry, 'idle', NOW + 5 * HOUR)).toBe(true)
    expect(isWoke(entry, 'idle', NOW + HOUR)).toBe(false)
    expect(isWoke({ ...entry, wokeAt: NOW + 2 * HOUR }, 'idle', NOW + 3 * HOUR)).toBe(true)
    const s = S({ id: 'z', activityAt: NOW - 20 * DAY })
    expect(shelfOf(s, 'idle', entry, undefined, NOW + HOUR)).toBe('snoozed')
    expect(shelfOf(s, 'idle', entry, undefined, NOW + 5 * HOUR)).toBe('active')
    expect(shelfOf(s, 'working', entry, undefined, NOW + HOUR, true)).toBe('working')
    expect(shelfOf(s, 'needs-you', entry, undefined, NOW + HOUR)).toBe('active')
  })

  test('edge "snooze across restart": a stored snooze whose wake passed is back, with Woke, and reconcile records it once', () => {
    const entry: Entry = { snoozedUntil: NOW - HOUR, snoozedAt: NOW - 3 * HOUR }
    const s = S({ id: 'z' })
    const patches = reconcile([s], { z: 'idle' }, { z: entry }, {}, NOW)
    expect(patches).toEqual([{ key: 'pref:z', entry: { ...entry, wokeAt: NOW, seenAt: NOW } }])
    const again = reconcile([s], { z: 'idle' }, { z: patches[0]!.entry! }, {}, NOW + MIN)
    expect(again).toEqual([])
  })

  test('pressing clears Woke and Done', () => {
    const woke: Entry = { snoozedUntil: NOW - HOUR, snoozedAt: NOW - 3 * HOUR, wokeAt: NOW - HOUR }
    const acked = applyAction(woke, 'ack', NOW)!
    expect(acked).toEqual({ ackAt: NOW })
    expect(isWoke(acked, 'idle', NOW)).toBe(false)
    expect(statusOf('idle', 0, NOW - 10 * MIN, undefined)).toBe('done')
    expect(statusOf('idle', 0, NOW - 10 * MIN, acked.ackAt)).toBe('idle')
  })

  test('edge "pinned and snoozed": snoozing a pinned card unpins it; pinning again clears the snooze', () => {
    const snoozed = applyAction({ isPinned: true }, { snooze: NOW + HOUR }, NOW)!
    expect(snoozed).toEqual({ snoozedUntil: NOW + HOUR, snoozedAt: NOW })
    expect(applyAction(snoozed, 'pin', NOW + MIN)).toEqual({ isPinned: true })
  })
})

describe('park and settle', () => {
  const s = S({ id: 'p', activityAt: NOW - HOUR })
  test('a parked card returns when the session works, asks or finishes, and not on other events', () => {
    const parked = applyAction(undefined, 'park', NOW - HOUR)!
    expect(parked).toEqual({ isParked: true, parkedAt: NOW - HOUR })
    expect(shelfOf(s, 'idle', parked, undefined, NOW)).toBe('parked')
    expect(shelfOf(s, 'idle', parked, NOW - 2 * HOUR, NOW)).toBe('parked')
    expect(shelfOf({ ...s, title: 'changed' }, 'idle', parked, undefined, NOW)).toBe('parked')
    expect(shelfOf(s, 'working', parked, undefined, NOW, true)).toBe('working')
    expect(shelfOf(s, 'needs-you', parked, undefined, NOW)).toBe('active')
    expect(shelfOf(s, 'done', parked, NOW - 30 * MIN, NOW)).toBe('active')
  })
  test('a settled card returns on the same three events', () => {
    const settled = applyAction(undefined, 'settle', NOW - HOUR)!
    expect(settled).toEqual({ isSettled: true, settledAt: NOW - HOUR })
    expect(shelfOf(s, 'idle', settled, undefined, NOW)).toBe('settled')
    expect(shelfOf(s, 'working', settled, undefined, NOW, true)).toBe('working')
    expect(shelfOf(s, 'needs-you', settled, undefined, NOW)).toBe('active')
    expect(shelfOf(s, 'done', settled, NOW - 30 * MIN, NOW)).toBe('active')
  })
  test('returnedOf: working, needs-you, or done after the filing time', () => {
    expect([returnedOf(100, 'working', undefined), returnedOf(100, 'needs-you', undefined), returnedOf(100, 'idle', 500), returnedOf(100, 'done', 99), returnedOf(100, 'done', 101), returnedOf(undefined, 'done', 1)]).toEqual([true, true, false, false, true, true])
  })
  test('reconcile drops park and settle once the session returned, and stamps seenAt on an existing entry only', () => {
    const entries: Record<string, Entry> = { p: { isParked: true, parkedAt: NOW - HOUR, seenAt: NOW - 10 }, q: { isSettled: true, settledAt: NOW - HOUR, seenAt: NOW - 10 }, r: { isPinned: true, seenAt: NOW - 2 * DAY } }
    const sessions = ['p', 'q', 'r', 'none'].map(id => S({ id }))
    const out = reconcile(sessions, { p: 'working', q: 'idle', r: 'idle', none: 'idle' }, entries, {}, NOW)
    expect(out).toEqual([
      { key: 'pref:p', entry: { seenAt: NOW - 10 } },
      { key: 'pref:r', entry: { isPinned: true, seenAt: NOW } },
    ])
    expect(SEEN_STAMP_MS).toBe(DAY)
    expect(reconcile([S({ id: 'r' })], { r: 'idle' }, { r: { isPinned: true, seenAt: NOW - DAY + 1 } }, {}, NOW)).toEqual([])
    expect(reconcile([S({ id: 'r' })], { r: 'idle' }, { r: { isPinned: true } }, {}, NOW)).toEqual([{ key: 'pref:r', entry: { isPinned: true, seenAt: NOW } }])
  })
  test('applyAction: pin, park and settle toggle and exclude each other; an empty entry is deleted', () => {
    expect(applyAction(undefined, 'pin', NOW)).toEqual({ isPinned: true })
    expect(applyAction({ isPinned: true }, 'pin', NOW)).toBeUndefined()
    expect(applyAction({ isPinned: true }, 'park', NOW)).toEqual({ isParked: true, parkedAt: NOW })
    expect(applyAction({ isParked: true, parkedAt: 5 }, 'settle', NOW)).toEqual({ isSettled: true, settledAt: NOW })
    expect(applyAction({ isParked: true, parkedAt: 5 }, 'park', NOW)).toBeUndefined()
    expect(applyAction({ isSettled: true, settledAt: 5 }, 'pin', NOW)).toEqual({ isPinned: true })
    expect(applyAction({ isPinned: true, seenAt: 9 }, 'pin', NOW)).toEqual({ seenAt: 9 })
    expect(applyAction({ isPinned: true }, 'ack', NOW)).toEqual({ isPinned: true, ackAt: NOW })
  })
  test('settled cards order by settledAt, latest first (settle A, B, C gives C, B, A)', () => {
    const cards = ['A', 'B', 'C'].map((id, index) => ({ s: S({ id }), status: 'idle' as const, entry: { isSettled: true as const, settledAt: NOW + index * MIN } }))
    expect(orderShelf('settled', cards, 'recent', { v: 1, active: [], pinned: [] })).toEqual(['C', 'B', 'A'])
  })
})

describe('offered actions', () => {
  test('Pin always; Snooze, Park, Settle only for idle and done', () => {
    expect(offeredActions('idle', 'active')).toEqual(['pin', 'snooze', 'park', 'settle'])
    expect(offeredActions('done', 'active')).toEqual(['pin', 'snooze', 'park', 'settle'])
    expect(offeredActions('working', 'working')).toEqual(['pin'])
    expect(offeredActions('needs-you', 'active')).toEqual(['pin'])
  })
  // Manual sort removed (no practical ordering in a terminal without drag and drop); only Pinned moves
  test('Move up and down: pinned cards only', () => {
    expect(offeredActions('working', 'pinned')).toEqual(['pin', 'move-up', 'move-down'])
    expect(offeredActions('needs-you', 'pinned')).toEqual(['pin', 'move-up', 'move-down'])
    expect(offeredActions('idle', 'active')).toEqual(['pin', 'snooze', 'park', 'settle'])
    expect(offeredActions('idle', 'inactive')).toEqual(['pin', 'snooze', 'park', 'settle'])
  })
})

describe('order', () => {
  const LAYOUT: Layout = { v: 1, active: [], pinned: [] }
  const entry = (id: string, status: Status, over: Partial<Session> = {}) => ({ s: S({ id, ...over }), status })
  const MIXED = [
    entry('a', 'idle', { activityAt: 400, startedAt: 10, project: 'Zeta' }),
    entry('b', 'idle', { activityAt: 900, startedAt: 30, project: 'alpha' }),
    entry('c', 'idle', { activityAt: 100, startedAt: 40, project: 'Zeta' }),
    entry('d', 'idle', { activityAt: 700, startedAt: 20, project: 'alpha' }),
  ]

  test('the default is recent activity, newest first', () => {
    expect(orderShelf('active', MIXED, 'recent', LAYOUT)).toEqual(['b', 'd', 'a', 'c'])
  })
  test('date created is by start, newest first', () => {
    expect(orderShelf('active', MIXED, 'created', LAYOUT)).toEqual(['c', 'b', 'd', 'a'])
  })
  test('project groups run alphabetically, newest activity first inside', () => {
    expect(orderShelf('active', MIXED, 'project', LAYOUT)).toEqual(['b', 'd', 'a', 'c'])
    const more = [...MIXED, entry('e', 'idle', { activityAt: 950, project: 'Mid' })]
    expect(orderShelf('active', more, 'project', LAYOUT)).toEqual(['b', 'd', 'e', 'a', 'c'])
  })
  // Manual sort removed (no practical ordering in a terminal without drag and drop); only Pinned moves
  test('a saved Active order no longer changes the sort', () => {
    expect(orderShelf('active', MIXED, 'recent', { v: 1, active: ['c', 'a', 'd'], pinned: [] })).toEqual(['b', 'd', 'a', 'c'])
  })
  test('moving by one place swaps with the neighbour; the edges are inert', () => {
    const drawn = ['w', 'x', 'y', 'z']
    expect(moved(drawn, 'y', -1)).toEqual(['w', 'y', 'x', 'z'])
    expect(moved(drawn, 'y', 1)).toEqual(['w', 'x', 'z', 'y'])
    expect(moved(drawn, 'w', -1)).toEqual(drawn)
    expect(moved(drawn, 'z', 1)).toEqual(drawn)
    expect(moved(drawn, 'missing', 1)).toEqual(drawn)
  })
  test('pinned follows its layout in every mode; an unknown pin goes on top', () => {
    const pinned = [entry('p1', 'idle', { activityAt: 1 }), entry('p2', 'idle', { activityAt: 2 }), entry('p3', 'working', { activityAt: 3 })]
    for (const mode of ['recent', 'created', 'project'] as const) expect(orderShelf('pinned', pinned, mode, { v: 1, active: [], pinned: ['p2', 'p1'] })).toEqual(['p3', 'p2', 'p1'])
  })
  test('moving the first non-needs-you card up leaves the list unchanged, since needs-you cards are not in it', () => {
    const cards = [entry('n1', 'needs-you', { statusSince: 10 }), entry('n2', 'needs-you', { statusSince: 20 }), ...MIXED]
    const drawn = orderShelf('active', cards, 'recent', { v: 1, active: [], pinned: [] })
    const rest = drawn.filter(id => !id.startsWith('n'))
    expect(drawn.slice(0, 2)).toEqual(['n1', 'n2'])
    expect(moved(rest, rest[0]!, -1)).toEqual(rest)
  })
  test('in every mode no other card sits above a needs-you card', () => {
    const cards = [...MIXED, entry('n1', 'needs-you', { activityAt: 1, startedAt: 1, project: 'Zz' }), entry('n2', 'needs-you', { activityAt: 2, startedAt: 2, project: 'Zz' })]
    for (const mode of ['recent', 'created', 'project'] as SortMode[]) {
      const order = orderShelf('active', cards, mode, { v: 1, active: ['a', 'n1', 'b'], pinned: [] })
      expect(order.slice(0, 2).sort()).toEqual(['n1', 'n2'])
    }
  })
  test('waits of 3, 10 and 1 minutes order 10, 3, 1', () => {
    const cards = [entry('w3', 'needs-you', { statusSince: NOW - 3 * MIN }), entry('w10', 'needs-you', { statusSince: NOW - 10 * MIN }), entry('w1', 'needs-you', { statusSince: NOW - MIN })]
    expect(orderShelf('active', cards, 'recent', LAYOUT)).toEqual(['w10', 'w3', 'w1'])
  })
  test('Working, Inactive, Snoozed and Parked order newest activity first, ties by id', () => {
    const cards = [entry('b', 'idle', { activityAt: 50 }), entry('a', 'idle', { activityAt: 50 }), entry('c', 'idle', { activityAt: 90 }), entry('d', 'idle', { activityAt: 10 })]
    for (const shelf of ['working', 'inactive', 'snoozed', 'parked'] as const) expect(orderShelf(shelf, cards, 'created', LAYOUT)).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('persistence', () => {
  test('defaults when the store is empty', () => {
    const { stored, resetKeys } = loadStored(new Map())
    expect(resetKeys).toEqual([])
    expect(stored).toEqual({ entries: {}, layout: { v: 1, active: [], pinned: [] }, sort: 'recent', collapsed: { ...DEFAULT_COLLAPSED }, settings: { icons: true, theme: 'auto', workingShelf: false } })
    expect(KEYS).toEqual({ shelves: 'shelves', sort: 'sort', layout: 'layout', icons: 'setting:icons', theme: 'setting:theme', workingShelf: 'setting:workingShelf', glyphs: 'setting:glyphs', caption: 'scene:caption', tickets: 'setting:tickets', softLimit: 'setting:softLimit', checkAfter: 'setting:checkAfter', sound: 'setting:sound' })
    expect(PREF_PREFIX).toBe('pref:')
  })

  test('every kind of state reads back', () => {
    const raw = new Map<string, unknown>([
      ['pref:s1', { isPinned: true, seenAt: 9 }], ['pref:s2', { snoozedUntil: 500, snoozedAt: 400, wokeAt: 450 }], ['pref:s3', { isParked: true, parkedAt: 3 }], ['pref:s4', { isSettled: true, settledAt: 4, ackAt: 5 }],
      ['shelves', { settled: false, inactive: false }], ['sort', 'project'], ['layout', { v: 1, active: ['b', 'a'], pinned: ['s1'] }], ['setting:icons', false], ['setting:theme', 'light'], ['setting:workingShelf', true], ['scene:caption', 7],
    ])
    const { stored, resetKeys } = loadStored(raw)
    expect(resetKeys).toEqual([])
    expect(Object.keys(stored.entries).sort()).toEqual(['s1', 's2', 's3', 's4'])
    expect(stored.entries.s2).toEqual({ snoozedUntil: 500, snoozedAt: 400, wokeAt: 450 })
    expect(stored.collapsed).toEqual({ ...DEFAULT_COLLAPSED, settled: false, inactive: false })
    expect([stored.sort, stored.layout, stored.settings, stored.caption]).toEqual(['project', { v: 1, active: ['b', 'a'], pinned: ['s1'] }, { icons: false, theme: 'light', workingShelf: true }, 7])
  })

  test('phase-1 entries stay valid', () => {
    const { stored, resetKeys } = loadStored(new Map<string, unknown>([['pref:old1', { isPinned: true }], ['pref:old2', { isParked: true }], ['shelves', { parked: false }]]))
    expect(resetKeys).toEqual([])
    expect(stored.entries).toEqual({ old1: { isPinned: true }, old2: { isParked: true } })
    expect(stored.collapsed.parked).toBe(false)
  })

  test('garbage in each key lists that key and uses its default', () => {
    const garbage: Array<[string, unknown, (s: Stored) => unknown, unknown]> = [
      ['pref:g', 'text', s => s.entries.g, undefined],
      ['pref:h', { isPinned: 'yes' }, s => s.entries.h, undefined],
      ['pref:i', { seenAt: 'yesterday' }, s => s.entries.i, undefined],
      ['pref:j', null, s => s.entries.j, undefined],
      ['shelves', 'closed', s => s.collapsed, { ...DEFAULT_COLLAPSED }],
      ['sort', 'alphabetical', s => s.sort, 'recent'],
      ['layout', { v: 2, active: [], pinned: [] }, s => s.layout, { v: 1, active: [], pinned: [] }],
      ['setting:icons', 'on', s => s.settings.icons, true],
      ['setting:theme', 'blue', s => s.settings.theme, 'auto'],
      ['setting:workingShelf', 'on', s => s.settings.workingShelf, false],
      ['scene:caption', -3, s => s.caption, undefined],
    ]
    for (const [key, value, read, fallback] of garbage) {
      const { stored, resetKeys } = loadStored(new Map<string, unknown>([[key, value]]))
      expect(resetKeys).toEqual([key])
      expect(read(stored)).toEqual(fallback)
    }
    expect(loadStored(new Map<string, unknown>([['layout', { v: 1, active: [1], pinned: [] }], ['shelves', { active: 'yes' }]])).resetKeys).toEqual(['layout', 'shelves'])
    expect(loadStored(new Map<string, unknown>([['unrelated', 1], ['pref:ok', {}]])).resetKeys).toEqual([])
  })

  // the icon setting persists under `setting:icons`; the old creature key is ignored.
  // Manual sort removed (no practical ordering in a terminal without drag and drop); only Pinned moves
  test('a stored manual sort reads as recent activity without a reset note', () => {
    const { stored, resetKeys } = loadStored(new Map<string, unknown>([['sort', 'manual']]))
    expect([stored.sort, resetKeys]).toEqual(['recent', []])
  })
  test('context windows persist under window:<model>; a bad value is left out and the layout is untouched', () => {
    const raw = new Map<string, unknown>([['window:claude-opus-5-5', 1_000_000], ['window:bad', -3], ['window:half', 1.5], ['sort', 'manual']])
    expect(windowsOf(raw)).toEqual({ 'claude-opus-5-5': 1_000_000 })
    expect(loadStored(raw).resetKeys).toEqual([])
  })
  test('the icon setting persists under setting:icons; setting:creatures is ignored', () => {
    expect(loadStored(new Map<string, unknown>([['setting:icons', false]])).stored.settings.icons).toBe(false)
    const old = loadStored(new Map<string, unknown>([['setting:creatures', false]]))
    expect([old.stored.settings.icons, old.resetKeys]).toEqual([true, []])
  })

  // settings are `/bridge` arguments, parsed by paneSettingOf.
  test('paneSettingOf reads every valid /bridge setting form', () => {
    expect(paneSettingOf('icons on')).toEqual({ key: KEYS.icons, value: true, label: 'Project icons: on' })
    expect(paneSettingOf('icons off')).toEqual({ key: KEYS.icons, value: false, label: 'Project icons: off' })
    expect(paneSettingOf('working-shelf on')).toEqual({ key: KEYS.workingShelf, value: true, label: 'Working shelf: on' })
    expect(paneSettingOf('working-shelf off')).toEqual({ key: KEYS.workingShelf, value: false, label: 'Working shelf: off' })
    for (const mode of ['auto', 'light', 'dark'] as const) expect(paneSettingOf(`theme ${mode}`)).toEqual({ key: KEYS.theme, value: mode, label: `Theme: ${mode}` })
    for (const mode of ['auto', 'nerd', 'plain'] as const) expect(paneSettingOf(`glyphs ${mode}`)).toEqual({ key: KEYS.glyphs, value: mode, label: `Glyphs: ${mode}` })
    expect(loadStored(new Map<string, unknown>([['setting:glyphs', 'plain']])).stored.settings.glyphs).toBe('plain')
  })
  test('paneSettingOf ignores case and extra spaces', () => {
    expect(paneSettingOf('  ICONS   Off ')).toEqual({ key: KEYS.icons, value: false, label: 'Project icons: off' })
    expect(paneSettingOf('Working-Shelf ON')).toEqual({ key: KEYS.workingShelf, value: true, label: 'Working shelf: on' })
    expect(paneSettingOf('Theme DARK')).toEqual({ key: KEYS.theme, value: 'dark', label: 'Theme: dark' })
  })
  test('empty arguments are no setting (the command opens the pane)', () => {
    expect(paneSettingOf('')).toBeUndefined()
    expect(paneSettingOf('   ')).toBeUndefined()
  })
  // ticket prefixes, as a list of ticket prefixes.
  test('/bridge tickets sets the prefix list, keeps their case and drops duplicates; off clears it', () => {
    expect(paneSettingOf('tickets APP-,OPS-')).toEqual({ key: 'setting:tickets', value: ['APP-', 'OPS-'], label: 'Ticket prefixes: APP-, OPS-' })
    expect(paneSettingOf('tickets APP, APP ,OPS-')).toEqual({ key: 'setting:tickets', value: ['APP', 'OPS-'], label: 'Ticket prefixes: APP, OPS-' })
    expect(paneSettingOf('tickets off')).toEqual({ key: 'setting:tickets', value: [], label: 'Ticket prefixes: off' })
    expect(loadStored(new Map<string, unknown>([['setting:tickets', ['APP-']]])).stored.settings.tickets).toEqual(['APP-'])
    expect(loadStored(new Map<string, unknown>([['setting:tickets', 'APP-']])).resetKeys).toEqual(['setting:tickets'])
    expect('tickets' in loadStored(new Map<string, unknown>([['setting:tickets', []]])).stored.settings).toBe(false)
  })
  // soft limit: the colour measures tokens against it
  test('/bridge soft-limit takes a token count, or off; it persists under setting:softLimit', () => {
    expect(paneSettingOf('soft-limit 150k')).toEqual({ key: 'setting:softLimit', value: 150_000, label: 'Soft limit: 150,000 tokens' })
    expect(paneSettingOf('soft-limit 200000')).toEqual({ key: 'setting:softLimit', value: 200_000, label: 'Soft limit: 200,000 tokens' })
    expect(paneSettingOf('Soft-Limit 1.5M')).toEqual({ key: 'setting:softLimit', value: 1_500_000, label: 'Soft limit: 1,500,000 tokens' })
    expect(paneSettingOf('soft-limit 150 K')).toEqual({ key: 'setting:softLimit', value: 150_000, label: 'Soft limit: 150,000 tokens' })
    expect(paneSettingOf('soft-limit off')).toEqual({ key: 'setting:softLimit', value: 0, label: 'Soft limit: off' })
    expect(softLimitOf('120_000')).toBe(120_000)
    expect('softLimit' in loadStored(new Map()).stored.settings).toBe(false)
    expect(loadStored(new Map<string, unknown>([['setting:softLimit', 200_000]])).stored.settings.softLimit).toBe(200_000)
    expect(loadStored(new Map<string, unknown>([['setting:softLimit', 0]])).stored.settings.softLimit).toBe(0)
    expect(loadStored(new Map<string, unknown>([['setting:softLimit', '150k']])).resetKeys).toEqual(['setting:softLimit'])
    expect(DEFAULT_SOFT_LIMIT).toBe(100_000)
    expect(LARGE_WINDOW_SOFT_LIMIT).toBe(300_000)
  })
  test('APP-84: /bridge check-after takes whole minutes or off; invalid stored values reset to the 15-minute default', () => {
    expect(paneSettingOf('check-after 20')).toEqual({ key: 'setting:checkAfter', value: 20, label: 'Check after: 20 minutes' })
    expect(paneSettingOf('check-after off')).toEqual({ key: 'setting:checkAfter', value: 0, label: 'Check after: off' })
    expect(loadStored(new Map<string, unknown>([['setting:checkAfter', 20]])).stored.settings.checkAfter).toBe(20)
    expect(loadStored(new Map<string, unknown>([['setting:checkAfter', 0]])).stored.settings.checkAfter).toBe(0)
    expect(loadStored(new Map<string, unknown>([['setting:checkAfter', '20']])).resetKeys).toEqual(['setting:checkAfter'])
    expect(DEFAULT_CHECK_AFTER_MINUTES).toBe(15)
  })
  test('any other argument is an error naming every form', () => {
    expect(PANE_ARGS_HINT).toBe('icons on|off · working-shelf on|off · glyphs auto|nerd|plain · theme auto|light|dark · tickets APP-,OPS-|off · soft-limit 100k|off · check-after 15|off · sound on|off')
    for (const bad of ['icons', 'icons maybe', 'theme blue', 'working-shelf', 'creatures off', 'icons on now', 'theme', 'on', 'tickets', 'soft-limit', 'soft-limit lots', 'soft-limit 0', 'soft-limit -5k', 'check-after', 'check-after 0', 'check-after 1.5', 'check-after -5']) {
      expect(paneSettingOf(bad)).toEqual({ error: `Unknown setting. Use: /bridge ${PANE_ARGS_HINT}` })
    }
  })

  test('entries unseen for 30 days are pruned, live ones and unstamped ones are kept', () => {
    expect(PRUNE_AFTER_MS).toBe(30 * DAY)
    const entries = {
      d29: { isPinned: true as const, seenAt: NOW - 29 * DAY }, d30: { isPinned: true as const, seenAt: NOW - 30 * DAY }, d31: { isPinned: true as const, seenAt: NOW - 31 * DAY },
      live: { isPinned: true as const, seenAt: NOW - 90 * DAY }, bare: { isPinned: true as const },
    }
    expect(prunedKeys(entries, new Set(['live']), NOW)).toEqual(['pref:d31'])
  })
})

describe('captions', () => {
  test('the working captions are the fixed list and the empty line is exact', () => {
    expect(ALL_CLEAR).toBe('All clear. Time to touch some grass.')
    expect(WORKING_CAPTIONS.length).toBe(18)
    expect(WORKING_CAPTIONS[0]).toBe("Everyone's busy. Go grab a coffee.")
    expect(new Set(WORKING_CAPTIONS).size).toBe(18)
  })
  test('50 appearances with a seeded random never repeat a caption', () => {
    let seed = 12345
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000)
    let previous: number | undefined
    for (let i = 0; i < 50; i++) {
      const next = nextCaption(previous, random)
      expect(next).not.toBe(previous)
      expect(next >= 0 && next < WORKING_CAPTIONS.length).toBe(true)
      previous = next
    }
  })
  test('every previous index with the extreme random values still differs', () => {
    for (let previous = 0; previous < WORKING_CAPTIONS.length; previous++) for (const value of [0, 0.4999, 0.9999, 1]) expect(nextCaption(previous, () => value)).not.toBe(previous)
    expect(nextCaption(undefined, () => 0)).toBe(0)
    expect(nextCaption(99, () => 0)).toBe(0)
  })
})

// ---- lines, header, view model ---------
// the top line and Next are withdrawn (nextOf removed).

describe('shelf headers', () => {
  // an open shelf ends in an up chevron.
  test('open: name, space, rule, space, up chevron, exactly the width', () => {
    for (const width of [30, 44, 70]) {
      const header = headerOf('Active', 3, false, width)
      expect(header).toBe(`Active ${'─'.repeat(width - 7 - 2)} ⌃`)
      expect(cellWidth(header)).toBe(width)
      expect(header).not.toContain('(')
    }
  })
  // a collapsed shelf ends in a down chevron.
  test('collapsed: the count in brackets and the down chevron', () => {
    for (const width of [30, 44, 70]) {
      const header = headerOf('Settled', 23, true, width)
      expect(header.startsWith('Settled (23) ─')).toBe(true)
      expect(header.endsWith(' ⌄')).toBe(true)
      expect(cellWidth(header)).toBe(width)
    }
  })
  // the extra (the Active sort mark) sits before the chevron.
  test('an extra sits before the chevron and the width stays exact', () => {
    for (const width of [30, 44, 70]) {
      const header = headerOf('Active', 3, false, width, ' ↕')
      expect(header).toBe(`Active ${'─'.repeat(width - 7 - cellWidth(' ↕ ⌃'))} ↕ ⌃`)
      expect(cellWidth(header)).toBe(width)
    }
  })
  test('the rule is at least two cells and the width is exact even when narrow', () => {
    expect(headerOf('Inactive', 12, true, 20)).toMatch(/^Inactive \(12\) ──/)
    for (let width = 4; width <= 40; width++) for (const collapsed of [false, true]) expect(cellWidth(headerOf('Snoozed', 120, collapsed, width))).toBe(width)
  })
})

describe('line widths', () => {
  const LONG = 'x'.repeat(200)
  const CJK = '日本語のとても長いタイトル'.repeat(12)
  const variants: Array<[string, Partial<CardInput>, Partial<Session>]> = [
    ['idle', {}, {}],
    ['working', { status: 'working' }, {}],
    ['needs-you', { status: 'needs-you' }, {}],
    ['needs-you woke', { status: 'needs-you', woke: true }, {}],
    ['done', { status: 'done' }, {}],
    ['woke idle', { woke: true }, {}],
    ['working woke', { status: 'working', woke: true }, {}],
    ['snoozed', { snoozedUntil: NOW + 5 * HOUR }, {}],
    ['away', { status: 'working' }, { away: 'Terminal.app' }],
  ]
  const full: Partial<Session> = { branch: LONG, title: LONG, reason: LONG, model: 'opus', pr: 123456, contextPercent: 88, project: LONG }
  const children = [CHILD('c1', 'working'), CHILD('c2', 'working'), CHILD('c3', 'done')]

  // About 3 s of layout on an idle machine, so it gets 20 s: under load it crossed the default 5 s limit.
  test('every line is exactly the requested width in cells, from 12 to 110, with 200-character texts', { timeoutMs: 20_000 }, () => {
    const wrong: string[] = []
    for (const [name, input, over] of variants) {
      for (let width = 12; width <= 110; width++) {
        for (const text of [full, { ...full, title: CJK, branch: CJK, project: '🔔日本' }]) {
          const c = card({ ...text, ...over, isSelf: true }, { ...input, children })
          for (const [which, segs] of [['line1', line1Of(c, width)], ['line2', line2Of(c, width)], ['line3', line3Of(c, width)], ['one', oneLineOf(c, width)]] as const) {
            if (cells(segs) !== width) wrong.push(`${name} ${which} width ${width}: ${cells(segs)} cells in "${plain(segs)}"`)
            const textWidth = cellWidth(plain(segs.filter(seg => seg.kind === 'text')))
            const spinners = segs.filter(seg => seg.kind === 'spinner').length
            if (textWidth !== width - spinners) wrong.push(`${name} ${which} width ${width}: ${textWidth} text cells beside ${spinners} spinner(s)`)
          }
        }
      }
    }
    expect(wrong).toEqual([])
  })

  test('a short line is padded, not left short', () => {
    const c = card({ project: 'Docs' })
    for (const width of [44, 70]) {
      const segs = line1Of(c, width)
      expect(cells(segs)).toBe(width)
      expect(plain(segs).endsWith('2h')).toBe(true)
    }
  })

  test('narrow lines truncate with an ellipsis', () => {
    const c = card({ title: LONG, project: 'p' })
    expect(plain(line2Of(c, 30))).toBe(`${'x'.repeat(29)}…`)
    expect(plain(line2Of(c, 5))).toBe('xxxx…')
  })
})

// the title is bold on a Done, woken or own card, dim on an Idle card, plain otherwise.
describe('title weight', () => {
  const title = (over: Partial<Session>, extra: Partial<CardInput>) => line2Of(card({ title: 'T', ...over }, extra), 20).find(seg => seg.kind === 'text' && seg.role === 'title')!
  test('bold on a Done card, a woken card and the own card', () => {
    expect(title({}, { status: 'done' })).toMatchObject({ bold: true })
    expect(title({}, { status: 'idle', woke: true })).toMatchObject({ bold: true })
    expect(title({}, { status: 'needs-you', woke: true })).toMatchObject({ bold: true })
    expect(title({ isSelf: true }, { status: 'working' })).toMatchObject({ bold: true })
    expect(title({ isSelf: true }, { status: 'idle' })).toMatchObject({ bold: true })
    for (const status of ['done', 'idle'] as const) expect('dim' in title({ isSelf: true }, { status })).toBe(false)
  })
  test('dim on an Idle card, never bold', () => {
    const seg = title({}, { status: 'idle' })
    expect(seg).toMatchObject({ dim: true })
    expect('bold' in seg).toBe(false)
  })
  test('plain on a Working or Needs-you card', () => {
    for (const status of ['working', 'needs-you'] as const) {
      const seg = title({}, { status })
      expect('bold' in seg).toBe(false)
      expect('dim' in seg).toBe(false)
    }
  })
})

describe('line 1', () => {
  const W = 44
  const line = (over: Partial<Session> = {}, extra: Partial<CardInput> = {}) => plain(line1Of(card(over, extra), W))

  // the project name is muted (no colour); the colour is on the icon.
  test('the project leads muted and the slot ends at the right edge', () => {
    const segs = line1Of(card({ project: 'Api-Docs' }), W)
    expect(segs[0]).toMatchObject({ kind: 'text', text: 'Api-Docs', dim: true, role: 'project' })
    expect('color' in segs[0]!).toBe(false)
    expect(plain(segs).startsWith('Api-Docs ')).toBe(true)
    expect(cells(segs)).toBe(W)
  })
  // the project is never bold, not even on the own card.
  test('the project is never bold, not even on the own card', () => {
    expect('bold' in line1Of(card({ isSelf: true }), W)[0]!).toBe(false)
    expect('bold' in line1Of(card({}), W)[0]!).toBe(false)
  })
  test('working shows the spinner cell, Working in yellow, the age dim', () => {
    const segs = line1Of(card({ statusSince: NOW - 5 * MIN }, { status: 'working' }), W)
    expect(segs.filter(seg => seg.kind === 'spinner').length).toBe(1)
    expect(plain(segs).endsWith('⠋ Working 5m')).toBe(true)
    expect(segs).toContainEqual(expect.objectContaining({ text: ' Working', color: PALETTE.text.yellow }))
    expect(segs).toContainEqual(expect.objectContaining({ text: ' 5m', dim: true }))
  })
  test('plain and Nerd pills keep one-cell caps and a fixed-width shaking bell slot', () => {
    for (const glyphMode of ['plain', 'nerd'] as const) {
      const texts = ([0, 1, 2] as const).map(bell => {
        const segs = line1Of(card({}, { status: 'needs-you', bell, glyphMode }), W)
        const pill = segs.filter(seg => seg.kind === 'text' && seg.role === 'status')
        expect(pill).toHaveLength(1)
        expect(pill[0]).toMatchObject({ color: PALETTE.pill.red.fg, bg: PALETTE.pill.red.bg })
        expect(cells(segs)).toBe(W)
        const caps = segs.filter(seg => seg.kind === 'text' && (seg.text === '▐' || seg.text === '▌' || seg.text === '\ue0b6' || seg.text === '\ue0b4'))
        expect(caps.every(cap => cellWidth(cap.text) === 1 && cap.color === PALETTE.pill.red.bg)).toBe(true)
        return (pill[0] as { text: string }).text
      })
      expect(new Set(texts.map(cellWidth))).toEqual(new Set([cellWidth(texts[0]!)]))
      expect(texts.every(text => text.includes(glyphMode === 'plain' ? '!' : '\uf0f3'))).toBe(true)
      expect(texts.every(text => text.indexOf('Needs you') === 2)).toBe(true)
      // the bell rests left and shakes one cell right only: two distinct frames
      expect([...new Set(texts)]).toHaveLength(2)
    }
    expect(glyphModeOf('auto', 'ghostty')).toBe('nerd')
    expect(glyphModeOf('auto', 'iTerm.app')).toBe('nerd')
    expect(glyphModeOf('auto', 'Apple_Terminal')).toBe('plain')
    expect(glyphModeOf('plain', 'ghostty')).toBe('plain')
    expect(glyphModeOf('nerd', 'someterm')).toBe('nerd')
  })
  test('done is a gray pill with a check', () => {
    const pill = line1Of(card({}, { status: 'done' }), W).find(seg => seg.kind === 'text' && seg.role === 'status')!
    expect(pill).toMatchObject({ text: '✓ Done ', color: PALETTE.pill.gray.fg, bg: PALETTE.pill.gray.bg })
  })
  test('idle shows the age, dim; unknown time shows nothing', () => {
    expect(line({ statusSince: NOW - 59 * MIN })).toMatch(/ 59m$/)
    expect(line({ statusSince: NOW - 5 * MIN })).toMatch(/ 5m$/)
    expect(line({ statusSince: NOW - 20 * DAY })).toMatch(/ 2w$/)
    expect(line1Of(card({ statusSince: NOW - HOUR }), W).at(-1)).toMatchObject({ dim: true })
    expect(line({ statusSince: 0 }).trim()).toBe('proj')
    expect(plain(line1Of(card({ statusSince: 0 }, { status: 'working' }), W)).endsWith('⠋ Working')).toBe(true)
  })
  test('a card in the Snoozed shelf shows the time left, dim', () => {
    const segs = line1Of(card({}, { snoozedUntil: NOW + 5 * HOUR }), W)
    expect(segs.at(-1)).toMatchObject({ text: '5h', dim: true })
    expect(plain(line1Of(card({}, { snoozedUntil: NOW + 4 * HOUR }), W)).endsWith(' 4h')).toBe(true)
  })
  test('Woke in green for idle and done; the pill stays for needs-you; Woke precedes a working slot', () => {
    expect(line1Of(card({}, { woke: true }), W).at(-1)).toMatchObject({ text: 'Woke', color: PALETTE.text.green })
    expect(plain(line1Of(card({}, { woke: true, status: 'done' }), W)).endsWith(' Woke')).toBe(true)
    expect(plain(line1Of(card({}, { woke: true, status: 'needs-you' }), W))).toContain('Needs you')
    expect(plain(line1Of(card({ statusSince: NOW - 5 * MIN }, { woke: true, status: 'working' }), W)).endsWith('Woke ⠋ Working 5m')).toBe(true)
  })
  // the person wants agents, not terminals: a card in another app never names that app.
  test('a card in another app names no terminal app; at a narrow width the project is cut before the slot', () => {
    const wide = line1Of(card({ project: 'Docs', away: 'tmux' }), W)
    expect(plain(wide)).not.toContain('tmux')
    expect(plain(wide).startsWith('Docs ')).toBe(true)
    const slot = '2h'
    expect(plain(line1Of(card({ project: 'Docs', away: 'tmux' }), 12))).toBe(`Docs${' '.repeat(12 - 4 - slot.length)}${slot}`)
    expect(plain(line1Of(card({ project: 'Documentation', away: 'tmux' }), 12))).toBe('Document… 2h')
    expect(plain(line1Of(card({ project: 'Docs', away: 'tmux' }, { status: 'needs-you' }), 20))).not.toContain('tmux')
  })
  test('the slot is never cut while it fits, even when the project goes', () => {
    const text = plain(line1Of(card({ project: 'A very long project name' }, { status: 'needs-you' }), 18))
    expect(text.endsWith('Needs you\u00a0▌')).toBe(true)
    expect(cellWidth(text)).toBe(18)
  })
})

test('a 44-column dock has 42-cell inset lines and full cards have one blank row between them, which half-row edges on a selected card replace', () => {
  expect(ROW_HORIZONTAL_PADDING).toBe(1)
  expect(CARD_GAP_ROWS).toBe(1)
  expect([CARD_EDGE_TOP, CARD_EDGE_BOTTOM]).toEqual(['\u2584', '\u2580'])
  for (const line of [line1Of(card(), 42), line2Of(card(), 42), line3Of(card(), 42)]) expect(cells(line)).toBe(42)
})

// The ticket chip before the title (prefixes from /bridge tickets).
describe('ticket chip', () => {
  const T = ['APP-', 'OPS']
  test('parseTicketId: the title start, then the branch (start or after a slash), then the worktree; boundaries hold', () => {
    expect(parseTicketId({ title: 'APP-84: pane mod', branchName: null, worktreeName: null }, T)).toEqual({ id: 'APP-84', source: 'title', titleRest: 'pane mod' })
    expect(parseTicketId({ title: 'Pane mod', branchName: 'feat/APP-84-pane', worktreeName: null }, T)).toEqual({ id: 'APP-84', source: 'branch', titleRest: null })
    expect(parseTicketId({ title: 'x', branchName: 'main', worktreeName: 'OPS-7' }, T)).toEqual({ id: 'OPS-7', source: 'branch', titleRest: null })
    expect(parseTicketId({ title: 'APP-84x title', branchName: null, worktreeName: null }, T)).toBeNull()
    expect(parseTicketId({ title: 'Mentions APP-84 later', branchName: null, worktreeName: null }, T)).toBeNull()
    expect(parseTicketId({ title: 'APP-84 title', branchName: null, worktreeName: null }, [])).toBeNull()
  })
  test('line 2 shows the id as a muted chip, then the title without the id; nothing without prefixes', () => {
    const fromTitle = line2Of(card({ title: 'APP-84 — Claude pane' }, { tickets: T }), 30)
    expect(fromTitle[1]).toMatchObject({ text: 'APP-84', color: PALETTE.pill.gray.fg, bg: PALETTE.pill.gray.bg })
    expect(plain(fromTitle).replace(/[▐▌]/g, '').replace(/\u00a0/g, ' ').trimEnd()).toBe('APP-84 Claude pane')
    expect(plain(line2Of(card({ title: 'Claude pane', branch: 'ws/APP-84-x' }, { tickets: T }), 30)).replace(/[▐▌]/g, '').replace(/\u00a0/g, ' ').trimEnd()).toBe('APP-84 Claude pane')
    expect(plain(line2Of(card({ title: 'APP-84 Claude pane' }), 30)).trimEnd()).toBe('APP-84 Claude pane')
    expect(line2Of(card({ title: 'APP-84 Claude pane' }), 30)[0]).not.toHaveProperty('bg')
    expect(cells(line2Of(card({ title: 'APP-84 '.repeat(20) }, { tickets: T }), 30))).toBe(30)
  })
})

describe('line 3', () => {
  const kids = (n: number) => Array.from({ length: n }, (_, i) => CHILD(`k${i}`, 'working', i))
  const own = { isSelf: true, branch: 'main', model: 'opus', pr: 42, contextPercent: 70 }
  const l3 = (width: number, over: Partial<Session> = {}, extra: Partial<CardInput> = {}) => plain(line3Of(card({ ...own, ...over }, { children: kids(4), ...extra }), width)).trimEnd()

  // the branch sits at the left; the rest sits right-aligned at the right edge.
  const lr = (width: number, left: string, right: string) => `${left}${' '.repeat(width - cellWidth(left) - cellWidth(right))}${right}`


  test('the branch at the left; badge, model, PR and context right-aligned, in that order', () => {
    expect(l3(60)).toBe(lr(60, '⎇ main', '●●● 4 opus PR #42 70%'))
  })
  test('details drop from the end, one at a time, as the line narrows; the branch lasts longest', () => {
    // right-aligned details, a plain percentage; the drop order is unchanged.
    const steps: Array<[number, string]> = [
      [28, '⎇ main ●●● 4 opus PR #42 70%'], [27, lr(27, '⎇ main', '●●● 4 opus PR #42')], [24, '⎇ main ●●● 4 opus PR #42'], [23, lr(23, '⎇ main', '●●● 4 opus')],
      [17, '⎇ main ●●● 4 opus'], [16, lr(16, '⎇ main', '●●● 4')], [12, '⎇ main ●●● 4'], [11, '⎇ main'], [6, '⎇ main'], [5, '⎇ ma…'], [3, '⎇ …'], [2, ''],
    ]
    for (const [width, expected] of steps) {
      expect(l3(width)).toBe(expected)
      expect(cells(line3Of(card({ ...own }, { children: kids(4) }), width))).toBe(width)
    }
  })
  test('no branch gives no mark; the details stay at the right edge', () => {
    expect(l3(60, { branch: undefined })).toBe(lr(60, '', '●●● 4 opus PR #42 70%'))
    expect(l3(60, { branch: undefined, model: undefined, pr: undefined, contextPercent: undefined }, { children: [] })).toBe('')
  })
  test('one dot per subagent up to three, then the total count', () => {
    expect(l3(60, { model: undefined, pr: undefined, contextPercent: undefined }, { children: kids(2) })).toBe(lr(60, '⎇ main', '●● 2'))
    expect(l3(60, { model: undefined, pr: undefined, contextPercent: undefined }, { children: kids(7) })).toBe(lr(60, '⎇ main', '●●● 7'))
  })
  test('another session has no badge even when the child list is given', () => {
    expect(l3(60, { isSelf: false })).toBe(lr(60, '⎇ main', 'opus PR #42 70%'))
  })
  test('dots take the card-status colour of the most urgent children', () => {
    const segs = line3Of(card(own, { children: [CHILD('a', 'done', 1), CHILD('b', 'working', 2), CHILD('c', 'working', 3), CHILD('d', 'failed', 4)] }), 60)
    expect(segs.filter(seg => seg.kind === 'text' && seg.text === '●').map(seg => (seg as { color?: string }).color)).toEqual([PALETTE.text.red, PALETTE.text.yellow, PALETTE.text.yellow])
  })
  // a plain percentage, muted below 75, orange from 75, red at 100 and above.
  test('context is a plain percentage; muted below 75, orange from 75, red at 100 and above', () => {
    const rows = ([[0, 'dim'], [74, 'dim'], [75, 'orange'], [99, 'orange'], [100, 'red'], [130, 'red']] as const).map(([percent, tone]) => {
      const seg = line3Of(card({ contextPercent: percent }), 40).find(one => one.kind === 'text' && one.text.includes('%'))! as { text: string; color?: string; dim?: boolean }
      return [percent, seg, tone] as const
    })
    for (const [percent, seg, tone] of rows) {
      expect(seg.text).toBe(`${percent}%`)
      if (tone === 'dim') {
        expect(seg.dim).toBe(true)
        expect(seg.color).toBeUndefined()
      } else {
        expect(seg.color).toBe(PALETTE.text[tone])
        expect(seg.dim).toBeUndefined()
      }
    }
  })
  // soft limit: the colour measures tokens against it
  test('with a soft limit and a token count, the colour follows tokens over the limit; the number stays the window percentage', () => {
    const seg = (over: Partial<Session>, softLimit?: number) => line3Of(card({ contextPercent: 15, ...over }, softLimit === undefined ? {} : { softLimit }), 40).find(one => one.kind === 'text' && one.text.includes('%'))! as { text: string; color?: string; dim?: boolean }
    expect(seg({ contextTokens: 150_000 }, 150_000)).toMatchObject({ text: '15%', color: PALETTE.text.red })
    expect(seg({ contextTokens: 112_500 }, 150_000)).toMatchObject({ text: '15%', color: PALETTE.text.orange })
    expect(seg({ contextTokens: 112_499 }, 150_000)).toMatchObject({ text: '15%', dim: true })
    expect(seg({ contextTokens: 150_000 }, 0)).toMatchObject({ text: '15%', dim: true })
    expect(seg({}, 150_000)).toMatchObject({ text: '15%', dim: true })
    expect(seg({ contextTokens: 150_000 })).toMatchObject({ text: '15%', dim: true })
  })
  test('no context value gives no percentage; a source value is shown', () => {
    expect(l3(60, { isSelf: false, contextPercent: undefined })).not.toMatch(/%|▰|▱/)
    expect(l3(60, { isSelf: false, contextPercent: 55 })).toMatch(/ 55%$/)
  })
  // the needs-you reason is no longer drawn on line 3.
  test('a needs-you card shows no reason on line 3, only its details', () => {
    const segs = line3Of(card({ branch: 'main', reason: 'permission prompt' }, { status: 'needs-you' }), 50)
    expect(plain(segs).trimEnd()).toBe('⎇ main')
    expect(plain(segs)).not.toMatch(/permission prompt|input needed|question/)
    expect(plain(line3Of(card({ branch: 'main' }, { status: 'needs-you' }), 50)).trimEnd()).toBe('⎇ main')
    expect(plain(line3Of(card({ branch: 'main', reason: 'permission prompt' }), 50)).trimEnd()).toBe('⎇ main')
  })
  // Woke shows only in line 1's slot, never on line 3.
  test('Woke is never on line 3', () => {
    expect(plain(line3Of(card({ branch: 'main' }, { status: 'needs-you', woke: true }), 50)).trimEnd()).toBe('⎇ main')
    expect(plain(line3Of(card({ branch: 'main' }, { status: 'idle', woke: true }), 50)).trimEnd()).toBe('⎇ main')
  })
  // with no reason on line 3 the branch alone is cut, then dropped.
  test('too narrow: the branch is cut with an ellipsis, then dropped', () => {
    const c = card({ branch: 'feature/a-long-branch', reason: 'permission prompt' }, { status: 'needs-you' })
    expect(plain(line3Of(c, 30)).trimEnd()).toBe('⎇ feature/a-long-branch')
    expect(plain(line3Of(c, 12)).trimEnd()).toBe('⎇ feature/a…')
    expect(plain(line3Of(c, 3)).trimEnd()).toBe('⎇ …')
    expect(plain(line3Of(c, 2)).trimEnd()).toBe('')
  })
})

describe('one-line card', () => {
  test('project, title, slot; Woke before the slot; the title is cut first', () => {
    const c = card({ project: 'Docs', title: 'Fix the cards', statusSince: NOW - 5 * MIN }, { status: 'working' })
    expect(plain(oneLineOf(c, 44))).toBe(`Docs Fix the cards${' '.repeat(44 - 18 - 12)}⠋ Working 5m`)
    expect(plain(oneLineOf(c, 26))).toBe('Docs Fix the…⠋ Working 5m'.replace('…⠋', '… ⠋'))
    expect(plain(oneLineOf({ ...c, woke: true }, 44)).endsWith('Woke ⠋ Working 5m')).toBe(true)
    expect(cells(oneLineOf(c, 20))).toBe(20)
  })
})

describe('child rows', () => {
  test('waiting, then running, then the rest, each newest first', () => {
    const order = sortChildren([CHILD('d1', 'done', 50), CHILD('r1', 'working', 10), CHILD('w1', 'working', 5), CHILD('r2', 'working', 30), CHILD('f1', 'failed', 40), CHILD('i1', 'idle', 60)]).map(child => child.id)
    expect(order).toEqual(['f1', 'r2', 'r1', 'w1', 'i1', 'd1'])
  })
  test('indent, rule, dot, label and glyph-plus-word status', () => {
    const states: Array<[ChildStatus, string, string]> = [['working', PALETTE.text.yellow, 'Working 2m'], ['done', PALETTE.text.gray, '✓ Done'], ['failed', PALETTE.text.red, '✕ Failed'], ['idle', PALETTE.text.gray, '2m']]
    for (const [status, color, shown] of states) {
      const row = childRowOf(CHILD('a', status, 0, NOW - 2 * MIN), 40, NOW, PALETTE)
      expect(plain(row.text)).toContain(shown)
      expect(cells(row.text)).toBe(40)
      expect(row.text.find(seg => seg.kind === 'text' && seg.text === '●')).toMatchObject({ color })
    }
  })
  test('a child engine waiting state uses the yellow Working slot without a row tint', () => {
    const waiting = childrenOf([{ id: 'a', status: 'waiting', description: 'a', type: 'general-purpose' }], [], {}, NOW).list[0]!
    const row = childRowOf(waiting, 40, NOW, PALETTE)
    expect(waiting.status).toBe('working')
    expect(plain(row.text)).toContain('Working')
    expect(row.bg).toBeUndefined()
  })
  test('Done child rows have no caps and 44-column dock rows fit in Nerd and plain modes', () => {
    const done = CHILD('done', 'done', 0, NOW - 5 * HOUR)
    for (const mode of ['nerd', 'plain'] as const) {
      const row = childRowOf(done, 42, NOW, PALETTE, mode)
      expect(plain(row.text)).toContain('✓ Done')
      expect(plain(row.text)).not.toMatch(/[\ue0b4\ue0b6▐▌]/)
      expect(cells(row.text)).toBe(42)
    }
  })
  test('a Needs-you child shakes in a fixed slot without moving its word', () => {
    for (const mode of ['nerd', 'plain'] as const) {
      const rows = ([0, 1, 2] as const).map(bell => plain(childRowOf(CHILD('ask', 'needs-you'), 42, NOW, PALETTE, mode, bell).text))
      expect(rows.map(cellWidth)).toEqual([42, 42, 42])
      expect(rows.map(row => row.indexOf('Needs you'))).toEqual([rows[0]!.indexOf('Needs you'), rows[0]!.indexOf('Needs you'), rows[0]!.indexOf('Needs you')])
      expect([...new Set(rows)]).toHaveLength(2)
    }
  })
  test('a long label is cut and the row keeps the width at every width from 14 up', () => {
    const child = { ...CHILD('a', 'working'), label: '日本語'.repeat(40) }
    for (let width = 14; width <= 80; width++) expect(cells(childRowOf(child, width, NOW, PALETTE).text)).toBe(width)
  })
  test('fitSegs pads a short line and cuts the run that overflows', () => {
    expect(plain(fitSegs([{ kind: 'text', text: 'ab' }], 5))).toBe('ab   ')
    expect(plain(fitSegs([{ kind: 'text', text: 'abcdef' }, { kind: 'text', text: 'zz' }], 4))).toBe('abc…')
    expect(fitSegs([{ kind: 'spinner' }], 0)).toEqual([])
  })
})

describe('paneViewOf', () => {
  const view = (sessions: Session[], over: Partial<Parameters<typeof paneViewOf>[0]> = {}) =>
    paneViewOf({ sessions, stored: loaded(), finished: {}, children: [], now: NOW, width: 44, caps: TRUE_COLOR, bell: 0, palette: PALETTE, projectColors: new Map([['proj', '#88aacc']]), ...over })
  const idle = (id: string, over: Partial<Session> = {}) => S({ id, ...over })
  const ids = (v: ReturnType<typeof view>, shelf: ShelfId) => v.shelves.find(one => one.id === shelf)?.cards.map(one => one.id)

  const ONE_PER_SHELF = [
    idle('pin'), idle('act'), idle('wrk', { raw: 'busy' }), idle('old', { activityAt: NOW - 8 * HOUR }), idle('snz'), idle('prk'), idle('stl'),
  ]
  const ENTRIES: Record<string, Entry> = {
    pin: { isPinned: true }, snz: { snoozedUntil: NOW + 3 * HOUR, snoozedAt: NOW - HOUR }, prk: { isParked: true, parkedAt: NOW - HOUR }, stl: { isSettled: true, settledAt: NOW - HOUR },
  }
  const withEntries = (over: Partial<Stored> = {}) => storedWith({ entries: ENTRIES, ...over })

  test('default open and collapsed shelves, headers with counts only when collapsed', () => {
    const v = view(ONE_PER_SHELF, { stored: withEntries({ settings: SHELF_ON }) })
    expect(v.shelves.map(one => [one.id, one.isCollapsed])).toEqual([['pinned', false], ['active', false], ['working', false], ['inactive', true], ['snoozed', true], ['parked', true], ['settled', true]])
    const header = (id: ShelfId) => v.shelves.find(one => one.id === id)!.header
    expect(header('active')).toBe(headerOf('Active', 1, false, 42, ' ↕')) // the open Active header carries the sort mark
    expect(header('settled')).toBe(headerOf('Settled', 1, true, 42))
    expect(header('settled')).toContain('Settled (1)')
    expect(header('active')).not.toContain('(')
    expect(v.shelves.filter(one => one.isCollapsed).every(one => one.cards.length === 0)).toBe(true)
    expect(v.shelves.filter(one => !one.isCollapsed).every(one => one.cards.length === 1)).toBe(true)
  })
  test('opening a collapsed shelf brings its cards; its header loses the count', () => {
    const opened = { ...DEFAULT_COLLAPSED, settled: false }
    const v = view(ONE_PER_SHELF, { stored: withEntries({ collapsed: opened }) })
    expect(ids(v, 'settled')).toEqual(['stl'])
    expect(v.shelves.find(one => one.id === 'settled')!.header).toBe(headerOf('Settled', 1, false, 42))
  })
  // the default soft limit follows the context window; a stored one wins.
  test('the default soft limit is 100k up to a 200k window or an unknown one, 300k above; a stored limit wins', () => {
    expect([undefined, 0, 200_000, 200_001, 1_000_000].map(defaultSoftLimitOf)).toEqual([100_000, 100_000, 100_000, 300_000, 300_000])
    const tone = (over: Partial<Session>, stored = loaded()) => {
      const card = view([idle('c', { contextPercent: 20, ...over })], { stored }).shelves.flatMap(one => one.cards)[0]!
      const seg = card.lines[2]!.find(one => one.kind === 'text' && one.text.includes('%')) as { color?: string; dim?: boolean }
      return seg.color === PALETTE.text.red ? 'red' : seg.color === PALETTE.text.orange ? 'orange' : seg.dim ? 'dim' : 'other'
    }
    expect(tone({ contextTokens: 200_000, contextWindow: 1_000_000 })).toBe('dim')
    expect(tone({ contextTokens: 240_000, contextWindow: 1_000_000 })).toBe('orange')
    expect(tone({ contextTokens: 80_000, contextWindow: 200_000 })).toBe('orange')
    expect(tone({ contextTokens: 100_000 })).toBe('red')
    expect(tone({ contextTokens: 200_000, contextWindow: 1_000_000 }, loaded([['setting:softLimit', 250_000]]))).toBe('orange')
    expect(tone({ contextTokens: 100_000 }, loaded([['setting:softLimit', 0]]))).toBe('dim')
  })
  test('an empty shelf is not in the view, but Active always is', () => {
    const v = view([idle('only')])
    expect(v.shelves.map(one => one.id)).toEqual(['active'])
    expect(view([]).shelves.map(one => one.id)).toEqual(['active'])
  })
  // an empty Active shelf has no header and is never collapsed; only the scene shows.
  test('an empty Active shelf has no header, no sort and is never collapsed', () => {
    for (const active of [false, true]) {
      const empty = view([], { stored: storedWith({ collapsed: { ...DEFAULT_COLLAPSED, active } }) }).shelves[0]!
      expect([empty.id, empty.hasHeader, empty.isCollapsed, empty.hasSort, empty.cards.length]).toEqual(['active', false, false, false, 0])
      expect(empty.sortMenu).toBeUndefined()
    }
    expect(view([idle('a')]).shelves[0]!.hasHeader).toBe(true)
  })
  test('through the view: pinned wins, needs-you is Active above idle, working is Working', () => {
    const v = view([idle('a'), idle('n', { raw: 'waiting', statusSince: NOW - MIN }), idle('w', { raw: 'busy' }), idle('p', { raw: 'busy' })], { stored: storedWith({ settings: SHELF_ON, entries: { p: { isPinned: true } } }) })
    expect(ids(v, 'pinned')).toEqual(['p'])
    expect(ids(v, 'active')).toEqual(['n', 'a'])
    expect(ids(v, 'working')).toEqual(['w'])
    expect(v.needYou).toBe(1)
  })

  test('with the Working shelf off, a working card is a full Active card with the Working slot; no Working shelf', () => {
    const mono = { kind: 'monogram', letter: 'P', text: 'P ', color: '#88aacc', ink: '#000000' }
    const v = view([idle('a'), idle('w', { raw: 'busy', statusSince: NOW - 5 * MIN, branch: 'main' })])
    expect(v.shelves.map(one => one.id)).toEqual(['active'])
    expect(v.scene).toBeUndefined()
    const w = v.shelves[0]!.cards.find(one => one.id === 'w')!
    expect([w.shelf, w.form, w.lines.length, w.icon]).toEqual(['active', 'full', 3, mono])
    expect(plain(w.lines[0]!)).toMatch(/^proj\s+⠋ Working 5m$/)
    expect(w.lines[0]!.find(seg => seg.kind === 'text' && seg.text === ' Working')).toMatchObject({ color: PALETTE.text.yellow, role: 'status' })
    expect(w.lines[0]!.find(seg => seg.kind === 'text' && seg.text === ' 5m')).toMatchObject({ dim: true, role: 'status' })
    expect(plain(w.lines[2]!)).toContain('main')
    const on = view([idle('a'), idle('w', { raw: 'busy' })], { stored: storedWith({ settings: SHELF_ON }) })
    expect(on.shelves.map(one => one.id)).toEqual(['active', 'working'])
    expect(on.shelves[1]!.cards[0]!.form).toBe('line')
  })
  test('the sort control sits under the open Active header only', () => {
    const open = view([idle('a')])
    expect(open.shelves.map(one => one.hasSort)).toEqual([true])
    const closed = view([idle('a')], { stored: storedWith({ collapsed: { ...DEFAULT_COLLAPSED, active: true } }) })
    expect(closed.shelves[0]!.hasSort).toBe(false)
    expect(closed.shelves[0]!.header).toContain('Active (1)')
    expect(open.shelves[0]!.header.endsWith(' ↕ ⌃')).toBe(true)
    expect(closed.shelves[0]!.header).not.toContain('↕')
  })
  // the sort menu opens under the open, non-empty Active header only.
  test('the sort menu shows only when asked, on the open Active header', () => {
    expect(view([idle('a')]).shelves[0]!.sortMenu).toBeUndefined()
    expect(view([idle('a')], { sortOpen: true }).shelves[0]!.sortMenu).toBe(true)
    const closed = view([idle('a')], { sortOpen: true, stored: storedWith({ collapsed: { ...DEFAULT_COLLAPSED, active: true } }) })
    expect(closed.shelves[0]!.sortMenu).toBeUndefined()
    expect(view([], { sortOpen: true }).shelves[0]!.sortMenu).toBeUndefined()
  })
  test('the sort mode in the store orders Active', () => {
    const sessions = [idle('a', { activityAt: NOW - 3 * HOUR, startedAt: 30 }), idle('b', { activityAt: NOW - MIN, startedAt: 10 }), idle('c', { activityAt: NOW - HOUR, startedAt: 20 })]
    expect(ids(view(sessions), 'active')).toEqual(['b', 'c', 'a'])
    expect(ids(view(sessions, { stored: storedWith({ sort: 'created' }) }), 'active')).toEqual(['a', 'c', 'b'])
    expect(view(sessions, { stored: storedWith({ sort: 'created' }) }).sort).toBe('created')
  })

  // the creature art column became the project icon on line 1.
  const MONO = { kind: 'monogram', letter: 'P', text: 'P ', color: '#88aacc', ink: '#000000' }
  test('Working cards are one line led by the icon; a pinned working card is full', () => {
    const v = view([idle('w', { raw: 'busy' }), idle('p', { raw: 'busy' })], { stored: storedWith({ settings: SHELF_ON, entries: { p: { isPinned: true } } }) })
    const working = v.shelves.find(one => one.id === 'working')!.cards[0]!
    expect([working.form, working.lines.length, working.icon]).toEqual(['line', 1, MONO])
    expect(cells(working.lines[0]!)).toBe(39)
    const pinned = v.shelves.find(one => one.id === 'pinned')!.cards[0]!
    expect([pinned.form, pinned.lines.length, pinned.icon]).toEqual(['full', 3, MONO])
  })
  test('line 1 shrinks by the icon (3 cells); lines 2 and 3 take the full width', () => {
    const lineWidths = (v: ReturnType<typeof view>) => v.shelves[0]!.cards[0]!.lines.map(cells)
    const one = [idle('a')]
    expect(lineWidths(view(one))).toEqual([39, 42, 42])
    expect(lineWidths(view(one, { caps: NO_COLOR_TERM }))).toEqual([39, 42, 42])
    expect(lineWidths(view(one, { stored: storedWith({ settings: { icons: false, theme: 'auto', workingShelf: false } }) }))).toEqual([42, 42, 42])
    expect(view(one, { stored: storedWith({ settings: { icons: false, theme: 'auto', workingShelf: false } }) }).shelves[0]!.cards[0]!.icon).toEqual({ kind: 'none' })
    expect(lineWidths(view(one, { width: 30 }))).toEqual([28, 28, 28])
    const narrow = view(one, { width: 29, stored: storedWith({ settings: { icons: true, theme: 'auto', workingShelf: false } }) })
    expect(lineWidths(narrow)).toEqual([27, 27, 27])
    expect(narrow.settings.icons).toBe(true)
    expect(narrow.shelves[0]!.cards[0]!.icon.kind).toBe('none')
  })
  test('a picture where the terminal draws one and the project has one, else the monogram', () => {
    const icons = new Map([['proj', '/cache/abc.png']])
    const iconOf = (over: Partial<Parameters<typeof paneViewOf>[0]>) => view([idle('a')], { projectIcons: icons, ...over }).shelves[0]!.cards[0]!.icon
    expect(iconOf({})).toEqual({ kind: 'picture', file: '/cache/abc.png', letter: 'P', color: '#88aacc', ink: '#000000' })
    expect(iconOf({ caps: { trueColor: true, pictures: false } })).toEqual(MONO)
    expect(iconOf({ caps: { trueColor: false, pictures: true } })).toEqual(MONO)
    expect(iconOf({ projectIcons: new Map() })).toEqual(MONO)
    expect(iconOf({ stored: storedWith({ settings: { icons: false, theme: 'auto', workingShelf: false } }) })).toEqual({ kind: 'none' })
    expect(iconOf({ width: 29 })).toEqual({ kind: 'none' })
  })
  test('the monogram ink reaches 4.5:1 on the project colour', () => {
    for (const color of ['#88aacc', '#1c1c1c', '#ffcc00', '#5500aa', '#777777']) {
      const icon = view([idle('a')], { projectColors: new Map([['proj', color]]) }).shelves[0]!.cards[0]!.icon
      expect(icon.kind).toBe('monogram')
      if (icon.kind === 'monogram') expect(contrastRatio(icon.ink, color)).toBeGreaterThanOrEqual(4.5)
    }
  })
  test('edge "session list unreadable": a session with no known project gets no icon and no invented project name', () => {
    const bare = view([idle('a', { project: '', title: 'only-a-name' })])
    const card = bare.shelves[0]!.cards[0]!
    expect(card.icon).toEqual({ kind: 'none' })
    expect(card.lines.map(cells)).toEqual([42, 42, 42])
    expect(card.lines[0]!.map(seg => (seg.kind === 'text' ? seg.text : '')).join('')).not.toMatch(/session/)
    expect(card.lines[1]!.find(seg => seg.kind === 'text' && seg.role === 'title')).toMatchObject({ text: 'only-a-name' })
  })
  test('a Done card has a bold title; other cards do not', () => {
    const done = view([idle('x', { title: 'Shipped' })], { finished: { x: NOW - MIN } }).shelves[0]!.cards[0]!
    expect(done.status).toBe('done')
    expect(done.lines[1]!.find(seg => seg.kind === 'text' && seg.role === 'title')).toMatchObject({ bold: true })
    const idleCard = view([idle('x', { title: 'Resting' })]).shelves[0]!.cards[0]!
    expect(idleCard.lines[1]!.find(seg => seg.kind === 'text' && seg.role === 'title')).not.toMatchObject({ bold: true })
  })
  test('only the own card is selected; the view carries the snapped fill', () => {
    const v = view([idle('me', { isSelf: true }), idle('other')])
    const [me, other] = [v.shelves[0]!.cards.find(one => one.id === 'me')!, v.shelves[0]!.cards.find(one => one.id === 'other')!]
    expect([me.isSelected, other.isSelected]).toEqual([true, false])
    // live capture v2: Raster colours reach the screen at 4 bits per channel, so the fill snaps to that grid
    expect(snapToRasterGrid(PALETTE.fill)).toBe('#333344')
    expect(v.selectedFill).toBe(snapToRasterGrid(PALETTE.fill))
  })
  test('a session in another app is dim; every status and list rule is the same', () => {
    const v = view([idle('far', { away: 'tmux' }), idle('near')])
    expect(v.shelves[0]!.cards.map(one => [one.id, one.isDim])).toEqual([['far', true], ['near', false]])
    expect(plain(v.shelves[0]!.cards.find(one => one.id === 'far')!.lines[0]!)).not.toContain('tmux') // no terminal app is named
  })
  test('hover actions and labels follow the status and the stored flags', () => {
    const v = view([idle('i'), idle('w', { raw: 'busy' }), idle('n', { raw: 'waiting' }), idle('p')], { stored: storedWith({ settings: SHELF_ON, entries: { p: { isPinned: true } } }) }) // Manual sort removed (no practical ordering in a terminal without drag and drop); only Pinned moves
    const by = (id: string) => v.shelves.flatMap(one => one.cards).find(one => one.id === id)!
    expect(by('i').actions).toEqual(['pin', 'snooze', 'park', 'settle'])
    expect(by('w').actions).toEqual(['pin'])
    expect(by('n').actions).toEqual(['pin'])
    expect(by('p').actions).toEqual(['pin', 'snooze', 'park', 'settle', 'move-up', 'move-down'])
    expect([by('p').labels.pin, by('i').labels.pin]).toEqual(['Unpin', 'Pin'])
    const parked = view([idle('x')], { stored: storedWith({ entries: { x: { isParked: true, parkedAt: 1 } }, collapsed: { ...DEFAULT_COLLAPSED, parked: false } }) }).shelves.find(one => one.id === 'parked')!.cards[0]!
    expect([parked.labels.park, parked.labels.settle]).toEqual(['Unpark', 'Settle'])
  })
  test('the snooze menu is attached to the open card only', () => {
    const v = view([idle('a'), idle('b')], { snoozeOpen: 'b' })
    const a = v.shelves[0]!.cards.find(one => one.id === 'a')!
    const b = v.shelves[0]!.cards.find(one => one.id === 'b')!
    expect(a.snoozeMenu).toBeUndefined()
    expect(b.snoozeMenu).toEqual(snoozeOptionsAt(NOW))
    expect(b.snoozeMenu!.length).toBe(snoozeOptionsAt(NOW).length)
  })
  test('the Snoozed card shows time left; a woken card is in Active with Woke', () => {
    const v = view([idle('s'), idle('w')], { stored: storedWith({ entries: { s: { snoozedUntil: NOW + 5 * HOUR, snoozedAt: NOW }, w: { snoozedUntil: NOW - 1, snoozedAt: NOW - HOUR } }, collapsed: { ...DEFAULT_COLLAPSED, snoozed: false } }) })
    const snoozed = v.shelves.find(one => one.id === 'snoozed')!.cards[0]!
    expect(plain(snoozed.lines[0]!).endsWith(' 5h')).toBe(true)
    const woke = v.shelves.find(one => one.id === 'active')!.cards[0]!
    expect([woke.id, plain(woke.lines[0]!).endsWith(' Woke')]).toEqual(['w', true])
  })
  test('a finished session is Done until its card is pressed', () => {
    const done = view([idle('x')], { finished: { x: NOW - MIN } })
    expect(done.shelves[0]!.cards[0]!.status).toBe('done')
    expect(plain(done.shelves[0]!.cards[0]!.lines[0]!)).toContain('✓ Done')
    const acked = view([idle('x')], { finished: { x: NOW - MIN }, stored: storedWith({ entries: { x: { ackAt: NOW } } }) })
    expect(acked.shelves[0]!.cards[0]!.status).toBe('idle')
    expect(plain(acked.shelves[0]!.cards[0]!.lines[0]!)).not.toContain('Done')
  })
  // the project colour is on the icon; the name is muted.
  test('project colours come from the map onto the icon; an unknown project falls back to gray', () => {
    const v = view([idle('a', { project: 'proj' }), idle('b', { project: 'other' })])
    const colorOf = (id: string) => v.shelves[0]!.cards.find(one => one.id === id)!.icon.color
    expect([colorOf('a'), colorOf('b')]).toEqual(['#88aacc', PALETTE.text.gray])
    for (const id of ['a', 'b']) expect(v.shelves[0]!.cards.find(one => one.id === id)!.lines[0]![0]).toMatchObject({ dim: true, role: 'project' })
  })

  test('only the own card has child rows; five at most, then +N more', () => {
    const kids = (n: number) => Array.from({ length: n }, (_, i) => CHILD(`k${i}`, i === 0 ? 'failed' : 'working', i))
    const sessions = [idle('me', { isSelf: true }), idle('other')]
    for (const [count, rows, more] of [[0, 0, undefined], [5, 5, undefined], [6, 5, '+1 more'], [8, 5, '+3 more']] as const) {
      const v = view(sessions, { children: kids(count) })
      const me = v.shelves[0]!.cards.find(one => one.id === 'me')!
      const other = v.shelves[0]!.cards.find(one => one.id === 'other')!
      expect(me.children?.rows.length ?? 0).toBe(rows)
      expect(me.children?.more).toBe(more)
      expect(other.children).toBeUndefined()
      expect(plain(other.lines[2]!)).not.toContain('●')
    }
    const v = view(sessions, { children: kids(3) })
    const rows = v.shelves[0]!.cards.find(one => one.id === 'me')!.children!.rows
    expect(rows.map(row => row.id)).toEqual(['k0', 'k2', 'k1'])
    expect(rows.map(row => row.bg)).toEqual([undefined, undefined, undefined])
    expect(rows.every(row => cells(row.text) === 42)).toBe(true)
  })

  test('the scene follows the Active-empty table', () => {
    const none = view([])
    expect(none.scene).toMatchObject({ kind: 'hills', showArt: true, width: 42 })
    expect(none.scene!.caption.trim()).toBe(ALL_CLEAR)
    const spare = 42 - ALL_CLEAR.length
    expect(none.scene!.caption.length).toBe(42)
    expect(Math.abs(none.scene!.caption.search(/\S/) - (spare - none.scene!.caption.search(/\S/)))).toBeLessThanOrEqual(1)

    const working = view([idle('w', { raw: 'busy' })], { caption: 3, stored: storedWith({ settings: SHELF_ON }) })
    expect(working.scene).toMatchObject({ kind: 'working' })
    expect(working.scene!.caption.trim()).toBe(fitCells(WORKING_CAPTIONS[3]!, 42))
    expect(working.scene!.caption.length).toBe(42)
    expect(view([idle('w', { raw: 'busy' })], { stored: storedWith({ caption: 5, settings: SHELF_ON }) }).scene!.caption.trim()).toBe(fitCells(WORKING_CAPTIONS[5]!, 42))

    expect(view([idle('me', { isSelf: true })]).scene).toBeUndefined()
    expect(view([idle('me', { isSelf: true, raw: 'busy' })], { stored: storedWith({ settings: SHELF_ON }) }).scene).toMatchObject({ kind: 'working' })
    expect(view([idle('me', { isSelf: true, raw: 'busy' })]).scene).toBeUndefined()
    expect(view([idle('me', { isSelf: true, raw: 'idle' })], { stored: storedWith({ entries: { me: { isPinned: true } } }) }).scene).toMatchObject({ kind: 'hills' })
    expect(view([idle('a')], { stored: storedWith({ entries: { a: { snoozedUntil: NOW + HOUR, snoozedAt: NOW } } }) }).scene).toMatchObject({ kind: 'hills' })
  })
  // the icon setting no longer hides the scene; 24-bit colour and width do.
  test('other shelves still draw under the scene; art is off without 24-bit colour or width', () => {
    const v = view([idle('a')], { stored: storedWith({ entries: { a: { snoozedUntil: NOW + HOUR, snoozedAt: NOW } } }) })
    expect(v.shelves.map(one => one.id)).toEqual(['active', 'snoozed'])
    expect(view([], { caps: NO_COLOR_TERM }).scene!.showArt).toBe(false)
    expect(view([], { stored: storedWith({ settings: { icons: false, theme: 'auto', workingShelf: false } }) }).scene!.showArt).toBe(true)
    expect(view([], { width: 29 }).scene!.showArt).toBe(false)
    expect(view([], { width: 30 }).scene!.showArt).toBe(false)
    expect(view([], { width: 32 }).scene!.showArt).toBe(true)
    expect(cellWidth(view([], { width: 29 }).scene!.caption)).toBe(27)
    expect(view([], { width: 29 }).scene!.caption.startsWith('All clear.')).toBe(true)
  })

  // no top line draws it, but the view data still counts needs-you sessions.
  test('the view data counts every needs-you session', () => {
    expect(view([idle('a', { raw: 'waiting' }), idle('b', { raw: 'waiting' }), idle('c')]).needYou).toBe(2)
    expect(view([idle('c')]).needYou).toBe(0)
  })

  test('edge "dock narrower": the setting value is unchanged below 30 columns', () => {
    const v = view([idle('a')], { width: 12 })
    expect(v.settings).toEqual({ icons: true, theme: 'auto', workingShelf: false })
    expect(v.shelves[0]!.cards[0]!.lines.every(line => cells(line) === 10)).toBe(true)
  })
})

// the project icon rules, and the background-task count.
describe('project icons and background tasks', () => {
  test('the candidate files are PROJECT_ICON_CANDIDATES, in their order', () => {
    expect([...PROJECT_ICON_CANDIDATES]).toEqual([
      'favicon.svg', 'favicon.ico', 'favicon.png', 'icon.svg', 'icon.png', 'icon.ico',
      'public/favicon.svg', 'public/favicon.ico', 'public/favicon.png',
      'app/favicon.ico', 'app/favicon.png', 'app/icon.svg', 'app/icon.png', 'app/icon.ico',
      'src/favicon.ico', 'src/favicon.svg', 'src/app/favicon.ico', 'src/app/icon.svg', 'src/app/icon.png',
      'assets/icon.svg', 'assets/icon.png', 'assets/logo.svg', 'assets/logo.png', '.idea/icon.svg',
    ])
  })
  test('the monogram letter rule (generic leading words skipped, scope dropped, # when empty)', () => {
    expect(['kiosk-web', 'the-billing', 'my-plugin-tasks', '@scope/web-app', 'myProject', 'the', '---', 'élan'].map(projectMonogramLetter)).toEqual(['K', 'B', 'T', 'W', 'P', 'T', '#', 'É'])
  })
  test('the project folder is the main checkout above a linked git dir, else the working directory', () => {
    expect(projectRootOf('/w/repo/.worktrees/x', '/w/repo/.git')).toBe('/w/repo')
    expect(projectRootOf('/w/repo/sub', '/w/repo/.git/')).toBe('/w/repo')
    expect(projectRootOf('/w/plain', undefined)).toBe('/w/plain')
    expect(projectRootOf('/w/bare-wt', '/w/bare.git')).toBe('/w/bare-wt')
  })
  test('the cache name is stable per file and modification time; sips converts every format, rsvg-convert backs up svg', () => {
    expect(iconCacheNameOf('/p/a/favicon.png', 1000)).toBe(iconCacheNameOf('/p/a/favicon.png', 1000))
    expect(iconCacheNameOf('/p/a/favicon.png', 1000)).not.toBe(iconCacheNameOf('/p/a/favicon.png', 2000))
    expect(iconCacheNameOf('/p/a/favicon.png', 1000)).toMatch(/^[0-9a-f]{8}\.png$/)
    const argv = iconConvertArgv('/c', '/p/a/icon.svg', '/c/x.png')
    expect([argv[0], argv[1], ...argv.slice(3)]).toEqual(['sh', '-c', 'bridge', '/c', '/p/a/icon.svg', '/c/x.png'])
    expect(argv[2]).not.toContain('qlmanage') // Quick Look padded SVGs onto a white page
    expect(argv[2]).toContain('rsvg-convert -w 64 -h 64')
    expect(argv[2]).toContain('sips -s format png -Z 64')
  })
  test('icon limits: a source over 1 MB is skipped; a raster over 1024 px a side is refused before converting, an svg is not measured', () => {
    expect(isIconSizeUsable(1)).toBe(true)
    expect(isIconSizeUsable(ICON_MAX_BYTES)).toBe(true)
    expect(isIconSizeUsable(ICON_MAX_BYTES + 1)).toBe(false)
    expect(isIconSizeUsable(0)).toBe(false)
    const script = iconConvertArgv('/c', '/p/a/icon.png', '/c/x.png')[2]!
    expect(script).toContain('sips -g pixelWidth -g pixelHeight')
    expect(script).toContain(`$2 > ${ICON_MAX_SIDE}`)
    expect(script.indexOf('sips -g pixelWidth')).toBeLessThan(script.indexOf('sips -s format png'))
    expect(script).toMatch(/\*\.svg\|\*\.SVG\) ;;/)
  })
  test('line 3 has no background-task count; the badge and model stay', () => {
    const own = { isSelf: true, branch: 'main', model: 'opus', background: [{ id: 'b1', kind: 'Command' as const, label: 'npm test', firstSeenAt: NOW - MIN }] }
    const lr = (width: number, left: string, right: string) => `${left}${' '.repeat(width - cellWidth(left) - cellWidth(right))}${right}`
    const l3 = plain(line3Of(card(own, { children: [CHILD('k', 'working', 1)] }), 60)).trimEnd()
    expect(l3).toBe(lr(60, '⎇ main', '● 1 opus'))
    expect(l3).not.toContain('⟳')
  })
  test('only the own session carries the background list and the failure a source gave', () => {
    const base = { rows: [], listed: [], listedSeen: {}, titles: {}, models: {}, places: {}, prs: {}, away: {} }
    const entry = (sessionId: string): RegistryEntry => ({ sessionId, name: sessionId, cwd: '/p', status: 'idle', kind: 'interactive', pid: 1, startedAt: 1 })
    const tasks = [{ id: 'b1', kind: 'Command' as const, label: 'npm test', firstSeenAt: 5 }]
    const out = sessionsOf({ ...base, registry: [entry('me'), entry('you')], selfId: 'me', selfBackground: tasks, selfFailedAt: 9 })
    expect(out.map(s => [s.id, s.background, s.failedAt])).toEqual([['me', tasks, 9], ['you', undefined, undefined]])
    const bare = sessionsOf({ ...base, registry: [entry('me')], selfId: 'me' })[0]!
    expect([bare.background, bare.failedAt]).toEqual([undefined, undefined])
  })
})

// ---- APP-84 pane gaps: Failed and Check? -----------------------------

describe('Failed and Check?', () => {
  test('an own API failure reads Failed until the card is pressed after it; working or waiting win', () => {
    expect(statusOf('idle', 0, 500, undefined, undefined, { failedAt: 600 })).toBe('failed')
    expect(statusOf('idle', 0, 500, 599, undefined, { failedAt: 600 })).toBe('failed')
    expect(statusOf('idle', 0, 500, 600, undefined, { failedAt: 600 })).toBe('idle')
    expect(statusOf('busy', 0, 500, undefined, undefined, { failedAt: 600 })).toBe('working')
    expect(statusOf('waiting', 0, 500, undefined, undefined, { failedAt: 600 })).toBe('needs-you')
  })
  test('an ended own turn with background tasks is Background, then Check? only after its silence threshold', () => {
    const endedAt = NOW - 5 * MIN
    const own = { background: 1, isTurnOver: true }
    expect(statusOf('idle', endedAt, undefined, undefined, undefined, own, NOW)).toBe('background')
    expect(statusOf('busy', endedAt, undefined, undefined, undefined, own, NOW)).toBe('background')
    expect(statusOf('idle', endedAt, undefined, undefined, undefined, own, endedAt + DEFAULT_CHECK_AFTER_MINUTES * MIN)).toBe('check')
    expect(statusOf('idle', endedAt, undefined, undefined, undefined, own, endedAt + 2 * HOUR, 0)).toBe('background')
    expect(statusOf('idle', endedAt, 500, undefined, undefined, { background: 2, isTurnOver: true }, NOW)).toBe('background')
    expect(statusOf('idle', 0, undefined, undefined, undefined, { background: 0 })).toBe('idle')
    expect(statusOf('busy', 0, undefined, undefined, undefined, { background: 1 })).toBe('working')
    expect(statusOf('idle', endedAt, undefined, undefined, undefined, { failedAt: 1, background: 1, isTurnOver: true }, NOW)).toBe('failed')
    expect(statusOf('idle', endedAt, undefined, undefined, 5, { background: 1, isTurnOver: true }, NOW)).toBe('needs-you')
    // The person's order once the turn is over: Needs you, Check?, Failed, Background.
    const stale = endedAt + DEFAULT_CHECK_AFTER_MINUTES * MIN
    expect(statusOf('idle', endedAt, undefined, undefined, undefined, { failedAt: 1, background: 1, isTurnOver: true }, stale)).toBe('check')
    expect(statusOf('failed', endedAt, undefined, undefined, undefined, { background: 1, isTurnOver: true }, stale)).toBe('check')
    expect(statusOf('failed', endedAt, undefined, undefined, undefined, { background: 1, isTurnOver: true }, NOW)).toBe('failed')
    expect(statusOf('idle', endedAt, undefined, undefined, 5, { background: 1, isTurnOver: true }, stale)).toBe('needs-you')
  })
  test('the slot draws a red Failed pill, green Background gear, and orange Check? with ages', () => {
    const failed = line1Of(card({}, { status: 'failed' }), 40)
    expect(plain(failed).endsWith('▐✕ Failed ▌')).toBe(true)
    const pill = failed.find(seg => seg.kind === 'text' && seg.text === '✕ Failed ')
    expect(pill).toMatchObject({ color: PALETTE.pill.red.fg, bg: PALETTE.pill.red.bg, role: 'status' })
    const background = line1Of(card({ statusSince: NOW - 5 * MIN }, { status: 'background', glyphMode: 'plain' }), 40)
    const check = line1Of(card({ statusSince: NOW - 5 * MIN }, { status: 'check' }), 40)
    expect(plain(background).endsWith('↻ Background 5m')).toBe(true)
    expect(background.find(seg => seg.kind === 'text' && seg.text === ' Background')).toMatchObject({ color: PALETTE.text.green })
    expect(plain(check).endsWith('Check? 5m')).toBe(true)
    expect(check.find(seg => seg.kind === 'text' && seg.text === 'Check?')).toMatchObject({ color: PALETTE.text.orange })
    expect(cells(failed)).toBe(40)
    expect(cells(background)).toBe(40)
    expect(cells(check)).toBe(40)
  })
  test('Failed sits on Active even when put away, wakes and returns; Check? sits on Active unless put away', () => {
    const s = S({ id: 'a', activityAt: NOW - 2 * INACTIVE_AFTER_MS })
    expect(shelfOf(s, 'failed', undefined, undefined, NOW)).toBe('active')
    expect(shelfOf(s, 'failed', { isParked: true, parkedAt: NOW - MIN }, undefined, NOW)).toBe('active')
    expect(shelfOf(s, 'failed', { isSettled: true, settledAt: NOW - MIN }, undefined, NOW)).toBe('active')
    expect(shelfOf(s, 'failed', { snoozedUntil: NOW + HOUR }, undefined, NOW)).toBe('active')
    expect(wakeOf({ snoozedUntil: NOW + HOUR }, 'failed', NOW)).toBe('attention')
    expect(returnedOf(NOW - MIN, 'failed', undefined)).toBe(true)
    for (const status of ['background', 'check'] as const) {
      expect(shelfOf(s, status, undefined, undefined, NOW)).toBe('active')
      expect(shelfOf(s, status, { isParked: true, parkedAt: NOW - MIN }, undefined, NOW)).toBe('parked')
      expect(shelfOf(s, status, { isSettled: true, settledAt: NOW - MIN }, undefined, NOW)).toBe('settled')
      expect(shelfOf(s, status, { snoozedUntil: NOW + HOUR }, undefined, NOW)).toBe('snoozed')
      expect(wakeOf({ snoozedUntil: NOW + HOUR }, status, NOW)).toBeNull()
      expect(returnedOf(NOW - MIN, status, undefined)).toBe(false)
    }
    for (const status of ['failed', 'background', 'check'] as const) expect(shelfOf(s, status, { isPinned: true }, undefined, NOW)).toBe('pinned')
  })
  test('on Active, needs-you sorts first, then Failed, then the rest by the sort mode', () => {
    const cardOf = (id: string, status: Status, statusSince: number, activityAt: number) => ({ s: S({ id, statusSince, activityAt }), status })
    const cards = [
      cardOf('idle1', 'idle', NOW - HOUR, NOW), cardOf('fail1', 'failed', NOW - MIN, NOW - HOUR), cardOf('need1', 'needs-you', NOW - MIN, NOW - HOUR),
      cardOf('fail0', 'failed', NOW - 2 * MIN, NOW - HOUR), cardOf('check', 'check', NOW - HOUR, NOW - MIN),
    ]
    expect(orderShelf('active', cards, 'recent', { v: 1, active: [], pinned: [] })).toEqual(['need1', 'fail0', 'fail1', 'idle1', 'check'])
  })
})

// ---- APP-84 pane gaps: live background rows ------------------------------------------

describe('background rows', () => {
  const T = (id: string, type: string, over: Record<string, string> = {}) => ({ id, type, status: 'running', description: `${id} description`, ...over })

  test('kinds and labels from the task type; subagents left out; no list keeps nothing', () => {
    const tasks = backgroundOf([
      T('s', 'shell', { command: 'npm test' }), T('m', 'monitor'), T('w', 'workflow', { name: 'deploy' }), T('a', 'subagent'), T('r', 'remote_agent'), T('e', 'shell', { description: '' }),
    ], null, 100)!
    expect(tasks.map(task => [task.id, task.kind, task.label, task.firstSeenAt])).toEqual([
      ['s', 'Command', 'npm test', 100], ['m', 'Monitoring', 'm description', 100], ['w', 'Workflow', 'deploy', 100], ['r', 'Agent', 'r description', 100], ['e', 'Command', 'shell', 100],
    ])
    expect(backgroundOf(undefined, tasks, 200)).toBeUndefined()
    expect(backgroundOf([], tasks, 200)).toEqual([])
    expect(taskLabelOf({ id: 'x', type: 'workflow', description: 'fallback' })).toBe('fallback')
  })
  test('a task keeps its first-seen time across later snapshots; a new id starts now', () => {
    const first = backgroundOf([T('s', 'shell', { command: 'npm test' })], null, 100)!
    const second = backgroundOf([T('s', 'shell', { command: 'npm test' }), T('m', 'monitor')], first, 500)!
    expect(second.map(task => [task.id, task.firstSeenAt])).toEqual([['s', 100], ['m', 500]])
  })
  test('a row reads `│ ⟳ Kind label … age`, the age from first sight, exactly the width', () => {
    const row = backgroundRowOf({ id: 's', kind: 'Command', label: 'npm test', firstSeenAt: NOW - 3 * MIN }, 40, NOW, PALETTE)
    expect(plain(row)).toBe(`  │ ⟳ Command npm test${' '.repeat(40 - 22 - 2)}3m`)
    expect(cells(row)).toBe(40)
    const long = backgroundRowOf({ id: 's', kind: 'Agent', label: 'x'.repeat(80), firstSeenAt: NOW - 2 * MIN }, 30, NOW, PALETTE)
    expect(cells(long)).toBe(30)
    expect(plain(long)).toMatch(/^  │ ⟳ Agent x+… 2m$/)
  })
  test('the own card draws at most 3 rows, then `+N more`; another card none', () => {
    const background = ['a', 'b', 'c', 'd', 'e'].map((id, at) => ({ id, kind: 'Command' as const, label: `job ${id}`, firstSeenAt: NOW - at * MIN }))
    const input = (isSelf: boolean, count: number) => paneViewOf({
      sessions: [S({ id: 'me', isSelf, background: background.slice(0, count) })], stored: loaded(), finished: {}, children: [], now: NOW, width: 40,
      caps: TRUE_COLOR, bell: 0, palette: PALETTE, projectColors: new Map(),
    }).shelves.flatMap(shelf => shelf.cards)[0]!
    const own = input(true, 5)
    expect(MAX_BACKGROUND_ROWS).toBe(3)
    expect(own.background?.rows.map(row => row.id)).toEqual(['a', 'b', 'c'])
    expect(own.background?.more).toBe('+2 more')
    expect(own.status).toBe('check')
    expect(input(true, 2).background?.more).toBeUndefined()
    expect(input(false, 5).background).toBeUndefined()
    expect(input(true, 0).background).toBeUndefined()
  })
})

// ---- APP-84 pane gaps: the needs-you chime ---------------------------------------------------

describe('needs-you chime', () => {
  const ON = { sound: true }
  const fresh = { stored: undefined, value: 'needs-you@500' }

  test('a change into Needs you or Failed chimes once per claim; every other change is silent', () => {
    expect(shouldChimeOf('working', 'needs-you', undefined, fresh, ON, false, NOW)).toBe(true)
    expect(shouldChimeOf('idle', 'failed', undefined, fresh, {}, false, NOW)).toBe(true)
    expect(shouldChimeOf('needs-you', 'failed', undefined, fresh, ON, false, NOW)).toBe(true)
    expect(shouldChimeOf('needs-you', 'needs-you', undefined, fresh, ON, false, NOW)).toBe(false)
    for (const next of ['working', 'done', 'idle', 'check'] as const) expect(shouldChimeOf('needs-you', next, undefined, fresh, ON, false, NOW)).toBe(false)
    expect(shouldChimeOf(undefined, 'needs-you', undefined, fresh, ON, false, NOW)).toBe(false)
  })
  test('silent with sound off, on the first refresh, put away, or claimed by another session', () => {
    expect(shouldChimeOf('working', 'needs-you', undefined, fresh, { sound: false }, false, NOW)).toBe(false)
    expect(shouldChimeOf('working', 'needs-you', undefined, fresh, ON, true, NOW)).toBe(false)
    expect(shouldChimeOf('working', 'needs-you', { isParked: true }, fresh, ON, false, NOW)).toBe(false)
    expect(shouldChimeOf('working', 'needs-you', { isSettled: true }, fresh, ON, false, NOW)).toBe(false)
    expect(shouldChimeOf('working', 'needs-you', { snoozedUntil: NOW + HOUR }, fresh, ON, false, NOW)).toBe(false)
    expect(shouldChimeOf('working', 'needs-you', { snoozedUntil: NOW - MIN }, fresh, ON, false, NOW)).toBe(true)
    expect(shouldChimeOf('working', 'needs-you', undefined, { stored: 'needs-you@500', value: 'needs-you@500' }, ON, false, NOW)).toBe(false)
    expect(shouldChimeOf('working', 'needs-you', undefined, { stored: 'needs-you@400', value: 'needs-you@500' }, ON, false, NOW)).toBe(true)
    expect([isPutAway(undefined, NOW), isPutAway({ isPinned: true }, NOW)]).toEqual([false, false])
  })
  test('the claim names the status and the newest shared status time, never a pane-local one', () => {
    expect(chimeClaimOf('needs-you', { sharedSince: 100 })).toBe('needs-you@100')
    expect(chimeClaimOf('failed', { sharedSince: 100, askedAt: 300, failedAt: 200 })).toBe('failed@300')
    expect(chimeClaimOf('needs-you', {})).toBe('needs-you@0')
    // Two panes that observed a listed word at different times still name the change alike.
    const base = { rows: [], listed: [], titles: {}, models: {}, places: {}, prs: {}, away: {}, selfId: '' }
    const entry: RegistryEntry = { sessionId: 'x', name: 'x', cwd: '/p', status: 'idle', kind: 'interactive', pid: 1, startedAt: 1, statusUpdatedAt: 50 }
    const paneA = sessionsOf({ ...base, registry: [entry], listedSeen: { x: { raw: 'waiting', observedAt: 900 } } })[0]!
    const paneB = sessionsOf({ ...base, registry: [entry], listedSeen: { x: { raw: 'waiting', observedAt: 950 } } })[0]!
    expect([paneA.raw, paneA.statusSince, paneB.statusSince]).toEqual(['waiting', 900, 950])
    expect(chimeClaimOf('needs-you', paneA)).toBe(chimeClaimOf('needs-you', paneB))
  })
  test('an ended session loses its chime key; live ones and other keys stay', () => {
    expect(prunedChimeKeys(['chime:a', 'chime:b', 'pref:b', 'layout'], new Set(['a']))).toEqual(['chime:b'])
  })
  test('the WAV has a RIFF header and non-empty 16-bit mono data; base64 is standard', () => {
    const samples = chimeSamples()
    expect(samples.length).toBe(Math.ceil(0.32 * CHIME_RATE))
    expect(samples.some(sample => sample !== 0)).toBe(true)
    expect(samples.every(sample => sample >= -1 && sample <= 1)).toBe(true)
    const wav = wavOf(samples, CHIME_RATE)
    const ascii = (from: number, to: number) => String.fromCharCode(...wav.slice(from, to))
    const view = new DataView(wav.buffer)
    expect([ascii(0, 4), ascii(8, 12), ascii(12, 16), ascii(36, 40)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
    expect([view.getUint32(4, true), view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)]).toEqual([wav.length - 8, 1, 1, CHIME_RATE, 16])
    expect(view.getUint32(40, true)).toBe(samples.length * 2)
    expect(base64Of(new Uint8Array([77, 97, 110]))).toBe('TWFu')
    expect(base64Of(new Uint8Array([77, 97]))).toBe('TWE=')
    expect(base64Of(new Uint8Array([77]))).toBe('TQ==')
    expect(chimeWav().startsWith('UklGR')).toBe(true)
    expect(chimeWav()).toBe(chimeWav())
  })
})
