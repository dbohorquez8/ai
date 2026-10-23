// The pane's cell art: a card's project icon, the Working spinner and the empty-state
// scene. Each Raster's first cells come from the same frame helpers the animation timer blits with.
// A keyed one-line Text sits in a Box carrying the key, so the element is addressable by it.

import type { Elements, RenderElement } from 'claude-code'

import { sceneFrameAt, spinnerFrameAt } from '../core/animation'
import { DEFAULT_COLOR } from '../core/raster'
import { sceneCells, spinnerCells } from '../core/sprites'
import { hexToColor } from '../core/types'
import { ROW_HORIZONTAL_PADDING } from '../core/layout'
import type { CardView, PaneView } from '../core/types'

type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Raster' | 'Image'>

/** The project icon and its gap at the start of line 1: the picture, or the monogram on the project colour. */
export const iconOf = (els: Els, card: CardView): RenderElement[] => {
  const { Box, Text, Image } = els
  const { icon } = card
  if (icon.kind === 'none') return []
  const shown =
    icon.kind === 'picture' ? (
      <Image key={`icon:${card.id}`} source={{ file: icon.file, format: 'png' }} columns={2} rows={1} alt={icon.letter} />
    ) : (
      <Box key={`monogram:${card.id}`}>
        <Text backgroundColor={icon.color} color={icon.ink} bold {...(card.isDim ? { dimColor: true } : {})}>{icon.text}</Text>
      </Box>
    )
  return [shown, <Text key={`icon-gap:${card.id}`}> </Text>]
}

/** The one-cell Working spinner; on the own card its background is the card's fill, on a child row the row's own background. */
export const spinnerOf = (els: Els, view: PaneView, card: CardView, tick: number, id = card.id, rowBg?: string | null): RenderElement => {
  const { Raster } = els
  const background = rowBg !== undefined ? (rowBg ? hexToColor(rowBg) : DEFAULT_COLOR) : card.isSelected ? hexToColor(view.selectedFill) : DEFAULT_COLOR
  return <Raster key={`spin:${id}`} columns={1} rows={1} cells={spinnerCells(spinnerFrameAt(tick), view.palette.text.yellow, background)} />
}

/** The empty-state scene: the art (when the terminal and the setting allow it) and its caption. */
export const sceneOf = (els: Els, view: PaneView, tick: number): RenderElement[] => {
  const { Box, Text, Raster } = els
  const scene = view.scene
  if (!scene) return []
  const out: RenderElement[] = []
  if (scene.showArt) {
    const { rows, cells } = sceneCells(scene.kind, sceneFrameAt(tick), scene.width, view.palette)
    out.push(
      <Box key="scene-row" width={view.width} paddingLeft={ROW_HORIZONTAL_PADDING} paddingRight={ROW_HORIZONTAL_PADDING}>
        <Raster key="scene" columns={scene.width} rows={rows} cells={cells} />
      </Box>,
    )
  }
  out.push(
    <Box key="scene-caption" width={view.width} paddingLeft={ROW_HORIZONTAL_PADDING} paddingRight={ROW_HORIZONTAL_PADDING}>
      <Text dimColor>{scene.caption}</Text>
    </Box>,
  )
  return out
}
