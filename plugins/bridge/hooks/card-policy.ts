// Pure logic of the session cards and shelves: no `$`, so the tests call it directly.
// The card anatomy, the shelf set and the status words follow the design;
// the code is this plugin's own, except
// relative-time.ts and project-colors.ts, which are copied (see their headers).

import type { ChildRow, Place, Pref, Row, Since, Title } from '../types'
import type { RegistryEntry } from './sidebar-policy'
import { prefIdOf } from './sidebar-policy'
import { relativeTimeLabel } from './relative-time'
import { projectColorsById } from './project-colors'

export const MINUTE_MS = 60_000

/** The shelves in drawing order; `parked` starts collapsed. */
export const SHELVES = ['pinned', 'working', 'active', 'parked'] as const
export type Shelf = (typeof SHELVES)[number]
export const SHELF_LABELS: Readonly<Record<Shelf, string>> = { pinned: 'Pinned', working: 'Working', active: 'Active', parked: 'Parked' }
export const DEFAULT_COLLAPSED: Readonly<Record<string, boolean>> = { parked: true }
export const SHELVES_KEY = 'shelves'

export const EMPTY_ACTIVE = 'All clear. Time to touch some grass.'

/** Whether a status word means the session or agent is running a turn now. */
export const isWorking = (status: string) => {
  const word = status.trim().toLowerCase()
  return word === 'busy' || word === 'running' || word === 'working'
}

/**
 * Rows into shelves: Pinned first (pinned wins over working), then Working,
 * then Active, and Parked apart. Each keeps the listing order.
 */
export const shelvesOf = (rows: readonly Row[], prefs: Readonly<Record<string, Pref>>): Record<Shelf, Row[]> => {
  const shelves: Record<Shelf, Row[]> = { pinned: [], working: [], active: [], parked: [] }
  for (const row of rows) {
    const pref = prefs[prefIdOf(row)]
    if (pref?.isParked) shelves.parked.push(row)
    else if (pref?.isPinned) shelves.pinned.push(row)
    else if (isWorking(row.status)) shelves.working.push(row)
    else shelves.active.push(row)
  }
  return shelves
}

/** A stored shelf state read back; anything else is the default. */
export const collapsedOf = (value: unknown): Record<string, boolean> => {
  const out: Record<string, boolean> = { ...DEFAULT_COLLAPSED }
  if (!value || typeof value !== 'object') return out
  for (const [key, one] of Object.entries(value as Record<string, unknown>)) {
    if (typeof one === 'boolean' && (SHELVES as readonly string[]).includes(key)) out[key] = one
  }
  return out
}

/** The shelf header: `Active (3) ─────── ⌄`, the rule filling the pane's width. */
export const shelfHeaderOf = (shelf: Shelf, count: number, isCollapsed: boolean, columns: number) => {
  const label = `${SHELF_LABELS[shelf]} (${count}) `
  const chevron = isCollapsed ? ' ›' : ' ⌄'
  const rule = Math.max(2, columns - label.length - chevron.length)
  return `${label}${'─'.repeat(rule)}${chevron}`
}

export type Tone = 'warning' | 'error' | 'success' | 'subtle'
export type StatusLabel = { word: string; tone: Tone; isPill?: true }

/**
 * A session's or agent's status as a word and a tone: registry `busy` and
 * agent `running` read Working; registry and agent `waiting` read Needs you,
 * drawn as a pill; `idle` reads Idle; an agent's end reads Done or Failed.
 */
export const statusLabelOf = (status: string): StatusLabel => {
  const word = status.trim().toLowerCase()
  if (isWorking(word)) return { word: 'Working', tone: 'warning' }
  if (word === 'waiting') return { word: 'Needs you', tone: 'error', isPill: true }
  if (word === 'pending') return { word: 'Queued', tone: 'subtle' }
  if (word === 'completed' || word === 'done') return { word: 'Done', tone: 'success' }
  if (word === 'failed' || word === 'killed') return { word: 'Failed', tone: 'error' }
  if (word === 'idle' || word === '') return { word: 'Idle', tone: 'subtle' }
  return { word: word[0]!.toUpperCase() + word.slice(1), tone: 'subtle' }
}

/**
 * Since when each session has shown its status: kept while the status stays,
 * reset to the registry's `statusUpdatedAt` (else now) when it changes. The
 * registry rewrites `statusUpdatedAt` on writes that keep the status, so it
 * alone would restart the clock mid-turn.
 */
export const sinceOf = (old: Readonly<Record<string, Since>>, rows: readonly Row[], now: number): Record<string, Since> => {
  const next: Record<string, Since> = {}
  for (const row of rows) {
    const id = prefIdOf(row)
    const kept = old[id]
    next[id] = kept && kept.status === row.status ? kept : { status: row.status, at: row.statusUpdatedAt ?? now }
  }
  return next
}

/** The status slot's text: "Working · 5m"; no time when it is unknown. */
export const statusTextOf = (label: StatusLabel, since: number | undefined, now: number) =>
  since === undefined ? label.word : `${label.word} · ${relativeTimeLabel(since, now)}`

