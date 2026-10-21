import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { IconLookup, Row, Since, Title } from '../types'
import type { Place as GitPlace } from '../types'
import { joined, REFRESH_MS, REGISTRY_SCRIPT, registryOf, resumeCommandOf, rowsOf, unavailableOf, withSelf } from './sidebar-policy'
import type { Listing, RegistryEntry } from './sidebar-policy'
import { askedAtOf, BRANCH_SCRIPT, contextTokensOf, itemsOf, mergedTitle, projectNameOf, staleDirsOf, staleTitlesOf, TITLE_SCRIPT, titleOf } from './card-policy'
import { elsewhereMessageOf, focusMessageOf, forgetKnown, HOST_VARS, isSamePlace, knownPlaceOf, placeLabelOf, refreshKnown } from './adapters/shared'
import type { CapsEnv, Place as TermPlace, Ran } from './adapters/shared'
import { forgetCmuxCli } from './adapters/cmux'
import { capabilitiesOf, focusSession, resolveOwnPlace } from './adapters/index'
import { backgroundOf, endedTaskIdOf, launchedTaskOf, reconciledBackgroundOf, withoutTask, withTask } from './core/background'
import { childrenOf } from './core/children'
import { CHIME_PREFIX, chimeClaimOf, chimeWav, prunedChimeKeys, shouldChimeOf } from './core/chime'
import type { TaskSummary } from './core/background'
import { bellOf, framesAt, isAnimating, sceneFrameAt, spinnerFrameAt, TICK_MS } from './core/animation'
import { nextCaption } from './core/captions'
import { ICON_LOOKUP_MS, iconCacheNameOf, iconConvertArgv, isIconSizeUsable, PROJECT_ICON_CANDIDATES, projectRootOf } from './core/icons'
import { applyAction, isWoke, offeredActions, reconcile } from './core/lifecycle'
import type { Action } from './core/lifecycle'
import { moved } from './core/order'
import { PALETTES, projectColorsOf, themeModeOf } from './core/palette'
import { DEFAULT_CHECK_AFTER_MINUTES, KEYS, loadStored, PREF_PREFIX, prunedKeys, SIDEBAR_ARGS_HINT, sidebarSettingOf, WINDOW_PREFIX, windowsOf } from './core/persist'
import { glyphModeOf } from './adapters/glyphs'
import { AGENTS_ARGV, AGENTS_MS, agentsJsonOf, modelIdOf, modelOf, PR_FIRST_MS, PR_MS, sessionsOf } from './core/sources'
import type { Listed } from './core/sources'
import { finishedAtOf, ownOf, statusOf } from './core/status'
import { DEFAULT_COLLAPSED } from './core/types'
import type { BackgroundTask, Caps, Child, PaneView, Session, Settings, Status, Stored, ThemeMode } from './core/types'
import { paneViewOf } from './core/view'
import { drawPane } from './render/pane'
import type { Handlers } from './render/pane'

export const PANE = 'bridge'
/** The dock width a three-line card wants; a request the person's own drag outranks. */
export const PANE_COLUMNS = 44

const HOUR_MS = 3_600_000
const LAYOUT_RESET = 'The saved layout was reset.'
const DEFAULT_STORED: Stored = {
  entries: {}, layout: { v: 1, active: [], pinned: [] }, sort: 'recent', collapsed: { ...DEFAULT_COLLAPSED }, settings: { icons: true, theme: 'auto', workingShelf: false },
}

const rows = atom({ plugin: 'bridge', key: 'rows' } as const, [] as Row[])
const registry = atom({ plugin: 'bridge', key: 'registry' } as const, [] as RegistryEntry[])
const listed = atom({ plugin: 'bridge', key: 'listed' } as const, [] as Listed[])
const listedSeen = atom({ plugin: 'bridge', key: 'listedSeen' } as const, {} as Record<string, { raw: string; observedAt: number }>)
const children = atom({ plugin: 'bridge', key: 'children' } as const, [] as Child[])
const childSince = atom({ plugin: 'bridge', key: 'childSince' } as const, {} as Record<string, { tag: string; since: number; startedAt: number }>)
const stored = atom({ plugin: 'bridge', key: 'stored' } as const, DEFAULT_STORED)
const finished = atom({ plugin: 'bridge', key: 'finished' } as const, {} as Record<string, number>)
const selfId = atom({ plugin: 'bridge', key: 'selfId' } as const, '')
const notice = atom({ plugin: 'bridge', key: 'notice' } as const, '')
const shown = atom({ plugin: 'bridge', key: 'shown' } as const, '')
const layoutNote = atom({ plugin: 'bridge', key: 'layoutNote' } as const, '')
const away = atom({ plugin: 'bridge', key: 'away' } as const, {} as Record<string, string>)
const titles = atom({ plugin: 'bridge', key: 'titles' } as const, {} as Record<string, Title>)
const models = atom({ plugin: 'bridge', key: 'models' } as const, {} as Record<string, string>)
const asks = atom({ plugin: 'bridge', key: 'asks' } as const, {} as Record<string, number>)
const contexts = atom({ plugin: 'bridge', key: 'contexts' } as const, {} as Record<string, { tokens: number; model: string }>)
const windows = atom({ plugin: 'bridge', key: 'windows' } as const, {} as Record<string, number>)
const places = atom({ plugin: 'bridge', key: 'places' } as const, {} as Record<string, GitPlace>)
const prs = atom({ plugin: 'bridge', key: 'prs' } as const, {} as Record<string, number>)
const since = atom({ plugin: 'bridge', key: 'since' } as const, {} as Record<string, Since>)
const bell = atom({ plugin: 'bridge', key: 'bell' } as const, 0 as 0 | 1 | 2)
const snoozeOpen = atom({ plugin: 'bridge', key: 'snoozeOpen' } as const, '')
const sortOpen = atom({ plugin: 'bridge', key: 'sortOpen' } as const, false)
const caps = atom({ plugin: 'bridge', key: 'caps' } as const, { trueColor: false, pictures: false } as Caps)
const icons = atom({ plugin: 'bridge', key: 'icons' } as const, {} as Record<string, IconLookup>)
const mode = atom({ plugin: 'bridge', key: 'mode' } as const, 'dark' as ThemeMode)
const own = atom({ plugin: 'bridge', key: 'own' } as const, null as TermPlace | null)
const selfContext = atom({ plugin: 'bridge', key: 'selfContext' } as const, null as number | null)
const selfBackground = atom({ plugin: 'bridge', key: 'selfBackground' } as const, null as BackgroundTask[] | null)
const selfFailedAt = atom({ plugin: 'bridge', key: 'selfFailedAt' } as const, null as number | null)
const selfWindow = atom({ plugin: 'bridge', key: 'selfWindow' } as const, null as number | null)
const selfTurnOver = atom({ plugin: 'bridge', key: 'selfTurnOver' } as const, null as boolean | null)
const selfTurnAt = atom({ plugin: 'bridge', key: 'selfTurnAt' } as const, null as number | null)
/** Pending person-facing child tool calls, keyed by the engine's tool-use id. */
const childInteractions = atom({ plugin: 'bridge', key: 'childInteractions' } as const, {} as Record<string, { agentId: string; at: number }>)
const now = atom({ plugin: 'bridge', key: 'now' } as const, 0)

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** The old value when equal, so an unchanged write redraws nothing. */
const keep = <T,>(old: T, value: T): T => (same(old, value) ? old : value)
const errorText = (error: unknown) => String(error instanceof Error ? error.message : error)

