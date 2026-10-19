import { describe, expect, test, tier } from 'claude-code/testing'

import { bellOf, framesAt, isAnimating, sceneFrameAt, spinnerFrameAt } from '../hooks/core/animation'
import { contrastRatio, ensureContrast, PALETTES, projectColorsOf, themeModeOf } from '../hooks/core/palette'
import { GENERATED } from '../hooks/core/palette.generated'
import { base64Of, DEFAULT_COLOR, hexToColor, packCells } from '../hooks/core/raster'
import { POSE_FRAMES, sceneCells, SPINNER_FRAMES, spinnerCells } from '../hooks/core/sprites'
import { STATUS_HUE, TAG_HUE } from '../hooks/core/types' // amend 2026-10-18: AC-93 -- (contextHueOf removed)
import type { CardView, Hue, PaneView, Pose, Status, ThemeMode } from '../hooks/core/types'

tier('builtin')

const MODES: readonly ThemeMode[] = ['dark', 'light']
const HUES: readonly Hue[] = ['red', 'orange', 'yellow', 'green', 'blue', 'violet', 'gray']

const near = (actual: string, expected: string) => {
  const a = hexToColor(actual)
  const e = hexToColor(expected)
  for (const shift of [16, 8, 0]) expect(Math.abs(((a >> shift) & 255) - ((e >> shift) & 255))).toBeLessThanOrEqual(1)
}

