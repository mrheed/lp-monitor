import { describe, expect, it } from 'vitest'
import { simulateFeeShare } from './simulate'

describe('simulateFeeShare', () => {
  it('counts the deposit as part of the pool it joins', () => {
    // $1,000 into a $2,000 pool buys a third, not a half.
    const { share } = simulateFeeShare(1_000, 2_000, 100)

    expect(share).toBeCloseTo(1 / 3, 6)
  })

  it('gives a negligible share of a pool far larger than the deposit', () => {
    const { share } = simulateFeeShare(1_000, 999_000, 100)

    expect(share).toBeCloseTo(0.001, 6)
  })

  it('awards the whole pool when it is currently empty', () => {
    expect(simulateFeeShare(1_000, 0, 100).share).toBe(1)
  })

  it('splits the fee rate by the resulting share', () => {
    const { feesPerHourUsd } = simulateFeeShare(1_000, 3_000, 400)

    // A quarter of the enlarged pool earns a quarter of the fees.
    expect(feesPerHourUsd).toBeCloseTo(100, 6)
  })

  it('reports a daily figure of twenty four hours of fees', () => {
    const { feesPerHourUsd, feesPerDayUsd } = simulateFeeShare(5_000, 5_000, 80)

    expect(feesPerDayUsd).toBeCloseTo(feesPerHourUsd * 24, 6)
  })

  it('annualises the return against the deposit', () => {
    // Half of a $2/h rate is $1/h, which is $8,760 a year on a $8,760 deposit: 100%.
    const { aprPercent } = simulateFeeShare(8_760, 8_760, 2)

    expect(aprPercent).toBeCloseTo(100, 6)
  })

  it('shows a larger deposit diluting its own return', () => {
    const small = simulateFeeShare(100, 10_000, 50)
    const large = simulateFeeShare(100_000, 10_000, 50)

    expect(large.feesPerHourUsd).toBeGreaterThan(small.feesPerHourUsd)
    expect(large.aprPercent).toBeLessThan(small.aprPercent)
  })

  it('collapses the headline yield of a very thin pool', () => {
    // The case the ranking pushes to the top: a tiny pool with a high fee rate. Depositing a
    // sum comparable to its TVL takes most of the pool but cuts the advertised yield sharply.
    const thin = simulateFeeShare(5_000, 2_000, 100)

    expect(thin.share).toBeCloseTo(5 / 7, 6)
    expect(thin.aprPercent).toBeLessThan(
      // Against the naive figure that ignores dilution entirely.
      (100 * 24 * 365) / 5_000 * 100,
    )
  })

  it('returns nothing for a deposit of zero or less', () => {
    expect(simulateFeeShare(0, 1_000, 100)).toEqual({
      share: 0,
      feesPerHourUsd: 0,
      feesPerDayUsd: 0,
      aprPercent: 0,
    })
    expect(simulateFeeShare(-50, 1_000, 100).share).toBe(0)
  })

  it('returns zero earnings for a pool generating no fees', () => {
    const { feesPerHourUsd, aprPercent, share } = simulateFeeShare(1_000, 1_000, 0)

    expect(share).toBeCloseTo(0.5, 6)
    expect(feesPerHourUsd).toBe(0)
    expect(aprPercent).toBe(0)
  })

  it('produces finite numbers for non finite inputs', () => {
    const result = simulateFeeShare(1_000, Number.NaN, Number.POSITIVE_INFINITY)

    expect(Number.isFinite(result.share)).toBe(true)
    expect(Number.isFinite(result.aprPercent)).toBe(true)
  })
})
