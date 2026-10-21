// Pure logic of the sidebar pane: no `$`, so the tests call it directly.

import type { Pref, Row, ChildRow } from '../types'

export const REFRESH_MS = 5000
export const PREF_PREFIX = 'pref:'

/** One row of ListAgents' `sections[].rows`, as the tool's result types it. */
export type ListedRow = { name?: string; ref?: string; id?: string; type?: string; status?: string }
export type ListedSection = { kind: string; total: number; rows: ListedRow[] }
export type Listing = { listing?: string; sections?: ListedSection[] }

/**
 * ListAgents sections that list this session's own agent loops (`subagents`, `teammates`): they are child
 * rows under the own card, never sessions, so a finished subagent never becomes a card of its own.
 */
export const CHILD_SECTION_KINDS: ReadonlySet<string> = new Set(['subagents', 'teammates'])

/** The rows of a ListAgents result, one per listed session that has an address; agent sections are left out. */
export const rowsOf = (listing: Listing | undefined): Row[] => {
  const rows: Row[] = []
  const seen = new Set<string>()
  for (const section of listing?.sections ?? []) {
    if (CHILD_SECTION_KINDS.has(section.kind)) continue
    for (const one of section.rows ?? []) {
      const id = one.id ?? one.ref ?? one.name
      if (!id || seen.has(id)) continue
      seen.add(id)
      rows.push({
        id,
        name: one.name ?? one.ref ?? id,
        kind: section.kind,
        type: one.type ?? '',
        status: one.status ?? '',
      })
    }
  }
  return rows
}

/** Subagents spawned by the main loop and their children, as child rows. */
export const childRowsOf = (agents: ReadonlyArray<{ id: string; description: string; type: string; status: string; name?: string; parentId?: string }>): ChildRow[] =>
  agents.map(agent => ({
    id: agent.id,
    name: agent.name ?? agent.description ?? agent.type,
    type: agent.type,
    status: agent.status,
    depth: agent.parentId ? 2 : 1,
  }))

/** The store key a session's preferences are kept under. */
export const prefKeyOf = (id: string) => `${PREF_PREFIX}${id}`

/** A stored value read back as a Pref; anything else is no preference. */
export const prefOf = (value: unknown): Pref => {
  if (!value || typeof value !== 'object') return {}
  const one = value as Record<string, unknown>
  if (one.isPinned === true) return { isPinned: true }
  if (one.isParked === true) return { isParked: true }
  return {}
}

/** Pin and park exclude each other: pinning unparks, parking unpins. */
export const toggled = (pref: Pref, action: 'pin' | 'park'): Pref =>
  action === 'pin'
    ? pref.isPinned ? {} : { isPinned: true }
    : pref.isParked ? {} : { isParked: true }

/**
 * One entry of `~/.claude/sessions/<pid>.json`: Claude Code's own registry of
 * live sessions. Internal and undocumented, so every field is checked.
 */
export type RegistryEntry = { sessionId: string; name: string; cwd: string; status: string; kind: string; pid: number; startedAt: number; updatedAt?: number; statusUpdatedAt?: number; waitingFor?: string; contextPercent?: number }

/** What the registry reader prints between files. */
export const REGISTRY_SEPARATOR = '\u001e'

/** The shell line that prints every registry file, each followed by the separator. */
export const REGISTRY_SCRIPT =
  'for f in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/sessions/*.json; do [ -f "$f" ] && cat "$f" && printf \'\\036\'; done; exit 0'

const textOf = (value: unknown) => (typeof value === 'string' ? value : '')

/** The registry entries in the reader's output; a file that is not one is skipped. */
export const registryOf = (stdout: string): RegistryEntry[] => {
  const entries: RegistryEntry[] = []
  for (const chunk of stdout.split(REGISTRY_SEPARATOR)) {
    if (!chunk.trim()) continue
    let one: Record<string, unknown>
    try {
      one = JSON.parse(chunk) as Record<string, unknown>
    } catch {
      continue
    }
    if (!one || typeof one !== 'object') continue
    const sessionId = textOf(one.sessionId)
    const name = textOf(one.name)
    if (!sessionId || !name) continue
    const entry: RegistryEntry = { sessionId, name, cwd: textOf(one.cwd), status: textOf(one.status), kind: textOf(one.kind), pid: typeof one.pid === 'number' ? one.pid : 0, startedAt: typeof one.startedAt === 'number' ? one.startedAt : 0 }
    if (typeof one.updatedAt === 'number') entry.updatedAt = one.updatedAt
    if (typeof one.statusUpdatedAt === 'number') entry.statusUpdatedAt = one.statusUpdatedAt
    else if (typeof one.statusSince === 'number') entry.statusUpdatedAt = one.statusSince
    if (textOf(one.waitingFor)) entry.waitingFor = textOf(one.waitingFor)
    else if (textOf(one.reason)) entry.waitingFor = textOf(one.reason)
    if (typeof one.contextPercent === 'number') entry.contextPercent = one.contextPercent
    entries.push(entry)
  }
  return entries
}

/** A registry entry's fields on a row; the registry's status wins, as it alone says `waiting`. */
const withEntry = (row: Row, entry: RegistryEntry): Row => {
  const next: Row = { ...row, sessionId: entry.sessionId, cwd: entry.cwd, pid: entry.pid || undefined, startedAt: entry.startedAt, status: entry.status || row.status }
  if (entry.updatedAt !== undefined) next.updatedAt = entry.updatedAt
  if (entry.statusUpdatedAt !== undefined) next.statusUpdatedAt = entry.statusUpdatedAt
  if (entry.waitingFor !== undefined) next.waitingFor = entry.waitingFor
  return next
}

/** Rows joined to the registry by name: each match gains its session id, directory, pid, times and status. */
export const joined = (rows: readonly Row[], registry: readonly RegistryEntry[]): Row[] => {
  const byName = new Map<string, RegistryEntry | null>()
  for (const entry of registry) byName.set(entry.name, byName.has(entry.name) ? null : entry)
  return rows.map(row => {
    const entry = byName.get(row.name)
    return entry ? withEntry(row, entry) : row
  })
}

/**
 * The rows with this session's own first: ListAgents leaves the caller out,
 * so its row comes from the registry entry that carries its session id.
 */
export const withSelf = (rows: readonly Row[], registry: readonly RegistryEntry[], selfId: string): Row[] => {
  if (!selfId || rows.some(row => row.sessionId === selfId)) return [...rows]
  const entry = registry.find(one => one.sessionId === selfId)
  if (!entry) return [...rows]
  return [withEntry({ id: entry.sessionId, name: entry.name, kind: 'sessions', type: 'session', status: '' }, entry), ...rows]
}

/** Where a row's pin and park are kept: its session id, else its listed address. */
export const prefIdOf = (row: Row) => row.sessionId ?? row.id

const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`

/**
 * The command that opens a listed session in a terminal of its own, or
 * undefined when its session id is unknown: a ListAgents ref is never an id.
 * `--resume` finds a session by its project directory, so the line cds first.
 */
export const resumeCommandOf = (row: Row): string | undefined => {
  if (!row.sessionId) return undefined
  return row.cwd ? `cd ${quoted(row.cwd)} && claude --resume ${row.sessionId}` : `claude --resume ${row.sessionId}`
}

/** What a row press shows when there is no command to copy. */
export const unavailableOf = (row: Row) => `${row.name}: resume unavailable (session id unknown)`
