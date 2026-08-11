import { describe, expect, it } from 'vitest'
import { HOURS, simulateCompounding, type CompoundPlan } from './compound'

/** A pool thin enough that a deposit visibly moves the share, so effects are legible. */
const plan = (over: Partial<CompoundPlan> = {}): CompoundPlan => ({
  depositUsd: 1_000,
  poolTvlUsd: 9_000,
  poolFeesPerHourUsd: 100,
  horizonHours: HOURS.month,
  compoundEveryHours: HOURS.day,
  costPerCompoundUsd: 0,
  ...over,
})

describe('the share a deposit buys', () => {
  it('counts the deposit itself as part of the pool', () => {
    // $1,000 into a pool holding $9,000 buys a tenth, not a ninth.
    const outcome = simulateCompounding(plan({ horizonHours: 1, compoundEveryHours: 0 }))

    expect(outcome.feesEarnedUsd).toBeCloseTo(10, 6)
  })
})

describe('compounding', () => {
  it('earns more than leaving fees unclaimed', () => {
    const compounded = simulateCompounding(plan())
    const simple = simulateCompounding(plan({ compoundEveryHours: 0 }))

    expect(compounded.feesEarnedUsd).toBeGreaterThan(simple.feesEarnedUsd)
  })

  it('reports what compounding added over not doing it', () => {
    const outcome = simulateCompounding(plan())

    expect(outcome.compoundingGainUsd).toBeGreaterThan(0)
    expect(outcome.compoundingGainUsd).toBeCloseTo(
      outcome.netProfitUsd - outcome.simpleProfitUsd,
      6,
    )
  })

  it('accelerates as the position grows, because the share grows with it', () => {
    // Reinvesting enlarges the position, which takes a larger cut of the same pool fees. The
    // second half of a horizon therefore earns more than the first.
    const full = simulateCompounding(plan({ horizonHours: HOURS.day * 20 }))
    const half = simulateCompounding(plan({ horizonHours: HOURS.day * 10 }))

    expect(full.feesEarnedUsd).toBeGreaterThan(half.feesEarnedUsd * 2)
  })

  it('slows as the position approaches owning the pool', () => {
    // Share cannot exceed 1, so income tends to the pool's whole fee rate rather than growing
    // without limit. A deposit that already dwarfs the pool gains almost nothing from a larger one.
    const outcome = simulateCompounding(
      plan({ depositUsd: 1_000_000, poolTvlUsd: 100, horizonHours: HOURS.day }),
    )

    expect(outcome.feesEarnedUsd).toBeLessThanOrEqual(100 * HOURS.day)
  })

  it('counts each reinvestment, skipping the one at the very end', () => {
    // Seven days of daily compounding offers seven moments to reinvest, but the last falls at
    // the horizon itself, where the fees would sit in the position earning nothing before being
    // withdrawn. Paying gas for it buys exactly nothing.
    const outcome = simulateCompounding(plan({ horizonHours: HOURS.day * 7 }))

    expect(outcome.compounds).toBe(6)
  })
})

describe('the cost of reinvesting', () => {
  it('subtracts it from the profit', () => {
    const free = simulateCompounding(plan())
    const costly = simulateCompounding(plan({ costPerCompoundUsd: 5 }))

    expect(costly.netProfitUsd).toBeLessThan(free.netProfitUsd)
    expect(costly.costsUsd).toBeGreaterThan(0)
  })

  it('skips a reinvestment that would cost more than it adds', () => {
    // Paying $50 of gas to reinvest $3 of fees destroys value. Fees left unclaimed keep
    // accumulating until they are worth the cost, which is what an operator would actually do.
    const outcome = simulateCompounding(
      plan({ poolFeesPerHourUsd: 1, costPerCompoundUsd: 50, horizonHours: HOURS.day * 3 }),
    )

    expect(outcome.compounds).toBe(0)
    expect(outcome.costsUsd).toBe(0)
  })

  it('never turns a profit into a loss through costs it chose to pay', () => {
    // Since an uneconomic reinvestment is skipped, compounding can only ever help.
    const outcome = simulateCompounding(plan({ costPerCompoundUsd: 40 }))

    expect(outcome.netProfitUsd).toBeGreaterThanOrEqual(outcome.simpleProfitUsd)
  })

  it('skips a reinvestment worth less than its cost in future fees', () => {
    // Drawn from a real pool: $1,000 into ETH/USDG at $67.3k TVL earning $19/h. A day's fees
    // come to about $6.70, comfortably more than $2 of gas, so a rule comparing the two would
    // reinvest. It should not: adding $4.70 to a $1,000 position in a $67,300 pool moves the
    // share so little that the extra fees never repay the $2. Compounding daily here cost $58
    // in gas to earn $20 of compounding benefit.
    const outcome = simulateCompounding({
      depositUsd: 1_000,
      poolTvlUsd: 67_300,
      poolFeesPerHourUsd: 19,
      horizonHours: HOURS.month,
      compoundEveryHours: HOURS.day,
      costPerCompoundUsd: 2,
    })

    expect(outcome.compoundingGainUsd).toBeGreaterThanOrEqual(0)
    expect(outcome.netProfitUsd).toBeGreaterThanOrEqual(outcome.simpleProfitUsd)
  })

  it('still reinvests where the share gain genuinely repays the cost', () => {
    // The same $2 cost against a thin pool, where a reinvestment buys a visible share.
    const outcome = simulateCompounding(plan({ costPerCompoundUsd: 2 }))

    expect(outcome.compounds).toBeGreaterThan(0)
    expect(outcome.compoundingGainUsd).toBeGreaterThan(0)
  })

  it('keeps unreinvested fees, which are still owed to the position', () => {
    const outcome = simulateCompounding(
      plan({ poolFeesPerHourUsd: 1, costPerCompoundUsd: 1_000, horizonHours: HOURS.day }),
    )

    expect(outcome.feesEarnedUsd).toBeGreaterThan(0)
    expect(outcome.finalValueUsd).toBeCloseTo(1_000 + outcome.feesEarnedUsd, 6)
  })
})

describe('the projected return', () => {
  it('states the return over the horizon asked for', () => {
    const outcome = simulateCompounding(plan())

    expect(outcome.returnPercent).toBeCloseTo((outcome.netProfitUsd / 1_000) * 100, 6)
  })

  it('annualises a horizon shorter than a year', () => {
    const outcome = simulateCompounding(plan({ horizonHours: HOURS.month }))

    expect(outcome.apyPercent).toBeGreaterThan(outcome.returnPercent)
  })

  it('leaves a full year unannualised, since there is nothing to extrapolate', () => {
    const outcome = simulateCompounding(plan({ horizonHours: HOURS.year }))

    expect(outcome.apyPercent).toBeCloseTo(outcome.returnPercent, 4)
  })
})

describe('inputs that describe nothing', () => {
  it('returns an empty outcome for a deposit of zero', () => {
    expect(simulateCompounding(plan({ depositUsd: 0 })).netProfitUsd).toBe(0)
  })

  it('returns an empty outcome for a pool earning nothing', () => {
    expect(simulateCompounding(plan({ poolFeesPerHourUsd: 0 })).netProfitUsd).toBe(0)
  })

  it('treats a negative deposit as no deposit rather than inverting the maths', () => {
    expect(simulateCompounding(plan({ depositUsd: -500 })).netProfitUsd).toBe(0)
  })

  it('survives a pool with no recorded liquidity', () => {
    const outcome = simulateCompounding(plan({ poolTvlUsd: 0 }))

    expect(Number.isFinite(outcome.netProfitUsd)).toBe(true)
  })
})
