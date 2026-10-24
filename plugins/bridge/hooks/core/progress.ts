// Ticket progress for the own card: which workers belong to which ticket, each ticket's status, their
// order, and the bar cells. Pure: no `$`, no drawing (layout.ts draws).

import type { Child, Hue } from './types'
import { ticketIdIn } from './tickets'
import { cellWidth } from './width'

/** The longest bar, in cells (plan L-2). */
export const MAXBAR = 12
/** The shortest bar drawn; below this the line shows the count only. */
export const MIN_BAR = 5
export const BAR_CELL = '━'
export const BAR_END = '╸'

export type TicketStatus = 'working' | 'needs-you' | 'failed' | 'done' | 'stopped'
export const TICKET_RUN_ORDER: readonly TicketStatus[] = ['done', 'working', 'needs-you', 'failed', 'stopped']
export const TICKET_HUE: Record<TicketStatus, Hue> = { working: 'yellow', 'needs-you': 'red', failed: 'red', done: 'green', stopped: 'gray' }

export type Ticket = { id: string; status: TicketStatus; workers: readonly Child[]; newest: Child; firstStartedAt: number }
export type TicketProgress = { tickets: readonly Ticket[]; loose: readonly Child[]; done: number; total: number }

/** A worker's ticket: the first id found in its description, then its name. */
export const workerTicketOf = (child: Child, prefixes: readonly string[]): string | null => {
  for (const text of child.texts ?? [child.label]) {
    const id = ticketIdIn(text, prefixes)
    if (id !== null) return id
  }
  return null
}

/** The worker that started last; a tie goes to the one later in the list. */
const newestOf = (workers: readonly Child[]): Child => {
  let newest = workers[0]!
  for (const worker of workers) if (worker.startedAt >= newest.startedAt) newest = worker
  return newest
}

const FINISHED_STATUS: Readonly<Record<string, TicketStatus>> = { done: 'done', failed: 'failed', idle: 'stopped' }

export const ticketStatusOf = (workers: readonly Child[]): TicketStatus => {
  if (workers.some(worker => worker.status === 'needs-you')) return 'needs-you'
  if (workers.some(worker => worker.status === 'working')) return 'working'
  return FINISHED_STATUS[newestOf(workers).status] ?? 'stopped'
}

/** The tickets the workers name, in order, with the workers that name none; null unless two or more tickets. */
export const ticketProgressOf = (children: readonly Child[], prefixes: readonly string[]): TicketProgress | null => {
  if (prefixes.length === 0) return null
  const byId = new Map<string, Child[]>()
  const loose: Child[] = []
  for (const child of children) {
    const id = workerTicketOf(child, prefixes)
    if (id === null) loose.push(child)
    else byId.set(id, [...(byId.get(id) ?? []), child])
  }
  if (byId.size < 2) return null
  const tickets: Ticket[] = [...byId].map(([id, workers]) => ({
    id,
    status: ticketStatusOf(workers),
    workers,
    newest: newestOf(workers),
    firstStartedAt: Math.min(...workers.map(worker => worker.startedAt)),
  }))
  tickets.sort((a, b) => a.firstStartedAt - b.firstStartedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { tickets, loose, done: tickets.filter(ticket => ticket.status === 'done').length, total: tickets.length }
}

/** The status of each of the n cells, left to right; [] when n is below MIN_BAR. */
export const barCellsOf = (tickets: readonly Ticket[], n: number): TicketStatus[] => {
  const total = tickets.length
  if (n < MIN_BAR || total === 0) return []
  if (total <= n) {
    const base = Math.floor(n / total)
    const extra = n % total
    return tickets.flatMap((ticket, index) => Array<TicketStatus>(base + (index < extra ? 1 : 0)).fill(ticket.status))
  }
  const counts = new Map<TicketStatus, number>()
  for (const ticket of tickets) counts.set(ticket.status, (counts.get(ticket.status) ?? 0) + 1)
  const present = TICKET_RUN_ORDER.filter(status => counts.has(status))
  const lengths = new Map<TicketStatus, number>(present.map(status => [status, Math.floor((n * counts.get(status)!) / total)]))
  let leftover = n - [...lengths.values()].reduce((sum, one) => sum + one, 0)
  const byFraction = [...present].sort((a, b) => ((n * counts.get(b)!) % total) - ((n * counts.get(a)!) % total) || present.indexOf(a) - present.indexOf(b))
  for (const status of byFraction) {
    if (leftover <= 0) break
    lengths.set(status, lengths.get(status)! + 1)
    leftover--
  }
  for (const status of present) {
    if (lengths.get(status)! > 0) continue
    const longest = present.reduce((best, one) => (lengths.get(one)! > lengths.get(best)! ? one : best))
    lengths.set(longest, lengths.get(longest)! - 1)
    lengths.set(status, 1)
  }
  return present.flatMap(status => Array<TicketStatus>(lengths.get(status)!).fill(status))
}

/** The title kept at the least: itself when it is at most a character and one cell wide, else its first character and `…`. */
export const titleMinOf = (title: string): string => {
  const first = [...title][0] ?? ''
  return cellWidth(title) <= cellWidth(first) + 1 ? title : `${first}…`
}

/** The bar cells N for a title line of width `lineWidth`, chip width, title minimum width and count width (plan L-2). */
export const barWidthOf = (lineWidth: number, chipWidth: number, titleMinW: number, countWidth: number): number =>
  Math.min(MAXBAR, Math.max(0, lineWidth - chipWidth - titleMinW - 2 - countWidth))
