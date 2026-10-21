// The session sources merged into one Session list: the registry (primary), ListAgents rows,
// the `claude agents --json` cross-check, transcript titles and models, git places and pull requests.
// Pure: no `$`, no terminal facts. A value no source reports is left out, never estimated.

import type { Place, Row, Title } from '../../types'
import type { RegistryEntry } from '../sidebar-policy'
import { prefIdOf } from '../sidebar-policy'
import { cardTextOf } from '../card-policy'
import { mergedStatusOf, steadySinceOf } from './status'
import type { BackgroundTask, Session } from './types'

export const AGENTS_ARGV: readonly string[] = ['claude', 'agents', '--json']
export const AGENTS_MS = 30_000
export const PR_FIRST_MS = 60_000
export const PR_MS = 300_000
export const TRANSCRIPT_TAIL_BYTES = 262_144

/** One entry of `claude agents --json`. */
export type Listed = { sessionId: string; pid?: number; cwd: string; name: string; raw: string; reason?: string; kind: string; startedAt: number }

const textOf = (value: unknown) => (typeof value === 'string' ? value : '')

/** The sessions in the cross-check's output; background sessions and junk are dropped. */
export const agentsJsonOf = (stdout: string): Listed[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: Listed[] = []
  for (const one of parsed as unknown[]) {
    if (!one || typeof one !== 'object') continue
    const entry = one as Record<string, unknown>
    const sessionId = textOf(entry.sessionId)
    const name = textOf(entry.name)
    const kind = textOf(entry.kind)
    if (!sessionId || !name || kind === 'background') continue
    const listed: Listed = { sessionId, cwd: textOf(entry.cwd), name, raw: textOf(entry.status) || textOf(entry.state), kind, startedAt: typeof entry.startedAt === 'number' ? entry.startedAt : 0 }
    if (typeof entry.pid === 'number') listed.pid = entry.pid
    if (textOf(entry.waitingFor)) listed.reason = textOf(entry.waitingFor)
    out.push(listed)
  }
  return out
}

const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'] as const

/** The short model name in a transcript line: `"model":"claude-opus-5-5"` reads `opus`. */
/** The full model id in a `"model":"…"` match, lower case; undefined when it is not a plain id. */
export const modelIdOf = (line: string): string | undefined => {
  const id = /"model"\s*:\s*"([^"]*)"/.exec(line)?.[1]?.trim().toLowerCase()
  return id && /^[a-z0-9][a-z0-9._:/-]*(\[1m\])?$/.test(id) ? id : undefined
}

export const modelOf = (line: string): string | undefined => {
  const id = modelIdOf(line)
  if (!id) return undefined
  const family = FAMILIES.find(name => id.includes(name))
  if (family) return family
  return id.split(/[-/:]/).filter(Boolean).at(-1)
}

/**
 * Another session's context percentage: its last-response tokens over the window Claude Code reported
 * for the same model (AC-94); undefined when no window is known for that model, never a guess.
 */
export const percentOf = (context: { tokens: number; model: string } | undefined, windows: Readonly<Record<string, number>> | undefined): number | undefined => {
  const window = context ? windows?.[context.model] : undefined
  return context && window && window > 0 ? Math.round((context.tokens / window) * 100) : undefined
}

const positive = (value: number | undefined) => (value !== undefined && value > 0 ? value : undefined)

type Source = {
  id: string
  name: string
  kind: string
  entry?: RegistryEntry
  listed?: Listed
  row?: Row
}