// ---------------------------------------------------------------- module state, reset at session start

/** The pane's environment, read once at session start (each name spelled out: the engine lists what a module reads). */
let env: CapsEnv = {}
/** Where converted project icons are cached: `${CLAUDE_CONFIG_DIR or ~/.claude}/bridge/icons`; undefined when neither is known. */
let iconDir: string | undefined
let isOwnResolved = false
let configTheme: unknown
let isPrOff = false
let lastPruneAt = -Infinity
let wasWorkingScene = false
let caption: number | undefined
let timers: Array<{ cancel: () => void }> = []
let running: Promise<void> | undefined
type ViewInput = Parameters<typeof paneViewOf>[0]

/** The last drawn view, its sessions and the input it was made from, read by the handlers, the animation tick and the refresh. */
let last: { view: PaneView; input: ViewInput; sessions: Session[]; mode: ThemeMode; surface: string } | undefined
/** The pane sites drawn (their `requestId`s), and the Raster cells each last showed. */
const sites = new Set<string>()
let shownCells = new Map<string, string>()
let tick = 0
let ticker: { cancel: () => void } | undefined
/** Each card's status at the last refresh, undefined before the first one after the cross-check was read (no chime for what was there already). */
let lastStatuses: Record<string, Status> | undefined
/** The cross-check has been read once since session start, so a listed status word is no longer news. */
let hasReadAgents = false

const readEnv = async ($: EngineInterface) => {
  const values = await Promise.all([
    $.env.get('CMUX_WORKSPACE_ID'), $.env.get('CMUX_SURFACE_ID'), $.env.get('CMUX_BUNDLED_CLI_PATH'), $.env.get('CMUX_SOCKET_PATH'),
    $.env.get('TMUX'), $.env.get('TMUX_PANE'), $.env.get('TERM_PROGRAM'), $.env.get('COLORTERM'),
    $.env.get('KITTY_WINDOW_ID'), $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES'),
  ])
  const next: CapsEnv = {}
  HOST_VARS.forEach((name, at) => {
    if (values[at]) next[name] = values[at]
  })
  if (values[7]) next.COLORTERM = values[7]
  if (values[8]) next.KITTY_WINDOW_ID = values[8]
  if (values[9]) next.CLAUDE_CODE_FORCE_TERMINAL_IMAGES = values[9]
  return next
}

const readIconDir = async ($: EngineInterface) => {
  const [config, home] = await Promise.all([$.env.get('CLAUDE_CONFIG_DIR'), $.env.get('HOME')])
  const base = config || (home ? `${home}/.claude` : undefined)
  return base ? `${base.replace(/\/+$/, '')}/bridge/icons` : undefined
}

/** The one edge to `$.process` for focusing and probing: a command that cannot start reads as exit 127. */
const runner = ($: EngineInterface) => async (argv: readonly string[]): Promise<Ran> => {
  try {
    const ran = await $.process.run(argv, { timeoutMs: 5000 })
    return { exitCode: ran.exitCode, stdout: ran.stdout, stderr: ran.stderr }
  } catch (error) {
    return { exitCode: 127, stdout: '', stderr: errorText(error) }
  }
}

// ---------------------------------------------------------------- sources

/** Reads Claude Code's session registry (`~/.claude/sessions/*.json`); undefined when unreadable or refused. */
export const readRegistry = async ($: EngineInterface): Promise<RegistryEntry[] | undefined> => {
  try {
    const ran = await $.process.run(['sh', '-c', REGISTRY_SCRIPT], { timeoutMs: 5000 })
    return ran.exitCode === 0 ? registryOf(ran.stdout) : undefined
  } catch {
    return undefined
  }
}

const readItems = async ($: EngineInterface, script: string, args: readonly string[]) => {
  try {
    const ran = await $.process.run(['sh', '-c', script, 'bridge', ...args], { timeoutMs: 5000 })
    if (ran.exitCode !== 0) return undefined
    const items = itemsOf(ran.stdout)
    return items.length === args.length ? items : undefined
  } catch {
    return undefined
  }
}

/** Title, prompt, model, open question and context tokens of each session whose registry `updatedAt` moved, in one process (AC-107, AC-108). */
const readTitles = async ($: EngineInterface, entries: readonly RegistryEntry[]) => {
  const stale = staleTitlesOf(entries, await read($, titles))
  if (stale.length === 0) return
  const items = await readItems($, TITLE_SCRIPT, stale.map(one => one.arg))
  if (!items) return
  const live = new Set(entries.map(entry => entry.sessionId))
  const read$ = { titles: await read($, titles), models: await read($, models), asks: await read($, asks), contexts: await read($, contexts) }
  const nextTitles: Record<string, Title> = {}
  const nextModels: Record<string, string> = {}
  const nextAsks: Record<string, number> = {}
  const nextContexts: Record<string, { tokens: number; model: string }> = {}
  for (const [id, title] of Object.entries(read$.titles)) if (live.has(id)) nextTitles[id] = title
  for (const [id, model] of Object.entries(read$.models)) if (live.has(id)) nextModels[id] = model
  for (const [id, askedAt] of Object.entries(read$.asks)) if (live.has(id)) nextAsks[id] = askedAt
  for (const [id, context] of Object.entries(read$.contexts)) if (live.has(id)) nextContexts[id] = context
  stale.forEach((one, at) => {
    const [ai = '', prompt = '', model = '', lastEntry = '', usage = ''] = items[at] ?? []
    nextTitles[one.sessionId] = mergedTitle(read$.titles[one.sessionId], one.at, titleOf(ai, prompt))
    const short = modelOf(model)
    if (short) nextModels[one.sessionId] = short
    const askedAt = askedAtOf(lastEntry)
    if (askedAt === undefined) delete nextAsks[one.sessionId]
    else nextAsks[one.sessionId] = askedAt
    const tokens = contextTokensOf(usage)
    const modelId = modelIdOf(model)
    if (tokens !== undefined && modelId) nextContexts[one.sessionId] = { tokens, model: modelId }
  })
  await update($, titles, old => keep(old, nextTitles))
  await update($, models, old => keep(old, nextModels))
  await update($, asks, old => keep(old, nextAsks))
  await update($, contexts, old => keep(old, nextContexts))
}

