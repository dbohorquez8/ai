// The pane drawing: maps a PaneView to elements with the keys of the test contract (plan L6).
// No ordering, no width maths beyond mapping runs to Text, no clock reads.

import type { Elements, RenderElement } from 'claude-code'

import type { PaneView, ShelfId, SortMode, ThemeMode } from '../core/types'
import { noteOf, noticeOf } from './chrome'
import { shelfOf } from './shelf'

/** The element constructors the module entry resolves for the render event and passes in. */
export type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Raster' | 'Select' | 'Image'>

export type Handlers = {
  pressCard(id: string): void
  toggleShelf(shelf: ShelfId): void
  act(prefId: string, action: 'pin' | 'park' | 'settle' | 'move-up' | 'move-down'): void
  openSnooze(prefId: string | undefined): void
  pickSnooze(prefId: string, wake: number): void
  sort(mode: SortMode): void
  toggleSort(): void
  pressChild(agentId: string): void
}

export const drawPane = (
  els: Els,
  view: PaneView,
  frame: { tick: number; mode: ThemeMode },
  on: Handlers,
  extra: { notice: string; note: string; viewedAgent?: string },
): RenderElement => {
  const { Box } = els
  return (
    <Box flexDirection="column">
      {noticeOf(els, view, extra.notice)}
      {view.shelves.map((shelf, at) => shelfOf(els, view, shelf, at, frame, on, extra.viewedAgent))}
      {noteOf(els, view, extra.note)}
    </Box>
  )
}
