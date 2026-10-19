// The color hash and the distinct-color assignment. Dropped: projectColorStyle and the text-contrast
// helpers, which build React CSS properties.
// Portions adapted from MIT-licensed code; Copyright (c) 2026 Michael Yong, Copyright (c) 2026 Yusuf Akbulut; design reference Copyright (c) 2026 T3 Tools Inc. See THIRD_PARTY_NOTICES.md.

function hashId(id: string): number {
  let hash = 2166136261
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const a = saturation * Math.min(lightness, 1 - lightness)
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * value).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** A stable muted color from the project's identity, without a fixed palette. */
export function automaticProjectColor(projectId: string, attempt = 0): string {
  const hash = hashId(projectId)
  return hslToHex(
    ((hash / 2 ** 32) * 360 + attempt * 137.507764) % 360,
    0.26 + ((hash >>> 8) % 12) / 100,
    0.62 + (hash % 8) / 100,
  )
}

export function projectColorsById(
  projectIds: readonly string[],
  overrides: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  const used = new Set(projectIds.flatMap(id => (overrides[id] ? [overrides[id]!.toLowerCase()] : [])))
  const colors = new Map<string, string>()
  for (const id of [...new Set(projectIds)].sort()) {
    if (overrides[id]) {
      colors.set(id, overrides[id]!)
      continue
    }
    let attempt = 0
    let color = automaticProjectColor(id)
    while (used.has(color)) color = automaticProjectColor(id, ++attempt)
    used.add(color)
    colors.set(id, color)
  }
  return colors
}