/** Decodes the base64 wire form back to [code point, fg, bg] cells. */
const decode = (cells: string): Array<[number, number, number]> => {
  const bytes = Uint8Array.from(atob(cells), ch => ch.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  const out: Array<[number, number, number]> = []
  for (let i = 0; i < bytes.length; i += 12) out.push([view.getUint32(i, true), view.getUint32(i + 4, true), view.getUint32(i + 8, true)])
  return out
}

describe('palette values (AC-37, AC-38, L7)', () => {
  const EXPECTED = {
    dark: { red: '#ff9f94', orange: '#f7bc95', yellow: '#ecd78a', green: '#98d5ac', blue: '#74d4ff', violet: '#c4b4ff', gray: '#d2d8e2', fill: '#2f313d' },
    light: { red: '#a50008', orange: '#7c3600', yellow: '#5e4b00', green: '#095c34', blue: '#0069a8', violet: '#664bad', gray: '#434850', fill: '#f1f2f8' },
  } as const
  for (const mode of MODES) {
    test(`the generated ${mode} hues and fill match the locked hex values within one step`, () => {
      for (const hue of HUES) near(GENERATED[mode][hue], EXPECTED[mode][hue])
      near(GENERATED[mode].fill, EXPECTED[mode].fill)
    })
    test(`the ${mode} palette keeps the seven hues and the fill`, () => {
      for (const hue of HUES) near(PALETTES[mode].text[hue], EXPECTED[mode][hue])
      near(PALETTES[mode].fill, EXPECTED[mode].fill)
    })
  }
  test('each mode has its own set (AC-38)', () => {
    for (const hue of HUES) expect(PALETTES.dark.text[hue]).not.toBe(PALETTES.light.text[hue])
  })
})

describe('contrast (AC-39)', () => {
  test('contrastRatio matches known WCAG values', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff') * 1000)).toBe(21_000)
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1)
  })
  test('ensureContrast leaves a passing colour alone and is deterministic', () => {
    expect(ensureContrast('#ffffff', ['#1c1c1c'], 'dark')).toBe('#ffffff')
    const first = ensureContrast('#555555', ['#1c1c1c'], 'dark')
    expect(ensureContrast('#555555', ['#1c1c1c'], 'dark')).toBe(first)
    expect(contrastRatio(first, '#1c1c1c')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(ensureContrast('#aaaaaa', ['#ffffff'], 'light'), '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })
  test('every colour the mod chooses reaches 4.5:1 on the pane background and the own-card fill, in both modes', () => {
    const failures: string[] = []
    const check = (mode: ThemeMode, what: string, fg: string, bgs: readonly string[]) => {
      for (const bg of bgs) {
        const ratio = contrastRatio(fg, bg)
        if (ratio < 4.5) failures.push(`${mode} ${what} ${fg} on ${bg} = ${ratio.toFixed(2)}`)
      }
    }
    for (const mode of MODES) {
      const p = PALETTES[mode]
      const surfaces = [p.bg, p.fill]
      for (const hue of HUES) check(mode, `text ${hue}`, p.text[hue], surfaces)
      for (const hue of Object.values(STATUS_HUE)) check(mode, `status ${hue}`, p.text[hue], surfaces)
      for (const hue of Object.values(TAG_HUE)) check(mode, `tag ${hue}`, p.text[hue], [...surfaces, p.waitingRow])
      // amend 2026-10-18: AC-93 -- the context tones are muted (gray) below 75, orange from 75, red at 100.
      for (const hue of ['gray', 'orange', 'red'] as const) check(mode, `context ${hue}`, p.text[hue], surfaces)
      check(mode, 'pill red', p.pill.red.fg, [p.pill.red.bg])
      check(mode, 'pill gray', p.pill.gray.fg, [p.pill.gray.bg])
      check(mode, 'ink', p.ink, [p.fill]) // amend 2026-10-19: Owner demo -- plain text on the own-card fill
      const names = Array.from({ length: 60 }, (_, i) => `project-${i}`)
      for (const [name, color] of projectColorsOf(names, mode)) check(mode, `project ${name}`, color, surfaces)
    }
    expect(failures).toEqual([])
  })
})

describe('project colours (AC-10)', () => {
  test('a name keeps its colour across calls', () => {
    for (const mode of MODES) expect(projectColorsOf(['alpha', 'beta'], mode).get('alpha')).toBe(projectColorsOf(['alpha', 'beta'], mode).get('alpha'))
  })
  test('a name keeps its colour across two different project sets', () => {
    for (const mode of MODES) {
      const small = projectColorsOf(['alpha', 'beta'], mode)
      const large = projectColorsOf(['zeta', 'alpha', 'beta', 'gamma', 'delta'], mode)
      expect(large.get('alpha')).toBe(small.get('alpha'))
      expect(large.get('beta')).toBe(small.get('beta'))
    }
  })
  test('distinct projects get distinct colours', () => {
    const colors = projectColorsOf(['alpha', 'beta', 'gamma', 'delta'], 'dark')
    expect(new Set(colors.values()).size).toBe(4)
  })
})

describe('themeModeOf (AC-38)', () => {
  test("a Claude theme starting with 'light' is light", () => {
    expect(themeModeOf('light', 'auto')).toBe('light')
    expect(themeModeOf('light-daltonized', 'auto')).toBe('light')
  })
  test('dark, other and unreadable themes are dark', () => {
    expect(themeModeOf('dark', 'auto')).toBe('dark')
    expect(themeModeOf('auto', 'auto')).toBe('dark')
    expect(themeModeOf(undefined, 'auto')).toBe('dark')
    expect(themeModeOf(42, 'auto')).toBe('dark')
  })
  test('the setting wins over the Claude theme', () => {
    expect(themeModeOf('light', 'dark')).toBe('dark')
    expect(themeModeOf('dark', 'light')).toBe('light')
    expect(themeModeOf(undefined, 'light')).toBe('light')
  })
})

describe('packCells (I-5)', () => {
  const T = 0x123456
  const A = 0xaa0000
  const B = 0x00bb00
  const cell = (top: number | null, bottom: number | null) => decode(packCells([[top], [bottom]], T).cells)[0]
  test('both transparent: a space with the default foreground on the transparent background', () => {
    expect(cell(null, null)).toEqual([0x20, DEFAULT_COLOR, T])
  })
  test('top only: upper half in the top colour', () => {
    expect(cell(A, null)).toEqual([0x2580, A, T])
  })
  test('bottom only: lower half in the bottom colour', () => {
    expect(cell(null, B)).toEqual([0x2584, B, T])
  })
  test('equal halves: a full block', () => {
    expect(cell(A, A)).toEqual([0x2588, A, T])
  })
  test('different halves: upper half, top as foreground, bottom as background', () => {
    expect(cell(A, B)).toEqual([0x2580, A, B])
  })
  test('reports columns and rows', () => {
    const packed = packCells([[A, B, null], [A, B, null], [null, null, null], [B, A, A]], T)
    expect([packed.columns, packed.rows]).toEqual([3, 2])
    expect(decode(packed.cells)).toHaveLength(6)
  })
  test('base64Of matches the standard encoding', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'abcd']) expect(base64Of(new TextEncoder().encode(text))).toBe(btoa(text))
  })
})

