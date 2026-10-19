// Exact-width lines of a card, a shelf header and a child row. Every line is built from styled runs
// whose widths sum to the requested width, counted in terminal cells (a bell is two). Pure.

import { ageLabel, timeLeftLabel } from './age'
import { cellWidth, fitCells } from './width'
import { parseTicketId } from './tickets'
import { TAG_HUE } from './types'
import type { BackgroundTask, Child, ChildTag, Palette, Seg, Session, Status } from './types'

export const MAX_CHILD_ROWS = 5
/** Below this many usable columns the project icons are hidden, the setting unchanged. */
export const ICON_MIN_COLUMNS = 30
/** The project icon's cells at the start of line 1: two for the icon, one gap. */
export const ICON_CELLS = 3

export type CardInput = { s: Session; status: Status; woke: boolean; snoozedUntil?: number; children: readonly Child[]; now: number; bell: 0 | 1 | 2; palette: Palette; projectColor: string; tickets?: readonly string[]; softLimit?: number }

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

/** Children in the order of AC-92: waiting, then running, then the rest, each newest first. */
export const sortChildren = (children: readonly Child[]): Child[] => {
  const rank = (tag: ChildTag) => (tag === 'WAITING' ? 0 : tag === 'RUNNING' ? 1 : 2)
  return [...children].sort((a, b) => rank(a.tag) - rank(b.tag) || b.startedAt - a.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * The pill's bell, drawn in braille dots like the Working spinner so it takes the pill's red as the
 * tinted icon does: a dome three dots wide and two deep, a rim five dots wide, and a clapper that
 * swings left and right to ring (rest, left, right; bell steps 0, 1, 2).
 */
const BELL_TEXT = [' ⠼⡿⠄ Needs you ', ' ⢼⠿⠄ Needs you ', ' ⠼⢿⠄ Needs you '] as const

/**
 * The status slot at the right end of line 1 (I-6): the Needs you bell pill, the red Failed pill, yellow
 * Check? with the age, the Working spinner, the gray Done pill, else the age. It may be empty when no time is known.
 */
const slotOf = (c: CardInput): Seg[] => {
  const { s, palette, now } = c
  const age = s.statusSince > 0 ? ageLabel(s.statusSince, now) : undefined
  if (c.snoozedUntil !== undefined) return [text(timeLeftLabel(c.snoozedUntil, now), { dim: true, role: 'status' })]
  if (c.status === 'needs-you') {
    const lead = c.woke ? [text('Woke ', { color: palette.text.green, role: 'status' })] : []
    return [...lead, text(BELL_TEXT[c.bell], { color: palette.pill.red.fg, bg: palette.pill.red.bg, role: 'status' })]
  }
  if (c.status === 'failed') {
    const lead = c.woke ? [text('Woke ', { color: palette.text.green, role: 'status' })] : []
    return [...lead, text(' ✕ Failed ', { color: palette.pill.red.fg, bg: palette.pill.red.bg, role: 'status' })]
  }
  if (c.status === 'check') return [text('Check?', { color: palette.text.yellow, role: 'status' }), ...(age ? [text(` ${age}`, { dim: true, role: 'status' })] : [])]
  if (c.status === 'working') {
    const lead = c.woke ? [text('Woke ', { color: palette.text.green, role: 'status' })] : []
    return [...lead, { kind: 'spinner' }, text(' Working', { color: palette.text.yellow, role: 'status' }), ...(age ? [text(` ${age}`, { dim: true, role: 'status' })] : [])]
  }
  if (c.woke) return [text('Woke', { color: palette.text.green, role: 'status' })]
  if (c.status === 'done') return [text(' ✓ Done ', { color: palette.pill.gray.fg, bg: palette.pill.gray.bg, role: 'status' })]
  return age ? [text(age, { dim: true, role: 'status' })] : []
}

/** The project name in muted text, as drawn with project colours off (the default); the icon keeps the colour. */
const projectOf = (_c: CardInput, project: string): Seg => text(project, { dim: true, role: 'project' })

/**
 * Line 1: the project at the left and the status slot at the right edge; no terminal app is named
 * (Owner, 2026-10-18: the pane shows agents, not terminals). When the line is narrow the project is
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
 * card (AC-11a), muted on an idle card already seen, plain otherwise.
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
  return { chip: [text(match.id, { color: palette.pill.gray.fg, bg: palette.pill.gray.bg }), text(' ')], title: match.titleRest || s.title }
}

/** Line 2: the ticket chip when one is found, then the title, cut with an ellipsis. */
export const line2Of = (c: CardInput, width: number): Seg[] => {
  const { chip, title } = ticketOf(c)
  return fitSegs([...chip, titleOf(c, title)], width)
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
    const dots = sortChildren(c.children).slice(0, 3).map(child => text('●', { color: palette.text[TAG_HUE[child.tag]] }))
    items.push({ key: 'badge', segs: [...dots, text(` ${c.children.length}`, { dim: true })] })
  }
  if (s.model) items.push({ key: 'model', segs: [text(s.model, { dim: true })] })
  if (s.pr !== undefined) items.push({ key: 'pr', segs: [text(`#${s.pr}`, { dim: true })] })
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

/** The Working shelf's one-line card: `project title … [Woke ]slot`; the icon, when shown, sits before it. */
export const oneLineOf = (c: CardInput, width: number): Seg[] => {
  if (width <= 0) return []
  const slot = slotOf(c)
  const slotWidth = sumOf(slot)
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
 * A child row: `  │ ● label … TAG age`. The tag and age carry role `status`; the rest is what the
 * view button draws. A waiting row has the warm tint on every run.
 */
export const childRowOf = (child: Child, width: number, now: number, palette: Palette): { text: Seg[]; bg?: string } => {
  const hue = palette.text[TAG_HUE[child.tag]]
  const tail = [text(child.tag, { color: hue, role: 'status' }), text(` ${ageLabel(child.since, now)}`, { dim: true, role: 'status' })]
  const head = [text('  '), text('│', { dim: true }), text(' '), text('●', { color: hue }), text(' ')]
  const room = width - sumOf(head) - sumOf(tail) - 1
  const label = room > 0 ? [text(fitCells(child.label, room))] : []
  const line = fitSegs([...head, ...label, ...spaces(width - sumOf(head) - sumOf(label) - sumOf(tail)), ...tail], width)
  if (child.tag !== 'WAITING') return { text: line }
  return { text: line.map(seg => (seg.kind === 'text' ? { ...seg, bg: palette.waitingRow } : seg)), bg: palette.waitingRow }
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
