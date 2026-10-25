export type Row = {
  id: string
  name: string
  kind: string
  type: string
  status: string
  sessionId?: string
  cwd?: string
  pid?: number
  startedAt?: number
  /** Registry: the last time the session wrote its entry. */
  updatedAt?: number
  /** Registry: the last time the session wrote its status. */
  statusUpdatedAt?: number
  /** Registry: what a `waiting` session waits for ("input needed", "dialog open"). */
  waitingFor?: string
}
export type ChildRow = { id: string; name: string; type: string; status: string; depth: number }
export type Pref = { isPinned?: true; isParked?: true }
/** A transcript title read at a registry `updatedAt`; `isAi` when it came from an `ai-title` record. */
export type Title = { at: number; title?: string; isAi?: boolean }
/** A directory's git branch, project name and project folder, read at the newest `updatedAt` of its sessions. */
export type Place = { at: number; branch?: string; project: string; root?: string }
/** A project folder's icon lookup: when it ran and the cached PNG it found, if any. */
export type IconLookup = { at: number; file?: string }
/** Since when a session has shown its current status. */
export type Since = { status: string; at: number }

/** Mirrors of the core shapes kept in plugin state (this contract is self-contained; core/types.ts is the source). */
export type ChildStatus = 'working' | 'needs-you' | 'done' | 'failed' | 'idle'
export type StateReport = { v: 1; at: number; tickets: Array<{ id: string; state: 'planned' | 'in_progress' | 'done'; worker?: string }>; epic?: string }
export type StateChild = { id: string; label: string; status: ChildStatus; since: number; startedAt: number }
export type StateEntry = {
  isPinned?: true; isParked?: true; parkedAt?: number; isSettled?: true; settledAt?: number
  snoozedUntil?: number; snoozedAt?: number; wokeAt?: number; ackAt?: number; seenAt?: number
}
export type StateShelf = 'pinned' | 'active' | 'working' | 'inactive' | 'snoozed' | 'parked' | 'settled'
export type StateStored = {
  entries: Record<string, StateEntry>
  layout: { v: 1; active: string[]; pinned: string[] }
  sort: 'recent' | 'created' | 'project'
  collapsed: Record<StateShelf, boolean>
  settings: { icons: boolean; theme: 'auto' | 'dark' | 'light'; workingShelf: boolean; tickets?: readonly string[]; softLimit?: number; sound?: boolean }
  caption?: number
}
export type StateRegistryEntry = {
  sessionId: string; name: string; cwd: string; status: string; kind: string; pid: number; startedAt: number
  updatedAt?: number; statusUpdatedAt?: number; waitingFor?: string; contextPercent?: number
}
export type StateListed = { sessionId: string; pid?: number; cwd: string; name: string; raw: string; reason?: string; kind: string; startedAt: number }
export type StateBackgroundTask = { id: string; kind: 'Command' | 'Monitoring' | 'Workflow' | 'Agent'; label: string; firstSeenAt: number }
export type StateTermPlace = { host: 'cmux' | 'tmux' | 'Ghostty' | 'Terminal' | 'iTerm2'; instance?: string }

declare module 'claude-code' {
  interface PluginState {
    'bridge': {
      /** ListAgents rows joined to the registry, this session's own first. */
      rows: Row[]
      /** The session registry as last read. */
      registry: StateRegistryEntry[]
      /** The `claude agents --json` cross-check, as last read (every 30 s). */
      listed: StateListed[]
      /** Session id to the cross-check's status word and when this pane first saw it. */
      listedSeen: Record<string, { raw: string; observedAt: number }>
      /** This session's subagents as child rows. */
      children: StateChild[]
      /** Agent id to the card status it shows, since when, and when it was first seen. */
      childSince: Record<string, { status: string; since: number; startedAt: number }>
      /** Engine tool-use id to a child interaction still waiting for the person. */
      childInteractions: Record<string, { agentId: string; at: number }>
      /** Everything kept in `$.store`, read back each refresh. */
      stored: StateStored
      /** PrefId to when the session last finished. */
      finished: Record<string, number>
      selfId: string
      /** The own session's live ticket report, a copy of its `tickets:` record. */
      report: StateReport | null
      /** Source problems, above the shelves. */
      notice: string
      /** The note under the list after a press. */
      shown: string
      /** The note left when a stored key failed its schema. */
      layoutNote: string
      /** Row id (or session id) to the app its session runs in, for sessions this pane cannot switch to. */
      away: Record<string, string>
      /** Session id to its transcript title. */
      titles: Record<string, Title>
      /** Session id to its short model name. */
      models: Record<string, string>
      /** Session id to when its last turn ended on a question to the person. */
      asks: Record<string, number>
      /** Session id to its last-response context tokens and full model id. */
      contexts: Record<string, { tokens: number; model: string }>
      /** Full model id to the context window Claude Code reported for it. */
      windows: Record<string, number>
      /** Directory to its branch and project. */
      places: Record<string, Place>
      /** `${cwd}\u0000${branch}` to its pull request number. */
      prs: Record<string, number>
      /** PrefId to the status word it shows and since when. */
      since: Record<string, Since>
      /** The bell wobble step. */
      bell: 0 | 1 | 2
      /** The prefId whose snooze menu is open, else ''. */
      snoozeOpen: string
      /** The Active header's sort menu is open. */
      sortOpen: boolean
      /** What the pane's own terminal draws. */
      caps: { trueColor: boolean; pictures: boolean }
      /** Project folder to its icon lookup (at most one per folder each 10 minutes). */
      icons: Record<string, IconLookup>
      /** Light or dark. */
      mode: 'dark' | 'light'
      /** This pane's own terminal place, null while unknown. */
      own: StateTermPlace | null
      /** This session's background tasks in flight (subagents left out), each with when it was first seen; null while no source said. */
      selfBackground: StateBackgroundTask[] | null
      /** When this session's last turn ended on an API error (StopFailure); null after a turn that stopped well. */
      selfFailedAt: number | null
      /** This session's context window from session usage, null while unknown. */
      selfWindow: number | null
      /** Whether this session's main loop has no turn running (turn.start / turn.complete); null while unknown. */
      selfTurnOver: boolean | null
      /** When this session's main loop last started or ended a turn; null while unknown. */
      selfTurnAt: number | null
      /** This session's context use in percent, null while unknown. */
      selfContext: number | null
      /** The time of the last refresh, so ages redraw with it. */
      now: number
    }
  }
}