describe('sprites (AC-41 to AC-43)', () => {
  const POSES: readonly Pose[] = ['typing', 'waving', 'cheering', 'asleep']
  const isPrintable = (code: number) => code >= 0x20 && code <= 0xffff && !(code >= 0xd800 && code <= 0xdfff) && !(code >= 0x7f && code < 0xa0)
  test('every pose frame is 6 rows of 4 characters', () => {
    for (const pose of POSES) for (const frame of POSE_FRAMES[pose]) expect(frame.map(row => row.length)).toEqual([4, 4, 4, 4, 4, 4])
  })
  test('the four poses have distinct first-frame grids', () => { // amend 2026-10-18: AC-42 -- poses now feed the working scene only
    expect(new Set(POSES.map(pose => POSE_FRAMES[pose][0]!.join('|'))).size).toBe(4)
  })
  test('typing and waving have at least two distinct frames; cheering and asleep have one', () => { // amend 2026-10-18: AC-43
    for (const pose of ['typing', 'waving'] as const) expect(new Set(POSE_FRAMES[pose].map(f => f.join('|'))).size).toBeGreaterThanOrEqual(2)
    expect(POSE_FRAMES.cheering).toHaveLength(1)
    expect(POSE_FRAMES.asleep).toHaveLength(1)
  })
  // amend 2026-10-18: AC-41 -- cards draw no creature, so the per-card creature cell tests are gone.
  test('the spinner is one width-1 braille cell per frame, in ten frames', () => {
    expect(SPINNER_FRAMES).toHaveLength(10)
    SPINNER_FRAMES.forEach((glyph, frame) => {
      const [only] = decode(spinnerCells(frame, '#ecd78a', DEFAULT_COLOR))
      expect(only).toEqual([glyph.codePointAt(0), hexToColor('#ecd78a'), DEFAULT_COLOR])
    })
  })
  test('scenes are at most 6 rows, two distinct frames, and use only block characters and spaces', () => {
    for (const kind of ['hills', 'working'] as const)
      for (const width of [20, 30, 44]) {
        const a = sceneCells(kind, 0, width, PALETTES.dark)
        const b = sceneCells(kind, 1, width, PALETTES.dark)
        expect(a.rows).toBeLessThanOrEqual(6)
        expect(a.cells).not.toBe(b.cells)
        expect(sceneCells(kind, 2, width, PALETTES.dark).cells).toBe(a.cells)
        const cells = decode(a.cells)
        expect(cells).toHaveLength(a.rows * width)
        for (const [code, fg] of cells) {
          expect([0x20, 0x2580, 0x2584, 0x2588]).toContain(code)
          if (code !== 0x20) expect(fg).not.toBe(DEFAULT_COLOR)
        }
      }
  })
  test('every code point drawn is one printable width-1 BMP character', () => {
    const codes = new Set<number>()
    for (const glyph of SPINNER_FRAMES) codes.add(glyph.codePointAt(0)!)
    for (const kind of ['hills', 'working'] as const) for (const [c] of decode(sceneCells(kind, 0, 40, PALETTES.light).cells)) codes.add(c)
    for (const code of codes) {
      expect(isPrintable(code)).toBe(true)
      expect(Array.from(String.fromCodePoint(code))).toHaveLength(1)
    }
  })
})

