import type { PoolRow } from '../types'
import { effectiveFeesPerHourUsd } from './liveFees'

/**
 * How much each factor contributes to the composite score. Weights are normalised at use, so
 * they express relative importance rather than needing to sum to one.
 *
 * Fees carry the most weight because fee income is the thing being optimised; the others
 * describe how efficiently, how reliably and how safely that income is produced.
 */
export type ScoreWeights = {
  fees: number
  tvl: number
  rate: number
  traders: number
  volatility: number
}

/**
 * Volatility carries the second largest weight because price movement drives impermanent loss,
 * which works directly against the fee income the other factors reward. Trader count carries
 * the least: it is capped by the transaction sample it is drawn from, so it discriminates far
 * less than its share of the score would suggest.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  fees: 0.3,
  tvl: 0.2,
  rate: 0.15,
  traders: 0.1,
  volatility: 0.25,
}

/** The 0..1 component scores behind a pool's composite, kept so the UI can explain a ranking. */
export type ScoreParts = {
  fees: number
  tvl: number
  rate: number
  traders: number
  volatility: number
}

/**
 * Scales values by magnitude on a log axis, clipped at the 1st and 99th percentiles.
 *
 * Percentile rank was the first approach here and it discards magnitude entirely: with a fee
 * rate distribution whose median is $37/h and 90th percentile is $403/h, a pool at $4,315/h and
 * one at $253/h both land in the thin upper tail, so a seventeen fold advantage collapses into
 * a fraction of a percentile. A dense factor like trader count then outvotes it.
 *
 * Log scaling keeps ratios meaningful across the several orders of magnitude these values span.
 * Clipping is deliberately gentle, at the 1st and 99th percentiles: it exists only to stop one
 * absurd outlier compressing the rest, and a tighter clip would cap the very high fee pools that
 * the score is meant to reward.
 */
export const magnitudeScores = (values: number[]): number[] => {
  if (values.length === 0) return []
  if (values.length === 1) return [0.5]

  const logs = values.map((value) => Math.log10(1 + Math.max(0, value)))
  const sorted = [...logs].sort((a, b) => a - b)
  const low = sorted[Math.floor(sorted.length * 0.01)]
  const high = sorted[Math.ceil(sorted.length * 0.99) - 1]

  // Every value identical, or the clipped range collapsed: nothing to separate them by.
  if (high <= low) return values.map(() => 0.5)

  return logs.map((value) => Math.min(1, Math.max(0, (value - low) / (high - low))))
}

/**
 * Mid-rank percentile of each value within the cohort, each in 0..1.
 *
 * Used for bounded factors, where relative standing matters and there is no magnitude range to
 * preserve. Ties share the average of the positions they span, so equal inputs score equally.
 */
export const percentileRanks = (values: number[]): number[] => {
  if (values.length === 0) return []
  if (values.length === 1) return [0.5]

  return values.map((value) => {
    const below = values.filter((other) => other < value).length
    const equal = values.filter((other) => other === value).length
    return (below + equal / 2) / values.length
  })
}

/**
 * Scores pools on fee rate, thinness, trade rate, trader count and calmness, relative to the
 * cohort.
 *
 * TVL is inverted: holding less capital for the same fees is better, because it means a larger
 * share of each fee accrues to a given position. The inversion is bounded by construction,
 * since a percentile cannot exceed 1, which stops a dust pool with near zero TVL from taking an
 * unbounded lead the way a raw fees/TVL ratio would.
 *
 * Scores are relative to the pools passed in, so a pool's score is only meaningful against the
 * cohort it was scored with.
 */
export const scorePools = <
  T extends Pick<
    PoolRow,
    'recentFeesPerHourUsd' | 'totalFeesUsd' | 'tvlUsd' | 'activity' | 'priceVolatility'
  > &
    // Optional: a caller that has not measured a pool simply has no live figure, and the
    // reported window stands in for it.
    Partial<Pick<PoolRow, 'liveFeesPerHourUsd'>>,
>(
  pools: T[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): (T & { score: number; scoreParts: ScoreParts })[] => {
  // Scored on the recent fee rate, not accumulated fees: a pool that earned heavily last month
  // and nothing since should not outrank one earning now. Accumulated fees are display only.
  //
  // The rate is the live one where a pool was measured, which spans seconds to minutes rather
  // than the feed's shortest published hour, and falls back to the reported window otherwise.
  //
  // Fees, TVL and trade rate span orders of magnitude, so they are scaled by magnitude and a
  // large advantage stays a large advantage. Trader count is capped by the sample size that
  // produces it, so it has no meaningful magnitude range and keeps its percentile rank.
  const feeRanks = magnitudeScores(pools.map(effectiveFeesPerHourUsd))
  const tvlRanks = magnitudeScores(pools.map((pool) => pool.tvlUsd))
  const rateRanks = magnitudeScores(pools.map((pool) => pool.activity?.transactionsPerHour ?? 0))
  const traderRanks = percentileRanks(pools.map((pool) => pool.activity?.uniqueTraders ?? 0))

  // Volatility is a bounded percentage spread fairly evenly from 0 to 100, so percentile rank
  // suits it and log scaling would wrongly compress the calm end. Exactly zero is genuine: two
  // of 2,642 pools report it, both with real volume and no drawdown.
  const volatilityRanks = percentileRanks(pools.map((pool) => pool.priceVolatility))

  const total =
    weights.fees + weights.tvl + weights.rate + weights.traders + weights.volatility

  return pools.map((pool, index) => {
    const scoreParts: ScoreParts = {
      fees: feeRanks[index],
      // Inverted: the thinnest pool in the cohort scores highest.
      tvl: 1 - tvlRanks[index],
      rate: rateRanks[index],
      traders: traderRanks[index],
      // Inverted: the calmest pool in the cohort scores highest, since price movement is what
      // turns fee income into impermanent loss.
      volatility: 1 - volatilityRanks[index],
    }

    const weighted =
      scoreParts.fees * weights.fees +
      scoreParts.tvl * weights.tvl +
      scoreParts.rate * weights.rate +
      scoreParts.traders * weights.traders +
      scoreParts.volatility * weights.volatility

    return { ...pool, score: total > 0 ? weighted / total : 0, scoreParts }
  })
}

/**
 * Ranks pools by composite score, highest first.
 *
 * Ties fall back to raw fee income so the ordering stays stable and predictable.
 */
export const rankByScore = <T extends { score: number; totalFeesUsd: number }>(pools: T[]): T[] =>
  [...pools].sort((a, b) => b.score - a.score || b.totalFeesUsd - a.totalFeesUsd)
