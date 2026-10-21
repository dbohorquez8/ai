// The shelf and inactivity rules, reshaped for session cards.
// Portions adapted from MIT-licensed code; Copyright (c) 2026 Michael Yong, Copyright (c) 2026 Yusuf Akbulut; design reference Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.

import { PREF_PREFIX } from '../sidebar-policy'
import type { Entry, Session, ShelfId, Status } from './types'

export const INACTIVE_AFTER_MS = 6 * 3_600_000
export const SEEN_STAMP_MS = 86_400_000

/** Whether a status asks for the Owner: Needs you, or Failed. */
const isAsking = (status: Status) => status === 'needs-you' || status === 'failed'

/**
 * Why a snoozed card is back, if it is: the session started working, asked
 * for the Owner or failed ('attention'), or the wake time passed ('timer').
 */
export const wakeOf = (entry: Entry | undefined, status: Status, now: number): 'timer' | 'attention' | null => {
  if (entry?.snoozedUntil === undefined) return null
  if (isAsking(status) || status === 'working') return 'attention'
  return now >= entry.snoozedUntil ? 'timer' : null
}

/** Whether a parked or settled card has more to say than when it was filed: it works, asks, failed or finished since. */
export const returnedOf = (at: number | undefined, status: Status, finishedAt: number | undefined): boolean => {
  if (status === 'working' || isAsking(status)) return true
  return status === 'done' && finishedAt !== undefined && finishedAt > (at ?? 0)
}

/** Whether a card carries the Woke mark: the wake was recorded, or it is happening now. */
export const isWoke = (entry: Entry | undefined, status: Status, now: number): boolean =>
  entry?.wokeAt !== undefined || wakeOf(entry, status, now) !== null

/**
 * The shelf a card is on now. A pin wins, then a raised hand (Needs you, Failed), then live work;
 * then snooze, park and settle until the session returns; then Inactive for an
 * idle session untouched for 6 hours. A card that woke from a snooze goes to
 * Active so the mark is seen, even when its session is old. Background and Check? are no raised hand: a card put away
 * stays put away, else it is Active. Live work goes to
 * the Working shelf only while that setting is on (AC-08a); otherwise it stays in Active.
 */
export const shelfOf = (s: Session, status: Status, entry: Entry | undefined, finishedAt: number | undefined, now: number, workingShelf = false): ShelfId => {
  if (entry?.isPinned) return 'pinned'
  if (isAsking(status)) return 'active'
  if (status === 'working') return workingShelf ? 'working' : 'active'
  if (entry?.snoozedUntil !== undefined) return isWoke(entry, status, now) ? 'active' : 'snoozed'
  if (entry?.isParked && !returnedOf(entry.parkedAt, status, finishedAt)) return 'parked'
  if (entry?.isSettled && !returnedOf(entry.settledAt, status, finishedAt)) return 'settled'
  if (status === 'idle' && s.activityAt > 0 && s.activityAt <= now - INACTIVE_AFTER_MS) return 'inactive'
  return 'active'
}

export type Patch = { key: string; entry: Entry | undefined }

const pick = <T>(record: Readonly<Record<string, T>>, s: Session): T | undefined => record[s.prefId] ?? record[s.id]

/**
 * The store writes a refresh owes: `wokeAt` on the first wake, park and settle
 * dropped once the session returned, and `seenAt` stamped on a live session's
 * existing entry. A session with no stored entry gets none.
 */
export const reconcile = (
  sessions: readonly Session[],
  statuses: Readonly<Record<string, Status>>,
  entries: Readonly<Record<string, Entry>>,
  finished: Readonly<Record<string, number>>,
  now: number,
): Patch[] => {
  const patches: Patch[] = []
  for (const s of sessions) {
    const entry = entries[s.prefId]
    if (!entry) continue
    const status = pick(statuses, s) ?? 'idle'
    const finishedAt = pick(finished, s)
    const next: Entry = { ...entry }
    if (next.wokeAt === undefined && wakeOf(entry, status, now) !== null) next.wokeAt = now
    if (next.isParked && returnedOf(next.parkedAt, status, finishedAt)) {
      delete next.isParked
      delete next.parkedAt
    }
    if (next.isSettled && returnedOf(next.settledAt, status, finishedAt)) {
      delete next.isSettled
      delete next.settledAt
    }
    if (next.seenAt === undefined || next.seenAt < now - SEEN_STAMP_MS) next.seenAt = now
    if (JSON.stringify(next) !== JSON.stringify(entry)) patches.push({ key: `${PREF_PREFIX}${s.prefId}`, entry: next })
  }
  return patches
}

export type Action = 'pin' | 'park' | 'settle' | 'ack' | { snooze: number }

const without = (entry: Entry, ...fields: Array<keyof Entry>): Entry => {
  const next: Entry = { ...entry }
  for (const field of fields) delete next[field]
  return next
}

/**
 * An action applied to a stored entry. Pin, park and settle toggle and clear
 * each other (pinning also clears the snooze); a snooze clears the rest; an ack
 * marks the card seen and clears the snooze and the Woke mark. An entry left
 * with nothing is undefined, so the key is deleted.
 */
export const applyAction = (entry: Entry | undefined, action: Action, now: number): Entry | undefined => {
  const start: Entry = entry ?? {}
  const SNOOZE = ['snoozedUntil', 'snoozedAt', 'wokeAt'] as const
  const PARK = ['isParked', 'parkedAt'] as const
  const SETTLE = ['isSettled', 'settledAt'] as const
  let next: Entry
  if (action === 'pin') {
    next = start.isPinned ? without(start, 'isPinned') : { ...without(start, ...PARK, ...SETTLE, ...SNOOZE), isPinned: true }
  } else if (action === 'park') {
    next = start.isParked ? without(start, ...PARK) : { ...without(start, 'isPinned', ...SETTLE), isParked: true, parkedAt: now }
  } else if (action === 'settle') {
    next = start.isSettled ? without(start, ...SETTLE) : { ...without(start, 'isPinned', ...PARK), isSettled: true, settledAt: now }
  } else if (action === 'ack') {
    next = { ...without(start, ...SNOOZE), ackAt: now }
  } else {
    next = { ...without(start, 'isPinned', ...PARK, ...SETTLE, 'wokeAt'), snoozedUntil: action.snooze, snoozedAt: now }
  }
  return Object.keys(next).length === 0 ? undefined : next
}

/**
 * The hover actions a card offers (AC-56, AC-65, AC-72, AC-74): Pin always;
 * Snooze, Park and Settle only for an idle or done session; Move up and down on
 * pinned cards only (the Owner removed Manual sort).
 */
export const offeredActions = (status: Status, shelf: ShelfId): ReadonlyArray<'pin' | 'snooze' | 'park' | 'settle' | 'move-up' | 'move-down'> => {
  const actions: Array<'pin' | 'snooze' | 'park' | 'settle' | 'move-up' | 'move-down'> = ['pin']
  if (status === 'idle' || status === 'done') actions.push('snooze', 'park', 'settle')
  if (shelf === 'pinned') actions.push('move-up', 'move-down')
  return actions
}
