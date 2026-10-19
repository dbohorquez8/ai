// Half-block packing for Raster cells. A cell is three little-endian 32-bit words: code point, foreground, background.

import { hexToColor } from './types'

export { hexToColor }

/** The terminal's own colour; never used as a foreground (the explore addendum's transparency rule). */
export const DEFAULT_COLOR = 0x01000000

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const base64Of = (bytes: Uint8Array): string => {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const w = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out += BASE64[(w >> 18) & 63]! + BASE64[(w >> 12) & 63]! + BASE64[(w >> 6) & 63]! + BASE64[w & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const w = bytes[i]! << 16
    out += `${BASE64[(w >> 18) & 63]!}${BASE64[(w >> 12) & 63]!}==`
  } else if (rest === 2) {
    const w = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out += `${BASE64[(w >> 18) & 63]!}${BASE64[(w >> 12) & 63]!}${BASE64[(w >> 6) & 63]!}=`
  }
  return out
}

/** Rows of 0xRRGGBB or null (transparent); the row count is even. */
export type Pixels = readonly (readonly (number | null)[])[]

/** One cell as [code point, foreground, background]. */
export type Cell = readonly [number, number, number]

export const UPPER_HALF = 0x2580
export const LOWER_HALF = 0x2584
export const FULL_BLOCK = 0x2588

/** Packs a list of cells into the base64 wire form. */
export const encodeCells = (cells: readonly Cell[]): string => {
  const bytes = new Uint8Array(cells.length * 12)
  const view = new DataView(bytes.buffer)
  cells.forEach((cell, i) => {
    view.setUint32(i * 12, cell[0], true)
    view.setUint32(i * 12 + 4, cell[1] >>> 0, true)
    view.setUint32(i * 12 + 8, cell[2] >>> 0, true)
  })
  return base64Of(bytes)
}

/** The cell for a top and bottom pixel; a transparent half shows `transparentBg`, never DEFAULT_COLOR as foreground. */
export const cellOf = (top: number | null, bottom: number | null, transparentBg: number): Cell => {
  if (top === null && bottom === null) return [0x20, DEFAULT_COLOR, transparentBg]
  if (bottom === null) return [UPPER_HALF, top!, transparentBg]
  if (top === null) return [LOWER_HALF, bottom, transparentBg]
  if (top === bottom) return [FULL_BLOCK, top, transparentBg]
  return [UPPER_HALF, top, bottom]
}

export const packCells = (pixels: Pixels, transparentBg: number): { columns: number; rows: number; cells: string } => {
  const columns = pixels[0]?.length ?? 0
  const rows = Math.floor(pixels.length / 2)
  const cells: Cell[] = []
  for (let row = 0; row < rows; row += 1)
    for (let x = 0; x < columns; x += 1) cells.push(cellOf(pixels[row * 2]![x] ?? null, pixels[row * 2 + 1]![x] ?? null, transparentBg))
  return { columns, rows, cells: encodeCells(cells) }
}
