/** The ticket tool: the orchestrator reports its tickets, and these rules accept or refuse each call. Pure. */

export const TICKET_TOOL = 'report_tickets'
export const TICKET_TOOL_FULL = 'mcp__bridge__report_tickets'

export const TICKET_TOOL_DESCRIPTION = 'Send every ticket each time you call this, done ones included, because each report replaces the previous list whole. Give each ticket its id, its state (planned, in_progress or done) and, when a worker carries it, that worker\'s agentId from the Agent tool result. Report again whenever a ticket\'s state changes, and make at most one report per turn. Add an epic id when all the tickets belong to one. To see the stored list without changing it, call with read_back set to true. Only the main conversation may call this tool.'

export const TICKET_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    all_tickets: {
      type: 'array',
      description: 'Every ticket, in the order to show them. Each report replaces the stored list; an empty list clears it.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The ticket id, 1 to 24 characters.' },
          state: { type: 'string', description: 'planned, in_progress or done.' },
          worker: { type: 'string', description: 'The agentId of the worker that carries the ticket, from the Agent tool result. Leave it out when no worker carries it.' },
        },
      },
    },
    epic: { type: 'string', description: 'The epic id the tickets belong to, 1 to 24 characters. Optional.' },
    read_back: { type: 'boolean', description: 'true to get the stored list back without changing it.' },
  },
} as const

export type TicketState = 'planned' | 'in_progress' | 'done'
export type ReportedTicket = { id: string; state: TicketState; worker?: string }
/** One session's accepted report as stored. `at`: when it was accepted, in clock milliseconds. */
export type Report = { v: 1; at: number; tickets: ReportedTicket[]; epic?: string }

export const MAX_TICKETS = 200
export const MAX_ID_CHARS = 24
export const REPORT_TTL_MS = 7 * 86_400_000
export const REPORT_PREFIX = 'tickets:'
export const reportKeyOf = (sessionId: string): string => `${REPORT_PREFIX}${sessionId}`

/** More than 7 days since the report was accepted (exactly 7 days is kept). */
export const isStale = (report: Report, now: number): boolean => now - report.at > REPORT_TTL_MS

const STATES: readonly string[] = ['planned', 'in_progress', 'done']
const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const cells = (text: string): number => [...text].length

const isWellFormed = (value: unknown): value is Report => {
  if (!isPlain(value) || value.v !== 1 || typeof value.at !== 'number' || !Number.isFinite(value.at) || !Array.isArray(value.tickets)) return false
  if (value.epic !== undefined && typeof value.epic !== 'string') return false
  return value.tickets.every(one => isPlain(one) && typeof one.id === 'string' && one.id !== '' && typeof one.state === 'string' && STATES.includes(one.state) && (one.worker === undefined || typeof one.worker === 'string'))
}

/** A stored value as a live report: null when absent, malformed, or stale. */
export const reportOf = (value: unknown, now: number): Report | null => (isWellFormed(value) && !isStale(value, now) ? value : null)

/** Whether a stored value under a `tickets:` key should be deleted: present, and malformed or stale. */
export const isDeadReport = (value: unknown, now: number): boolean => value !== undefined && value !== null && reportOf(value, now) === null

export type TicketCallOutcome = { text: string; isRefused: boolean; write?: { report: Report | null } }

const TAIL = ' The ticket list did not change.'
const refusal = (text: string): TicketCallOutcome => ({ text: `${text}${TAIL}`, isRefused: true })
const plural = (n: number) => `${n} ticket${n === 1 ? '' : 's'}`
const shownOf = (value: unknown): string => {
  const json = JSON.stringify(value) ?? String(value)
  return cells(json) > MAX_ID_CHARS ? `${[...json].slice(0, MAX_ID_CHARS).join('')}…` : json
}

const readBackOf = (previous: Report | null): string => {
  if (!previous) return 'The stored list is empty.'
  const head = `Stored list: ${plural(previous.tickets.length)}${previous.epic ? `, epic ${previous.epic}` : ''}.`
  return [head, ...previous.tickets.map(t => `${t.id} ${t.state}${t.worker ? `, worker ${t.worker}` : ''}`)].join('\n')
}