/** Cut to `width` cells with an ellipsis; nothing when there is no room. */
export const fit = (text: string, width: number) => {
  const chars = [...text]
  if (width <= 0) return ''
  if (chars.length <= width) return text
  return width === 1 ? '…' : `${chars.slice(0, width - 1).join('')}…`
}

/** The transcript a registry entry writes, relative to the config dir's `projects/`; undefined when the id is not plain. */
export const transcriptOf = (entry: { sessionId: string; cwd: string }) => {
  if (!/^[A-Za-z0-9-]+$/.test(entry.sessionId) || !entry.cwd) return undefined
  return `${entry.cwd.replace(/[^A-Za-z0-9]/g, '-')}/${entry.sessionId}`
}

/** What the title and branch readers print between fields and between items. */
export const FIELD = '\u001f'
export const ITEM = '\u001e'

/**
 * Prints, per `<mode>:<slug>/<id>` argument, five fields of that transcript:
 * the last `custom-title` record (a `/rename`), else the last `ai-title` record, the last `last-prompt` record, the last
 * `"model":"…"` match, the last user or assistant entry (for `askedAtOf`) and
 * the input token counts of the last main-thread response (for `contextTokensOf`). Both modes read only the last 262 144 bytes (the
 * `full`/`tail` word stays so `staleTitlesOf` keeps working); a title that is
 * not in the tail falls back to the prompt or the session name.
 */
export const TITLE_SCRIPT = [
  'd="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"',
  'for spec; do',
  '  mode=${spec%%:*}; f="$d/${spec#*:}.jsonl"',
  '  t=$(tail -c 262144 "$f" 2>/dev/null)',
  '  a=$(printf %s "$t" | grep -F \'"type":"custom-title"\' | tail -n 1)',
  '  [ -z "$a" ] && a=$(printf %s "$t" | grep -F \'"type":"ai-title"\' | tail -n 1)',
  '  p=$(printf %s "$t" | grep -F \'"type":"last-prompt"\' | tail -n 1)',
  '  m=$(printf %s "$t" | grep -o \'"model":"[^"]*"\' | tail -n 1)',
  '  l=$(printf %s "$t" | grep -E \'"type":"(user|assistant)"\' | tail -n 1)',
  '  u=$(printf %s "$t" | grep -F \'"type":"assistant"\' | grep -F \'"usage":{\' | grep -vF \'"isSidechain":true\' | tail -n 1 | grep -oE \'"(input_tokens|cache_creation_input_tokens|cache_read_input_tokens)":[0-9]+\' | tr "\\n" " ")',
  '  printf \'%s\\037%s\\037%s\\037%s\\037%s\\036\' "$a" "$p" "$m" "$l" "$u"',
  'done',
  'exit 0',
].join('\n')

/** Prints, per directory argument, its git branch (else short commit) and absolute common git dir. */
export const BRANCH_SCRIPT = [
  'for d; do',
  '  b=$(git -C "$d" branch --show-current 2>/dev/null)',
  '  [ -z "$b" ] && b=$(git -C "$d" rev-parse --short HEAD 2>/dev/null)',
  '  c=$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)',
  '  printf \'%s\\037%s\\036\' "$b" "$c"',
  'done',
  'exit 0',
].join('\n')

