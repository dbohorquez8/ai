// The pane's chrome: the source notice and the one-line note under the list. As designed, the pane
// carries no top line and no settings rows; settings are `/bridge` arguments.

import type { RenderElement } from 'claude-code'

import type { Els } from './pane'

/** A source problem (ListAgents refused, registry unreadable), above the shelves. */
export const noticeOf = (els: Els, notice: string): RenderElement | undefined => {
  const { Box, Text } = els
  return notice === '' ? undefined : (
    <Box key="notice">
      <Text color="warning">{notice}</Text>
    </Box>
  )
}

/** The one-line note under the list, when there is one. */
export const noteOf = (els: Els, note: string): RenderElement | undefined => {
  const { Box, Text } = els
  return note === '' ? undefined : (
    <Box key="note" marginTop={1}>
      <Text dimColor>{note}</Text>
    </Box>
  )
}