const isLeftOut = (value: unknown) => value === undefined || value === null

/** One call of the ticket tool, decided purely. `write` absent: the store does not change; `report: null`: delete the key. */
export const ticketCallOf = (input: Readonly<Record<string, unknown>>, previous: Report | null, now: number, isWorker: boolean): TicketCallOutcome => {
  if (isWorker) return refusal('Refused: only the main conversation can report tickets or read them back.')
  const isReadBack = input.read_back === true
  if (isReadBack && (!isLeftOut(input.all_tickets) || !isLeftOut(input.epic))) return refusal('Refused: send either all_tickets or read_back, not both.')
  if (isReadBack) return { text: readBackOf(previous), isRefused: false }
  const list = input.all_tickets
  if (isLeftOut(list)) return refusal('Refused: all_tickets is missing; send every ticket, or an empty list to clear the list.')
  if (!Array.isArray(list)) return refusal('Refused: all_tickets must be a list.')
  if (list.length > MAX_TICKETS) return refusal(`Refused: ${list.length} tickets; a report holds at most ${MAX_TICKETS}.`)
  const tickets: ReportedTicket[] = []
  for (let at = 0; at < list.length; at += 1) {
    const entry: unknown = list[at]
    const i = at + 1
    if (!isPlain(entry)) return refusal(`Refused: ticket ${i} is not an object.`)
    if (typeof entry.id !== 'string') return refusal(`Refused: ticket ${i} has no id.`)
    const id = entry.id.trim()
    if (id === '') return refusal(`Refused: ticket ${i} has an empty id.`)
    if (cells(id) > MAX_ID_CHARS) return refusal(`Refused: ticket ${i}'s id is longer than ${MAX_ID_CHARS} characters.`)
    if (tickets.some(t => t.id === id)) return refusal(`Refused: ticket ${id} is listed twice.`)
    if (isLeftOut(entry.state)) return refusal(`Refused: ticket ${id} has no state; use planned, in_progress or done.`)
    if (typeof entry.state !== 'string' || !STATES.includes(entry.state)) return refusal(`Refused: ticket ${id} has state ${shownOf(entry.state)}; use planned, in_progress or done.`)
    let worker: string | undefined
    if (!isLeftOut(entry.worker)) {
      worker = typeof entry.worker === 'string' ? entry.worker.trim() : ''
      if (worker === '') return refusal(`Refused: ticket ${id} has an empty worker.`)
    }
    tickets.push({ id, state: entry.state as TicketState, ...(worker === undefined ? {} : { worker }) })
  }
  let epic: string | undefined
  if (!isLeftOut(input.epic)) {
    epic = typeof input.epic === 'string' ? input.epic.trim() : ''
    if (epic === '') return refusal('Refused: the epic is empty.')
    if (cells(epic) > MAX_ID_CHARS) return refusal(`Refused: the epic is longer than ${MAX_ID_CHARS} characters.`)
  }
  const kept = new Set(tickets.map(t => t.id))
  const removed = (previous?.tickets ?? []).filter(t => !kept.has(t.id))
  const open = removed.filter(t => t.state !== 'done')
  const doneGone = removed.filter(t => t.state === 'done')
  const lines = [tickets.length === 0 && previous && previous.tickets.length > 0
    ? `Accepted: 0 tickets; cleared ${plural(previous.tickets.length)}.`
    : `Accepted: ${plural(tickets.length)}.`]
  if (removed.length > 0) lines.push(open.length > 0 ? `Removed ${removed.length}: ${open.map(t => t.id).join(', ')}` : `Removed ${removed.length}.`)
  if (doneGone.length > 0) lines.push(`Done tickets removed: ${doneGone.map(t => t.id).join(', ')}`)
  const report: Report | null = tickets.length > 0 ? { v: 1, at: now, tickets, ...(epic === undefined ? {} : { epic }) } : null
  return { text: lines.join('\n'), isRefused: false, write: { report } }
}
