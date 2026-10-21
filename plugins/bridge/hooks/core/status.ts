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

/**
 * When the shown status began, kept steady while the status word stays the same. The registry rewrites
 * `statusUpdatedAt` on each write, also when the word did not change (a working session every few
 * seconds), so its time alone would keep the age at `now`. A changed word, or no earlier one, takes `since`.
 */
export const steadySinceOf = (prev: { status: string; at: number } | undefined, raw: string, since: number, restartAt?: number): number => {
  if (!prev || prev.at <= 0 || wordOf(prev.status) !== wordOf(raw)) return since
  // The own session knows when its turn started or ended: a change after the kept start (busy, idle, busy
  // between two refreshes) restarts it. Another session's rewrites and flips look alike, so its start is kept.
  if (restartAt !== undefined && restartAt > prev.at) return restartAt
  return Math.min(prev.at, since > 0 ? since : prev.at)
}

/** Whether a raw status word means the session failed: failed or error. */
export const isFailedRaw = (raw: string): boolean => wordOf(raw) === 'failed' || wordOf(raw) === 'error'

/**
 * A card shows Needs you, Working, Failed, Background, Check?, Done (finished and not yet seen) or Idle. A turn that
 * ended on a question (`askedAt`) needs the Owner until the card is pressed after it. The own session
 * adds two facts: `failedAt`, its last turn ended on an API error (Failed until pressed; a later
 * successful stop clears it), and `background`, its background tasks in flight (Check? while it is
 * otherwise idle and the list is not empty, and also while its status word still says working after its
 * turn ended, `isTurnOver`: Claude Code keeps it `busy` while background work it waits on runs). Check?
 * replaces Background only after the configured silence period since that turn ended.
 */
export const statusOf = (
  raw: string,
  _since: number,
  finishedAt: number | undefined,
  ackAt: number | undefined,
  askedAt?: number,
  own: { failedAt?: number; background?: number; isTurnOver?: boolean; childNeedAt?: number } = {},
  now?: number,
  checkAfterMinutes = 15,
): Status => {
  const seen = ackAt ?? Number.NEGATIVE_INFINITY
  if (own.childNeedAt !== undefined) return 'needs-you'
  if (isWaitingRaw(raw)) return 'needs-you'
  // The registry keeps a session `busy` while background work it waits on runs; with no turn running that is Background.
  const hasBackground = own.background !== undefined && own.background > 0 && (own.isTurnOver === true || (own.isTurnOver !== false && !isWorkingRaw(raw)))
  if (isWorkingRaw(raw) && !hasBackground) return 'working'
  if (askedAt !== undefined && askedAt > seen) return 'needs-you'
  // The Owner's order once the turn is over: Check? before Failed, Failed before Background.
  const isSilent = checkAfterMinutes > 0 && now !== undefined && _since > 0 && now - _since >= checkAfterMinutes * 60_000
  if (hasBackground && isSilent) return 'check'
  if (isFailedRaw(raw)) return 'failed'
  if (own.failedAt !== undefined && own.failedAt > seen) return 'failed'
  if (hasBackground) return 'background'
  if (finishedAt !== undefined && finishedAt > seen) return 'done'
  return 'idle'
}

/** The own facts `statusOf` reads from a merged session. */
export const ownOf = (s: { failedAt?: number; background?: readonly unknown[]; isTurnOver?: boolean; childNeedAt?: number }): { failedAt?: number; background?: number; isTurnOver?: boolean; childNeedAt?: number } => ({
  ...(s.failedAt !== undefined ? { failedAt: s.failedAt } : {}),
  ...(s.background ? { background: s.background.length } : {}),
  ...(s.isTurnOver !== undefined ? { isTurnOver: s.isTurnOver } : {}),
  ...(s.childNeedAt !== undefined ? { childNeedAt: s.childNeedAt } : {}),
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
