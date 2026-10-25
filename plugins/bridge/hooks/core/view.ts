// The view model: everything a renderer draws, built from the merged sessions and the stored state.
// Render paints it with no ordering, width maths or clock reads of its own. Pure.

import { ALL_CLEAR, WORKING_CAPTIONS } from './captions'
import { inkOf, monogramTextOf, projectMonogramLetter } from './icons'
import { backgroundRowOf, childRowOf, headerOf, ICON_CELLS, ICON_MIN_COLUMNS, line1Of, line2Of, line3Of, MAX_CHILD_ROWS, oneLineOf, ROW_HORIZONTAL_PADDING, sortChildren } from './layout'
import { ticketProgressOf } from './progress'
import type { CardInput } from './layout'
import type { Report } from './report'
import { isWoke, offeredActions, shelfOf } from './lifecycle'
import { MAX_BACKGROUND_ROWS } from './background'
import { DEFAULT_CHECK_AFTER_MINUTES, defaultSoftLimitOf } from './persist'
import { orderShelf } from './order'
import { snoozeOptionsAt } from './snooze'
import { ownOf, statusOf, waitsOnWorkers } from './status'
import { cellWidth, fitCells } from './width'
import { SHELF_LABEL, SHELF_ORDER, snapToRasterGrid } from './types'
import type { Caps, CardIcon, CardView, Child, Entry, GlyphMode, PaneView, Palette, Session, ShelfId, ShelfView, Status, Stored } from './types'

const centered = (caption: string, width: number): string => {
  const shown = fitCells(caption, width)
  const spare = Math.max(0, width - cellWidth(shown))
  const left = Math.floor(spare / 2)
  return `${' '.repeat(left)}${shown}${' '.repeat(spare - left)}`
}

/**
 * The pane view. Session ids in `stored.entries` and `finished` are prefIds. A shelf that is collapsed
 * has no cards in the view; its header carries the count. Active is always present and holds the scene
 * when it has no cards; the other shelves are present only when they have cards.
 */
