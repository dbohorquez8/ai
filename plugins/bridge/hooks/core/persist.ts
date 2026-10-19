// What the pane keeps in the plugin store, one key per entry, and how a stored value is read back.
// Pure: the caller lists and reads the keys; this validates them. A value that fails its
// schema is named in `resetKeys`, and its default is used (AC-119).

import { PREF_PREFIX } from '../sidebar-policy'
import { DEFAULT_COLLAPSED, SHELF_ORDER } from './types'
import type { Entry, Layout, Settings, ShelfId, SortMode, Stored } from './types'

export { PREF_PREFIX }

export const PRUNE_AFTER_MS = 30 * 86_400_000

export const KEYS = { shelves: 'shelves', sort: 'sort', layout: 'layout', icons: 'setting:icons', theme: 'setting:theme', workingShelf: 'setting:workingShelf', caption: 'scene:caption', tickets: 'setting:tickets', softLimit: 'setting:softLimit', sound: 'setting:sound' } as const

/** The default soft limit: where the smart zone ends when no soft limit is set. */
export const DEFAULT_SOFT_LIMIT = 150_000

const SORTS: readonly SortMode[] = ['recent', 'created', 'project']
const THEMES: ReadonlyArray<Settings['theme']> = ['auto', 'dark', 'light']

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(one => typeof one === 'string')

const FLAGS = ['isPinned', 'isParked', 'isSettled'] as const
const TIMES = ['parkedAt', 'settledAt', 'snoozedUntil', 'snoozedAt', 'wokeAt', 'ackAt', 'seenAt'] as const

/** A stored value as an Entry, or undefined when a known field has the wrong type. Unknown fields are kept. */
const entryOf = (value: unknown): Entry | undefined => {
  if (!isRecord(value)) return undefined
  for (const flag of FLAGS) if (value[flag] !== undefined && value[flag] !== true) return undefined
  for (const time of TIMES) if (value[time] !== undefined && !isTime(value[time])) return undefined
  return { ...value } as Entry
}

const layoutOf = (value: unknown): Layout | undefined =>
  isRecord(value) && value.v === 1 && isIds(value.active) && isIds(value.pinned) ? { ...value, v: 1, active: value.active, pinned: value.pinned } : undefined

const collapsedOf = (value: unknown): Record<ShelfId, boolean> | undefined => {
  if (!isRecord(value)) return undefined
  const out: Record<ShelfId, boolean> = { ...DEFAULT_COLLAPSED }
  for (const id of SHELF_ORDER) {
    const one = value[id]
    if (one === undefined) continue
    if (typeof one !== 'boolean') return undefined
    out[id] = one
  }
  return out
}

/** The stored state from the raw key-value map; every key that failed its schema is listed to delete. */
export const loadStored = (raw: ReadonlyMap<string, unknown>): { stored: Stored; resetKeys: string[] } => {
  const resetKeys: string[] = []
  const entries: Record<string, Entry> = {}
  for (const [key, value] of raw) {
    if (!key.startsWith(PREF_PREFIX) || value === undefined) continue
    const entry = entryOf(value)
    if (entry) entries[key.slice(PREF_PREFIX.length)] = entry
    else resetKeys.push(key)
  }
  const read = <T>(key: string, parse: (value: unknown) => T | undefined, fallback: T): T => {
    const value = raw.get(key)
    if (value === undefined) return fallback
    const parsed = parse(value)
    if (parsed === undefined) {
      resetKeys.push(key)
      return fallback
    }
    return parsed
  }
  // 'manual' was a mode until the Owner removed it; it reads as the default, without the reset note.
  const sort = read<SortMode>(KEYS.sort, value => (value === 'manual' ? 'recent' : SORTS.find(one => one === value)), 'recent')
  const layout = read<Layout>(KEYS.layout, layoutOf, { v: 1, active: [], pinned: [] })
  const collapsed = read<Record<ShelfId, boolean>>(KEYS.shelves, collapsedOf, { ...DEFAULT_COLLAPSED })
  const icons = read<boolean>(KEYS.icons, value => (typeof value === 'boolean' ? value : undefined), true)
  const theme = read<Settings['theme']>(KEYS.theme, value => THEMES.find(one => one === value), 'auto')
  const workingShelf = read<boolean>(KEYS.workingShelf, value => (typeof value === 'boolean' ? value : undefined), false)
  const caption = read<number | undefined>(KEYS.caption, value => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined), undefined)
  const tickets = read<readonly string[]>(KEYS.tickets, ticketPrefixesOf, [])
  const softLimit = read<number | undefined>(KEYS.softLimit, value => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined), undefined)
  const sound = read<boolean | undefined>(KEYS.sound, value => (typeof value === 'boolean' ? value : undefined), undefined)
  const stored: Stored = { entries, layout, sort, collapsed, settings: { icons, theme, workingShelf, ...(tickets.length > 0 ? { tickets } : {}), ...(softLimit !== undefined ? { softLimit } : {}), ...(sound !== undefined ? { sound } : {}) } }
  if (caption !== undefined) stored.caption = caption
  return { stored, resetKeys }
}