/** Branch and project of each directory whose newest `updatedAt` moved, in one process. */
const readPlaces = async ($: EngineInterface, entries: readonly RegistryEntry[]) => {
  const stale = staleDirsOf(entries, await read($, places))
  if (stale.length === 0) return
  const items = await readItems($, BRANCH_SCRIPT, stale.map(one => one.cwd))
  if (!items) return
  const live = new Set(entries.map(entry => entry.cwd))
  const old = await read($, places)
  const next: Record<string, GitPlace> = {}
  for (const [cwd, place] of Object.entries(old)) if (live.has(cwd)) next[cwd] = place
  stale.forEach((one, at) => {
    const [branch, common] = items[at] ?? []
    next[one.cwd] = { at: one.at, project: projectNameOf(one.cwd, common || undefined), root: projectRootOf(one.cwd, common || undefined), ...(branch ? { branch } : {}) }
  })
  await update($, places, old => keep(old, next))
}

/**
 * A project folder's icon (AC-42): the first candidate file that exists and is at most 1 MB, as a 64 px PNG in the cache. A PNG
 * already cached for the same file and modification time is used as is; otherwise one process converts it.
 */
const lookupIcon = async ($: EngineInterface, dir: string, root: string, at: number): Promise<IconLookup> => {
  for (const name of PROJECT_ICON_CANDIDATES) {
    const source = `${root}/${name}`
    const stat = await $.fs.stat(source).catch(() => undefined)
    if (stat?.kind !== 'file' || !isIconSizeUsable(stat.size)) continue
    const target = `${dir}/${iconCacheNameOf(source, stat.mtimeMs)}`
    if (await $.fs.exists(target).catch(() => false)) return { at, file: target }
    const ran = await runner($)(iconConvertArgv(dir, source, target))
    return ran.exitCode === 0 ? { at, file: target } : { at }
  }
  return { at }
}

/**
 * Looks up the icon of each project folder not looked up in the last 10 minutes, only while icons are on and the
 * terminal draws pictures; a folder whose lookup stands costs no file or process call (AC-109).
 */
const readIcons = async ($: EngineInterface, at: number) => {
  const dir = iconDir
  const shownCaps = await read($, caps)
  if (!dir || !shownCaps.pictures || !shownCaps.trueColor || !(await read($, stored)).settings.icons) return
  const old = await read($, icons)
  const roots = [...new Set(Object.values(await read($, places)).flatMap(place => (place.root ? [place.root] : [])))]
  const due = roots.filter(root => !old[root] || at - old[root].at >= ICON_LOOKUP_MS)
  const next: Record<string, IconLookup> = {}
  for (const root of roots) if (old[root]) next[root] = old[root]
  for (const root of due) next[root] = await lookupIcon($, dir, root, at)
  await update($, icons, prev => keep(prev, next))
}

/** Project name to its cached PNG, from each place's folder lookup. */
const projectIconsOf = (placed: Readonly<Record<string, GitPlace>>, found: Readonly<Record<string, IconLookup>>): Map<string, string> => {
  const out = new Map<string, string>()
  for (const place of Object.values(placed)) {
    const file = place.root ? found[place.root]?.file : undefined
    if (file && !out.has(place.project)) out.set(place.project, file)
  }
  return out
}

/** Tags each session that runs in another app than this pane, by row id and by session id. */
const markAway = async ($: EngineInterface, listedRows: readonly Row[], entries: readonly RegistryEntry[]) => {
  const mine = (await read($, own)) ?? undefined
  const tags: Record<string, string> = {}
  const tag = (id: string, pid: number | undefined, startedAt: number | undefined) => {
    const place = pid ? knownPlaceOf(pid, startedAt) : undefined
    if (place && !isSamePlace(mine, place)) tags[id] = placeLabelOf(place, mine)
  }
  for (const row of listedRows) tag(row.id, row.pid, row.startedAt)
  for (const entry of entries) tag(entry.sessionId, entry.pid, entry.startedAt)
  await update($, away, old => keep(old, tags))
}

/** This session's subagents as children, each with the time it has shown its tag; finished ones stay listed (AC-31b, AC-92). */
const readChildren = async ($: EngineInterface, at: number) => {
  let agents: Array<Record<string, unknown>> = []
  try {
    agents = (await $.agent.list()) as unknown as Array<Record<string, unknown>>
  } catch {}
  const interactions = await read($, childInteractions)
  const needsYou = Object.values(interactions).reduce<Record<string, number>>((out, one) => {
    out[one.agentId] = Math.max(out[one.agentId] ?? 0, one.at)
    return out
  }, {})
  const { list, seen } = childrenOf(agents, await read($, children), await read($, childSince), at, needsYou)
  await update($, childSince, old => keep(old, seen))
  await update($, children, old => keep(old, list))
}

/** Marks a child permission/question while its engine tool call waits for the person. */
const noteChildInteraction = async ($: EngineInterface, key: string, agentId: string, active: boolean) => {
  const at = await $.clock.now()
  await update($, childInteractions, old => {
    if (active) return { ...old, [key]: { agentId, at } }
    if (!(key in old)) return old
    const next = { ...old }
    delete next[key]
    return next
  })
  await readChildren($, at)
}

const childNeedAtOf = (interactions: Readonly<Record<string, { agentId: string; at: number }>>) =>
  Math.max(0, ...Object.values(interactions).map(one => one.at)) || undefined

/** A task a main-loop tool call started, added to the own background list. */
const noteLaunched = async ($: EngineInterface, task: TaskSummary) => {
  const at = await $.clock.now()
  await update($, selfBackground, old => withTask(old, task, at))
}

/** A task that ended (its notification, or a TaskStop), taken off the own background list. */
const noteEnded = async ($: EngineInterface, id: string) => {
  await update($, selfBackground, old => {
    const next = withoutTask(old, id)
    return next === null ? old : keep(old, next)
  })
}

/** A background task a main-loop Bash, Monitor or Workflow call started (the tool's arguments sit on `e`); a subagent's own calls are its business. */
const noteToolCall = async ($: EngineInterface, tool: string, e: { readonly agentId?: string }, called: unknown) => {
  const result = called && typeof called === 'object' && 'result' in called ? (called as { result?: unknown }).result : undefined
  const task = e.agentId === undefined ? launchedTaskOf(tool, e, result) : undefined
  if (task) await noteLaunched($, task)
}

