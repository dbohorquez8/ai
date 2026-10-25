// Ticket progress for the own card: the reported tickets, each ticket's colour, and the bar cells. Pure: no `$`, no drawing (layout.ts draws).

import type { Report, TicketState } from './report'
import type { Hue } from './types'
import { cellWidth } from './width'

/** The longest bar, in cells. */
export const MAXBAR = 12
/** The shortest bar drawn; below this the line shows the count only. */
export const MIN_BAR = 5
export const BAR_CELL = '━'
export const BAR_END = '╸'

export type TicketColor = TicketState
export const TICKET_RUN_ORDER: readonly TicketColor[] = ['done', 'in_progress', 'planned']
export const TICKET_HUE: Readonly<Record<TicketColor, Hue>> = { done: 'green', in_progress: 'blue', planned: 'gray' }

export type Ticket = { id: string; state: TicketState; color: TicketColor }
export type TicketProgress = { tickets: readonly Ticket[]; done: number; total: number; chip: string | null }

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

/** null when there is no report or it holds no ticket. Reads the reported states only; never a worker. */
export const ticketProgressOf = (report: Report | null): TicketProgress | null => {
  if (!report || report.tickets.length === 0) return null
  const tickets: Ticket[] = report.tickets.map(one => ({ id: one.id, state: one.state, color: one.state }))
  return {
    tickets,
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
