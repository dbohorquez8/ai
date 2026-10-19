// The own session's background work, as the engine lists it at each stop (`background_tasks`).
// There is no live list: a finished task wakes the session with a notification turn, whose stop
// brings a fresh snapshot. Pure: no `$`.

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
