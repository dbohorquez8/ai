// One card: its exact-width lines (the first led by the project icon), its hover actions, its snooze menu and its child rows.
// Only maps the CardView to elements; every width, order and label comes from core.

import type { RenderElement } from 'claude-code'

import type { CardView, PaneView, Seg } from '../core/types'
import { CARD_EDGE_BOTTOM, CARD_EDGE_TOP, CARD_GAP_ROWS, ROW_HORIZONTAL_PADDING } from '../core/layout'
import { iconOf, spinnerOf } from './art'
import { backgroundRowsOf, childRowsOf } from './children'
import type { Els, Handlers } from './pane'

/**
 * A run's Text props: colours are palette hex, muted text is `dimColor`, plain text has no colour, except
 * on a filled card, where it takes `ink` so the text reads on the fill.
 */
export const textProps = (seg: Extract<Seg, { kind: 'text' }>, isDim: boolean, ink?: string) => ({
  ...(seg.color ? { color: seg.color } : ink ? { color: ink } : {}),
  ...(seg.bg ? { backgroundColor: seg.bg } : {}),
  ...(seg.dim || isDim ? { dimColor: true } : {}),
  ...(seg.bold ? { bold: true } : {}),
})

/** A drawn line's runs; the title run is the card's press target, the spinner its Raster. */
const lineOf = (els: Els, view: PaneView, card: CardView, segs: readonly Seg[], tick: number, on: Handlers) =>
  segs.map(seg => {
    const { Text, Button } = els
    if (seg.kind === 'spinner') return spinnerOf(els, view, card, tick)
    if (seg.role === 'title') {
      return (
        <Button key={`open:${card.id}`} plain {...(card.isDim ? { dimColor: true } : {})} onPress={() => on.pressCard(card.id)}>
          <Text {...textProps(seg, card.isDim, card.isSelected ? view.palette.ink : undefined)}>{seg.text}</Text>
        </Button>
      )
    }
    return <Text {...textProps(seg, card.isDim, card.isSelected ? view.palette.ink : undefined)}>{seg.text}</Text>
  })

const ACTION_LABEL = { snooze: 'Snooze', 'move-up': '↑', 'move-down': '↓' } as const

/** The hover actions, laid over the card's last line so showing them moves nothing; the card's row lights their group. */
const actionsOf = (els: Els, card: CardView, on: Handlers, top: number) => {
  const { Box, Button } = els
  if (card.actions.length === 0) return undefined
  return (
    <Box key={`actions:${card.id}`} display="none" hover={{ scope: `card:${card.id}`, display: 'flex' }} position="absolute" top={top} right={0} columnGap={1}>
      {card.actions.map(action => {
        const label = action === 'pin' || action === 'park' || action === 'settle' ? card.labels[action] : ACTION_LABEL[action]
        const press = () => (action === 'snooze' ? on.openSnooze(card.prefId) : on.act(card.prefId, action))
        return (
          <Button key={`${action}:${card.id}`} plain dimColor onPress={press}>
            {label}
          </Button>
        )
      })}
    </Box>
  )
}

const snoozeMenuOf = (els: Els, card: CardView, on: Handlers) => {
  const { Box, Button } = els
  if (!card.snoozeMenu) return undefined
  return (
    <Box key={`snooze-menu:${card.id}`} flexDirection="column" paddingLeft={2}>
      {card.snoozeMenu.map(option => (
        <Button key={`snooze-pick:${option.label}`} plain onPress={() => on.pickSnooze(card.prefId, option.wake)}>
          {option.label}
        </Button>
      ))}
      <Button key="snooze-cancel" plain dimColor onPress={() => on.openSnooze(undefined)}>
        Cancel
      </Button>
    </Box>
  )
}

/**
 * A full card is three line rows; one blank row (CARD_GAP_ROWS) separates it from the card before. A selected full card
 * fills those rows edge to edge and draws half-row edges in the gap rows around it: `▄` above and `▀` below, in the
 * fill colour on the pane's own background. The next card then skips its gap, because the `▀` row is already there.
 * Compact Working cards keep their one-line form.
 */
export const cardOf = (els: Els, view: PaneView, card: CardView, at: number, frame: { tick: number }, on: Handlers, viewedAgent: string | undefined, followsSelected = false): RenderElement => {
  const { Box, Text } = els
  const edged = card.form === 'full' && card.isSelected
  const edgeRowOf = (edge: 'top' | 'bottom') => (
    <Box key={`card-${edge}:${card.id}`} flexDirection="row" width={view.width}>
      <Text color={view.selectedFill}>{(edge === 'top' ? CARD_EDGE_TOP : CARD_EDGE_BOTTOM).repeat(view.width)}</Text>
    </Box>
  )
  const gapped = card.form === 'full' && at > 0 && !edged && !followsSelected
  return (
    <Box key={`card:${card.id}`} flexDirection="column" {...(gapped ? { marginTop: CARD_GAP_ROWS } : {})}>
      {edged ? edgeRowOf('top') : undefined}
      <Box key={`row:${card.id}`} flexDirection="row" width={view.width} hover={{ scope: `card:${card.id}` }} {...(card.isSelected ? { backgroundColor: view.selectedFill } : {})}>
        <Box flexDirection="column" paddingLeft={ROW_HORIZONTAL_PADDING} paddingRight={ROW_HORIZONTAL_PADDING}>
          {card.lines.map((segs, index) => (
            <Box key={`line${index + 1}:${card.id}`} flexDirection="row">
              {index === 0 ? iconOf(els, card) : undefined}
              {lineOf(els, view, card, segs, frame.tick, on)}
            </Box>
          ))}
        </Box>
      </Box>
      {edged ? edgeRowOf('bottom') : undefined}
      {actionsOf(els, card, on, card.lines.length - 1 + (edged ? 1 : 0))}
      {snoozeMenuOf(els, card, on)}
      {childRowsOf(els, view, card, frame.tick, on, viewedAgent)}
      {backgroundRowsOf(els, view, card)}
    </Box>
  )
}
