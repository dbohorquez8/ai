// Ticket progress for the own card: the reported tickets, the listed workers they name, each ticket's
// colour and word, and the bar cells. Pure: no `$`, no drawing (layout.ts draws).

import type { Report, TicketState } from './report'
import type { Child, Hue } from './types'
import { cellWidth } from './width'

/** The longest bar, in cells. */
export const MAXBAR = 12
/** The shortest bar drawn; below this the line shows the count only. */
export const MIN_BAR = 5
export const BAR_CELL = '━'
export const BAR_END = '╸'

export type TicketColor = 'done' | 'in_progress' | 'attention' | 'planned'
export const TICKET_RUN_ORDER: readonly TicketColor[] = ['done', 'in_progress', 'attention', 'planned']
export const TICKET_HUE: Readonly<Record<TicketColor, Hue>> = { done: 'green', in_progress: 'blue', attention: 'red', planned: 'gray' }
export type TicketWord = 'Planned' | 'In progress' | 'Done' | 'Failed' | 'Needs you'

export type Ticket = { id: string; state: TicketState; color: TicketColor; word: TicketWord; worker?: Child; claimed: readonly Child[] }
export type TicketProgress = { tickets: readonly Ticket[]; rows: readonly Ticket[]; loose: readonly Child[]; done: number; total: number; chip: string | null }

/** The listed worker a report names, by its id only; should the host list one id twice, the most recently started wins, a tie going to the later-listed one. */
export const workerOf = (ref: string, children: readonly Child[]): Child | undefined => {
  let found: Child | undefined
  for (const child of children) if (child.id === ref && (!found || child.startedAt >= found.startedAt)) found = child
  return found
}

/** The worker and every listed child whose chain of parent links reaches it. */
export const claimedBy = (worker: Child, children: readonly Child[]): Child[] => {
  const byId = new Map<string, Child>()
  for (const child of children) byId.set(child.id, child)
  const claimed: Child[] = []
  for (const child of children) {
    if (child === worker) {
      claimed.push(child)
      continue
    }
    let at: Child | undefined = child
    for (let step = 0; step < children.length && at; step++) {
      const parent: string | undefined = at.parentId
      if (parent === undefined) break
      if (parent === worker.id) {
        claimed.push(child)
        break
      }
      at = byId.get(parent)
    }
  }
  if (!claimed.includes(worker)) claimed.unshift(worker)
  return claimed
}

/** `◆<epic>` when an epic is named; else the shared letters when every id is letters, `-`, digits with one letters part; else null. */
export const groupChipOf = (report: Pick<Report, 'tickets' | 'epic'>): string | null => {
  if (report.epic !== undefined) return `◆${report.epic}`
  let letters: string | undefined
  for (const ticket of report.tickets) {
    const match = /^([A-Za-z]+)-(\d+)$/.exec(ticket.id)
    if (!match) return null
    if (letters !== undefined && letters !== match[1]) return null
    letters = match[1]
  }
  return letters ?? null
}

const WORD_OF: Readonly<Record<TicketState, TicketWord>> = { planned: 'Planned', in_progress: 'In progress', done: 'Done' }

/** null when there is no report or it holds no ticket. */
export const ticketProgressOf = (report: Report | null, children: readonly Child[]): TicketProgress | null => {
  if (!report || report.tickets.length === 0) return null
  const claimedIds = new Set<Child>()
  const tickets: Ticket[] = report.tickets.map(one => {
    const worker = one.worker ? workerOf(one.worker, children) : undefined
    const claimed = worker ? claimedBy(worker, children) : []
    for (const child of claimed) claimedIds.add(child)
    const isAttention = one.state !== 'done' && claimed.some(child => child.status === 'failed' || child.status === 'needs-you')
    const word: TicketWord = isAttention ? (claimed.some(child => child.status === 'needs-you') ? 'Needs you' : 'Failed') : WORD_OF[one.state]
    return { id: one.id, state: one.state, color: isAttention ? 'attention' : one.state, word, ...(worker ? { worker } : {}), claimed }
  })
  const rows = [
    ...tickets.filter(ticket => ticket.color === 'attention'),
    ...tickets.filter(ticket => ticket.color === 'in_progress'),
    ...tickets.filter(ticket => ticket.color !== 'attention' && ticket.color !== 'in_progress'),
  ]
  return {
    tickets,
    rows,
    loose: children.filter(child => !claimedIds.has(child)),
    done: tickets.filter(ticket => ticket.state === 'done').length,
    total: tickets.length,
    chip: groupChipOf(report),
  }
}

/** The bar's segments left to right: a run per ticket when they fit, else a run per colour present. Empty below MIN_BAR. */
export const barRunsOf = (tickets: readonly Pick<Ticket, 'color'>[], n: number): { color: TicketColor; length: number }[] => {
  const total = tickets.length
  if (n < MIN_BAR || total === 0) return []
  if (total <= n) {
    const base = Math.floor(n / total)
    const extra = n % total
    return tickets.map((ticket, index) => ({ color: ticket.color, length: base + (index < extra ? 1 : 0) }))
  }
  const counts = new Map<TicketColor, number>()
  for (const ticket of tickets) counts.set(ticket.color, (counts.get(ticket.color) ?? 0) + 1)
  const present = TICKET_RUN_ORDER.filter(color => counts.has(color))
  const lengths = new Map<TicketColor, number>(present.map(color => [color, Math.floor((n * counts.get(color)!) / total)]))
  let leftover = n - [...lengths.values()].reduce((sum, one) => sum + one, 0)
  const byFraction = [...present].sort((a, b) => ((n * counts.get(b)!) % total) - ((n * counts.get(a)!) % total) || present.indexOf(a) - present.indexOf(b))
  for (const color of byFraction) {
    if (leftover <= 0) break
    lengths.set(color, lengths.get(color)! + 1)
    leftover--
  }
  for (const color of present) {
    if (lengths.get(color)! > 0) continue
    const longest = present.reduce((best, one) => (lengths.get(one)! > lengths.get(best)! ? one : best))
    lengths.set(longest, lengths.get(longest)! - 1)
    lengths.set(color, 1)
  }
  return present.map(color => ({ color, length: lengths.get(color)! }))
}

/** The colour of each of the n cells, left to right; [] when n is below MIN_BAR. */
export const barCellsOf = (tickets: readonly Pick<Ticket, 'color'>[], n: number): TicketColor[] =>
  barRunsOf(tickets, n).flatMap(run => Array<TicketColor>(run.length).fill(run.color))

/** The title kept at the least: itself when it is at most a character and one cell wide, else its first character and `…`. */
export const titleMinOf = (title: string): string => {
  const first = [...title][0] ?? ''
  return cellWidth(title) <= cellWidth(first) + 1 ? title : `${first}…`
}

/** The bar cells N for a title line of width `lineWidth`, chip width, title minimum width and count width. */
export const barWidthOf = (lineWidth: number, chipWidth: number, titleMinW: number, countWidth: number): number =>
  Math.min(MAXBAR, Math.max(0, lineWidth - chipWidth - titleMinW - 2 - countWidth))
