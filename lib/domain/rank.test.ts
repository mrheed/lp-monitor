import { describe, expect, it } from 'vitest'
import { comparePools, feeBand, rankPools } from './rank'

/** Builds the minimal ranking input. */
const pool = (totalFeesUsd: number, tvlUsd: number, volume24hUsd = 0) => ({
  totalFeesUsd,
  tvlUsd,
  volume24hUsd,
})

describe('feeBand', () => {
  it('groups fees within the same half decade into one band', () => {
    expect(feeBand(9_000)).toBe(feeBand(9_100))
  })

  it('separates fees an order of magnitude apart', () => {
    expect(feeBand(90_000)).toBeGreaterThan(feeBand(9_000))
  })

  it('places zero and negative fees below every real band', () => {
    expect(feeBand(0)).toBe(Number.NEGATIVE_INFINITY)
    expect(feeBand(-5)).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('comparePools', () => {
  it('ranks a higher fee band ahead regardless of TVL', () => {
    const big = pool(90_000, 1_000)
    const small = pool(9_000, 10_000_000)

    expect(comparePools(big, small)).toBeLessThan(0)
  })

  it('prefers deeper liquidity when two pools share a fee band', () => {
    const deep = pool(9_100, 5_000_000)
    const shallow = pool(9_000, 100_000)

    expect(comparePools(deep, shallow)).toBeLessThan(0)
  })

  it('falls back to volume when fee band and TVL both tie', () => {
    const busy = pool(9_000, 100_000, 4_000_000)
    const quiet = pool(9_000, 100_000, 100_000)

    expect(comparePools(busy, quiet)).toBeLessThan(0)
  })

  it('orders two fee-less pools by TVL rather than returning NaN', () => {
    const result = comparePools(pool(0, 500), pool(0, 100))

    expect(Number.isNaN(result)).toBe(false)
    expect(result).toBeLessThan(0)
  })
})

describe('rankPools', () => {
  it('sorts without mutating the input array', () => {
    const input = [pool(100, 10), pool(100_000, 10), pool(1_000, 10)]
    const originalOrder = [...input]

    const ranked = rankPools(input)

    expect(ranked.map((entry) => entry.totalFeesUsd)).toEqual([100_000, 1_000, 100])
    expect(input).toEqual(originalOrder)
  })
})
