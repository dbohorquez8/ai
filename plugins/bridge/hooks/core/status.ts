// Status words from the session sources, merged and mapped onto the card statuses.
// Pure: no `$`, no terminal facts.

import type { Status } from './types'
import { isWorking } from '../card-policy'

const wordOf = (raw: string) => raw.trim().toLowerCase()

/** Whether a raw status word means a turn is running now: busy, running or working. */
export const isWorkingRaw = (raw: string): boolean => isWorking(raw)

/** Whether a raw status word means the session waits for the Owner. */
export const isWaitingRaw = (raw: string): boolean => wordOf(raw) === 'waiting'

/**
 * The status two sources agree on, or the one whose change is newer. Equal words
 * keep the registry's `since`; on a tie the registry, the primary source, wins.
 */
export const mergedStatusOf = (
  registry: { raw: string; since: number },
  listed?: { raw: string; observedAt: number },
): { raw: string; since: number } => {
  if (!listed || wordOf(listed.raw) === wordOf(registry.raw)) return { raw: registry.raw, since: registry.since }
  return listed.observedAt > registry.since ? { raw: listed.raw, since: listed.observedAt } : { raw: registry.raw, since: registry.since }
}

/** Whether a raw status word means the session failed: failed or error. */
export const isFailedRaw = (raw: string): boolean => wordOf(raw) === 'failed' || wordOf(raw) === 'error'

/**
 * A card shows Needs you, Working, Failed, Check?, Done (finished and not yet seen) or Idle. A turn that
 * ended on a question (`askedAt`) needs the Owner until the card is pressed after it. The own session
 * adds two facts: `failedAt`, its last turn ended on an API error (Failed until pressed; a later
 * successful stop clears it), and `background`, the background tasks its last stop listed (Check?
 * while it is otherwise idle and the list is not empty).
 */
export const statusOf = (
  raw: string,
  _since: number,
  finishedAt: number | undefined,
  ackAt: number | undefined,
  askedAt?: number,
  own: { failedAt?: number; background?: number } = {},
): Status => {
  const seen = ackAt ?? Number.NEGATIVE_INFINITY
  if (isWaitingRaw(raw)) return 'needs-you'
  if (isWorkingRaw(raw)) return 'working'
  if (isFailedRaw(raw)) return 'failed'
  if (askedAt !== undefined && askedAt > seen) return 'needs-you'
  if (own.failedAt !== undefined && own.failedAt > seen) return 'failed'
  if (own.background !== undefined && own.background > 0) return 'check'
  if (finishedAt !== undefined && finishedAt > seen) return 'done'
  return 'idle'
}

/** The own facts `statusOf` reads from a merged session. */
export const ownOf = (s: { failedAt?: number; background?: readonly unknown[] }): { failedAt?: number; background?: number } => ({
  ...(s.failedAt !== undefined ? { failedAt: s.failedAt } : {}),
  ...(s.background ? { background: s.background.length } : {}),
})

/** When the session last finished: an explicit done word, or a working or waiting status that ended in idle. */
export const finishedAtOf = (
  prev: { raw: string; since: number } | undefined,
  next: { raw: string; since: number },
  known: number | undefined,
): number | undefined => {
  const word = wordOf(next.raw)
  if (word === 'completed' || word === 'done') return next.since
  if (prev && (isWorkingRaw(prev.raw) || isWaitingRaw(prev.raw)) && !isWorkingRaw(next.raw) && !isWaitingRaw(next.raw)) return next.since
  return known
}