/** A main-loop turn's end: `error` (an API error ended it) marks the own card Failed, `answer` clears it. */
const noteTurnEnd = async ($: EngineInterface, reason: string) => {
  if (reason === 'error') {
    const at = await $.clock.now()
    await update($, selfFailedAt, () => at)
  } else if (reason === 'answer') {
    await update($, selfFailedAt, old => (old === null ? old : null))
  }
}

/** Every turn end restarts the Check? silence clock, so a second end with no turn start between them is not read as old silence. */
const noteTurnOver = async ($: EngineInterface, isOver: boolean) => {
  if (!isOver && (await read($, selfTurnOver)) === false) return
  const at = await $.clock.now()
  await update($, selfTurnOver, () => isOver)
  await update($, selfTurnAt, () => at)
  const id = await read($, selfId)
  const raw = (await read($, registry)).find(entry => entry.sessionId === id)?.status
    ?? (await read($, rows)).find(row => row.sessionId === id)?.status
  if (id && raw) await update($, since, old => ({ ...old, [id]: { status: raw, at } }))
}

/**
 * A `/clear` or a resume ends the conversation without a new `session.start`: what belonged to the old one
 * (its background tasks, which a clear kills without a notification, its turn, Failed, subagents and status
 * times) is dropped, and the session id is read again.
 */
const resetConversation = async ($: EngineInterface) => {
  await update($, selfBackground, () => null)
  await update($, selfTurnOver, () => null)
  await update($, selfTurnAt, () => null)
  await update($, selfFailedAt, () => null)
  await update($, selfContext, () => null)
  await update($, selfWindow, () => null)
  await update($, children, () => [])
  await update($, childSince, () => ({}))
  await update($, since, () => ({}))
  await readSelfId($)
}

const readSelfId = async ($: EngineInterface) => {
  try {
    const id = await $.session.id()
    if (id) await update($, selfId, old => (old === id ? old : id))
  } catch {}
}

/** The own session's in-flight background work, as the engine hands it to a stop hook; subagents are the child rows. */
const noteBackground = async ($: EngineInterface, tasks: readonly TaskSummary[] | undefined) => {
  const at = await $.clock.now()
  await update($, selfBackground, old => {
    const next = backgroundOf(tasks, old, at)
    return next === undefined ? old : keep(old, next)
  })
}

/** The own session's live context percentage, and its model's window for other sessions on that model (AC-94). */
const readSelfContext = async ($: EngineInterface) => {
  try {
    const { percent, window } = (await $.session.usage()).context
    await update($, selfContext, old => keep(old, typeof percent === 'number' ? percent : null))
    await update($, selfWindow, old => keep(old, typeof window === 'number' && window > 0 ? window : null))
    const model = (await read($, contexts))[await read($, selfId)]?.model
    if (model && typeof window === 'number' && window > 0 && (await read($, windows))[model] !== window) {
      // Kept in the shared store, so a pane on this model shows other sessions' percentages before its own first reply.
      await update($, windows, old => ({ ...old, [model]: window }))
      await $.store.set(`${WINDOW_PREFIX}${model}`, window)
    }
  } catch {
    await update($, selfContext, old => keep(old, null))
    await update($, selfWindow, old => keep(old, null))
  }
}

// ---------------------------------------------------------------- the store

/** Reads every key, validates it, deletes what failed (with the reset note) and publishes the result (AC-116, AC-119). */
const loadStore = async ($: EngineInterface) => {
  const raw = new Map<string, unknown>()
  for (const key of await $.store.keys()) raw.set(key, await $.store.get(key))
  const loaded = loadStored(raw)
  for (const key of loaded.resetKeys) await $.store.delete(key)
  if (loaded.resetKeys.length > 0) await update($, layoutNote, old => keep(old, LAYOUT_RESET))
  await update($, stored, old => keep(old, loaded.stored))
  await update($, windows, old => keep(old, { ...old, ...windowsOf(raw) }))
  await update($, mode, old => keep(old, themeModeOf(configTheme, loaded.stored.settings.theme)))
  return loaded.stored
}

/** One key's fresh value, validated as `loadStored` does; the default when absent or invalid. */
const freshOf = async ($: EngineInterface, key: string) => loadStored(new Map([[key, await $.store.get(key)]])).stored

const writeEntry = async ($: EngineInterface, prefId: string, action: Action) => {
  const key = `${PREF_PREFIX}${prefId}`
  const fresh = (await freshOf($, key)).entries[prefId]
  const next = applyAction(fresh, action, await $.clock.now())
  if (next) await $.store.set(key, next)
  else await $.store.delete(key)
}

// ---------------------------------------------------------------- refresh

const sessionsFrom = async ($: EngineInterface): Promise<Session[]> => {
  const context = await read($, selfContext)
  const background = await read($, selfBackground)
  const failedAt = await read($, selfFailedAt)
  const turnOver = await read($, selfTurnOver)
  const turnAt = await read($, selfTurnAt)
  const childNeedAt = childNeedAtOf(await read($, childInteractions))
  const window = await read($, selfWindow)
  return sessionsOf({
    rows: await read($, rows), registry: await read($, registry), listed: await read($, listed), listedSeen: await read($, listedSeen),
    titles: await read($, titles), models: await read($, models), asks: await read($, asks), contexts: await read($, contexts), windows: await read($, windows), places: await read($, places), prs: await read($, prs),
    selfId: await read($, selfId), away: await read($, away), since: await read($, since), ...(context === null ? {} : { selfContext: context }), ...(background === null ? {} : { selfBackground: background }), ...(failedAt === null ? {} : { selfFailedAt: failedAt }), ...(turnOver === null ? {} : { selfTurnOver: turnOver }), ...(window === null ? {} : { selfWindow: window }), ...(turnAt === null ? {} : { selfTurnAt: turnAt }), ...(childNeedAt === undefined ? {} : { selfChildNeedAt: childNeedAt }),
  })
}

/** The refresh in flight: a second caller joins it, so two never read the same transcripts at once. */
export const refresh = ($: EngineInterface) =>
  (running ??= refreshOnce($).finally(() => {
    running = undefined
  }))

