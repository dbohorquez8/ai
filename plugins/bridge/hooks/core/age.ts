// Age and time-left labels for the status slot. A future timestamp reads 'now'.
// The time-left label follows the snooze wake label of the design.
// Portions adapted from MIT-licensed code; Copyright (c) 2026 Michael Yong, Copyright (c) 2026 Yusuf Akbulut; design reference Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "now", "5m", "2h", "3d", "2w": floored, days until 14 days, then weeks (AC-26). */
export const ageLabel = (since: number, now: number): string => {
  const elapsed = now - since
  if (elapsed < MINUTE) return 'now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`
  if (elapsed < 14 * DAY) return `${Math.floor(elapsed / DAY)}d`
  return `${Math.floor(elapsed / (7 * DAY))}w`
}

/** Time until `until`, rounded up so a snooze never reads "0m" while it still hides the card. */
export const timeLeftLabel = (until: number, now: number): string => {
  const remaining = until - now
  if (remaining <= 0) return 'now'
  const minutes = Math.max(1, Math.ceil(remaining / MINUTE))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.ceil(remaining / HOUR)
  if (hours < 24) return `${hours}h`
  return `${Math.ceil(remaining / DAY)}d`
}
