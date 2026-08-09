import type { PoolRow } from '../types'

/** Inputs the ranking cares about, kept minimal so tests do not need a whole PoolRow. */
export type Rankable = Pick<PoolRow, 'totalFeesUsd' | 'tvlUsd' | 'volume24hUsd'>

/**
 * Half-decade band a pool's fee income falls into, used as the primary sort key.
 *
 * Fees are unique floats, so sorting on the raw number would make TVL and volume dead
 * tiebreakers that never fire. Banding fees first means a pool earning $9,000 does not
 * outrank one earning $9,100 that holds ten times the liquidity, while a pool earning an
 * order of magnitude more still wins outright. Half-decades (roughly 3.2x per band) keep
 * bands narrow enough that genuinely different earners stay separated.
 */
export const feeBand = (totalFeesUsd: number) => {
  if (!Number.isFinite(totalFeesUsd) || totalFeesUsd <= 0) return Number.NEGATIVE_INFINITY
  return Math.floor(Math.log10(totalFeesUsd) * 2)
}

/**
 * Orders pools by fee band, then TVL, then 24h volume, all descending.
 *
 * Returns a negative number when `a` should rank ahead of `b`, matching Array.sort.
 */
export const comparePools = (a: Rankable, b: Rankable) => {
  const bandDelta = feeBand(b.totalFeesUsd) - feeBand(a.totalFeesUsd)
  if (bandDelta !== 0 && Number.isFinite(bandDelta)) return bandDelta

  // Both pools sit outside any band (zero or negative fees); fall through to size.
  if (Number.isNaN(bandDelta)) return b.tvlUsd - a.tvlUsd

  const tvlDelta = b.tvlUsd - a.tvlUsd
  if (tvlDelta !== 0) return tvlDelta

  return b.volume24hUsd - a.volume24hUsd
}

/** Returns a new array ordered by {@link comparePools}, leaving the input untouched. */
export const rankPools = <T extends Rankable>(pools: T[]): T[] => [...pools].sort(comparePools)