const refreshOnce = async ($: EngineInterface) => {
  let note = ''
  const at = await $.clock.now()
  // The id moves on after a `/clear` or a resume, which no `session.start` announces.
  await readSelfId($)
  try {
    const called = await $.tool.call({ tool: 'ListAgents' } as never)
    if ('deny' in called && called.deny) {
      note = `ListAgents refused: ${called.deny}`
    } else {
      const entries = await readRegistry($)
      if (!entries) note = 'Session registry unreadable: resume unavailable.'
      const self = await read($, selfId)
      const next = withSelf(joined(rowsOf(called.result as Listing | undefined), entries ?? []), entries ?? [], self)
      await update($, rows, old => keep(old, next))
      await update($, registry, old => keep(old, entries ?? []))
      if (entries) {
        // Probe each new session's host after the rows are known, so a press runs no probe.
        await refreshKnown(runner($), entries)
        if (!isOwnResolved) {
          isOwnResolved = true
          const mine = entries.find(entry => entry.sessionId === self)
          const place = await resolveOwnPlace(runner($), env, mine ? { pid: mine.pid, startedAt: mine.startedAt } : undefined)
          await update($, own, old => keep(old, place ?? null))
          await update($, caps, old => keep(old, capabilitiesOf(place, env)))
        }
        await markAway($, next, entries)
        await readTitles($, entries)
        await readPlaces($, entries)
        await readIcons($, at)
      }
    }
  } catch (error) {
    note = `ListAgents unavailable: ${errorText(error)}`
  }
  await update($, notice, old => keep(old, note))
  await readChildren($, at)
  await readSelfContext($)
  // The clock moves only when it changes what is drawn (ages turn over by the minute), so a quiet refresh redraws nothing (AC-110).
  // A turn can restart an own card's status clock without changing its raw word. Its cached view still has the
  // old start, so comparing that view alone would leave Check? drawn until the next minute boundary.
  const turnAt = await read($, selfTurnAt)
  const ownStatusSince = last?.sessions.find(session => session.isSelf)?.statusSince ?? 0
  const turnRestarted = turnAt !== null && turnAt > ownStatusSince
  if (turnRestarted || !last || !same(paneViewOf({ ...last.input, now: at }), last.view)) await update($, now, old => keep(old, at))
  await reconcileStore($, at)
}

/** Statuses, finish times and the store writes a refresh owes (L5): wake marks, returns, seen stamps, prune. */
const reconcileStore = async ($: EngineInterface, at: number) => {
  // Taken before the sessions are read: a cross-check landing after that read is not in them yet.
  const isPrimed = hasReadAgents
  const kept = await loadStore($)
  const first = await sessionsFrom($)
  // A task whose end went unseen leaves no row once the registry says idle with no turn running. The registry's
  // own word is read, not the merged one: the listing can win the merge with `idle` while shells still run.
  const mine = first.find(s => s.isSelf)
  const tracked = await read($, selfBackground)
  const reconciled = mine?.sharedRaw !== undefined ? reconciledBackgroundOf(tracked, { raw: mine.sharedRaw, ...(mine.isTurnOver === undefined ? {} : { isTurnOver: mine.isTurnOver }), ...(mine.sharedSince === undefined ? {} : { idleSince: mine.sharedSince }) }) : tracked
  const isReconciled = !same(tracked, reconciled)
  if (isReconciled) await update($, selfBackground, () => reconciled)
  const sessions = isReconciled ? await sessionsFrom($) : first
  const oldSince = await read($, since)
  const oldFinished = await read($, finished)
  const nextSince: Record<string, Since> = {}
  const nextFinished: Record<string, number> = {}
  const statuses: Record<string, Status> = {}
  for (const s of sessions) {
    const prev = oldSince[s.prefId]
    const done = finishedAtOf(prev ? { raw: prev.status, since: prev.at } : undefined, { raw: s.raw, since: s.statusSince }, oldFinished[s.prefId])
    nextSince[s.prefId] = { status: s.raw, at: s.statusSince }
    if (done !== undefined) nextFinished[s.prefId] = done
    statuses[s.prefId] = statusOf(s.raw, s.statusSince, done, kept.entries[s.prefId]?.ackAt, s.askedAt, ownOf(s), at, kept.settings.checkAfter ?? DEFAULT_CHECK_AFTER_MINUTES)
  }
  await update($, since, old => keep(old, nextSince))
  await update($, finished, old => keep(old, nextFinished))
  await chimeFor($, sessions, statuses, kept, at, isPrimed)
  const patches = reconcile(sessions, statuses, kept.entries, nextFinished, at)
  for (const patch of patches) {
    if (patch.entry) await $.store.set(patch.key, patch.entry)
    else await $.store.delete(patch.key)
  }
  let isPruned = false
  if (at - lastPruneAt >= HOUR_MS) {
    lastPruneAt = at
    for (const key of prunedKeys(kept.entries, new Set(sessions.map(s => s.prefId)), at)) {
      await $.store.delete(key)
      isPruned = true
    }
    // A claim is only news while its session lives: an ended session's `chime:` key goes with the prune.
    // An empty list is a failed read more often than no sessions at all: it keeps every claim.
    if (sessions.length > 0) for (const key of prunedChimeKeys(await $.store.keys().catch(() => []), new Set(sessions.map(s => s.prefId)))) await $.store.delete(key).catch(() => undefined)
  }
  if (patches.length > 0 || isPruned) await loadStore($)
}

/**
 * The needs-you chime (AC-G6): one sound when a card changes into Needs you or Failed. The entries are
 * the ones before this refresh's writes, so a card put away still reads put away. Every session runs the
 * pane, so the change is claimed in the shared store under `chime:<prefId>` and only the first claim plays.
 */
const chimeFor = async ($: EngineInterface, sessions: readonly Session[], statuses: Readonly<Record<string, Status>>, kept: Stored, at: number, isPrimed: boolean) => {
  const prev = lastStatuses
  // Until the cross-check has been read once, its words could still flip a card to a state that was already there.
  // A card missing from one refresh keeps its last status, so its return is no change.
  lastStatuses = isPrimed ? { ...prev, ...statuses } : undefined
  let isDue = false
  for (const s of sessions) {
    const next = statuses[s.prefId] ?? 'idle'
    // A card first seen after the first refresh comes from idle, so one that appears needing the Owner chimes.
    const before = prev === undefined ? undefined : (prev[s.prefId] ?? 'idle')
    if (prev === undefined || before === next || (next !== 'needs-you' && next !== 'failed')) continue
    const key = `${CHIME_PREFIX}${s.prefId}`
    const claimed = { stored: await $.store.get(key).catch(() => undefined), value: chimeClaimOf(next, s) }
    if (!shouldChimeOf(before, next, kept.entries[s.prefId], claimed, kept.settings, false, at)) continue
    await $.store.set(key, claimed.value).catch(() => undefined)
    isDue = true
  }
  if (isDue) void $.audio.play({ base64: chimeWav(), mime: 'audio/wav' }).catch(() => undefined)
}

