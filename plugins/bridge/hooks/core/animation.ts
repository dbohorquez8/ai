// The animation policy: when anything animates and which rasters change on a tick (L8, AC-22, AC-111 to AC-113).

import { sceneCells, spinnerCells } from './sprites'
import { PALETTES } from './palette'
import { hexToColor } from './types'
import type { CardView, PaneView, ThemeMode } from './types'

/** Five frames a second: each frame costs a worker hop and a blit, and 10 put the pane over its CPU budget (AC-110). */
export const TICK_MS = 200
export const SCENE_FRAME_MS = 600
export const BELL_PERIOD_MS = 4000

/**
 * Bell shake: rest, right, rest, right, one TICK_MS each, once per four seconds; 0 is the centred rest.
 * Each step lasts exactly one tick, so a ticker at any offset draws every step once, in order.
 */
export const bellOf = (now: number): 0 | 1 | 2 => {
  const at = ((now % BELL_PERIOD_MS) + BELL_PERIOD_MS) % BELL_PERIOD_MS
  const step = Math.floor(at / TICK_MS)
  return step === 1 || step === 3 ? 2 : 0
}

export const spinnerFrameAt = (tick: number): number => tick % 10
export const sceneFrameAt = (tick: number): number => Math.floor((tick * TICK_MS) / SCENE_FRAME_MS)

const visibleCards = (view: PaneView): CardView[] => view.shelves.filter(shelf => !shelf.isCollapsed).flatMap(shelf => shelf.cards)

const hasSpinner = (card: CardView): boolean => card.lines.some(line => line.some(seg => seg.kind === 'spinner')) || card.children?.rows.some(row => row.text.some(seg => seg.kind === 'spinner')) === true

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
      if (card.lines.some(line => line.some(seg => seg.kind === 'spinner'))) blits.push({ key: `spin:${card.id}`, columns: 1, rows: 1, cells: spinnerCells(spinnerFrameAt(tick), palette.text.yellow, bg) })
      // Child rows sit below the selected fill, so their spinner uses the row's own background.
      for (const row of card.children?.rows ?? []) if (row.text.some(seg => seg.kind === 'spinner')) blits.push({ key: `spin:${row.id}`, columns: 1, rows: 1, cells: spinnerCells(spinnerFrameAt(tick), palette.text.yellow, row.bg ? hexToColor(row.bg) : 0x01000000) })
    }
  }
  if (view.scene?.showArt) {
    const { rows, cells } = sceneCells(view.scene.kind, sceneFrameAt(tick), view.scene.width, palette)
    blits.push({ key: 'scene', columns: view.scene.width, rows, cells })
  }
  return blits
}
