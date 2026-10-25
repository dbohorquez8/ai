// Core types and look tables shared by every layer. Pure: no `$`, no terminal facts.

export type Status = 'working' | 'needs-you' | 'failed' | 'background' | 'check' | 'done' | 'idle'
export type ShelfId = 'pinned' | 'active' | 'working' | 'inactive' | 'snoozed' | 'parked' | 'settled'
export const SHELF_ORDER: readonly ShelfId[] = ['pinned', 'active', 'working', 'inactive', 'snoozed', 'parked', 'settled']
export const SHELF_LABEL: Readonly<Record<ShelfId, string>> = {
  pinned: 'Pinned', active: 'Active', working: 'Working', inactive: 'Inactive', snoozed: 'Snoozed', parked: 'Parked', settled: 'Settled',
}
export const DEFAULT_COLLAPSED: Readonly<Record<ShelfId, boolean>> = {
  pinned: false, active: false, working: false, inactive: true, snoozed: true, parked: true, settled: true,
}
export type SortMode = 'recent' | 'created' | 'project'
export type ThemeMode = 'dark' | 'light'
/** How Bridge draws its decorative pill caps and bell. `auto` follows the terminal host. */
export type GlyphSetting = 'auto' | 'nerd' | 'plain'
export type GlyphMode = Exclude<GlyphSetting, 'auto'>
export type Caps = { trueColor: boolean; pictures: boolean }            // from adapters: 24-bit colour, and whether a picture can be drawn

/** One session after merging every source, before shelving. */
export type Session = {
  id: string                 // card id (phase-1 Row.id)
  prefId: string             // sessionId ?? id
  sessionId?: string
  name: string
  cwd?: string
  pid?: number
  startedAt?: number
  activityAt: number         // max(updatedAt, statusSince, startedAt) known values, else 0
  raw: string                // winning raw status word
  statusSince: number        // when the winning status began
  sharedSince?: number       // the registry's status time (else the listing's start), alike in every pane; claims a chime
  sharedRaw?: string         // the registry's own status word, before the merge; absent with no registry entry
  reason?: string            // waitingFor, else 'question' when the last turn asked the person
  askedAt?: number           // when the last turn ended on a question to the person (askedAtOf)
  title: string              // ai title, else last prompt, else name
  project: string
  branch?: string
  model?: string             // short family: 'opus' | 'sonnet' | 'haiku' | 'fable' | last id segment
  pr?: number
  contextPercent?: number    // own: session usage; others: registry contextPercent only
  contextTokens?: number     // tokens in the context window, when a source gives them; colours the percentage against the soft limit
  contextWindow?: number     // the model's context window: own from session usage, others the window reported for their model; sets the default soft limit
  failedAt?: number          // own only: when its last turn ended on an API error (StopFailure)
  background?: readonly BackgroundTask[]   // own only: background tasks in flight, subagents left out
  isTurnOver?: boolean       // own only: no main-loop turn runs now (turn.start / turn.complete); absent while unknown
  childNeedAt?: number       // own only: newest live child permission/question prompt
  isSelf: boolean
  away?: string              // other terminal app's label; undefined = same app or unknown
}

/** Stored per session at `pref:<prefId>` (L5). Unknown fields are ignored and kept. */
export type Entry = {
  isPinned?: true
  isParked?: true; parkedAt?: number
  isSettled?: true; settledAt?: number
  snoozedUntil?: number; snoozedAt?: number; wokeAt?: number
  ackAt?: number             // last press of the card: clears Done and Woke
  seenAt?: number            // last time the session was seen live
}
export type Layout = { v: 1; active: string[]; pinned: string[] }
/** `softLimit`: absent = the window's default (`defaultSoftLimitOf`), 0 = off (the colour follows the window percentage). */
/** `checkAfter`: absent = 15 minutes; 0 = off. `sound`: absent = on; the needs-you chime. */
export type Settings = { icons: boolean; theme: 'auto' | 'dark' | 'light'; workingShelf: boolean; glyphs?: GlyphSetting; tickets?: readonly string[]; softLimit?: number; checkAfter?: number; sound?: boolean }
export type Stored = { entries: Record<string, Entry>; layout: Layout; sort: SortMode; collapsed: Record<ShelfId, boolean>; settings: Settings; caption?: number }

