import { describe, expect, it } from 'vitest'
import { percentileRanks } from './score'

/** The original definition, kept as the oracle the fast path must agree with. */
const naive = (values: number[]): number[] => {
  if (values.length === 0) return []
  if (values.length === 1) return [0.5]
  return values.map((value) => {
    const below = values.filter((other) => other < value).length
    const equal = values.filter((other) => other === value).length
    return (below + equal / 2) / values.length
  })
}

describe('percentileRanks', () => {
  it('matches the original definition on ties, duplicates and negatives', () => {
    const cases = [
      [1, 2, 3, 4],
      [2, 2, 2, 2],
      [5, 1, 5, 3, 1],
      [-3, 0, -3, 7],
      [0.5, 0.25, 0.75],
    ]
    for (const values of cases) {
      expect(percentileRanks(values)).toEqual(naive(values))
    }
  })

  it('matches the original on a large random cohort', () => {
    const values = Array.from({ length: 400 }, (_, i) => (i * 7919) % 53)
    expect(percentileRanks(values)).toEqual(naive(values))
  })

  it('handles the empty and single-value cases', () => {
    expect(percentileRanks([])).toEqual([])
    expect(percentileRanks([42])).toEqual([0.5])
  })

  it('ranks a full pool cohort fast enough to render a page', () => {
    // The live feed returns well over five thousand pools and scores five factors over each,
    // so a quadratic pass here is the difference between a page and a timeout.
    const values = Array.from({ length: 6000 }, (_, i) => (i * 2654435761) % 100000)
    const started = Date.now()
    percentileRanks(values)
    expect(Date.now() - started).toBeLessThan(300)
  })
})