/** The cross-check and the theme, every 30 s (L3): never inside the 5 s refresh. */
const readAgents = async ($: EngineInterface) => {
  try {
    const ran = await $.process.run(AGENTS_ARGV, { timeoutMs: 5000 })
    const list = ran.exitCode === 0 ? agentsJsonOf(ran.stdout) : []
    const at = await $.clock.now()
    const old = await read($, listedSeen)
    const seen: Record<string, { raw: string; observedAt: number }> = {}
    for (const one of list) seen[one.sessionId] = old[one.sessionId]?.raw === one.raw ? old[one.sessionId]! : { raw: one.raw, observedAt: at }
    await update($, listed, old => keep(old, list))
    await update($, listedSeen, old => keep(old, seen))
  } catch {}
  hasReadAgents = true
  await readTheme($)
}

const readTheme = async ($: EngineInterface) => {
  try {
    configTheme = (await $.config.list()).find(row => row.key === 'theme')?.value
  } catch {
    configTheme = undefined
  }
  const theme = (await read($, stored)).settings.theme
  await update($, mode, old => keep(old, themeModeOf(configTheme, theme)))
}

/** One `gh` per distinct (cwd, branch), at most 10 (AC-114a); a missing or signed-out `gh` stops lookups (AC-114b). */
const readPrs = async ($: EngineInterface) => {
  if (isPrOff) return
  const pairs = new Map<string, { cwd: string; branch: string }>()
  for (const s of await sessionsFrom($)) if (s.cwd && s.branch) pairs.set(`${s.cwd}\u0000${s.branch}`, { cwd: s.cwd, branch: s.branch })
  const found: Record<string, number> = {}
  for (const [key, { cwd, branch }] of [...pairs].slice(0, 10)) {
    let ran: { exitCode: number; stdout: string; stderr: string }
    try {
      ran = await $.process.run(['gh', 'pr', 'list', '--head', branch, '--state', 'all', '--json', 'number', '--limit', '1'], { cwd, timeoutMs: 10_000 })
    } catch (error) {
      ran = { exitCode: 127, stdout: '', stderr: errorText(error) }
    }
    if (ran.exitCode === 127 || /auth|log ?in/i.test(ran.stderr)) {
      isPrOff = true
      await update($, prs, old => keep(old, {}))
      return
    }
    try {
      const number = (JSON.parse(ran.stdout) as Array<{ number?: unknown }>)[0]?.number
      if (typeof number === 'number') found[key] = number
    } catch {}
  }
  await update($, prs, old => keep(old, found))
}

// ---------------------------------------------------------------- animation (L8)

const stopTicker = () => {
  ticker?.cancel()
  ticker = undefined
}

const syncAnimation = ($: EngineInterface, isShown: boolean) => {
  const wanted = last !== undefined && sites.size > 0 && isAnimating(last.view, isShown)
  if (wanted && !ticker) {
    ticker = $.clock.every(TICK_MS, () => void onTick($).catch(() => undefined))
  }
  if (!wanted) stopTicker()
}

let lastSignature = ''

/** Which animated frame each kind of Raster in the view shows at this tick. */
const frameSignatureOf = (view: PaneView, at: number) => {
  const cards = view.shelves.filter(shelf => !shelf.isCollapsed).flatMap(shelf => shelf.cards)
  const spins = cards.some(card => card.lines.some(line => line.some(seg => seg.kind === 'spinner')))
  return [spins ? spinnerFrameAt(at) : -1, view.scene?.showArt ? sceneFrameAt(at) : -1].join(',')
}

const hasNeedsYou = (view: PaneView) => view.shelves.some(shelf => shelf.cards.some(card => card.status === 'needs-you'))

const onTick = async ($: EngineInterface) => {
  if (!last) return stopTicker()
  tick += 1
  if (hasNeedsYou(last.view)) {
    const step = bellOf(await $.clock.now())
    if (step !== (await read($, bell))) await update($, bell, () => step)
  }
  // Frames change on their own periods (spinner every tick, the scene every 6): skip the ticks where none does.
  const signature = frameSignatureOf(last.view, tick)
  if (signature === lastSignature) return
  lastSignature = signature
  for (const blit of framesAt(last.view, tick, last.mode)) {
    if (shownCells.get(blit.key) === blit.cells) continue
    shownCells.set(blit.key, blit.cells)
    for (const requestId of [...sites]) {
      const result = await $.ui.blit({ requestId, ...blit }).catch(error => ({ deny: errorText(error) }))
      if (result.deny !== undefined) sites.delete(requestId)
    }
  }
  if (sites.size === 0) stopTicker()
}

// ---------------------------------------------------------------- handlers

const cardOfId = (id: string) => last?.view.shelves.flatMap(shelf => shelf.cards).find(card => card.id === id || card.prefId === id)

const copySurface = () => (last?.surface ?? 'terminal') as Parameters<EngineInterface['ui']['copy']>[0]['surface']

/** A row for the phase-1 resume helpers, from a merged session. */
const rowOf = (s: Session): Row => ({ id: s.id, name: s.name, kind: 'sessions', type: '', status: s.raw, ...(s.sessionId ? { sessionId: s.sessionId } : {}), ...(s.cwd ? { cwd: s.cwd } : {}) })

/**
 * A card press: an ack when the card is Done, Failed or Woke, then the own card shows the main view; another
 * card focuses its tab in this pane's own terminal app only (L9). A live session elsewhere gets a note
 * and nothing is copied; a failed or dead focus copies the resume line. Never a toast.
 */
const acknowledgeSession = async ($: EngineInterface, s: Session) => {
  const at = await $.clock.now()
  const kept = await read($, stored)
  const entry = kept.entries[s.prefId]
  const status = statusOf(s.raw, s.statusSince, (await read($, finished))[s.prefId], entry?.ackAt, s.askedAt, ownOf(s), at, kept.settings.checkAfter ?? DEFAULT_CHECK_AFTER_MINUTES)
  if (status === 'done' || status === 'failed' || isWoke(entry, status, at)) {
    await writeEntry($, s.prefId, 'ack')
    await loadStore($)
  }
}