/** One background task of the own session as its last stop listed it; `firstSeenAt` survives later snapshots of the same id. */
export type BackgroundTask = { id: string; kind: 'Command' | 'Monitoring' | 'Workflow' | 'Agent'; label: string; firstSeenAt: number }

/** A child uses the same status slot as a card; an engine `killed` child becomes `idle` (age only). */
export type ChildStatus = Extract<Status, 'working' | 'needs-you' | 'done' | 'failed' | 'idle'>
export type Child = { id: string; label: string; status: ChildStatus; since: number; startedAt: number; parentId?: string }

/** A styled run of a drawn line; a line's runs sum to its exact cell width. */
export type Seg =
  | { kind: 'text'; text: string; color?: string; bg?: string; dim?: true; bold?: true; role?: 'title' | 'status' | 'project' | 'bar' | 'count' }
  | { kind: 'spinner' }      // one cell, drawn as the `spin:<id>` Raster

export type Hue = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet' | 'gray'
export type Palette = {
  text: Readonly<Record<Hue, string>>                      // '#rrggbb'
  pill: { red: { fg: string; bg: string }; gray: { fg: string; bg: string } }
  waitingRow: string                                        // orange-bg
  fill: string                                              // own-card fill (tint-base)
  ink: string                                               // plain text on the own-card fill, so it reads whatever the terminal's own colours
  bg: string                                                // reference pane background (L7)
}
export type Pose = 'typing' | 'waving' | 'cheering' | 'asleep'
export const STATUS_HUE: Readonly<Record<Status, Hue>> = { working: 'yellow', 'needs-you': 'red', failed: 'red', background: 'green', check: 'orange', done: 'gray', idle: 'gray' }
/** `#rrggbb` as a Raster colour `0x00RRGGBB`; shared by core view (fills) and sprites. */
export const hexToColor = (hex: string): number => Number.parseInt(hex.replace('#', '').slice(0, 6), 16) & 0xffffff

/** Raster cells reach the screen at 4 bits per channel; a fill shared by text boxes and a Raster snaps to that grid so both match. */
export const snapToRasterGrid = (hex: string): string =>
  `#${[1, 3, 5].map(i => Math.round(Number.parseInt(hex.slice(i, i + 2), 16) / 17).toString(16).repeat(2)).join('')}`

/**
 * The project icon at the start of a card's first line: the project's picture (a PNG file, 2 x 1 cells),
 * else its monogram (`text` is exactly 2 cells: the letter on the project colour, `ink` reaching 4.5:1 on it), else none.
 */
export type CardIcon =
  | { kind: 'picture'; file: string; letter: string; color: string; ink: string }
  | { kind: 'monogram'; letter: string; text: string; color: string; ink: string }
  | { kind: 'none' }

// The view model: the single hand-off from core to render (built by group A's view.ts, read by B's animation.ts and D's render)
export type CardView = {
  id: string; prefId: string; shelf: ShelfId; form: 'full' | 'line'; status: Status
  icon: CardIcon
  lines: Seg[][]; isSelected: boolean; isDim: boolean
  actions: ReadonlyArray<'pin' | 'snooze' | 'park' | 'settle' | 'move-up' | 'move-down'>
  labels: { pin: 'Pin' | 'Unpin'; park: 'Park' | 'Unpark'; settle: 'Settle' | 'Unsettle' }
  snoozeMenu?: Array<{ label: string; wake: number }>
  children?: { rows: Array<{ id: string; text: Seg[]; bg?: string }>; more?: string }
  background?: { rows: Array<{ id: string; text: Seg[] }>; more?: string }
}
export type ShelfView = { id: ShelfId; header: string; hasHeader: boolean; isCollapsed: boolean; cards: CardView[]; hasSort: boolean; sortMenu?: true }
export type PaneView = {
  needYou: number; shelves: ShelfView[]
  scene?: { kind: 'hills' | 'working'; caption: string; showArt: boolean; width: number }
  /** Full pane width. Rendered selected-card fill reaches both edges. */
  width: number
  /** Width inside the one-cell inset applied to non-fill rows and card text. */
  contentWidth: number
  sort: SortMode; settings: Settings; selectedFill: string; palette: Palette
}
