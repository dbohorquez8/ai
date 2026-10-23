// The needs-you chime: one short sound rendered here as a WAV (no binary asset), and the rule for when a
// card change plays it. The tone math is adapted from Chime 0.1.0 (MIT License,
// Copyright (c) 2026 Chime contributors; see THIRD_PARTY_NOTICES.md), its "minimal-question" sound (the glass one was too much). Pure: no `$`.

import type { Entry, Settings, Status } from './types'

export const CHIME_PREFIX = 'chime:'
export const CHIME_RATE = 22_050

/** Chime's "minimal-question": two short plain notes, a rising fourth. */
const CHIME = { duration: 0.32, notes: [[659.25, 0, 0.1], [880, 0.19, 0.1]] as const, gain: 0.26 }

const envelope = (time: number, start: number, duration: number) => {
  const local = time - start
  if (local < 0 || local >= duration) return 0
  return Math.min(1, local / 0.025, (duration - local) / 0.08) * Math.exp(-local * 2.5)
}

/** The minimal timbre: a plain sine. */
const tone = (frequency: number, time: number) => Math.sin(2 * Math.PI * frequency * time)

/** The chime's samples in [-1, 1], with Chime's 25 ms tail fade. */
export const chimeSamples = (rate = CHIME_RATE): number[] => {
  const count = Math.ceil(CHIME.duration * rate)
  const out: number[] = []
  for (let index = 0; index < count; index += 1) {
    const time = index / rate
    let sample = 0
    for (const [frequency, start, duration] of CHIME.notes) sample += tone(frequency, time) * envelope(time, start, duration)
    const fade = Math.min(1, (CHIME.duration - time) / 0.025)
    out.push(Math.max(-1, Math.min(1, sample * CHIME.gain * fade)))
  }
  return out
}

/** Samples as a 16-bit mono PCM WAV file. */
export const wavOf = (samples: readonly number[], rate: number): Uint8Array => {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, word: string) => [...word].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)                // PCM
  view.setUint16(22, 1, true)                // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)         // bytes per second
  view.setUint16(32, 2, true)                // block align
  view.setUint16(34, 16, true)               // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(sample * 32767), true))
  return bytes
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Bytes as base64, padded (the module has no `btoa` or Buffer to lean on). */
export const base64Of = (bytes: Uint8Array): string => {
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[at], bytes[at + 1], bytes[at + 2]]
    const word = (a << 16) | (b << 8) | c
    out += ALPHABET[(word >> 18) & 63]! + ALPHABET[(word >> 12) & 63]!
    out += at + 1 < bytes.length ? ALPHABET[(word >> 6) & 63]! : '='
    out += at + 2 < bytes.length ? ALPHABET[word & 63]! : '='
  }
  return out
}

let rendered: string | undefined
/** The chime as base64 WAV, rendered once. */
export const chimeWav = (): string => (rendered ??= base64Of(wavOf(chimeSamples(), CHIME_RATE)))

/** Put away: parked, settled, or snoozed with the wake time still ahead. */
export const isPutAway = (entry: Entry | undefined, now: number): boolean =>
  Boolean(entry?.isParked || entry?.isSettled || (entry?.snoozedUntil !== undefined && entry.snoozedUntil > now))

/**
 * The value a chime claim stores for a change: the status and the newest status fact's time, from data
 * every session reads alike (the registry's status time, the transcript's question time, the own failure
 * time), never a time one pane observed, so all sessions name the same change the same way.
 */
export const chimeClaimOf = (status: Status, s: { sharedSince?: number; askedAt?: number; failedAt?: number; childNeedAt?: number }): string =>
  `${status}@${Math.max(s.sharedSince ?? 0, s.askedAt ?? 0, s.failedAt ?? 0, s.childNeedAt ?? 0)}`

/** The `chime:` keys whose session is no longer live. */
export const prunedChimeKeys = (keys: readonly string[], liveIds: ReadonlySet<string>): string[] =>
  keys.filter(key => key.startsWith(CHIME_PREFIX) && !liveIds.has(key.slice(CHIME_PREFIX.length)))

/**
 * Whether a card's change plays the chime: it changed into Needs you or Failed from another status this
 * pane saw, sound is on, the card is not put away, it is not the first refresh after session start, and
 * no session has claimed this change yet (`claim.stored`, the `chime:<prefId>` value, differs from
 * `claim.value`). A race between two sessions may chime twice; that is accepted.
 */
export const shouldChimeOf = (
  prev: Status | undefined,
  next: Status,
  entry: Entry | undefined,
  claim: { stored: unknown; value: string },
  settings: Pick<Settings, 'sound'>,
  isFirst: boolean,
  now: number,
): boolean => {
  if (isFirst || settings.sound === false) return false
  if (next !== 'needs-you' && next !== 'failed') return false
  if (prev === undefined || prev === next) return false
  if (isPutAway(entry, now)) return false
  return claim.stored !== claim.value
}
