import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEIGHTS,
  magnitudeScores,
  percentileRanks,
  rankByScore,
  scorePools,
} from './score'
import type { Activity } from '../types'

/** Builds the activity fields the score reads. */
const activity = (transactionsPerHour: number, uniqueTraders: number): Activity => ({
  transactionsPerHour,
  volumeUsd: 0,
  volumeUsdPerHour: 0,
  uniqueTraders,
  averageTradeUsd: 0,
  sampleSize: 0,
  windowSeconds: 0,
})

/** Builds a scoreable pool. */
const pool = (
  recentFeesPerHourUsd: number,
  tvlUsd: number,
  rate = 0,
  traders = 0,
  priceVolatility = 50,
) => ({
  recentFeesPerHourUsd,
  totalFeesUsd: recentFeesPerHourUsd,
  tvlUsd,
  priceVolatility,
  activity: activity(rate, traders),
})

describe('percentileRanks', () => {
  it('returns an empty list for no values', () => {
    expect(percentileRanks([])).toEqual([])
  })

  it('scores a lone value at the midpoint rather than the top', () => {
    expect(percentileRanks([42])).toEqual([0.5])
  })

  it('ranks the largest value highest and the smallest lowest', () => {
    const ranks = percentileRanks([10, 30, 20])

    expect(ranks[1]).toBeGreaterThan(ranks[2])
    expect(ranks[2]).toBeGreaterThan(ranks[0])
  })

  it('gives tied values identical ranks', () => {
    const [first, second] = percentileRanks([5, 5, 9])

    expect(first).toBe(second)
  })

  it('keeps every rank within zero and one', () => {
    const ranks = percentileRanks([1, 2, 3, 1_000_000])

    expect(Math.min(...ranks)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ranks)).toBeLessThanOrEqual(1)
  })
})

describe('scorePools', () => {
  it('ranks the thinner pool higher when fees and activity match', () => {
    const [thin, thick] = scorePools([pool(1_000, 10_000, 50, 50), pool(1_000, 900_000, 50, 50)])

    expect(thin.score).toBeGreaterThan(thick.score)
  })

  it('ranks the higher earning pool higher when liquidity and activity match', () => {
    const [rich, poor] = scorePools([pool(90_000, 100_000, 50, 50), pool(900, 100_000, 50, 50)])

    expect(rich.score).toBeGreaterThan(poor.score)
  })

  it('ranks the busier pool higher when fees and liquidity match', () => {
    const [busy, quiet] = scorePools([pool(1_000, 100_000, 500, 50), pool(1_000, 100_000, 2, 50)])

    expect(busy.score).toBeGreaterThan(quiet.score)
  })

  it('ranks the pool with more distinct traders higher, all else equal', () => {
    const [broad, narrow] = scorePools([pool(1_000, 100_000, 50, 400), pool(1_000, 100_000, 50, 3)])

    expect(broad.score).toBeGreaterThan(narrow.score)
  })

  it('does not let a near empty pool run away with the ranking', () => {
    // A dust pool wins on thinness but loses on everything else, so a strong pool still beats
    // it. A raw fees/TVL ratio would have handed the dust pool an unbounded lead.
    const [dust, strong] = scorePools([
      pool(5, 1, 1, 1),
      pool(500_000, 2_000_000, 800, 400),
    ])

    expect(strong.score).toBeGreaterThan(dust.score)
  })

  it('keeps every score within zero and one', () => {
    const scored = scorePools([pool(1, 1, 1, 1), pool(1e9, 1e9, 1e6, 1e5), pool(50, 500, 5, 5)])

    for (const { score } of scored) {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    }
  })

  it('exposes the component scores behind the composite', () => {
    const [only] = scorePools([pool(100, 100, 10, 10)])

    expect(only.scoreParts).toEqual({
      fees: 0.5,
      tvl: 0.5,
      rate: 0.5,
      traders: 0.5,
      volatility: 0.5,
    })
  })

  it('lets a large fee advantage outweigh a modest trader deficit', () => {
    // The failure this guards: a pool earning seventeen times more was outranked because the
    // other had 72 traders to its 51. Fee magnitude has to survive normalisation to prevent it.
    const cohort = [
      pool(4_315, 408_385, 670, 51),
      pool(253, 545_309, 207, 72),
      ...Array.from({ length: 20 }, (_, i) => pool(15 + i * 20, 3_000 + i * 400, 20 + i * 5, 45 + i)),
    ]

    const [rich, dense] = scorePools(cohort)

    expect(rich.scoreParts.fees).toBeGreaterThan(dense.scoreParts.fees + 0.3)
    expect(rich.score).toBeGreaterThan(dense.score)
  })

  it('ranks the calmer pool higher when everything else matches', () => {
    // Volatility drives impermanent loss, which eats the fee income the other factors reward.
    const [calm, wild] = scorePools([
      pool(1_000, 100_000, 50, 50, 5),
      pool(1_000, 100_000, 50, 50, 95),
    ])

    expect(calm.scoreParts.volatility).toBeGreaterThan(wild.scoreParts.volatility)
    expect(calm.score).toBeGreaterThan(wild.score)
  })

  it('treats a pool with no activity data as the worst on rate and traders', () => {
    const [measured, unmeasured] = scorePools([
      {
        recentFeesPerHourUsd: 1_000,
        totalFeesUsd: 1_000,
        tvlUsd: 100_000,
        priceVolatility: 50,
        activity: activity(100, 100),
      },
      {
        recentFeesPerHourUsd: 1_000,
        totalFeesUsd: 1_000,
        tvlUsd: 100_000,
        priceVolatility: 50,
        activity: null,
      },
    ])

    expect(measured.score).toBeGreaterThan(unmeasured.score)
  })

  it('honours weights, so zeroing a factor removes its influence', () => {
    const weights = { ...DEFAULT_WEIGHTS, tvl: 0 }
    const [thin, thick] = scorePools(
      [pool(1_000, 10_000, 50, 50), pool(1_000, 900_000, 50, 50)],
      weights,
    )

    expect(thin.score).toBeCloseTo(thick.score, 10)
  })
})

