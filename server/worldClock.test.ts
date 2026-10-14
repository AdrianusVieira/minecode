import assert from 'node:assert/strict'
import test from 'node:test'
import { DAY_LENGTH_MS, SEASON_LENGTH_MS, worldClock } from '../src/worldClock.js'

test('all four seasons and both light states recur and shift against a real day', () => {
  const start = Date.parse('2026-10-13T06:00:00Z')
  const seasons = new Set<string>()
  let sawDay = false
  let sawNight = false
  for (let offset = 0; offset < 24 * 60; offset += 5) {
    const state = worldClock(start + offset * 60_000)
    seasons.add(state.season)
    sawDay ||= state.daylight > 0.9
    sawNight ||= state.daylight < 0.1
  }
  assert.equal(seasons.size, 4)
  assert.equal(sawDay && sawNight, true)
  assert.notEqual(worldClock(start).dayProgress, worldClock(start + 86_400_000).dayProgress)
  assert.notEqual(worldClock(start).seasonProgress, worldClock(start + 86_400_000).seasonProgress)
  assert.equal(worldClock(start + DAY_LENGTH_MS).dayProgress, worldClock(start).dayProgress)
  assert.equal(worldClock(start + SEASON_LENGTH_MS * 4).season, worldClock(start).season)
})
