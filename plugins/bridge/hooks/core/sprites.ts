// The spinner and scene art; the working scene's creature (AC-48) is drawn from the poses. Poses are 4 x 6 pixels (4 columns x 3 rows), modelled on the working-scene
// typist of the design (a round head with a sprout, eyes that blink, a bobbing head).
// Portions adapted from MIT-licensed code; Copyright (c) 2026 Michael Yong, Copyright (c) 2026 Yusuf Akbulut. See THIRD_PARTY_NOTICES.md.

import { DEFAULT_COLOR, encodeCells, hexToColor, packCells } from './raster'
import type { Pixels } from './raster'
import type { Palette, Pose } from './types'

/**
 * Frames of 6 strings x 4 characters; '.' is transparent. Like the designed typist, the body is line art in muted text:
 * o outline, f faint fill, e eye, g sprout; m raised mark, y spark or key, z sleep mark are the only accents.
 */
export const POSE_FRAMES: Readonly<Record<Pose, readonly string[][]>> = {
  typing: [
    ['..g.', '.oo.', 'offo', 'oeeo', 'oooo', 'y.y.'],
    ['.g..', '.oo.', 'offo', 'oeeo', 'oooo', '.y.y'],
  ],
  waving: [
    ['g..m', '.oo.', 'offo', 'oeeo', 'oooo', '....'],
    ['g...', '.oom', 'offo', 'oeeo', 'oooo', '....'],
  ],
  cheering: [['y.gy', '.oo.', 'offo', 'oeeo', 'oooo', '....']],
  asleep: [['...z', '..g.', '.oo.', 'offo', 'offo', 'oooo']],
}

/** Body tones are muted text mixed toward what sits behind the creature: the own-card fill, else the pane background. */
const rolesOf = (palette: Palette, behind: number = hexToColor(palette.bg)): Readonly<Record<string, number>> => {
  const gray = hexToColor(palette.text.gray)
  return {
    o: mix(gray, behind, 0.45),
    f: mix(gray, behind, 0.85),
    e: mix(gray, behind, 0.15),
    g: mix(hexToColor(palette.text.green), behind, 0.3),
    b: mix(gray, behind, 0.45),
    m: hexToColor(palette.text.red),
    y: hexToColor(palette.text.yellow),
    z: hexToColor(palette.text.blue),
  }
}


export const SPINNER_FRAMES: readonly string[] = Array.from('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏')

export const spinnerCells = (frame: number, color: string, transparentBg: number): string => {
  const glyph = SPINNER_FRAMES[((frame % SPINNER_FRAMES.length) + SPINNER_FRAMES.length) % SPINNER_FRAMES.length]!
  return encodeCells([[glyph.codePointAt(0)!, hexToColor(color), transparentBg]])
}

const mix = (a: number, b: number, t: number): number => {
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t)
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

const blank = (width: number, height: number): (number | null)[][] => Array.from({ length: height }, () => Array<number | null>(width).fill(null))

const put = (grid: (number | null)[][], x: number, y: number, color: number): void => {
  if (y >= 0 && y < grid.length && x >= 0 && x < grid[0]!.length) grid[y]![x] = color
}

const stamp = (grid: (number | null)[][], left: number, top: number, rows: readonly string[], palette: Palette): void => {
  const roles = rolesOf(palette)
  rows.forEach((row, dy) => Array.from(row).forEach((ch, dx) => ch !== '.' && roles[ch] !== undefined && put(grid, left + dx, top + dy, roles[ch]!)))
}

const HILLS_PIXEL_ROWS = 8
const WORKING_PIXEL_ROWS = 10

/** The empty-state hills: muted gray line art, faint soil, three plants and a pale sun. */
const hillsGrid = (frame: number, width: number, palette: Palette): Pixels => {
  const grid = blank(width, HILLS_PIXEL_ROWS)
  const gray = hexToColor(palette.text.gray)
  const bg = hexToColor(palette.bg)
  const line = mix(gray, bg, 0.45)
  const soil = mix(gray, bg, 0.82)
  const plant = line
  const sun = mix(gray, bg, 0.65)
  const topOf = (x: number) => Math.round(5.2 - 1.4 * Math.sin((x / Math.max(width, 1)) * Math.PI * 2 + 0.8) - 0.6 * Math.sin(x * 0.4))
  for (let x = 0; x < width; x += 1) {
    const top = Math.min(HILLS_PIXEL_ROWS - 1, Math.max(2, topOf(x)))
    put(grid, x, top, line)
    for (let y = top + 1; y < HILLS_PIXEL_ROWS; y += 1) put(grid, x, y, soil)
  }
  const sunX = Math.max(0, width - 5)
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) put(grid, sunX + dx, dy, sun)
  for (const at of [0.22, 0.45, 0.68]) {
    const x = Math.round(width * at)
    const top = Math.min(HILLS_PIXEL_ROWS - 1, Math.max(2, topOf(x)))
    const sway = frame % 2 === 0 ? -1 : 1
    put(grid, x, top - 1, plant)
    put(grid, x, top - 2, plant)
    put(grid, x + sway, top - 3, plant)
  }
  return grid
}

const workingGrid = (frame: number, width: number, palette: Palette): Pixels => {
  const grid = blank(width, WORKING_PIXEL_ROWS)
  const gray = hexToColor(palette.text.gray)
  const bg = hexToColor(palette.bg)
  const lid = mix(gray, bg, 0.35)
  const screen = mix(gray, bg, 0.75)
  const base = mix(gray, bg, 0.5)
  const key = hexToColor(palette.text.yellow)
  const cx = Math.floor(width / 2)
  stamp(grid, cx - 2, 0, POSE_FRAMES.typing[frame % POSE_FRAMES.typing.length]!.map(row => row.replace(/y/g, '.')), palette)
  const left = cx - 4
  for (let x = left; x < left + 8; x += 1) {
    put(grid, x, 5, lid)
    put(grid, x, 6, screen)
    put(grid, x, 7, screen)
    put(grid, x, 8, lid)
    put(grid, x, 9, base)
  }
  put(grid, left + (frame % 2 === 0 ? 2 : 5), 9, key)
  return grid
}

export const sceneCells = (kind: 'hills' | 'working', frame: number, width: number, palette: Palette): { rows: number; cells: string } => {
  const columns = Math.max(1, width)
  const packed = packCells(kind === 'hills' ? hillsGrid(frame, columns, palette) : workingGrid(frame, columns, palette), DEFAULT_COLOR)
  return { rows: packed.rows, cells: packed.cells }
}
