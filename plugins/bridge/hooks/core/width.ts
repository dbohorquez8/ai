// Display width in terminal cells, so every drawn line can be padded and cut to an exact width.
// Pure: no `$`, no terminal facts.

const ZERO_WIDTH = /[\p{M}\p{Cc}\p{Cf}]/u
/** Pictographs drawn as emoji by default take two cells; text-default ones (`↕`, `☀`) take one unless U+FE0F follows. */
const EMOJI = /\p{Emoji_Presentation}/u
const PICTOGRAPH = /\p{Extended_Pictographic}/u

const ZWJ = 0x200d

/** East Asian Wide and Fullwidth ranges (Unicode EastAsianWidth.txt, W and F). */
const WIDE: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd],
]

const isWide = (code: number) => WIDE.some(([low, high]) => code >= low && code <= high)

/** The width of each code point of `text`: a pictograph that follows a joiner adds nothing, since the pair draws as one. */
const widthsOf = (chars: readonly string[]): number[] => {
  const widths: number[] = []
  let previous = 0
  for (const char of chars) {
    const code = char.codePointAt(0) ?? 0
    let width: number
    if (code === 0xfe0f && PICTOGRAPH.test(String.fromCodePoint(previous)) && widths.at(-1) === 1) widths[widths.length - 1] = 2
    if (code === ZWJ || code === 0xfe0f || code === 0xfe0e || ZERO_WIDTH.test(char)) width = 0
    else if (isWide(code) || EMOJI.test(char)) width = previous === ZWJ ? 0 : 2
    else width = 1
    widths.push(width)
    previous = code
  }
  return widths
}

/** 0 for marks and joiners, 2 for East Asian wide characters and emoji-presentation pictographs, else 1. */
export const cellWidth = (text: string): number => widthsOf([...text]).reduce((sum, one) => sum + one, 0)

/** Cut to `width` cells, ending in an ellipsis when cut; nothing when there is no room. */
export const fitCells = (text: string, width: number): string => {
  if (width <= 0) return ''
  const chars = [...text]
  const widths = widthsOf(chars)
  if (widths.reduce((sum, one) => sum + one, 0) <= width) return text
  const budget = width - 1
  let used = 0
  let out = ''
  for (let index = 0; index < chars.length; index++) {
    const one = widths[index]!
    if (used + one > budget) break
    used += one
    out += chars[index]
  }
  return `${out}…`
}

/** `fitCells`, then spaces up to exactly `width` cells. */
export const padCells = (text: string, width: number): string => {
  if (width <= 0) return ''
  const fitted = fitCells(text, width)
  return fitted + ' '.repeat(Math.max(0, width - cellWidth(fitted)))
}
