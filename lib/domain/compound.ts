/** Hour counts for the horizons and intervals the projection is offered over. */
export const HOURS = {
  hour: 1,
  day: 24,
  week: 24 * 7,
  month: 24 * 30,
  quarter: 24 * 90,
  year: 24 * 365,
} as const

/** What to project: a deposit, the pool it goes into, and how it is managed. */
export type CompoundPlan = {
  depositUsd: number
  /** Pool liquidity excluding this deposit, since the deposit enlarges the pool it joins. */
  poolTvlUsd: number
  poolFeesPerHourUsd: number
  horizonHours: number
  /** Hours between reinvestments. Zero means fees are never put back to work. */
  compoundEveryHours: number
  /** What one reinvestment costs in gas and swap fees. */
  costPerCompoundUsd: number
}

/** The projected result of following a plan. */
export type CompoundOutcome = {
  /** The position plus any fees earned but not yet reinvested. */
  finalValueUsd: number
  feesEarnedUsd: number
  costsUsd: number
  netProfitUsd: number
  /** Net profit as a percentage of the deposit, over the horizon asked for. */
  returnPercent: number
  /** The same return annualised, so horizons of different lengths can be compared. */
  apyPercent: number
  /** Reinvestments actually made, which is fewer than offered when some were uneconomic. */
  compounds: number
  /** The share of the pool the position ends up holding, 0..1. */
  finalShare: number
  /** Net profit from the same deposit left to accumulate without reinvesting. */
  simpleProfitUsd: number
  /** What reinvesting added over not doing it, after its costs. */
  compoundingGainUsd: number
}

const EMPTY: CompoundOutcome = {
  finalValueUsd: 0,
  feesEarnedUsd: 0,
  costsUsd: 0,
  netProfitUsd: 0,
  returnPercent: 0,
  apyPercent: 0,
  compounds: 0,
  finalShare: 0,
  simpleProfitUsd: 0,
  compoundingGainUsd: 0,
}

/** A finite positive number, or the fallback. */
const positive = (value: number, fallback = 0) =>
  Number.isFinite(value) && value > 0 ? value : fallback

/**
 * Fees a position earns over a stretch of hours during which its size does not change.
 *
 * Pool fees are treated as fixed, following trading volume rather than liquidity, so a larger
 * position takes a larger cut of the same total rather than creating more of it. That is why
 * the share sits in the numerator and the position sits in both.
 */
const feesOver = (positionUsd: number, otherLiquidityUsd: number, ratePerHour: number, hours: number) =>
  ratePerHour * hours * (positionUsd / (otherLiquidityUsd + positionUsd))

/**
 * Projects what a deposit earns when its fees are periodically put back into the position.
 *
 * Compounding matters here for a reason specific to liquidity pools: fee income is proportional
 * to the share of the pool held, so reinvesting buys a larger share, which earns faster, which
 * buys more share. Growth is self-limiting rather than exponential, because share cannot pass 1
 * and the position's income tends towards the pool's entire fee rate.
 *
 * Fees accrue but earn nothing until reinvested, which is how a position actually behaves:
 * uncollected fees sit outside the liquidity that trades against. A reinvestment happens only
 * when the extra fees it buys over the remaining time exceed its cost, so fees keep accumulating
 * until they are worth collecting. That makes reinvesting weakly better than never doing it, and
 * it is why the projection can report fewer reinvestments than the chosen interval offers.
 *
 * This is a projection at the pool's current fee rate, not a forecast. It assumes that rate
 * holds for the whole horizon, which no pool guarantees, and it ignores impermanent loss
 * entirely. A pool whose price moves can lose more to divergence than it earns in fees.
 */
export const simulateCompounding = (planned: CompoundPlan): CompoundOutcome => {
  const deposit = positive(planned.depositUsd)
  const rate = positive(planned.poolFeesPerHourUsd)
  const horizon = positive(planned.horizonHours)

  if (deposit === 0 || rate === 0 || horizon === 0) return EMPTY

  const otherLiquidity = positive(planned.poolTvlUsd)
  const cost = positive(planned.costPerCompoundUsd)
  const interval = positive(planned.compoundEveryHours)

  // The same deposit left alone for the whole horizon, as the baseline compounding is judged
  // against. Its share never moves, so its income is a straight line.
  const simpleProfitUsd = feesOver(deposit, otherLiquidity, rate, horizon)

  let position = deposit
  let pending = 0
  let feesEarnedUsd = 0
  let costsUsd = 0
  let compounds = 0

  // A zero interval means never reinvesting, which is one uninterrupted stretch.
  const stepHours = interval === 0 ? horizon : Math.min(interval, horizon)

  for (let elapsed = 0; elapsed < horizon; elapsed += stepHours) {
    const hours = Math.min(stepHours, horizon - elapsed)
    const earned = feesOver(position, otherLiquidity, rate, hours)

    feesEarnedUsd += earned
    pending += earned

    // Reinvest only when the extra fees it buys over the time left exceed what it costs.
    //
    // Comparing the fees waiting against the cost is the obvious rule and it is wrong: a day's
    // fees on $1,000 in a $67,300 pool come to about $6.70, which clears $2 of gas easily, but
    // adding $4.70 to that position moves its share so little that the extra fees never repay
    // the $2. Following that rule spent $58 of gas over a month to gain $20.
    const remaining = horizon - elapsed - hours
    if (interval > 0 && remaining > 0) {
      const added = pending - cost
      const extraFees =
        added > 0
          ? feesOver(position + added, otherLiquidity, rate, remaining) -
            feesOver(position, otherLiquidity, rate, remaining)
          : 0

      if (extraFees > cost) {
        position += added
        costsUsd += cost
        pending = 0
        compounds += 1
      }
    }
  }

  const finalValueUsd = position + pending
  const netProfitUsd = finalValueUsd - deposit
  const returnPercent = (netProfitUsd / deposit) * 100

  // Annualised by compounding the horizon's return, so a month and a year stay comparable. A
  // horizon of exactly a year is left alone, having nothing to extrapolate.
  const periodsPerYear = HOURS.year / horizon
  const apyPercent = (Math.pow(1 + netProfitUsd / deposit, periodsPerYear) - 1) * 100

  return {
    finalValueUsd,
    feesEarnedUsd,
    costsUsd,
    netProfitUsd,
    returnPercent,
    apyPercent,
    compounds,
    finalShare: position / (otherLiquidity + position),
    simpleProfitUsd,
    compoundingGainUsd: netProfitUsd - simpleProfitUsd,
  }
}
