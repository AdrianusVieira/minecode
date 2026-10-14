// Coprime minute lengths keep the village from repeating its appearance at the
// same wall-clock time on consecutive days. Both clocks use real elapsed time.
export const DAY_LENGTH_MS = 29 * 60_000
export const SEASON_LENGTH_MS = 43 * 60_000
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const
export type Season = typeof SEASONS[number]

export function worldClock(now: number): { daylight: number; season: Season; seasonProgress: number; dayProgress: number } {
  const dayProgress = ((now % DAY_LENGTH_MS) + DAY_LENGTH_MS) % DAY_LENGTH_MS / DAY_LENGTH_MS
  const seasonPosition = ((now % (SEASON_LENGTH_MS * 4)) + SEASON_LENGTH_MS * 4) % (SEASON_LENGTH_MS * 4) / SEASON_LENGTH_MS
  // Sunrise and sunset are gradual. Night still has enough moonlight to explore.
  const sunHeight = Math.sin(dayProgress * Math.PI * 2)
  const daylight = Math.min(1, Math.max(0, (sunHeight + 0.18) / 0.5))
  return { daylight, season: SEASONS[Math.floor(seasonPosition)], seasonProgress: seasonPosition % 1, dayProgress }
}
