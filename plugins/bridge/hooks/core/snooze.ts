// The snooze presets and their wake times, fixed to the five default presets.
// Portions adapted from MIT-licensed code; Copyright (c) 2026 Michael Yong, Copyright (c) 2026 Yusuf Akbulut; design reference Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.

const HOUR_MS = 3_600_000

export const SNOOZE_LABELS = ['1 hour', '5 hours', 'This evening', 'Tomorrow morning', 'Next week'] as const

/** A local calendar time `days` from now at `hour:00`; calendar-day arithmetic keeps the local hour across a clock change. */
const localAt = (now: Date, days: number, hour: number): number => {
  const wake = new Date(now)
  wake.setDate(wake.getDate() + days)
  wake.setHours(hour, 0, 0, 0)
  return wake.getTime()
}

/**
 * The five snooze presets and their wake times, in local time. This evening is
 * 18:00 today and is left out once that has passed; Tomorrow morning is 09:00
 * tomorrow; Next week is 09:00 next Monday, and on a Sunday that is the next day.
 */
export const snoozeOptionsAt = (now: number): Array<{ label: string; wake: number }> => {
  const date = new Date(now)
  const options: Array<{ label: string; wake: number }> = [
    { label: SNOOZE_LABELS[0], wake: now + HOUR_MS },
    { label: SNOOZE_LABELS[1], wake: now + 5 * HOUR_MS },
  ]
  const evening = localAt(date, 0, 18)
  if (evening > now) options.push({ label: SNOOZE_LABELS[2], wake: evening })
  options.push({ label: SNOOZE_LABELS[3], wake: localAt(date, 1, 9) })
  options.push({ label: SNOOZE_LABELS[4], wake: localAt(date, (1 - date.getDay() + 7) % 7 || 7, 9) })
  return options
}
