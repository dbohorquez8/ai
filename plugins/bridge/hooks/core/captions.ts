// WORKING_CAPTIONS, the working-scene captions; the picker keeps no module state.
// Portions adapted from MIT-licensed code; Copyright (c) 2026 Michael Yong, Copyright (c) 2026 Yusuf Akbulut; design reference Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.

export const ALL_CLEAR = 'All clear. Time to touch some grass.'

/** What Active says while every session is working. */
export const WORKING_CAPTIONS: readonly string[] = [
  "Everyone's busy. Go grab a coffee.",
  'All hands on deck. Go stretch your legs.',
  'Nothing needs you. Go touch grass.',
  "Everyone's working. Refill your water.",
  "Go grab a snack. They'll ping you.",
  "Heads down. We'll call you when we're done.",
  'All threads are cooking.',
  'Busy little bees. Nothing for you yet.',
  "Everyone's typing. Nobody needs you.",
  'The team is in the zone.',
  'Shh. Genius at work.',
  'Nothing needs you right now.',
  'All quiet on your end.',
  "Every thread is running. You're free.",
  "Your inbox is empty. Theirs isn't.",
  'Zero asks. Enjoy it while it lasts.',
  'Your agents are earning their tokens.',
  "Plants watered, agents busy, you're free.",
]

/** The index of the next working caption, never the one shown last time. */
export const nextCaption = (previous: number | undefined, random: () => number): number => {
  const count = WORKING_CAPTIONS.length
  const draw = (range: number) => Math.min(range - 1, Math.max(0, Math.floor(random() * range)))
  if (previous === undefined || !Number.isInteger(previous) || previous < 0 || previous >= count) return draw(count)
  const pick = draw(count - 1)
  return pick >= previous ? pick + 1 : pick
}
