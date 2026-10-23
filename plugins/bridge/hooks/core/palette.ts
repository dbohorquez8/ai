// Palettes per theme mode: the generated hex values, adjusted deterministically for contrast.

import { projectColorsById } from '../project-colors'
import { GENERATED } from './palette.generated'
import type { Hue, Palette, Settings, ThemeMode } from './types'

const HUES: readonly Hue[] = ['red', 'orange', 'yellow', 'green', 'blue', 'violet', 'gray']
const REFERENCE_BG: Readonly<Record<ThemeMode, string>> = { dark: '#1c1c1c', light: '#ffffff' }
/** Plain text on the own-card fill: the terminal's default foreground may not match the theme (light set on a dark terminal). */
const INK: Readonly<Record<ThemeMode, string>> = { dark: '#eceef3', light: '#1f2126' }

const channelsOf = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const luminanceOf = (hex: string): number => {
  const [r, g, b] = channelsOf(hex).map(c => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours. */
export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const hslOf = (hex: string): [number, number, number] => {
  const [r, g, b] = channelsOf(hex).map(c => c / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}

const hexOfHsl = (h: number, s: number, l: number): string => {
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** Steps HSL lightness by 0.02 (lighter in dark, darker in light) until the colour reaches 4.5:1 against every colour. */
export const ensureContrast = (hex: string, against: readonly string[], mode: ThemeMode): string => {
  const ok = (c: string) => against.every(bg => contrastRatio(c, bg) >= 4.5)
  if (ok(hex)) return hex
  const [h, s, l0] = hslOf(hex)
  const step = mode === 'dark' ? 0.02 : -0.02
  let best = hex
  for (let l = l0 + step; l >= -0.001 && l <= 1.001; l += step) {
    best = hexOfHsl(h, s, Math.min(1, Math.max(0, l)))
    if (ok(best)) return best
  }
  return best
}

const paletteOf = (mode: ThemeMode): Palette => {
  const g = GENERATED[mode]
  const bg = REFERENCE_BG[mode]
  const fix = (hex: string) => ensureContrast(hex, [bg, g.fill, g.waitingRow], mode)
  const text = Object.fromEntries(HUES.map(h => [h, fix(g[h])])) as Record<Hue, string>
  return {
    text,
    pill: {
      red: { fg: ensureContrast(text.red, [g.redPill], mode), bg: g.redPill },
      gray: { fg: ensureContrast(text.gray, [g.grayPill], mode), bg: g.grayPill },
    },
    waitingRow: g.waitingRow,
    fill: g.fill,
    ink: ensureContrast(INK[mode], [g.fill], mode),
    bg,
  }
}

export const PALETTES: Readonly<Record<ThemeMode, Palette>> = { dark: paletteOf('dark'), light: paletteOf('light') }

/** Stable project colours, each adjusted to reach 4.5:1 on the pane background and the own-card fill. */
export const projectColorsOf = (projects: readonly string[], mode: ThemeMode): ReadonlyMap<string, string> => {
  const { bg, fill } = PALETTES[mode]
  return new Map([...projectColorsById(projects, {})].map(([name, color]) => [name, ensureContrast(color, [bg, fill], mode)]))
}

/** A `setting:theme` of dark or light wins; else a Claude theme starting with `light` is light; anything else is dark. */
export const themeModeOf = (configTheme: unknown, setting: Settings['theme']): ThemeMode => {
  if (setting === 'dark' || setting === 'light') return setting
  return typeof configTheme === 'string' && configTheme.startsWith('light') ? 'light' : 'dark'
}
