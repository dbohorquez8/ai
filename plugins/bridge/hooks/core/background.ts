// The own session's background work. Two sources, merged: the snapshot a stop hook gets
// (`background_tasks`), and the tool calls that start a task (a background Bash command, a Monitor,
// a Workflow) with the task notification that ends it. A managed plugin earlier in the chain can send
// the stop event past every installed plugin, so the tool calls and notifications alone must suffice.
// Pure: no `$`.

import type { BackgroundTask } from './types'

/** One entry of a stop's `background_tasks`, the fields read here. */
export type TaskSummary = { id: string; type: string; description?: string; command?: string; name?: string }

export const MAX_BACKGROUND_ROWS = 3

const KIND_OF: Readonly<Record<string, BackgroundTask['kind']>> = { shell: 'Command', monitor: 'Monitoring', workflow: 'Workflow' }

const filled = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

/** A task's row label: the workflow's name, the shell's command, else its description, else its type. */
export const taskLabelOf = (task: TaskSummary): string =>
  (task.type === 'workflow' ? filled(task.name) : task.type === 'shell' ? filled(task.command) : undefined) ?? filled(task.description) ?? task.type

/**
 * The snapshot a stop hands over, subagents left out (they are the child rows), each task keeping
 * the time it was first seen in an earlier snapshot; undefined when the stop carried no list.
 */
export const backgroundOf = (tasks: readonly TaskSummary[] | undefined, old: readonly BackgroundTask[] | null | undefined, now: number): BackgroundTask[] | undefined => {
  if (!Array.isArray(tasks)) return undefined
  const seen = new Map((old ?? []).map(task => [task.id, task.firstSeenAt]))
  return tasks
    .filter(task => task && typeof task.id === 'string' && task.type !== 'subagent')
    .map(task => ({ id: task.id, kind: KIND_OF[task.type] ?? 'Agent', label: taskLabelOf(task), firstSeenAt: seen.get(task.id) ?? now }))
}

const recordOf = (value: unknown): Readonly<Record<string, unknown>> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})

/**
 * The task a main-loop tool call put in the background, from the call's input and its result; undefined
 * for any other call. A Bash command that ends with its caller's final response is no task to wait on.
 */
export const launchedTaskOf = (tool: string, input: unknown, result: unknown): TaskSummary | undefined => {
  const args = recordOf(input)
  const out = recordOf(result)
  const text = (value: unknown) => filled(value)
  if (tool === 'Bash') {
    const id = text(out.backgroundTaskId)
    if (!id || out.backgroundEndsWithFinalResponse === true) return undefined
    return { id, type: 'shell', ...(text(args.command) ? { command: text(args.command) } : {}), ...(text(args.description) ? { description: text(args.description) } : {}) }
  }
  if (tool === 'Monitor') {
    const id = text(out.taskId)
    return id ? { id, type: 'monitor', ...(text(args.description) ? { description: text(args.description) } : {}) } : undefined
  }
  if (tool === 'Workflow') {
    const id = text(out.taskId)
    if (!id || out.error !== undefined) return undefined
    const name = text(out.workflowName) ?? text(args.name)
    return { id, type: out.status === 'remote_launched' ? 'remote_agent' : 'workflow', ...(name ? { name } : {}) }
  }
  return undefined
}

/** The status words a task notification ends a task with. */
const ENDED = new Set(['completed', 'failed', 'killed', 'stopped', 'error', 'timeout', 'cancelled', 'canceled'])

/** The id of the task a `<task-notification>` says has ended; undefined for any other text or a status that is not an end. */
export const endedTaskIdOf = (text: string): string | undefined => {
  if (!text.includes('<task-notification>')) return undefined
  const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(text)?.[1]
  const status = /<status>\s*([^<]*?)\s*<\/status>/.exec(text)?.[1]?.toLowerCase()
  return id && status && ENDED.has(status) ? id : undefined
}

/** The list with one more task, first seen now; unchanged when the id is listed already. */
export const withTask = (list: readonly BackgroundTask[] | null | undefined, task: TaskSummary, now: number): BackgroundTask[] => {
  const old = list ?? []
  if (old.some(one => one.id === task.id)) return [...old]
  return [...old, { id: task.id, kind: KIND_OF[task.type] ?? 'Agent', label: taskLabelOf(task), firstSeenAt: now }]
}

/** The list without the task of that id; null stays null (no source said yet). */
export const withoutTask = (list: readonly BackgroundTask[] | null, id: string): BackgroundTask[] | null =>
  list === null ? null : list.filter(one => one.id !== id)

/**
 * The list once the session is idle: with no turn running and the status word `idle` (not busy, waiting or
 * `shell`, which Claude Code writes while background shells run), a task first seen before that idle began
 * has ended unseen (a notification missed or not recognized), so it goes. Anything else keeps the list.
 */
export const reconciledBackgroundOf = (list: readonly BackgroundTask[] | null, own: { raw: string; isTurnOver?: boolean; idleSince?: number }): BackgroundTask[] | null => {
  if (list === null || list.length === 0 || own.isTurnOver !== true || own.raw.trim().toLowerCase() !== 'idle' || own.idleSince === undefined) return list === null ? null : [...list]
  const since = own.idleSince
  return list.filter(task => task.firstSeenAt >= since)
}