/** Every session the sources name, one per card, with the values each source reports. */
export const sessionsOf = (input: {
  rows: readonly Row[]
  registry: readonly RegistryEntry[]
  listed: readonly Listed[]
  listedSeen: Readonly<Record<string, { raw: string; observedAt: number }>>
  titles: Readonly<Record<string, Title>>
  models: Readonly<Record<string, string>>
  /** When each session's last turn ended on a question to the Owner (`askedAtOf`). */
  asks?: Readonly<Record<string, number>>
  /** Each session's last-response context tokens and full model id, from its transcript. */
  contexts?: Readonly<Record<string, { tokens: number; model: string }>>
  /** Context windows Claude Code reported, by full model id (the own session's model). */
  windows?: Readonly<Record<string, number>>
  places: Readonly<Record<string, Place>>
  prs: Readonly<Record<string, number>>
  selfId: string
  selfContext?: number
  /** The own session's background tasks in flight, subagents left out; absent when no source said. */
  selfBackground?: readonly BackgroundTask[]
  /** When the own session's last turn ended on an API error; absent when it did not. */
  selfFailedAt?: number
  /** The own session's context window from session usage; absent while unknown. */
  selfWindow?: number
  /** Whether the own session's main loop has no turn running; absent while unknown. */
  selfTurnOver?: boolean
  /** When the own session's main loop last started or ended a turn; absent while unknown. */
  selfTurnAt?: number
  /** Newest active subagent permission/question prompt, from engine interaction events. */
  selfChildNeedAt?: number
  away: Readonly<Record<string, string>>
  /** The status and its start each card showed at the last refresh, by prefId: the age stays steady while the word does. */
  since?: Readonly<Record<string, { status: string; at: number }>>
}): Session[] => {
  const byId = new Map<string, RegistryEntry>()
  for (const entry of input.registry) byId.set(entry.sessionId, entry)
  const listedById = new Map<string, Listed>()
  for (const one of input.listed) listedById.set(one.sessionId, one)

  const sources: Source[] = []
  const covered = new Set<string>()
  for (const row of input.rows) {
    const sessionId = row.sessionId
    if (sessionId) covered.add(sessionId)
    const source: Source = { id: row.id, name: row.name, kind: row.kind, row }
    const entry = sessionId ? byId.get(sessionId) : undefined
    const listed = sessionId ? listedById.get(sessionId) : undefined
    if (entry) source.entry = entry
    if (listed) source.listed = listed
    sources.push(source)
  }
  for (const entry of input.registry) {
    if (covered.has(entry.sessionId)) continue
    covered.add(entry.sessionId)
    const source: Source = { id: entry.sessionId, name: entry.name, kind: 'sessions', entry }
    const listed = listedById.get(entry.sessionId)
    if (listed) source.listed = listed
    sources.push(source)
  }
  for (const one of input.listed) {
    if (covered.has(one.sessionId)) continue
    covered.add(one.sessionId)
    sources.push({ id: one.sessionId, name: one.name, kind: 'sessions', listed: one })
  }

  return sources.map(source => {
    const { entry, listed, row } = source
    const sessionId = entry?.sessionId ?? row?.sessionId ?? listed?.sessionId
    const prefId = row ? prefIdOf(row) : (sessionId ?? source.id)
    const cwd = (entry?.cwd || row?.cwd || listed?.cwd) || undefined
    const startedAt = positive(entry?.startedAt) ?? positive(row?.startedAt) ?? positive(listed?.startedAt)
    const updatedAt = entry?.updatedAt ?? row?.updatedAt
    const registryRaw = entry?.status || row?.status || ''
    const registrySince = entry?.statusUpdatedAt ?? row?.statusUpdatedAt ?? updatedAt ?? startedAt ?? 0
    const seen = sessionId ? input.listedSeen[sessionId] : undefined
    const merged = entry || row ? mergedStatusOf({ raw: registryRaw, since: registrySince }, seen) : listed ? { raw: seen?.raw ?? listed.raw, since: seen?.observedAt ?? 0 } : { raw: '', since: 0 }
    const askedAt = sessionId ? input.asks?.[sessionId] : undefined
    const reason = entry?.waitingFor ?? row?.waitingFor ?? listed?.reason ?? (askedAt !== undefined ? 'question' : undefined)
    const place = cwd ? input.places[cwd] : undefined
    const text = cardTextOf({ id: source.id, name: source.name, kind: source.kind, type: '', status: '', ...(cwd ? { cwd } : {}) }, input.titles[sessionId ?? source.id], place)
    const isSelf = Boolean(input.selfId) && (sessionId === input.selfId || source.id === input.selfId)
    const known = [positive(updatedAt), positive(merged.since), startedAt].filter((one): one is number => one !== undefined)
    const model = input.models[sessionId ?? source.id]
    const pr = cwd && text.branch ? input.prs[`${cwd}\u0000${text.branch}`] : undefined
    const contextPercent = isSelf ? input.selfContext : (entry?.contextPercent ?? percentOf(sessionId ? input.contexts?.[sessionId] : undefined, input.windows))
    const transcript = sessionId ? input.contexts?.[sessionId] : undefined
    const modelWindow = transcript ? input.windows?.[transcript.model] : undefined
    const selfWindow = isSelf && transcript ? modelWindow : undefined
    // A plain model id names a 200k and a 1M window alike (only some transcripts add `[1m]`), so another
    // session's window above 200k counts only under an id that carries the marker; otherwise the smaller default.
    const contextWindow = isSelf ? (input.selfWindow ?? modelWindow) : (modelWindow !== undefined && (modelWindow <= 200_000 || transcript?.model.endsWith('[1m]') === true) ? modelWindow : undefined)
    // The own count follows the live percentage when its window is known, so number and colour agree.
    const contextTokens = isSelf && input.selfContext !== undefined && selfWindow ? Math.round((input.selfContext / 100) * selfWindow) : transcript?.tokens
    const away = input.away[source.id] ?? (sessionId ? input.away[sessionId] : undefined)
    const pid = positive(entry?.pid) ?? positive(row?.pid) ?? positive(listed?.pid)

    const session: Session = {
      id: source.id,
      prefId,
      name: source.name,
      activityAt: known.length ? Math.max(...known) : 0,
      raw: merged.raw,
      statusSince: steadySinceOf(input.since?.[prefId], merged.raw, merged.since, isSelf ? input.selfTurnAt : undefined),
      title: text.title,
      project: text.project,
      isSelf,
    }
    const sharedSince = positive(entry || row ? registrySince : listed?.startedAt)
    if (sharedSince !== undefined) session.sharedSince = sharedSince
    if (entry || row) session.sharedRaw = registryRaw
    if (sessionId) session.sessionId = sessionId
    if (cwd) session.cwd = cwd
    if (pid !== undefined) session.pid = pid
    if (startedAt !== undefined) session.startedAt = startedAt
    if (reason) session.reason = reason
    if (askedAt !== undefined) session.askedAt = askedAt
    if (text.branch) session.branch = text.branch
    if (model) session.model = model
    if (pr !== undefined) session.pr = pr
    if (contextPercent !== undefined) session.contextPercent = contextPercent
    if (contextPercent !== undefined && contextTokens !== undefined) session.contextTokens = contextTokens
    if (contextWindow !== undefined && contextWindow > 0) session.contextWindow = contextWindow
    if (away) session.away = away
    if (isSelf && input.selfBackground !== undefined) session.background = input.selfBackground
    if (isSelf && input.selfFailedAt !== undefined) session.failedAt = input.selfFailedAt
    if (isSelf && input.selfTurnOver !== undefined) session.isTurnOver = input.selfTurnOver
    if (isSelf && input.selfChildNeedAt !== undefined) session.childNeedAt = input.selfChildNeedAt
    return session
  })
}