const pressSession = async ($: EngineInterface, s: Session) => {
  await acknowledgeSession($, s)
  if (s.isSelf) {
    try {
      await $.ui.view({})
    } catch {}
    return
  }
  const row = rowOf(s)
  const line = resumeCommandOf(row)
  if (!line) return void (await update($, shown, () => unavailableOf(row)))
  const place = (await read($, own)) ?? undefined
  if (!place) {
    const copied = await $.ui.copy({ text: line, surface: copySurface() })
    return void (await update($, shown, () => `${s.name}: this terminal is not supported for switching. ${copied.isCopied ? 'Copied' : 'Run'}: ${line}`))
  }
  const focused = s.pid
    ? await focusSession(runner($), { pid: s.pid, cwd: s.cwd ?? '', startedAt: s.startedAt, ...(s.title ? { title: s.title } : {}) }, { cli: env.CMUX_BUNDLED_CLI_PATH, place })
    : ({ kind: 'failed', reason: 'session pid unknown' } as const)
  if (focused.kind === 'focused') return void (await update($, shown, () => ''))
  if (focused.kind === 'elsewhere' || focused.kind === 'unknown') return void (await update($, shown, () => elsewhereMessageOf(s.name, focused, place)))
  const copied = await $.ui.copy({ text: line, surface: copySurface() })
  await update($, shown, () => focusMessageOf(focused, line, copied.isCopied))
}

const handlersOf = ($: EngineInterface): Handlers => ({
  pressCard: id => {
    const s = last?.sessions.find(one => one.id === id)
    // `ui.view` is authorized only during this press. `pressSession` first
    // awaits the clock, so its old own-card call arrived after authorization.
    if (s?.isSelf) {
      void $.ui.view({}).then(() => undefined).catch(() => undefined)
      void acknowledgeSession($, s)
    }
    else if (s) void pressSession($, s)
  },
  toggleShelf: shelf => void (async () => {
    const collapsed = { ...(await freshOf($, KEYS.shelves)).collapsed }
    collapsed[shelf] = !collapsed[shelf]
    await $.store.set(KEYS.shelves, collapsed)
    await loadStore($)
  })(),
  act: (prefId, action) => void (async () => {
    const card = cardOfId(prefId)
    if (!card || !last) return
    if (!offeredActions(card.status, card.shelf).includes(action)) return
    if (action === 'pin' || action === 'park' || action === 'settle') {
      await writeEntry($, prefId, action)
    } else {
      const shelf = last.view.shelves.find(one => one.id === card.shelf)
      const drawn = (shelf?.cards ?? []).filter(one => one.status !== 'needs-you').map(one => one.prefId)
      const layout = (await freshOf($, KEYS.layout)).layout
      const order = moved(drawn, prefId, action === 'move-up' ? -1 : 1)
      await $.store.set(KEYS.layout, { ...layout, pinned: order })
    }
    await loadStore($)
  })(),
  openSnooze: prefId => void (async () => {
    const card = prefId === undefined ? undefined : cardOfId(prefId)
    if (card && last && !offeredActions(card.status, card.shelf).includes('snooze')) return
    await update($, snoozeOpen, () => prefId ?? '')
  })(),
  pickSnooze: (prefId, wake) => void (async () => {
    await writeEntry($, prefId, { snooze: wake })
    await update($, snoozeOpen, () => '')
    await loadStore($)
  })(),
  sort: value => void (async () => {
    await $.store.set(KEYS.sort, value)
    await update($, sortOpen, () => false)
    await loadStore($)
  })(),
  toggleSort: () => void (async () => {
    await update($, sortOpen, old => !old)
  })(),
  pressChild: agentId => void (async () => {
    try {
      const moved$ = await $.ui.view({ agentId })
      await update($, shown, () => (moved$.deny ? `Transcript unavailable: ${moved$.deny}` : ''))
    } catch (error) {
      await update($, shown, () => `Transcript unavailable: ${errorText(error)}`)
    }
  })(),
})

// ---------------------------------------------------------------- entry

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Bridge', columns: PANE_COLUMNS })

