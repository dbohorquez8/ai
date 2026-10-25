// Exact-width lines of a card, a shelf header and a child row. Every line is built from styled runs
// whose widths sum to the requested width, counted in terminal cells (a bell is two). Pure.

import { ageLabel, timeLeftLabel } from './age'
import { cellWidth, fitCells } from './width'
import { parseTicketId } from './tickets'
import { BAR_CELL, BAR_END, barRunsOf, barWidthOf, MIN_BAR, TICKET_HUE, titleMinOf } from './progress'
import type { Ticket, TicketProgress } from './progress'
import { STATUS_HUE } from './types'
import type { BackgroundTask, Child, GlyphMode, Palette, Seg, Session, Status } from './types'

export const MAX_CHILD_ROWS = 5
/** Below this many usable columns the project icons are hidden, the setting unchanged. */
export const ICON_MIN_COLUMNS = 30
/** The project icon's cells at the start of line 1: two for the icon, one gap. */
export const ICON_CELLS = 3
/** Full cards have one blank row between them; a selected card draws a half-row edge (`▄` above, `▀` below) in that row instead. */
export const CARD_GAP_ROWS = 1
export const CARD_EDGE_TOP = '▄'
export const CARD_EDGE_BOTTOM = '▀'
/** One terminal cell on each side of an inset pane row stays outside its exact-width content. */
export const ROW_HORIZONTAL_PADDING = 1

export type CardInput = { s: Session; status: Status; woke: boolean; snoozedUntil?: number; children: readonly Child[]; now: number; bell: 0 | 1 | 2; palette: Palette; projectColor: string; glyphMode: GlyphMode; tickets?: readonly string[]; softLimit?: number; waiting?: true; progress?: TicketProgress }

type TextSeg = Extract<Seg, { kind: 'text' }>
type Style = Partial<Omit<TextSeg, 'kind' | 'text'>>

const text = (value: string, style: Style = {}): TextSeg => ({ kind: 'text', text: value, ...style })
const widthOf = (seg: Seg) => (seg.kind === 'spinner' ? 1 : cellWidth(seg.text))
const sumOf = (segs: readonly Seg[]) => segs.reduce((total, seg) => total + widthOf(seg), 0)
const spaces = (count: number): Seg[] => (count > 0 ? [text(' '.repeat(count))] : [])

/** Runs cut to exactly `width` cells: the run that overflows ends in an ellipsis, the rest are dropped, a short line is padded. */
export const fitSegs = (segs: readonly Seg[], width: number): Seg[] => {
  if (width <= 0) return []
  const out: Seg[] = []
  let left = width
  for (const seg of segs) {
    const size = widthOf(seg)
    if (size === 0) continue
    if (size <= left) {
      out.push(seg)
      left -= size
    } else {
      if (seg.kind === 'text' && left > 0) {
        const cut = fitCells(seg.text, left)
        out.push({ ...seg, text: cut })
        left -= cellWidth(cut)
      }
      break
    }
    if (left === 0) break
  }
  return [...out, ...spaces(left)]
}

/**
 * `Pinned ──── ⌃` or `Settled (23) ──── ⌄`, exactly `width` cells, the rule at least two cells: the
 * chevron points down on a collapsed shelf and turns up when it opens; the count shows only when collapsed.
 */
export const headerOf = (label: string, count: number, isCollapsed: boolean, width: number, extra = ''): string => {
  const tail = `${extra}${isCollapsed ? ' ⌄' : ' ⌃'}`
  const head = isCollapsed ? `${label} (${count}) ` : `${label} `
  const room = width - cellWidth(tail) - 2
  const shown = cellWidth(head) > room ? fitCells(head, Math.max(0, room)) : head
  const rule = Math.max(0, width - cellWidth(shown) - cellWidth(tail))
  const line = `${shown}${'─'.repeat(rule)}${tail}`
  return cellWidth(line) > width ? fitCells(line, width) : line
}

