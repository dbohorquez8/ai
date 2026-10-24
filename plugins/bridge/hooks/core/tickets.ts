// A ticket id from a title, branch or
// worktree name, or anywhere in a worker's text, for the configured prefixes; unchanged but for style. Pure.
// Portions adapted from MIT-licensed code; Copyright (c) 2026 Michael Yong, Copyright (c) 2026 Yusuf Akbulut; design reference Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.

export type TicketMatch = { id: string; source: 'title' | 'branch'; titleRest: string | null }

const BOUNDARY_CHAR = /[\p{L}\p{N}]/u

/** A prefix entered without its trailing hyphen ("APP") also matches the hyphenated form ("APP-19"). */
const prefixForms = (prefix: string): string[] => (prefix.endsWith('-') ? [prefix] : [`${prefix}-`, prefix])

const idAt = (text: string, start: number, sortedPrefixes: readonly string[]): string | null => {
  for (const prefix of sortedPrefixes.flatMap(prefixForms)) {
    if (!text.startsWith(prefix, start)) continue
    let digitsEnd = start + prefix.length
    while (digitsEnd < text.length && text[digitsEnd]! >= '0' && text[digitsEnd]! <= '9') digitsEnd++
    if (digitsEnd === start + prefix.length) continue
    const next = text.codePointAt(digitsEnd)
    if (next !== undefined && BOUNDARY_CHAR.test(String.fromCodePoint(next))) continue
    return text.slice(start, digitsEnd)
  }
  return null
}

const idAtStartOrAfterSlash = (name: string, sortedPrefixes: readonly string[]): string | null => {
  const atStart = idAt(name, 0, sortedPrefixes)
  if (atStart) return atStart
  for (let index = 0; index < name.length; index++) {
    if (name[index] !== '/') continue
    const id = idAt(name, index + 1, sortedPrefixes)
    if (id) return id
  }
  return null
}

export const stripTicketSeparator = (rest: string): string => rest.replace(/^\s*[:\-–—]?\s*/, '')

/** The ticket id at the start of the title, else in the branch, else in the worktree name; null without prefixes. */
export const parseTicketId = (
  input: { title: string; branchName: string | null; worktreeName: string | null },
  prefixes: readonly string[],
): TicketMatch | null => {
  if (prefixes.length === 0) return null
  const sortedPrefixes = [...prefixes].sort((a, b) => b.length - a.length)

  const trimmedTitle = input.title.trim()
  const titleId = idAt(trimmedTitle, 0, sortedPrefixes)
  if (titleId) return { id: titleId, source: 'title', titleRest: stripTicketSeparator(trimmedTitle.slice(titleId.length)) }

  if (input.branchName !== null) {
    const branchId = idAtStartOrAfterSlash(input.branchName, sortedPrefixes)
    if (branchId) return { id: branchId, source: 'branch', titleRest: null }
  }

  if (input.worktreeName !== null) {
    const worktreeId = idAtStartOrAfterSlash(input.worktreeName, sortedPrefixes)
    if (worktreeId) return { id: worktreeId, source: 'branch', titleRest: null }
  }

  return null
}

/** The first ticket id anywhere in `text` for the prefixes, else null. Case-sensitive; an id needs no letter or digit
 *  (any script) right before it and none right after its digits. Same prefix forms and id shape as `parseTicketId`. */
export const ticketIdIn = (text: string, prefixes: readonly string[]): string | null => {
  if (prefixes.length === 0) return null
  const sortedPrefixes = [...prefixes].sort((a, b) => b.length - a.length)
  let previous: string | null = null
  for (let index = 0; index < text.length; ) {
    const point = text.codePointAt(index)!
    const char = String.fromCodePoint(point)
    if (previous === null || !BOUNDARY_CHAR.test(previous)) {
      const id = idAt(text, index, sortedPrefixes)
      if (id) return id
    }
    previous = char
    index += char.length
  }
  return null
}
