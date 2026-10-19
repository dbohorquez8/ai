// The animation policy: when anything animates and which rasters change on a tick (L8, AC-22, AC-111 to AC-113).

import { sceneCells, spinnerCells } from './sprites'
import { PALETTES } from './palette'
import { hexToColor } from './types'
import type { CardView, PaneView, ThemeMode } from './types'

/** Five frames a second: each frame costs a worker hop and a blit, and 10 put the pane over its CPU budget (AC-110). */
export const TICK_MS = 200
export const SCENE_FRAME_MS = 600
export const BELL_PERIOD_MS = 4000

/** Bell wobble: 1 in [0,150) and [300,450) ms, 2 in [150,300) ms of each 4000 ms window, else 0. */
export const bellOf = (now: number): 0 | 1 | 2 => {
  const at = ((now % BELL_PERIOD_MS) + BELL_PERIOD_MS) % BELL_PERIOD_MS
  if (at < 150) return 1
  if (at < 300) return 2
  if (at < 450) return 1
  return 0
}

export const spinnerFrameAt = (tick: number): number => tick % 10
export const sceneFrameAt = (tick: number): number => Math.floor((tick * TICK_MS) / SCENE_FRAME_MS)

const visibleCards = (view: PaneView): CardView[] => view.shelves.filter(shelf => !shelf.isCollapsed).flatMap(shelf => shelf.cards)

const hasSpinner = (card: CardView): boolean => card.lines.some(line => line.some(seg => seg.kind === 'spinner'))

export const isAnimating = (view: PaneView, isShown: boolean): boolean => {
  if (!isShown) return false
  if (view.scene?.showArt) return true
  return visibleCards(view).some(card => hasSpinner(card) || card.status === 'needs-you')
}

export type Blit = { key: string; columns: number; rows: number; cells: string }

export const framesAt = (view: PaneView, tick: number, mode: ThemeMode): Blit[] => {
  const palette = PALETTES[mode]
  const blits: Blit[] = []
  for (const card of visibleCards(view)) {
    if (hasSpinner(card)) {
      const bg = card.isSelected ? hexToColor(view.selectedFill) : 0x01000000
      blits.push({ key: `spin:${card.id}`, columns: 1, rows: 1, cells: spinnerCells(spinnerFrameAt(tick), palette.text.yellow, bg) })
    }
  }
  if (view.scene?.showArt) {
    const { rows, cells } = sceneCells(view.scene.kind, sceneFrameAt(tick), view.scene.width, palette)
    blits.push({ key: 'scene', columns: view.scene.width, rows, cells })
  }
  return blits
}