const isOurs = (requestId: string) => requestId === PANE || requestId.startsWith(`${PANE}-`)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    for (const timer of timers) timer.cancel()
    stopTicker()
    timers = []
    running = undefined
    isOwnResolved = false
    isPrOff = false
    lastPruneAt = -Infinity
    lastStatuses = undefined
    hasReadAgents = false
    wasWorkingScene = false
    caption = undefined
    last = undefined
    sites.clear()
    shownCells = new Map()
    tick = 0
    forgetKnown()
    forgetCmuxCli()
    await $.command.register({ name: 'bridge', description: 'Open the Bridge sessions pane, or change a Bridge setting', argumentHint: SIDEBAR_ARGS_HINT })
    // A new session starts from nothing: what the last one read and derived is dropped.
    await update($, rows, () => [])
    await update($, registry, () => [])
    await update($, listed, () => [])
    await update($, listedSeen, () => ({}))
    await update($, children, () => [])
    await update($, childSince, () => ({}))
    await update($, finished, () => ({}))
    await update($, since, () => ({}))
    await update($, titles, () => ({}))
    await update($, models, () => ({}))
    await update($, asks, () => ({}))
    await update($, contexts, () => ({}))
    await update($, windows, () => ({}))
    await update($, places, () => ({}))
    await update($, icons, () => ({}))
    await update($, prs, () => ({}))
    await update($, away, () => ({}))
    await update($, notice, () => '')
    await update($, shown, () => '')
    await update($, layoutNote, () => '')
    await update($, selfContext, () => null)
    await update($, selfBackground, () => null)
    await update($, selfFailedAt, () => null)
    await update($, selfTurnOver, () => null)
    await update($, selfTurnAt, () => null)
    await update($, childInteractions, () => ({}))
    await update($, selfWindow, () => null)
    await update($, now, () => 0)
    env = await readEnv($)
    iconDir = await readIconDir($).catch(() => undefined)
    await update($, own, () => null)
    await update($, caps, () => capabilitiesOf(undefined, env))
    await update($, selfId, () => '')
    try {
      const id = await $.session.id()
      await update($, selfId, () => id)
    } catch {}
    const started$ = await $.clock.now()
    await update($, bell, () => bellOf(started$))
    await update($, snoozeOpen, () => '')
    await update($, sortOpen, () => false)
    await readTheme($)
    // The cross-check is read before the first refresh, so the first-refresh guard covers its status words (AC-G6).
    void readAgents($).finally(() => refresh($))
    timers.push($.clock.every(REFRESH_MS, () => void refresh($)))
    timers.push($.clock.every(AGENTS_MS, () => void readAgents($)))
    timers.push($.clock.after(PR_FIRST_MS, () => {
      void readPrs($)
      timers.push($.clock.every(PR_MS, () => void readPrs($)))
    }))
    void openPane($)

    return started
  })

  // The own background list and turn state, from events no other plugin can send past this one: a managed
  // plugin may hand classic.Stop and classic.SubagentStop past every installed plugin (live defect D1).
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await noteTurnOver($, false).catch(() => undefined)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await noteTurnOver($, true).catch(() => undefined)
      // The own Failed, from an event no managed plugin sends past this one: an API error marks it, an answer clears it (AC-G1).
      await noteTurnEnd($, e.reason).catch(() => undefined)
    }
    return done
  })
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const called = await next(e)
    await noteToolCall($, 'Bash', e, called).catch(() => undefined)
    return called
  })
  on('tool.call', { tool: 'Monitor' }, async ($, e, next) => {
    const called = await next(e)
    await noteToolCall($, 'Monitor', e, called).catch(() => undefined)
    return called
  })
  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const called = await next(e)
    await noteToolCall($, 'Workflow', e, called).catch(() => undefined)
    return called
  })
  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const called = await next(e)
    // The task the call named (`task_id`, or the older `shell_id`), once the call did not fail.
    const input = e as { task_id?: unknown; shell_id?: unknown }
    const id = [input.task_id, input.shell_id].find(one => typeof one === 'string' && one !== '') as string | undefined
    const isFailed = !('result' in called) || (called as { isError?: boolean }).isError === true
    if (id && !isFailed) await noteEnded($, id).catch(() => undefined)
    return called
  })
  // `waiting` is not a prompt signal. The engine marks a real permission/plan
  // interaction as `ask` and supplies the child id and tool-use id here.
  on('tool.check', async ($, e, next) => {
    const checked = await next(e)
    if (e.agentId !== undefined && checked.decision === 'ask' && e.tool_use_id) await noteChildInteraction($, e.tool_use_id, e.agentId, true).catch(() => undefined)
    return checked
  })
  on('tool.call', async ($, e, next) => {
    const key = e.tool_use_id
    // AskUserQuestion is person-facing by contract even where no permission check precedes it.
    if (e.agentId !== undefined && e.tool === 'AskUserQuestion' && key) await noteChildInteraction($, key, e.agentId, true).catch(() => undefined)
    try {
      return await next(e)
    } finally {
      if (key && (await read($, childInteractions))[key] !== undefined) await noteChildInteraction($, key, '', false).catch(() => undefined)
    }
  })
  on('session.end', async ($, e, next) => {
    const ended = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') await resetConversation($).catch(() => undefined)
    return ended
  })
  on('prompt.submit', async ($, e, next) => {
    const id = e.origin?.kind === 'task-notification' ? endedTaskIdOf(e.text) : undefined
    if (id) await noteEnded($, id).catch(() => undefined)
    // The person's own next prompt clears Failed: an interrupted turn ends with no answer (AC-G1).
    if (e.origin?.kind === 'composer' && !e.command) await update($, selfFailedAt, old => (old === null ? old : null)).catch(() => undefined)
    return next(e)
  })

  // A turn that ends well clears an earlier API failure; one that ends on an API error marks the card Failed (AC-G1).
  on('classic.Stop', async ($, e, next) => {
    await noteBackground($, e.background_tasks).catch(() => undefined)
    await noteTurnOver($, true).catch(() => undefined)
    await update($, selfFailedAt, old => (old === null ? old : null)).catch(() => undefined)
    return next(e)
  })
  // A new turn clears it too: an interrupted turn has no Stop (AC-G1).
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await update($, selfFailedAt, old => (old === null ? old : null)).catch(() => undefined)
    return next(e)
  })
  on('classic.StopFailure', async ($, e, next) => {
    const at = await $.clock.now().catch(() => undefined)
    if (at !== undefined) await update($, selfFailedAt, () => at).catch(() => undefined)
    return next(e)
  })
  on('classic.SubagentStop', async ($, e, next) => {
    await noteBackground($, e.background_tasks).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'bridge' }, async ($, e) => {
    const setting = sidebarSettingOf(e.args)
    if (setting && 'error' in setting) return { text: setting.error }
    if (setting) {
      await $.store.set(setting.key, setting.value)
      await loadStore($)
      return { text: setting.label }
    }
    await refresh($)
    const opened = await openPane($)

    return { text: opened.isPlaced ? 'Bridge pane opened.' : `Bridge pane waits: ${opened.reason}` }
  })

  // A closed pane stops the animation until its next render (L8); the close itself always goes through (nothing above `next` throws).
  on('ui.close', async ($, e, next) => {
    if (isOurs(e.id)) {
      sites.delete(e.id)
      if (sites.size === 0) stopTicker()
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (!isOurs(e.requestId) || e.surface !== 'terminal') return next(e)
    const els = $.ui.resolve(e)
    const isShown = e.props.bodyColumns > 0
    const width = Math.max(1, e.props.bodyColumns)
    const kept = await read($, stored)
    const shade = await read($, mode)
    const palette = PALETTES[shade]
    const sessions = await sessionsFrom($)
    const open = await read($, snoozeOpen)
    const isSortOpen = await read($, sortOpen)
    const inputOf = (pick: number | undefined): ViewInput => ({
      sessions, stored: kept, finished: finishedNow, children: childList, now: at, width, caps: shownCaps, bell: step,
      glyphMode: glyphModeOf(kept.settings.glyphs, env.TERM_PROGRAM),
      ...(open ? { snoozeOpen: open } : {}), ...(isSortOpen ? { sortOpen: true } : {}), ...(pick === undefined ? {} : { caption: pick }),
      palette, projectColors: projectColorsOf([...new Set(sessions.map(s => s.project))], shade), projectIcons: iconFiles,
    })
    const viewOf = (pick: number | undefined) => paneViewOf(inputOf(pick))
    const finishedNow = await read($, finished)
    const iconFiles = projectIconsOf(await read($, places), await read($, icons))
    const childList = await read($, children)
    const at = await read($, now)
    const shownCaps = await read($, caps)
    const step = await read($, bell)
    let view = viewOf(caption)
    // A new working caption each time the working scene appears after not being shown (AC-49).
    const isWorkingScene = view.scene?.kind === 'working'
    if (isWorkingScene && !wasWorkingScene) {
      caption = nextCaption(kept.caption, Math.random)
      void $.store.set(KEYS.caption, caption).catch(() => undefined)
      view = viewOf(caption)
    }
    wasWorkingScene = isWorkingScene
    sites.add(e.requestId)
    last = { view, input: inputOf(caption), sessions, mode: shade, surface: e.surface }
    shownCells = new Map(framesAt(view, tick, shade).map(blit => [blit.key, blit.cells]))
    lastSignature = frameSignatureOf(view, tick)
    syncAnimation($, isShown)
    const note = (await read($, shown)) || (await read($, layoutNote))
    return drawPane(els, view, { tick, mode: shade }, handlersOf($), { notice: await read($, notice), note, ...(e.props.view.agentId ? { viewedAgent: e.props.view.agentId } : {}) })
  })
}
