/** What a given deposit would earn in a pool, at the pool's current fee rate. */
export type FeeShare = {
  /** Fraction of the pool the deposit would represent, 0..1. */
  share: number
  feesPerHourUsd: number
  feesPerDayUsd: number
  /** Annualised return on the deposit as a percentage, at the current rate. */
  aprPercent: number
}

const EMPTY: FeeShare = { share: 0, feesPerHourUsd: 0, feesPerDayUsd: 0, aprPercent: 0 }

const HOURS_PER_YEAR = 24 * 365

/**
 * Projects the fees a deposit would earn from a pool's current fee rate.
 *
 * The deposit is added to the denominator: putting $1,000 into a pool holding $2,000 buys a
 * third of it, not a half, because the deposit itself enlarges the pool. Dividing by the
 * pre-deposit TVL is the common mistake and it overstates thin pools worst, which are exactly
 * the ones a thinness-weighted ranking pushes to the top.
 *
 * Total fees are treated as unchanged by the deposit, since they follow trading volume rather
 * than liquidity. Adding liquidity therefore redistributes the same fees across a larger base,
 * which is why the projected return falls as the deposit grows.
 *
 * This is a projection at the current rate, not a forecast. It ignores impermanent loss, and it
 * assumes the position earns across the whole range: a concentrated position earns more while
 * the price sits inside its range and nothing outside it.
 */
export const simulateFeeShare = (
  depositUsd: number,
  poolTvlUsd: number,
  feeRatePerHourUsd: number,
): FeeShare => {
  if (!(depositUsd > 0) || !Number.isFinite(depositUsd)) return EMPTY

  const tvl = Number.isFinite(poolTvlUsd) && poolTvlUsd > 0 ? poolTvlUsd : 0
  const share = depositUsd / (tvl + depositUsd)

  const rate = Number.isFinite(feeRatePerHourUsd) && feeRatePerHourUsd > 0 ? feeRatePerHourUsd : 0
  const feesPerHourUsd = rate * share

  return {
    share,
    feesPerHourUsd,
    feesPerDayUsd: feesPerHourUsd * 24,
    aprPercent: (feesPerHourUsd * HOURS_PER_YEAR) / depositUsd * 100,
  }
}
