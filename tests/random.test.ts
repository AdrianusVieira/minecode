import assert from 'node:assert/strict'
import test from 'node:test'
import { between, createRandom, deriveSeed, parseSeed, resolveRunSeed, weightedChoice } from '../src/random'

test('the same seed and stream label replay the same draws', () => {
  const seed = deriveSeed(123456789, 'movement:session-a')
  const first = createRandom(seed), replay = createRandom(seed)
  assert.deepEqual(Array.from({ length: 100 }, () => first()), Array.from({ length: 100 }, () => replay()))
  assert.notEqual(createRandom(deriveSeed(123456789, 'movement:session-b'))(), replay())
})

test('weighted choices respect weights and remove zero-weight outcomes', () => {
  const options = [{ value: 'farm', weight: 6 }, { value: 'coffee', weight: 2 }, { value: 'roam', weight: 2 }]
  assert.equal(weightedChoice(options, () => 0.59), 'farm')
  assert.equal(weightedChoice(options, () => 0.62), 'coffee')
  assert.equal(weightedChoice(options, () => 0.95), 'roam')
  assert.equal(weightedChoice(options.map((option) => ({ ...option, weight: option.value === 'farm' ? 0 : option.weight })), () => 0), 'coffee')
  assert.throws(() => weightedChoice([{ value: 'farm', weight: 0 }], () => 0))
})

test('continuous samples stay within their interval and spread across it', () => {
  const random = createRandom(42)
  const samples = Array.from({ length: 10_000 }, () => between(random, -2, 6))
  assert.ok(samples.every((value) => value >= -2 && value < 6))
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
  assert.ok(Math.abs(mean - 2) < 0.15)
})

test('a replay seed takes priority, and a fresh run can replace stored seed', () => {
  assert.equal(parseSeed('4294967295'), 4294967295)
  assert.equal(parseSeed('4294967296'), null)
  assert.equal(parseSeed('-1'), null)
  assert.equal(resolveRunSeed('7', '9', () => 11), 7)
  assert.equal(resolveRunSeed(null, '9', () => 11), 9)
  assert.equal(resolveRunSeed(null, null, () => 11), 11)
})