/** Children in urgency order: Needs you, Failed, Working, then finished, each newest first. */
export const sortChildren = (children: readonly Child[]): Child[] => {
  const rank = (status: Child['status']) => (status === 'needs-you' ? 0 : status === 'failed' ? 1 : status === 'working' ? 2 : 3)
  return [...children].sort((a, b) => rank(a.status) - rank(b.status) || b.startedAt - a.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Caps sit outside the filled block. Their foreground takes the fill colour; their background stays
 * the row background (the selected-card fill on the own card), making a terminal-cell rounded end.
 */
const capsOf = (mode: GlyphMode) => mode === 'nerd' ? ['\ue0b6', '\ue0b4'] as const : ['▐', '▌'] as const
const pillOf = (label: string, pill: Palette['pill']['red'], mode: GlyphMode, selected: boolean): Seg[] => {
  const [left, right] = capsOf(mode)
  const cap = { color: pill.bg, ...(selected ? { bg: undefined } : {}) }
  // Selected rows receive their fill at the parent Box. Do not paint a terminal-default background over it.
  return [text(left, cap), text(label, { color: pill.fg, bg: pill.bg, role: 'status' }), text(right, cap)]
}
const bellOf = (mode: GlyphMode) => mode === 'plain' ? '!' : '\uf0f3'

/**
 * A terminal may stretch a PUA glyph into a following ordinary space. NBSP is its documented one-cell
 * constraint, so the bell's two-cell slot is both the shake track and a safe neighbour for Nerd glyphs.
 * The bell rests left and shakes one cell right only no gap opens before it.
 */
const bellSlotOf = (mode: GlyphMode, frame: 0 | 1 | 2): string => {
  const bell = bellOf(mode)
  return frame === 2 ? `\u00a0${bell}` : `${bell}\u00a0`
}

/**
 * The status slot at the right end of line 1 (I-6): the Needs you bell pill, the red Failed pill, yellow
 * Background with the age, orange Check? with the age, the Working spinner, the gray Done pill, else the age. It may be empty when no time is known.
 */
const statusSlotOf = (status: Status, since: number, now: number, palette: Palette, mode: GlyphMode, selected: boolean, woke = false, bell: 0 | 1 | 2 = 0, snoozedUntil?: number, waiting = false): Seg[] => {
  const age = since > 0 ? ageLabel(since, now) : undefined
  if (snoozedUntil !== undefined) return [text(timeLeftLabel(snoozedUntil, now), { dim: true, role: 'status' })]
  if (status === 'needs-you') {
    const lead = woke ? [text('Woke ', { color: palette.text.green, role: 'status' })] : []
    return [...lead, ...pillOf(`${bellSlotOf(mode, bell)}Needs you\u00a0`, palette.pill.red, mode, selected)]
  }
  if (status === 'failed') {
    const lead = woke ? [text('Woke ', { color: palette.text.green, role: 'status' })] : []
    return [...lead, ...pillOf('✕ Failed ', palette.pill.red, mode, selected)]
  }
  if (status === 'background') return [text(mode === 'nerd' ? '⚙' : '↻', { color: palette.text.green, role: 'status' }), text(' Background', { color: palette.text.green, role: 'status' }), ...(age ? [text(` ${age}`, { dim: true, role: 'status' })] : [])]
  if (status === 'check') return [text('Check?', { color: palette.text.orange, role: 'status' }), ...(age ? [text(` ${age}`, { dim: true, role: 'status' })] : [])]
  if (status === 'working') {
    const lead = woke ? [text('Woke ', { color: palette.text.green, role: 'status' })] : []
    return [...lead, { kind: 'spinner' }, text(' Working', { color: palette.text.yellow, role: 'status' }), ...(age ? [text(` ${age}`, { dim: true, role: 'status' })] : [])]
  }
  if (waiting) return [text('Waiting', { color: palette.text.green, role: 'status' }), ...(age ? [text(` ${age}`, { dim: true, role: 'status' })] : [])]
  if (woke) return [text('Woke', { color: palette.text.green, role: 'status' })]
  if (status === 'done') return pillOf('✓ Done ', palette.pill.gray, mode, selected)
  return age ? [text(age, { dim: true, role: 'status' })] : []
}

const slotOf = (c: CardInput): Seg[] => statusSlotOf(c.status, c.s.statusSince, c.now, c.palette, c.glyphMode, c.s.isSelf, c.woke, c.bell, c.snoozedUntil, c.waiting === true)

/** The project name in muted text, as drawn with project colours off (the default); the icon keeps the colour. */
const projectOf = (_c: CardInput, project: string): Seg => text(project, { dim: true, role: 'project' })

/**
 * Line 1: the project at the left and the status slot at the right edge; no terminal app is named
 * (the pane shows agents, not terminals). When the line is narrow the project is
 * cut; the slot is cut only when it alone is wider than the line.
 */
export const line1Of = (c: CardInput, width: number): Seg[] => {
  if (width <= 0) return []
  const slot = slotOf(c)
  const slotWidth = sumOf(slot)
  if (slotWidth >= width) return fitSegs(slot, width)
  const room = width - slotWidth - (slotWidth > 0 ? 1 : 0)
  const project = c.s.project
  const left: Seg[] = []
  if (cellWidth(project) <= room) {
    left.push(projectOf(c, project))
  } else if (room > 0) {
    left.push(projectOf(c, fitCells(project, room)))
  }
  return fitSegs([...left, ...spaces(width - sumOf(left) - slotWidth), ...slot], width)
}

/**
 * The title run, weighted as designed: bold on a Done (unread) or woken card and on the own (open)
 * card, muted on an idle card already seen, plain otherwise.
 */
const titleOf = (c: CardInput, title: string): TextSeg => {
  if (c.status === 'done' || c.woke || c.s.isSelf) return text(title, { role: 'title', bold: true })
  if (c.status === 'idle') return text(title, { role: 'title', dim: true })
  return text(title, { role: 'title' })
}

/**
 * The ticket chip and the title it leaves: the id from the title's start, else the branch, else the
 * worktree folder, for the configured prefixes; a title that led with the id drops it.
 */
const ticketOf = (c: CardInput): { chip: Seg[]; title: string } => {
  const { s, palette } = c
  const worktree = s.cwd?.split('/').filter(Boolean).at(-1) ?? null
  const match = parseTicketId({ title: s.title, branchName: s.branch ?? null, worktreeName: worktree }, c.tickets ?? [])
  if (!match) return { chip: [], title: s.title }
  const [left, right] = capsOf(c.glyphMode)
  // The NBSP immediately after the right Nerd cap keeps a terminal from stretching it into the title gap.
  return { chip: [text(left, { color: palette.pill.gray.bg }), text(match.id, { color: palette.pill.gray.fg, bg: palette.pill.gray.bg }), text(`${right}\u00a0`, { color: palette.pill.gray.bg })], title: match.titleRest || s.title }
}

/** The bar: one segment per run, every cell `━` and the run's last cell `╸`, coloured by the run's ticket hue (plan L-4). */
const barOf = (tickets: readonly Ticket[], cells: number, palette: Palette): Seg[] =>
  barRunsOf(tickets, cells).map(run => text(BAR_CELL.repeat(run.length - 1) + BAR_END, { color: palette.text[TICKET_HUE[run.color]], role: 'bar' }))

/** The group chip: its label as one plain text segment in the gray pill's text colour, then a no-break space (plan L-8 undo form). */
const groupChipOf = (c: CardInput, label: string): Seg[] => [text(label, { color: c.palette.pill.gray.fg }), text(' ')]

/**
 * Line 2: the ticket chip when one is found, then the title, cut with an ellipsis. While ticket progress
 * shows, the bar and the `done/total` count sit at the right: the title gives way first, down to its first
 * character, then the bar shrinks, and below five cells the count stands alone (plan L-2, L-3).
 */
export const line2Of = (c: CardInput, width: number): Seg[] => {
  const progress = c.progress
  if (!progress) {
    const { chip, title } = ticketOf(c)
    return fitSegs([...chip, titleOf(c, title)], width)
  }
  const title = c.s.title
  const chip = progress.chip !== null ? groupChipOf(c, progress.chip) : []
  const count = text(`${progress.done}/${progress.total}`, { role: 'count' })
  const countCells = sumOf([count])
  const chipCells = sumOf(chip)
  const minTitle = titleMinOf(title)
  const minCells = cellWidth(minTitle)
  const cells = barWidthOf(width, chipCells, minCells, countCells)
  if (cells >= MIN_BAR) {
    const left = [...chip, titleOf(c, fitCells(title, width - chipCells - 1 - cells - 1 - countCells))]
    const bar = [...barOf(progress.tickets, cells, c.palette), text(' ')]
    return fitSegs([...left, ...spaces(Math.max(1, width - sumOf(left) - sumOf(bar) - countCells)), ...bar, count], width)
  }
  const left: Seg[] =
    width >= chipCells + minCells + 1 + countCells ? [...chip, titleOf(c, minTitle)]
    : width >= minCells + 1 + countCells ? [titleOf(c, minTitle)]
    : []
  return fitSegs([...left, ...spaces(Math.max(left.length > 0 ? 1 : 0, width - sumOf(left) - countCells)), count], width)
}

type Item = { key: 'branch' | 'badge' | 'model' | 'pr' | 'context'; segs: Seg[] }

const itemsWidth = (items: readonly Item[]) => items.reduce((total, item) => total + sumOf(item.segs), 0) + Math.max(0, items.length - 1)

/**
 * The context tone: muted, orange from 75 percent, red at 100, measured against the soft limit when the
 * card has one and the token count is known; otherwise against the window percentage shown.
 */
const contextStyleOf = (percent: number, tokens: number | undefined, softLimit: number | undefined, palette: Palette): Style => {
  const zone = softLimit && softLimit > 0 && tokens !== undefined ? (tokens / softLimit) * 100 : percent
  return zone >= 100 ? { color: palette.text.red } : zone >= 75 ? { color: palette.text.orange } : { dim: true }
}

/**
 * Line 3, laid out as designed: the branch at the left taking the free width, then at the right edge the
 * child badge, the model, the pull request and the context as a plain percentage (background tasks are
 * rows under the card). When they do not fit, the right-hand items drop from the end (context, PR, model,
 * badge) and the branch is cut (or dropped when under `⎇ ` and one character).
 */
export const line3Of = (c: CardInput, width: number): Seg[] => {
  if (width <= 0) return []
  const { s, palette } = c
  let items: Item[] = []
  if (s.branch) items.push({ key: 'branch', segs: [text(`⎇ ${s.branch}`, { dim: true })] })
  if (s.isSelf && c.children.length > 0) {
    const dots = sortChildren(c.children).slice(0, 3).map(child => text('●', { color: palette.text[STATUS_HUE[child.status]] }))
    items.push({ key: 'badge', segs: [...dots, text(` ${c.children.length}`, { dim: true })] })
  }
  if (s.model) items.push({ key: 'model', segs: [text(s.model, { dim: true })] })
  if (s.pr !== undefined) items.push({ key: 'pr', segs: [text(`PR #${s.pr}`, { dim: true })] })
  if (s.contextPercent !== undefined) {
    const percent = Math.max(0, Math.round(s.contextPercent))
    items.push({ key: 'context', segs: [text(`${percent}%`, contextStyleOf(percent, s.contextTokens, c.softLimit, palette))] })
  }

  for (const key of ['context', 'pr', 'model', 'badge'] as const) {
    if (itemsWidth(items) <= width) break
    items = items.filter(item => item.key !== key)
  }
  const cutItem = (key: Item['key'], minimum: number) => {
    if (itemsWidth(items) <= width) return
    const target = items.find(item => item.key === key)
    if (!target) return
    const others = items.filter(item => item !== target)
    const room = width - itemsWidth(others) - (others.length > 0 ? 1 : 0)
    if (room >= minimum && target.segs[0]?.kind === 'text') {
      const first = target.segs[0]
      target.segs = [{ ...first, text: fitCells(first.text, room) }]
    } else if (key === 'branch') {
      items = others
    }
  }
  cutItem('branch', 3)

  const join = (group: readonly Item[]) => group.flatMap((item, index) => (index > 0 ? [text(' '), ...item.segs] : item.segs))
  const left = join(items.filter(item => item.key === 'branch'))
  const right = join(items.filter(item => item.key !== 'branch'))
  return fitSegs([...left, ...spaces(width - sumOf(left) - sumOf(right)), ...right], width)
}

/**
 * The one-line card while ticket progress shows: `project title … d/t slot`, no bar. The title shrinks
 * first, then the project; the count and the slot stay whole (plan L-3b).
 */
const oneLineWithCountOf = (c: CardInput, width: number, slot: readonly Seg[]): Seg[] => {
  const progress = c.progress!
  const count = text(`${progress.done}/${progress.total}`, { role: 'count' })
  const slotWidth = sumOf(slot)
  const tail = [count, ...(slotWidth > 0 ? [text(' '), ...slot] : [])]
  const room = width - sumOf(tail) - 1
  const project = c.s.project
  const title = c.s.title
  const m = cellWidth(titleMinOf(title))
  const p = cellWidth(project)
  const left: Seg[] = []
  if (project) {
    if (p + 1 + cellWidth(title) <= room) left.push(projectOf(c, project), text(' '), titleOf(c, title))
    else if (p + 1 + m <= room) left.push(projectOf(c, project), text(' '), titleOf(c, fitCells(title, room - p - 1)))
    else if (room - 1 - m >= 1) left.push(projectOf(c, fitCells(project, room - 1 - m)), text(' '), titleOf(c, titleMinOf(title)))
    else if (m <= room) left.push(titleOf(c, titleMinOf(title)))
  } else if (cellWidth(title) <= room) left.push(titleOf(c, title))
  else if (m <= room) left.push(titleOf(c, fitCells(title, room)))
  return fitSegs([...left, ...spaces(width - sumOf(left) - sumOf(tail)), ...tail], width)
}

/** The Working shelf's one-line card: `project title … [Woke ]slot`; the icon, when shown, sits before it. */
export const oneLineOf = (c: CardInput, width: number): Seg[] => {
  if (width <= 0) return []
  const slot = slotOf(c)
  const slotWidth = sumOf(slot)
  if (c.progress) return oneLineWithCountOf(c, width, slot)
  if (slotWidth >= width) return fitSegs(slot, width)
  const room = width - slotWidth - (slotWidth > 0 ? 1 : 0)
  const project = c.s.project
  const left: Seg[] = []
  const projectWidth = cellWidth(project)
  if (!project) {
    left.push(titleOf(c, fitCells(c.s.title, room)))
  } else if (projectWidth >= room) {
    if (room > 0) left.push(projectOf(c, fitCells(project, room)))
  } else {
    left.push(projectOf(c, project))
    const titleRoom = room - projectWidth - 1
    if (titleRoom > 0) left.push(text(' '), titleOf(c, fitCells(c.s.title, titleRoom)))
  }
  return fitSegs([...left, ...spaces(width - sumOf(left) - slotWidth), ...slot], width)
}

/**
 * A child row: `  │ ● label … glyph + status word`. A child row uses a label-sized status rather
 * than a parent-card pill, which also keeps PUA caps out of this narrow row.
 */
const childStatusOf = (child: Child, now: number, palette: Palette, glyphMode: GlyphMode, bell: 0 | 1 | 2): Seg[] => {
  const hue = palette.text[STATUS_HUE[child.status]]
  const age = child.since > 0 ? ageLabel(child.since, now) : undefined
  if (child.status === 'needs-you') return [text(`${bellSlotOf(glyphMode, bell)}Needs you`, { color: hue, role: 'status' })]
  if (child.status === 'failed') return [text('✕ Failed', { color: hue, role: 'status' })]
  if (child.status === 'done') return [text('✓ Done', { color: hue, role: 'status' })]
  if (child.status === 'working') return [{ kind: 'spinner' }, text(' Working', { color: hue, role: 'status' }), ...(age ? [text(` ${age}`, { dim: true, role: 'status' })] : [])]
  return age ? [text(age, { dim: true, role: 'status' })] : []
}

export const childRowOf = (child: Child, width: number, now: number, palette: Palette, glyphMode: GlyphMode = 'plain', bell: 0 | 1 | 2 = 0): { text: Seg[]; bg?: string } => {
  const hue = palette.text[STATUS_HUE[child.status]]
  const tail = childStatusOf(child, now, palette, glyphMode, bell)
  const head = [text('  '), text('│', { dim: true }), text(' '), text('●', { color: hue }), text(' ')]
  const room = width - sumOf(head) - sumOf(tail) - 1
  const label = room > 0 ? [text(fitCells(child.label, room))] : []
  return { text: fitSegs([...head, ...label, ...spaces(width - sumOf(head) - sumOf(label) - sumOf(tail)), ...tail], width) }
}

/**
 * A ticket row under the own card: `  │ ID ● description ×n … status`. The dot takes the ticket's colour,
 * the description and status are the newest worker's; the description shrinks first (plan L-7).
 */
export const ticketRowOf = (ticket: Ticket, width: number, now: number, palette: Palette, glyphMode: GlyphMode = 'plain', bell: 0 | 1 | 2 = 0): { text: Seg[] } => {
  const tail = childStatusOf(ticket.newest, now, palette, glyphMode, bell)
  const head = [text('  '), text('│', { dim: true }), text(' '), text(ticket.id), text(' '), text('●', { color: palette.text[TICKET_HUE[ticket.status]] }), text(' ')]
  const many = ticket.workers.length >= 2 ? [text(` ×${ticket.workers.length}`, { dim: true })] : []
  const room = width - sumOf(head) - sumOf(many) - sumOf(tail) - 1
  const description = ticket.newest.texts?.[0] ?? ticket.newest.label
  const label = room > 0 ? [text(fitCells(description, room))] : []
  const used = sumOf(head) + sumOf(label) + sumOf(many)
  return { text: fitSegs([...head, ...label, ...many, ...spaces(width - used - sumOf(tail)), ...tail], width) }
}

/**
 * A background-task row under the own card, drawn like a child row: `  │ ⟳ Kind label … age`, the age
 * counted from when the task was first seen. The age carries role `status`.
 */
export const backgroundRowOf = (task: BackgroundTask, width: number, now: number, palette: Palette): Seg[] => {
  const tail = [text(ageLabel(task.firstSeenAt, now), { dim: true, role: 'status' })]
  const head = [text('  '), text('│', { dim: true }), text(' '), text('⟳', { color: palette.text.blue }), text(' '), text(task.kind, { color: palette.text.blue }), text(' ')]
  const room = width - sumOf(head) - sumOf(tail) - 1
  const label = room > 0 ? [text(fitCells(task.label, room))] : []
  return fitSegs([...head, ...label, ...spaces(width - sumOf(head) - sumOf(label) - sumOf(tail)), ...tail], width)
}
