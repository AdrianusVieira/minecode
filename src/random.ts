// mulberry32-v1 is for repeatable village simulation, not secrets or tokens.
export type RandomSource = () => number
export type WeightedOption<T> = { value: T; weight: number }

export function createRandom(seed: number): RandomSource {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000
  }
}

export function deriveSeed(seed: number, label: string): number {
  let result = (2166136261 ^ seed) >>> 0
  for (let index = 0; index < label.length; index++) result = Math.imul(result ^ label.charCodeAt(index), 16777619)
  return result >>> 0
}

export function weightedChoice<T>(options: readonly WeightedOption<T>[], random: RandomSource): T {
  const total = options.reduce((sum, option) => sum + Math.max(0, option.weight), 0)
  if (!Number.isFinite(total) || total <= 0) throw new Error('At least one finite positive weight is required')
  let ticket = random() * total
  for (const option of options) {
    const weight = Math.max(0, option.weight)
    if (weight === 0) continue
    ticket -= weight
    if (ticket < 0) return option.value
  }
  for (let index = options.length - 1; index >= 0; index--) if (options[index].weight > 0) return options[index].value
  throw new Error('At least one finite positive weight is required')
}

export function between(random: RandomSource, min: number, max: number): number {
  return min + random() * (max - min)
}

export function parseSeed(value: string | null): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 && number <= 0xffff_ffff ? number : null
}

export function resolveRunSeed(requested: string | null, saved: string | null, freshSeed: () => number): number {
  return parseSeed(requested) ?? parseSeed(saved) ?? freshSeed()
}

const storageKey = 'minecode.world.seed.mulberry32-v1'

export function getRunSeed(): number {
  const params = new URLSearchParams(window.location.search)
  let saved: string | null = null
  try { saved = window.sessionStorage.getItem(storageKey) } catch { /* Storage can be unavailable. */ }
  const freshRun = params.has('newRun')
  const seed = resolveRunSeed(freshRun ? null : params.get('seed'), freshRun ? null : saved,
    () => window.crypto.getRandomValues(new Uint32Array(1))[0])
  try { window.sessionStorage.setItem(storageKey, String(seed)) } catch { /* Storage can be unavailable. */ }
  if (freshRun) {
    params.delete('newRun')
    params.set('seed', String(seed))
    window.history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`)
  }
  return seed
}
