// The decorative glyph mode is resolved once at the terminal edge, then core layout receives the result.

import type { GlyphMode, GlyphSetting } from '../core/types'

/** Ghostty and iTerm2 ship the Powerline/Nerd glyphs Bridge uses. All other terminals stay readable. */
export const glyphModeOf = (setting: GlyphSetting | undefined, terminalProgram: string | undefined): GlyphMode => {
  if (setting === 'nerd' || setting === 'plain') return setting
  return terminalProgram === 'ghostty' || terminalProgram === 'iTerm.app' ? 'nerd' : 'plain'
}