export const paneViewOf = (input: {
  sessions: readonly Session[]
  stored: Stored
  finished: Readonly<Record<string, number>>
  children: readonly Child[]
  /** The own session's live ticket report, or null. */
  report: Report | null
  now: number
  width: number
  caps: Caps
  bell: 0 | 1 | 2
  glyphMode?: GlyphMode
  snoozeOpen?: string
  /** The Active header's sort menu is open. */
  sortOpen?: boolean
  caption?: number
  palette: Palette
  projectColors: ReadonlyMap<string, string>
  /** Project name to its cached PNG; a project absent here has no picture. */
  projectIcons?: ReadonlyMap<string, string>
}): PaneView => {
  const { stored, now, width, palette } = input
  const contentWidth = Math.max(0, width - ROW_HORIZONTAL_PADDING * 2)
  const finishedOf = (s: Session) => input.finished[s.prefId] ?? input.finished[s.id]

  type Placed = { s: Session; status: Status; entry: Entry | undefined; shelf: ShelfId }
  const placed: Placed[] = input.sessions.map(s => {
    const entry = stored.entries[s.prefId]
    const status = statusOf(s.raw, s.statusSince, finishedOf(s), entry?.ackAt, s.askedAt, ownOf(s), now, stored.settings.checkAfter ?? DEFAULT_CHECK_AFTER_MINUTES)
    return { s, status, entry, shelf: shelfOf(s, status, entry, finishedOf(s), now, stored.settings.workingShelf) }
  })

  const isWide = contentWidth >= ICON_MIN_COLUMNS
  const showIcons = stored.settings.icons && isWide
  const canPicture = input.caps.pictures && input.caps.trueColor

  /** The picture where the terminal draws one and the project has one, else the monogram. */
  const iconOf = (project: string, color: string): CardIcon => {
    if (!showIcons || !project) return { kind: 'none' }
    const letter = projectMonogramLetter(project)
    const ink = inkOf(color)
    const file = input.projectIcons?.get(project)
    if (canPicture && file) return { kind: 'picture', file, letter, color, ink }
    return { kind: 'monogram', letter, text: monogramTextOf(letter), color, ink }
  }

  const cardOf = (one: Placed): CardView => {
    const { s, status, entry, shelf } = one
    const form = shelf === 'working' ? 'line' : 'full'
    const projectColor = input.projectColors.get(s.project) ?? palette.text.gray
    const icon = iconOf(s.project, projectColor)
    const firstWidth = Math.max(0, contentWidth - (icon.kind === 'none' ? 0 : ICON_CELLS))
    const woke = isWoke(entry, status, now)
    const progress = s.isSelf ? ticketProgressOf(input.report) : null
    const card: CardInput = {
      s, status, woke, children: s.isSelf ? input.children : [], ...(progress ? { progress } : {}), ...(s.isSelf && waitsOnWorkers(status, input.children) ? { waiting: true as const } : {}), now, bell: input.bell, palette, projectColor, glyphMode: input.glyphMode ?? 'plain',
      ...(stored.settings.tickets ? { tickets: stored.settings.tickets } : {}),
      softLimit: stored.settings.softLimit ?? defaultSoftLimitOf(s.contextWindow),
      ...(shelf === 'snoozed' && entry?.snoozedUntil !== undefined ? { snoozedUntil: entry.snoozedUntil } : {}),
    }
    const view: CardView = {
      id: s.id, prefId: s.prefId, shelf, form, status, icon,
      lines: form === 'line' ? [oneLineOf(card, firstWidth)] : [line1Of(card, firstWidth), line2Of(card, contentWidth), line3Of(card, contentWidth)],
      isSelected: s.isSelf,
      isDim: Boolean(s.away),
      actions: offeredActions(status, shelf),
      labels: { pin: entry?.isPinned ? 'Unpin' : 'Pin', park: entry?.isParked ? 'Unpark' : 'Park', settle: entry?.isSettled ? 'Unsettle' : 'Settle' },
    }
    if (input.snoozeOpen !== undefined && input.snoozeOpen === s.prefId) view.snoozeMenu = snoozeOptionsAt(now)
    if (s.isSelf && input.children.length > 0) {
      const ordered = sortChildren(input.children)
      const rows = ordered.slice(0, MAX_CHILD_ROWS).map(child => {
        const row = childRowOf(child, contentWidth, now, palette, input.glyphMode ?? 'plain', input.bell)
        return { id: child.id, text: row.text, ...(row.bg ? { bg: row.bg } : {}) }
      })
      view.children = ordered.length > MAX_CHILD_ROWS ? { rows, more: `+${ordered.length - MAX_CHILD_ROWS} more` } : { rows }
    }
    const tasks = s.isSelf ? (s.background ?? []) : []
    if (tasks.length > 0) {
      const rows = tasks.slice(0, MAX_BACKGROUND_ROWS).map(task => ({ id: task.id, text: backgroundRowOf(task, contentWidth, now, palette) }))
      view.background = tasks.length > MAX_BACKGROUND_ROWS ? { rows, more: `+${tasks.length - MAX_BACKGROUND_ROWS} more` } : { rows }
    }
    return view
  }

  const shelves: ShelfView[] = []
  for (const id of SHELF_ORDER) {
    const inShelf = placed.filter(one => one.shelf === id)
    if (inShelf.length === 0 && id !== 'active') continue
    const byPref = new Map(inShelf.map(one => [one.s.prefId, one]))
    const order = orderShelf(id, inShelf.map(one => ({ s: one.s, status: one.status, ...(one.entry ? { entry: one.entry } : {}) })), stored.sort, stored.layout)
    // As designed, an empty Active shelf has no header: only its empty-state scene shows, whatever was collapsed.
    const hasHeader = inShelf.length > 0
    const isCollapsed = hasHeader && stored.collapsed[id]
    const hasSort = id === 'active' && hasHeader && !isCollapsed
    shelves.push({
      id,
      header: headerOf(SHELF_LABEL[id], inShelf.length, isCollapsed, contentWidth, hasSort ? ' ↕' : ''),
      hasHeader,
      isCollapsed,
      cards: isCollapsed ? [] : order.map(prefId => cardOf(byPref.get(prefId)!)),
      hasSort,
      ...(hasSort && input.sortOpen ? { sortMenu: true } : {}),
    })
  }

  const view: PaneView = {
    needYou: placed.filter(one => one.status === 'needs-you').length,
    shelves,
    width,
    contentWidth,
    sort: stored.sort,
    settings: stored.settings,
    selectedFill: snapToRasterGrid(palette.fill),
    palette,
  }
  if (!placed.some(one => one.shelf === 'active')) {
    const isWorking = placed.some(one => one.status === 'working')
    const index = (input.caption ?? stored.caption ?? 0) % WORKING_CAPTIONS.length
    view.scene = {
      kind: isWorking ? 'working' : 'hills',
      caption: centered(isWorking ? WORKING_CAPTIONS[index]! : ALL_CLEAR, contentWidth),
      showArt: isWide && input.caps.trueColor,
      width: contentWidth,
    }
  }
  return view
}