describe('animation policy (AC-22, AC-111 to AC-113)', () => {
  test('the bell changes only inside the first 450 ms of each 4 s window (AC-22)', () => {
    let previous = bellOf(0)
    const changes: number[] = []
    for (let ms = 1; ms <= 12_000; ms += 1) {
      const now = bellOf(ms)
      if (now !== previous) changes.push(ms)
      previous = now
    }
    expect(changes.length).toBeGreaterThan(0)
    for (const ms of changes) expect(ms % 4000).toBeLessThanOrEqual(450)
    expect(bellOf(0)).toBe(1)
    expect(bellOf(200)).toBe(2)
    expect(bellOf(350)).toBe(1)
    expect(bellOf(450)).toBe(0)
    expect(bellOf(3999)).toBe(0)
  })

  const card = (id: string, status: Status, extra: Partial<CardView> = {}): CardView => ({
    id, prefId: id, shelf: 'active', form: 'full', status,
    icon: { kind: 'monogram', letter: 'P', text: 'P ', color: '#88aacc', ink: '#000000' }, // amend 2026-10-18: AC-41
    lines: [[{ kind: 'text', text: 'line' }]], isSelected: false, isDim: false, actions: [],
    labels: { pin: 'Pin', park: 'Park', settle: 'Settle' }, ...extra,
  })
  const spinnerLines: CardView['lines'] = [[{ kind: 'spinner' }, { kind: 'text', text: ' Working' }]]
  const view = (cards: CardView[], extra: Partial<PaneView> = {}): PaneView => ({
    needYou: 0, shelves: [{ id: 'active', header: 'Active', isCollapsed: false, cards, hasSort: false }],
    width: 44, sort: 'recent', settings: { icons: true, theme: 'auto', workingShelf: false }, selectedFill: PALETTES.dark.fill, palette: PALETTES.dark, ...extra, // amend 2026-10-18: AC-08a
  })

  test('nothing animates while the pane is hidden', () => {
    expect(isAnimating(view([card('a', 'working', { lines: spinnerLines })]), false)).toBe(false)
  })
  test('idle and done cards with no scene do not animate (AC-111)', () => {
    expect(isAnimating(view([card('a', 'idle'), card('b', 'done')]), true)).toBe(false)
    expect(isAnimating(view([]), true)).toBe(false)
  })
  test('one working card animates (AC-112)', () => {
    expect(isAnimating(view([card('a', 'idle'), card('b', 'working', { lines: spinnerLines })]), true)).toBe(true)
  })
  test('a needs-you pill and a scene with art each animate', () => { // amend 2026-10-18: AC-41
    expect(isAnimating(view([card('a', 'needs-you')]), true)).toBe(true)
    expect(isAnimating(view([card('a', 'idle')], { scene: { kind: 'hills', caption: 'x', showArt: true, width: 40 } }), true)).toBe(true)
    expect(isAnimating(view([], { scene: { kind: 'hills', caption: 'x', showArt: false, width: 40 } }), true)).toBe(false)
  })
  test('cards on a collapsed shelf do not animate', () => {
    const collapsed = view([card('a', 'working', { lines: spinnerLines })])
    collapsed.shelves[0]!.isCollapsed = true
    expect(isAnimating(collapsed, true)).toBe(false)
  })

  test('framesAt emits at most 10 frames per raster over 10 ticks (AC-113)', () => {
    const busy = view(
      [card('a', 'working', { lines: spinnerLines }), card('b', 'needs-you'), card('c', 'done')],
      { scene: { kind: 'working', caption: 'x', showArt: true, width: 40 } },
    )
    const counts = new Map<string, number>()
    for (let tick = 0; tick < 10; tick += 1) for (const blit of framesAt(busy, tick, 'dark')) counts.set(blit.key, (counts.get(blit.key) ?? 0) + 1)
    expect([...counts.keys()].sort()).toEqual(['scene', 'spin:a']) // amend 2026-10-18: AC-41 -- no creature on cards
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(10)
  })
  test('framesAt skips still rasters and uses each raster size', () => {
    const blits = framesAt(view([card('c', 'done'), card('d', 'idle')]), 3, 'light')
    expect(blits).toEqual([])
    // amend 2026-10-18: AC-41 -- the spinner is the only card Raster
    const [spin, more] = framesAt(view([card('a', 'working', { lines: spinnerLines })]), 3, 'dark')
    expect([spin!.key, spin!.columns, spin!.rows]).toEqual(['spin:a', 1, 1])
    expect(more).toBeUndefined()
  })
  test('frame helpers follow the shared formulas', () => {
    expect([0, 9, 10, 13].map(spinnerFrameAt)).toEqual([0, 9, 0, 3])
    expect([0, 2, 3, 6].map(sceneFrameAt)).toEqual([0, 0, 1, 2]) // amend 2026-10-18: AC-110 -- 200 ms ticks, so the 600 ms scene frame is every 3
  })
})
