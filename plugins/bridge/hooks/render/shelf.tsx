// One shelf: its muted header (a press toggles it), the sort row under the open Active header,
// its cards, and in the empty Active shelf the scene and its caption.

import type { RenderElement } from 'claude-code'

import type { PaneView, ShelfView, SortMode } from '../core/types'
import { sceneOf } from './art'
import { cardOf } from './card'
import type { Els, Handlers } from './pane'

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recent activity' },
  { value: 'created', label: 'Date created' },
  { value: 'project', label: 'Project' },
] as const

export const shelfOf = (els: Els, view: PaneView, shelf: ShelfView, at: number, frame: { tick: number }, on: Handlers, viewedAgent: string | undefined): RenderElement => {
  const { Box, Text, Button } = els
  // The Active header carries the sort control: `↕` before the chevron opens the sort menu; the rest toggles the shelf.
  const [head, tail] = shelf.hasSort ? [shelf.header.slice(0, -4), shelf.header.slice(-2)] : [shelf.header, '']
  return (
    <Box key={`section:${shelf.id}`} flexDirection="column" {...(at > 0 ? { marginTop: 1 } : {})}>
      {shelf.hasHeader && (
        <Box key={`header:${shelf.id}`} flexDirection="row">
          <Button key={`shelf:${shelf.id}`} plain dimColor onPress={() => on.toggleShelf(shelf.id)}>
            <Text dimColor>{head}</Text>
          </Button>
          {shelf.hasSort && (
            <Button key="sort" plain dimColor onPress={() => on.toggleSort()}>
              <Text dimColor>{' ↕'}</Text>
            </Button>
          )}
          {shelf.hasSort && (
            <Button key={`chevron:${shelf.id}`} plain dimColor onPress={() => on.toggleShelf(shelf.id)}>
              <Text dimColor>{tail}</Text>
            </Button>
          )}
        </Box>
      )}
      {shelf.sortMenu && (
        <Box key="sort-menu" flexDirection="column" paddingLeft={2}>
          {SORT_OPTIONS.map(option => (
            <Button key={`sort:${option.value}`} plain onPress={() => on.sort(option.value as SortMode)}>
              <Text {...(option.value === view.sort ? {} : { dimColor: true })}>{`${option.value === view.sort ? '✓' : ' '} ${option.label}`}</Text>
            </Button>
          ))}
        </Box>
      )}
      {shelf.cards.map((card, index) => cardOf(els, view, card, index, frame, on, viewedAgent))}
      {shelf.id === 'active' && !shelf.isCollapsed && shelf.cards.length === 0 && sceneOf(els, view, frame.tick)}
    </Box>
  )
}
