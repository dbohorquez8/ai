// The own card's child rows: `  │ ● label … status slot`, then `+N more`.
// The status slot (role `status`) sits outside the view Button, so the Button reads as the label.
// Its background-task rows follow: `  │ ⟳ Kind label … age`, then `+N more`; they have no transcript to open.

import type { RenderElement } from 'claude-code'

import type { CardView, PaneView } from '../core/types'
import { ROW_HORIZONTAL_PADDING } from '../core/layout'
import { spinnerOf } from './art'
import { textProps } from './card'
import type { Els, Handlers } from './pane'

export const childRowsOf = (els: Els, view: PaneView, card: CardView, tick: number, on: Handlers, viewedAgent: string | undefined): RenderElement[] => {
  const { Box, Text, Button } = els
  if (!card.children) return []
  const rows = card.children.rows.map(row => {
    const label = row.text.filter(seg => seg.kind === 'text' && seg.role !== 'status')
    const tail = row.text.filter(seg => seg.kind === 'spinner' || (seg.kind === 'text' && seg.role === 'status'))
    return (
      <Box key={`child:${row.id}`} flexDirection="row" width={view.width} paddingLeft={ROW_HORIZONTAL_PADDING} paddingRight={ROW_HORIZONTAL_PADDING}>
        <Box flexDirection="row" {...(row.bg ? { backgroundColor: row.bg } : {})}>
          <Button key={`view:${row.id}`} plain onPress={() => on.pressChild(row.id)}>
            {label.map(seg =>
              seg.kind === 'text' ? <Text {...textProps(seg, false)}>{viewedAgent === row.id && seg.text === '●' ? '▸' : seg.text}</Text> : undefined,
            )}
          </Button>
          {tail.map(seg => (seg.kind === 'text' ? <Text {...textProps(seg, false)}>{seg.text}</Text> : spinnerOf(els, view, card, tick, row.id, row.bg ?? null)))}
        </Box>
      </Box>
    )
  })
  if (!card.children.more) return rows
  return [
    ...rows,
    <Box key="child-more" flexDirection="row" width={view.width} paddingLeft={ROW_HORIZONTAL_PADDING + 4} paddingRight={ROW_HORIZONTAL_PADDING}>
      <Text dimColor>{card.children.more}</Text>
    </Box>,
  ]
}

export const backgroundRowsOf = (els: Els, view: PaneView, card: CardView): RenderElement[] => {
  const { Box, Text } = els
  if (!card.background) return []
  const rows = card.background.rows.map(row => (
    <Box key={`task:${row.id}`} flexDirection="row" width={view.width} paddingLeft={ROW_HORIZONTAL_PADDING} paddingRight={ROW_HORIZONTAL_PADDING}>
      {row.text.map(seg => (seg.kind === 'text' ? <Text {...textProps(seg, false)}>{seg.text}</Text> : undefined))}
    </Box>
  ))
  if (!card.background.more) return rows
  return [
    ...rows,
    <Box key="task-more" flexDirection="row" width={view.width} paddingLeft={ROW_HORIZONTAL_PADDING + 4} paddingRight={ROW_HORIZONTAL_PADDING}>
      <Text dimColor>{card.background.more}</Text>
    </Box>,
  ]
}
