// The own card's child rows: `  │ ● label … TAG age`, a waiting row tinted, then `+N more`.
// The tag and age (role `status`) sit outside the view Button, so the Button reads as the label.
// Its background-task rows follow: `  │ ⟳ Kind label … age`, then `+N more`; they have no transcript to open.

import type { RenderElement } from 'claude-code'

import type { CardView } from '../core/types'
import { textProps } from './card'
import type { Els, Handlers } from './pane'

export const childRowsOf = (els: Els, card: CardView, on: Handlers, viewedAgent: string | undefined): RenderElement[] => {
  const { Box, Text, Button } = els
  if (!card.children) return []
  const rows = card.children.rows.map(row => {
    const label = row.text.filter(seg => seg.kind === 'text' && seg.role !== 'status')
    const tail = row.text.filter(seg => seg.kind === 'text' && seg.role === 'status')
    return (
      <Box key={`child:${row.id}`} flexDirection="row" {...(row.bg ? { backgroundColor: row.bg } : {})}>
        <Button key={`view:${row.id}`} plain onPress={() => on.pressChild(row.id)}>
          {label.map(seg =>
            seg.kind === 'text' ? <Text {...textProps(seg, false)}>{viewedAgent === row.id && seg.text === '●' ? '▸' : seg.text}</Text> : undefined,
          )}
        </Button>
        {tail.map(seg => (seg.kind === 'text' ? <Text {...textProps(seg, false)}>{seg.text}</Text> : undefined))}
      </Box>
    )
  })
  if (!card.children.more) return rows
  return [
    ...rows,
    <Box key="child-more" flexDirection="row" paddingLeft={4}>
      <Text dimColor>{card.children.more}</Text>
    </Box>,
  ]
}

export const backgroundRowsOf = (els: Els, card: CardView): RenderElement[] => {
  const { Box, Text } = els
  if (!card.background) return []
  const rows = card.background.rows.map(row => (
    <Box key={`task:${row.id}`} flexDirection="row">
      {row.text.map(seg => (seg.kind === 'text' ? <Text {...textProps(seg, false)}>{seg.text}</Text> : undefined))}
    </Box>
  ))
  if (!card.background.more) return rows
  return [
    ...rows,
    <Box key="task-more" flexDirection="row" paddingLeft={4}>
      <Text dimColor>{card.background.more}</Text>
    </Box>,
  ]
}