/** Ticket prefixes: non-empty words without spaces or commas, at most 16 characters, case kept; undefined when invalid. */
export const ticketPrefixesOf = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const prefixes = value.map(one => (typeof one === 'string' ? one.trim() : '')).filter(Boolean)
  if (prefixes.length > 100 || prefixes.some(one => one.length > 16 || /[\s,]/.test(one))) return undefined
  return [...new Set(prefixes)]
}

/** A soft limit as accepted: `150000`, `150k`, `1.5m`; undefined for anything else. */
export const softLimitOf = (raw: string): number | undefined => {
  const match = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(raw.trim().toLowerCase().replace(/[_,\s]/g, ''))
  if (!match) return undefined
  const value = Math.round(Number(match[1]) * (match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1))
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** The `/bridge` argument forms, shown after the command name. */
export const SIDEBAR_ARGS_HINT = 'icons on|off · working-shelf on|off · theme auto|light|dark · tickets WS-,AID-|off · soft-limit 150k|off · sound on|off'

/**
 * A `/bridge` setting from its typed arguments (settings stay off the sidebar, so the pane has no
 * settings rows): `icons on|off`, `working-shelf on|off`, `theme auto|light|dark`, and `tickets` with a
 * comma-separated prefix list (the ticket prefixes) or `off`, and `soft-limit` with a token count
 * (the soft limit) or `off`, and `sound on|off` (the needs-you chime). Empty arguments are no setting (the
 * command opens the pane); anything else is an error naming the forms.
 */
export const sidebarSettingOf = (args: string):
  | { key: typeof KEYS.icons | typeof KEYS.workingShelf | typeof KEYS.sound; value: boolean; label: string }
  | { key: typeof KEYS.theme; value: 'auto' | 'light' | 'dark'; label: string }
  | { key: typeof KEYS.tickets; value: string[]; label: string }
  | { key: typeof KEYS.softLimit; value: number; label: string }
  | { error: string }
  | undefined => {
  const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return undefined
  const [name, value] = words
  if (words.length === 2 && (name === 'icons' || name === 'working-shelf') && (value === 'on' || value === 'off')) {
    return { key: name === 'icons' ? KEYS.icons : KEYS.workingShelf, value: value === 'on', label: `${name === 'icons' ? 'Project icons' : 'Working shelf'}: ${value}` }
  }
  if (words.length === 2 && name === 'sound' && (value === 'on' || value === 'off')) return { key: KEYS.sound, value: value === 'on', label: `Needs-you chime: ${value}` }
  if (words.length === 2 && name === 'theme' && (value === 'auto' || value === 'light' || value === 'dark')) return { key: KEYS.theme, value, label: `Theme: ${value}` }
  if (name === 'tickets' && words.length >= 2) {
    const prefixes = words[1] === 'off' && words.length === 2 ? [] : ticketPrefixesOf(args.trim().slice('tickets'.length).split(/[\s,]+/))
    if (prefixes) return { key: KEYS.tickets, value: [...prefixes], label: prefixes.length > 0 ? `Ticket prefixes: ${prefixes.join(', ')}` : 'Ticket prefixes: off' }
  }
  if (name === 'soft-limit' && words.length >= 2) {
    if (words[1] === 'off' && words.length === 2) return { key: KEYS.softLimit, value: 0, label: 'Soft limit: off' }
    const limit = softLimitOf(words.slice(1).join(''))
    if (limit !== undefined) return { key: KEYS.softLimit, value: limit, label: `Soft limit: ${limit.toLocaleString('en-US')} tokens` }
  }
  return { error: `Unknown setting. Use: /bridge ${SIDEBAR_ARGS_HINT}` }
}

/** Where a model's context window is kept, as Claude Code reported it to a pane on that model (AC-94). */
export const WINDOW_PREFIX = 'window:'

/** The stored context windows by full model id; a value that is not a positive whole number is left out. */
export const windowsOf = (raw: ReadonlyMap<string, unknown>): Record<string, number> => {
  const windows: Record<string, number> = {}
  for (const [key, value] of raw) {
    if (key.startsWith(WINDOW_PREFIX) && typeof value === 'number' && Number.isInteger(value) && value > 0) windows[key.slice(WINDOW_PREFIX.length)] = value
  }
  return windows
}

/** The `pref:` keys to delete: unseen for 30 days and not live. An entry never stamped is kept until it is. */
export const prunedKeys = (entries: Readonly<Record<string, Entry>>, liveIds: ReadonlySet<string>, now: number): string[] =>
  Object.entries(entries)
    .filter(([id, entry]) => entry.seenAt !== undefined && entry.seenAt < now - PRUNE_AFTER_MS && !liveIds.has(id))
    .map(([id]) => `${PREF_PREFIX}${id}`)
