// The icon candidate files in their order and the monogram letter rule, unchanged but for style. Dropped: the
// HTTP route, the href extraction from page sources and the monogram tile colours (the pane uses the
// card's project colour). Added: the cache name and the conversion commands, pure. Pure.
// Portions adapted from MIT-licensed code; Copyright (c) 2026 Michael Yong, Copyright (c) 2026 Yusuf Akbulut; design reference Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.

import { contrastRatio } from './palette'
import { cellWidth, fitCells } from './width'

// Mirrors T3 Code's useful, framework-agnostic candidates. The root icon
// wins, then public assets, framework app icons, and finally generic assets.
export const PROJECT_ICON_CANDIDATES = [
  'favicon.svg',
  'favicon.ico',
  'favicon.png',
  'icon.svg',
  'icon.png',
  'icon.ico',
  'public/favicon.svg',
  'public/favicon.ico',
  'public/favicon.png',
  'app/favicon.ico',
  'app/favicon.png',
  'app/icon.svg',
  'app/icon.png',
  'app/icon.ico',
  'src/favicon.ico',
  'src/favicon.svg',
  'src/app/favicon.ico',
  'src/app/icon.svg',
  'src/app/icon.png',
  'assets/icon.svg',
  'assets/icon.png',
  'assets/logo.svg',
  'assets/logo.png',
  '.idea/icon.svg',
] as const

/**
 * Leading words that many project names share. Skipped while another word
 * follows, so names that share a short prefix read as their own letters
 * rather than a column of identical ones.
 */
const GENERIC_WORDS = new Set(['plugin', 'the', 'my'])

const words = (name: string): string[] => {
  // An npm scope or a path prefix says where the project lives, not what it is.
  const base = name.trim().replace(/^@[^/]+\//u, '').split('/').at(-1) ?? ''
  return base
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** The one letter that stands for a project without an icon. */
export const projectMonogramLetter = (name: string): string => {
  const all = words(name)
  const first = all.find((word, index) => index === all.length - 1 || !GENERIC_WORDS.has(word.toLowerCase())) ?? ''
  return first ? [...first][0]!.toLocaleUpperCase() : '#'
}

/** The monogram's two cells: the letter and a space, or a wide letter alone. */
export const monogramTextOf = (letter: string): string => {
  const shown = cellWidth(letter) > 2 ? fitCells(letter, 2) : letter
  return `${shown}${' '.repeat(Math.max(0, 2 - cellWidth(shown)))}`
}

/** White or black, whichever contrasts more with `bg`; either reaches 4.5:1 on any colour. */
export const inkOf = (bg: string): string => (contrastRatio('#ffffff', bg) >= contrastRatio('#000000', bg) ? '#ffffff' : '#000000')

/** How long a project's icon lookup stands before the folder is looked at again. */
export const ICON_LOOKUP_MS = 10 * 60_000
/** The size the cached PNG is scaled to, in pixels on its long side. */
export const ICON_PIXELS = 64

/** A source picture larger than this is skipped, and the next candidate file is tried. */
export const ICON_MAX_BYTES = 1_048_576
/** A PNG or ICO wider or taller than this is not converted; an SVG has no pixel size, so only the byte limit applies. */
export const ICON_MAX_SIDE = 1024

/** Whether a candidate file is small enough to read as a project icon. */
export const isIconSizeUsable = (bytes: number): boolean => bytes > 0 && bytes <= ICON_MAX_BYTES

/** Bumped when the conversion changes, so older cached pictures are not reused. */
const ICON_CACHE_VERSION = 3

/** A stable cache file name for a source picture at one modification time (FNV-1a). */
export const iconCacheNameOf = (source: string, mtimeMs: number): string => {
  let hash = 0x811c9dc5
  for (const char of `${ICON_CACHE_VERSION}\u0000${source}\u0000${Math.round(mtimeMs)}`) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193)
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}.png`
}

/** The folder a session's project lives in: the main checkout above a linked git dir, else the working directory. */
export const projectRootOf = (cwd: string, commonDir: string | undefined): string => {
  const common = commonDir?.trim().replace(/\/+$/, '')
  return common?.endsWith('/.git') ? common.slice(0, -'/.git'.length) : cwd
}

const CONVERT_SCRIPT = [
  'mkdir -p "$1" || exit 1',
  // A raster wider or taller than ICON_MAX_SIDE is refused before any conversion.
  `case "$2" in *.svg|*.SVG) ;; *) sips -g pixelWidth -g pixelHeight "$2" 2>/dev/null | awk '/pixel(Width|Height)/ { if ($2 > ${ICON_MAX_SIDE}) bad = 1 } END { exit bad }' || exit 1 ;; esac`,
  `sips -s format png -Z ${ICON_PIXELS} "$2" --out "$3" >/dev/null 2>&1`,
  // sips reads SVG on current macOS; rsvg-convert covers older systems. Quick Look is not used: its thumbnail pads a white page.
  'case "$2" in *.svg|*.SVG) test -s "$3" || rsvg-convert -w ' + ICON_PIXELS + ' -h ' + ICON_PIXELS + ' -a "$2" -o "$3" >/dev/null 2>&1 ;; esac',
  'test -s "$3"',
].join('\n')

/** One process that writes `target` (a PNG in `dir`) from the picture at `source`. */
export const iconConvertArgv = (dir: string, source: string, target: string): string[] => ['sh', '-c', CONVERT_SCRIPT, 'bridge', dir, source, target]