const parsed = (line: string): Record<string, unknown> | undefined => {
  try {
    const one = JSON.parse(line) as unknown
    return one && typeof one === 'object' ? (one as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** The first non-empty line of a prompt, collapsed. */
const promptLineOf = (text: string) => text.split('\n').map(line => line.trim()).find(Boolean)?.replace(/\s+/g, ' ')

/** A title from the reader's two records: the `/rename` or AI title, else the last prompt's first line. */
export const titleOf = (aiLine: string, promptLine: string): { title?: string; isAi?: boolean } => {
  const record = parsed(aiLine)
  const ai = record?.customTitle ?? record?.aiTitle
  if (typeof ai === 'string' && ai.trim()) return { title: ai.trim(), isAi: true }
  const prompt = parsed(promptLine)?.lastPrompt
  const line = typeof prompt === 'string' ? promptLineOf(prompt) : undefined
  return line ? { title: line } : {}
}

/** Request phrases that ask the Owner without a question mark. */
const ASKING = /\b(should i|shall i|do you want|would you like|which (one |option )?do you prefer|let me know|your call|please confirm|can you confirm|reply with|tell me (which|whether|if))\b/i
/** A closing choice list: lines led by `(A)`, `A)` or `Option A`, then the same for B. */
const CHOICES = /(^|\n)\W*(\(A\)|A\)|Option A\b)[\s\S]*\n\W*(\(B\)|B\)|Option B\b)/

/**
 * Whether a finished turn's text asks the Owner something: with code blocks left out, one of the last
 * two paragraphs ends in `?` or holds a request phrase (a closing status line often follows the
 * question), or the text closes on an A/B choice list. A heuristic (no session marks its questions):
 * a miss still leaves the card Done.
 */
export const asksOwner = (text: string): boolean => {
  const prose = text.replace(/```[\s\S]*?```/g, '').trim()
  if (!prose) return false
  const paragraphs = prose.split(/\n\s*\n/).map(one => one.trim()).filter(Boolean)
  const closing = paragraphs.slice(-2)
  const asks = (paragraph: string) => paragraph.replace(/[\s*_`"')\]]+$/, '').endsWith('?') || ASKING.test(paragraph)
  return closing.some(asks) || CHOICES.test(paragraphs.slice(-6).join('\n'))
}

/**
 * When the session asked the Owner, from its last user or assistant entry: an assistant entry whose
 * blocks are text only (no tool call) and whose text asks (`asksOwner`); undefined otherwise.
 */
export const askedAtOf = (lastLine: string): number | undefined => {
  const entry = parsed(lastLine)
  if (entry?.type !== 'assistant') return undefined
  const content = (entry.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content) || content.length === 0) return undefined
  const blocks = content as Array<{ type?: unknown; text?: unknown }>
  if (blocks.some(block => block.type !== 'text' && block.type !== 'thinking')) return undefined
  const text = blocks.map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('\n')
  const at = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN
  return asksOwner(text) && Number.isFinite(at) ? at : undefined
}

/**
 * The tokens the last main-thread response was answered over (uncached, cache-written and cache-read
 * input together, as Claude Code counts context), from the reader's usage field; the first count of
 * each kind wins. Undefined when the field names none.
 */
export const contextTokensOf = (field: string): number | undefined => {
  const counts = new Map<string, number>()
  for (const [, key, value] of field.matchAll(/"(input_tokens|cache_creation_input_tokens|cache_read_input_tokens)":(\d+)/g)) {
    if (!counts.has(key!)) counts.set(key!, Number(value))
  }
  if (counts.size === 0) return undefined
  return [...counts.values()].reduce((total, one) => total + one, 0)
}

/** The reader's output split into items of fields. */
export const itemsOf = (stdout: string) => stdout.split(ITEM).slice(0, -1).map(item => item.split(FIELD))

/**
 * The sessions whose title must be read: those whose `updatedAt` moved since
 * the last read. Each comes with its reader argument; `full` while no AI title is known.
 */
export const staleTitlesOf = (registry: readonly RegistryEntry[], titles: Readonly<Record<string, Title>>) => {
  const stale: { sessionId: string; at: number; arg: string }[] = []
  for (const entry of registry) {
    const path = transcriptOf(entry)
    if (!path) continue
    const at = entry.updatedAt ?? entry.startedAt
    const known = titles[entry.sessionId]
    if (known && known.at === at) continue
    stale.push({ sessionId: entry.sessionId, at, arg: `${known?.isAi ? 'tail' : 'full'}:${path}` })
  }
  return stale
}

/** A fresh read merged into the cache: a tail without an AI title keeps the known AI title. */
export const mergedTitle = (known: Title | undefined, at: number, read: { title?: string; isAi?: boolean }): Title => {
  if (!read.isAi && known?.isAi) return { ...known, at }
  return { at, ...read }
}

/** Each directory's newest `updatedAt`: a directory's branch is read again only when it moves. */
export const staleDirsOf = (registry: readonly RegistryEntry[], places: Readonly<Record<string, Place>>) => {
  const newest = new Map<string, number>()
  for (const entry of registry) {
    if (!entry.cwd) continue
    const at = entry.updatedAt ?? entry.startedAt
    newest.set(entry.cwd, Math.max(newest.get(entry.cwd) ?? 0, at))
  }
  return [...newest].filter(([cwd, at]) => places[cwd]?.at !== at).map(([cwd, at]) => ({ cwd, at }))
}

const baseOf = (path: string) => path.replace(/\/+$/, '').split('/').at(-1) ?? path

/** The project a directory belongs to: the main checkout's folder for a worktree, else the folder's own name. */
export const projectNameOf = (cwd: string, commonDir: string | undefined) => {
  const common = commonDir?.trim().replace(/\/+$/, '')
  if (common?.endsWith('/.git')) return baseOf(common.slice(0, -'/.git'.length))
  if (common?.endsWith('.git')) return baseOf(common).slice(0, -'.git'.length)
  return baseOf(cwd)
}

/** One stable, distinct color per project name (a stable hash). */
export const colorsOf = (projects: readonly string[]) => projectColorsById(projects, {})

/** The card's three texts: project, title, branch line; the project is empty when no directory is known, never invented. */
export const cardTextOf = (row: Row, title: Title | undefined, place: Place | undefined) => ({
  project: place?.project ?? (row.cwd ? projectNameOf(row.cwd, undefined) : ''),
  title: title?.title ?? row.name,
  branch: place?.branch,
})

/** Child status tones in urgency order, for the badge's discs. */
const BADGE_ORDER: readonly Tone[] = ['error', 'warning', 'success', 'subtle']

/** The child badge: up to three discs, most urgent first, and the count. */
export const badgeOf = (children: readonly ChildRow[]) => {
  const tones = children.map(child => statusLabelOf(child.status).tone)
  const dots = [...tones].sort((a, b) => BADGE_ORDER.indexOf(a) - BADGE_ORDER.indexOf(b)).slice(0, 3)
  return { dots, count: children.length }
}
