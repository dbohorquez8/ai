// The own session's subagents as child rows: what the agent list reports now, plus the finished ones
// it has already forgotten. The engine drops an ended agent from its list seconds to minutes after it
// ends, so a finished child stays listed here for the rest of the session. Pure: no `$`.

import type { Child, ChildStatus } from './types'

/** When each child first showed its status, and when it started. */
export type ChildSeen = { status: string; since: number; startedAt: number }

/** At most this many finished children are kept once the agent list no longer reports them (oldest first to go). */
export const MAX_KEPT_FINISHED = 20

const STATUS_OF: Readonly<Record<string, ChildStatus>> = { running: 'working', pending: 'working', waiting: 'working', completed: 'done', idle: 'done', failed: 'failed', killed: 'idle' }

const numberOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** Whether a child status means the subagent ended: Done, Failed or killed (age only). */
export const isFinishedStatus = (status: ChildStatus): boolean => status === 'done' || status === 'failed' || status === 'idle'

/**
 * The child rows after one read of the agent list. Each listed agent keeps the time it has shown its
 * tag; a finished child the list no longer reports stays as it was last seen, up to MAX_KEPT_FINISHED.
 * One that vanished while it still ran or waited is gone (the session removed it).
 */
export const childrenOf = (
  agents: ReadonlyArray<Readonly<Record<string, unknown>>>,
  old: readonly Child[],
  oldSeen: Readonly<Record<string, ChildSeen>>,
  at: number,
  needsYou: Readonly<Record<string, number>> = {},
): { list: Child[]; seen: Record<string, ChildSeen> } => {
  const seen: Record<string, ChildSeen> = {}
  const list: Child[] = agents.map(agent => {
    const id = String(agent.id)
    // `waiting` also covers background work. A real engine interaction is the only Needs you signal.
    const status = needsYou[id] === undefined ? (STATUS_OF[String(agent.status)] ?? 'done') : 'needs-you'
    const prev = oldSeen[id]
    const own = numberOf(agent.statusSince)
    const started = numberOf(agent.startedAt)
    const since = own ?? (prev && prev.status === status ? prev.since : (prev ? at : (started ?? at)))
    const startedAt = started ?? prev?.startedAt ?? at
    seen[id] = { status, since, startedAt }
    const label = [agent.description, agent.name, agent.type].find(one => typeof one === 'string' && one.trim() !== '') as string | undefined
    const parentId = typeof agent.parentId === 'string' && agent.parentId.trim() !== '' ? agent.parentId : undefined
    return { id, label: label ?? id, status, since, startedAt, ...(parentId !== undefined ? { parentId } : {}) }
  })
  const live = new Set(list.map(child => child.id))
  const kept = old
    .filter(child => !live.has(child.id) && isFinishedStatus(child.status))
    .sort((a, b) => b.since - a.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, MAX_KEPT_FINISHED - list.filter(child => isFinishedStatus(child.status)).length))
  for (const child of kept) seen[child.id] = oldSeen[child.id] ?? { status: child.status, since: child.since, startedAt: child.startedAt }
  return { list: [...list, ...kept], seen }
}
