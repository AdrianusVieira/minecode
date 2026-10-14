import assert from 'node:assert/strict'
import test from 'node:test'
import { activityIsCurrent } from '../src/worldData.js'

test('a character leaves after three minutes without a new activity event', () => {
  const observed = Date.parse('2026-10-13T12:00:00Z')
  const timestamp = new Date(observed).toISOString()
  assert.equal(activityIsCurrent(timestamp, false, observed + 179_999), true)
  assert.equal(activityIsCurrent(timestamp, false, observed + 180_000), false)
  assert.equal(activityIsCurrent(new Date(observed + 60_000).toISOString(), false, observed + 180_000), true)
  assert.equal(activityIsCurrent(null, true, observed + 180_000), true)
  assert.equal(activityIsCurrent(null, false, observed + 180_000), false)
})
