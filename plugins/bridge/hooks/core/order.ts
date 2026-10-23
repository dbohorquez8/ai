// Moving a pinned card by an offset, with the shelf orders of the pane.
// Portions adapted from MIT-licensed code; Copyright (c) 2026 Michael Yong, Copyright (c) 2026 Yusuf Akbulut; design reference Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.

import type { Entry, Layout, Session, ShelfId, SortMode, Status } from './types'

type Card = { s: Session; status: Status; entry?: Entry }

const byPrefId = (a: Card, b: Card) => (a.s.prefId < b.s.prefId ? -1 : a.s.prefId > b.s.prefId ? 1 : 0)
const byActivity = (a: Card, b: Card) => b.s.activityAt - a.s.activityAt || byPrefId(a, b)

/** Cards in a saved order, and cards the order does not name on top, newest activity first. */
const savedOrder = (cards: readonly Card[], saved: readonly string[]): Card[] => {
  const rank = new Map(saved.map((id, index) => [id, index]))
  const known = cards.filter(card => rank.has(card.s.prefId)).sort((a, b) => rank.get(a.s.prefId)! - rank.get(b.s.prefId)!)
  const fresh = cards.filter(card => !rank.has(card.s.prefId)).sort(byActivity)
  return [...fresh, ...known]
}

const nameOf = (card: Card) => card.s.project.toLowerCase()

/**
 * The prefIds of a shelf in drawn order. Active puts the cards that need the
 * Person first, the longest waiting on top, then the Failed cards the same way,
 * then follows the sort mode; Pinned
 * follows the saved layout; Settled is the latest settled first; the other
 * shelves are newest activity first. Ties break by prefId.
 */
export const orderShelf = (shelf: ShelfId, cards: readonly Card[], sort: SortMode, layout: Layout): string[] => {
  if (shelf === 'pinned') return savedOrder(cards, layout.pinned).map(card => card.s.prefId)
  if (shelf === 'settled') return [...cards].sort((a, b) => (b.entry?.settledAt ?? 0) - (a.entry?.settledAt ?? 0) || byPrefId(a, b)).map(card => card.s.prefId)
  if (shelf !== 'active') return [...cards].sort(byActivity).map(card => card.s.prefId)
  const longest = (a: Card, b: Card) => a.s.statusSince - b.s.statusSince || byPrefId(a, b)
  const waiting = cards.filter(card => card.status === 'needs-you').sort(longest)
  const failed = cards.filter(card => card.status === 'failed').sort(longest)
  const rest = cards.filter(card => card.status !== 'needs-you' && card.status !== 'failed')
  let ordered: Card[]
  if (sort === 'created') ordered = [...rest].sort((a, b) => (b.s.startedAt ?? 0) - (a.s.startedAt ?? 0) || byPrefId(a, b))
  else if (sort === 'project') ordered = [...rest].sort((a, b) => (nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0) || byActivity(a, b))
  else ordered = [...rest].sort(byActivity)
  return [...waiting, ...failed, ...ordered].map(card => card.s.prefId)
}

/** The order with one id swapped with its neighbour; at an edge, or for an unknown id, nothing moves. */
export const moved = (drawn: readonly string[], id: string, offset: -1 | 1): string[] => {
  const index = drawn.indexOf(id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= drawn.length) return [...drawn]
  const next = [...drawn]
  next[index] = drawn[target]!
  next[target] = id
  return next
}