describe('rankByScore', () => {
  it('orders by score descending without mutating the input', () => {
    const input = [
      { score: 0.2, totalFeesUsd: 1 },
      { score: 0.9, totalFeesUsd: 1 },
      { score: 0.5, totalFeesUsd: 1 },
    ]
    const original = [...input]

    expect(rankByScore(input).map((entry) => entry.score)).toEqual([0.9, 0.5, 0.2])
    expect(input).toEqual(original)
  })

  it('breaks a score tie on raw fee income', () => {
    const ranked = rankByScore([
      { score: 0.5, totalFeesUsd: 10 },
      { score: 0.5, totalFeesUsd: 900 },
    ])

    expect(ranked[0].totalFeesUsd).toBe(900)
  })
})

describe('magnitudeScores', () => {
  it('returns an empty list for no values', () => {
    expect(magnitudeScores([])).toEqual([])
  })

  it('scores a lone value at the midpoint', () => {
    expect(magnitudeScores([500])).toEqual([0.5])
  })

  it('keeps every score within zero and one', () => {
    const scores = magnitudeScores([1, 10, 100, 1_000, 1_000_000])

    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...scores)).toBeLessThanOrEqual(1)
  })

  it('separates values an order of magnitude apart far more than percentile rank does', () => {
    // Both sit in the upper tail, where percentile rank barely distinguishes them.
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 253, 4_315]
    const magnitude = magnitudeScores(values)
    const percentile = percentileRanks(values)
    const gap = (a: number[]) => a[9] - a[8]

    expect(gap(magnitude)).toBeGreaterThan(gap(percentile))
  })

  it('gives identical values identical scores', () => {
    const [a, b] = magnitudeScores([70, 70, 5, 900])

    expect(a).toBe(b)
  })

  it('returns midpoints when every value is the same', () => {
    expect(magnitudeScores([9, 9, 9])).toEqual([0.5, 0.5, 0.5])
  })

  it('handles zero and negative inputs without producing NaN', () => {
    const scores = magnitudeScores([0, -5, 100, 1_000])

    expect(scores.every((score) => Number.isFinite(score))).toBe(true)
  })
})
