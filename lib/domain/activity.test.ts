import { describe, expect, it } from 'vitest'
import { computeActivity } from './activity'

/** Builds a transaction sample at a millisecond offset from a fixed epoch. */
const tx = (offsetMs: number, walletAddress = '0xa', amountUsd = 100) => ({
  timestampMs: String(1_786_000_000_000 + offsetMs),
  walletAddress,
  amountUsd,
})

describe('computeActivity', () => {
  it('returns an empty result for an empty sample', () => {
    const activity = computeActivity([])

    expect(activity.sampleSize).toBe(0)
    expect(activity.transactionsPerHour).toBe(0)
    expect(activity.uniqueTraders).toBe(0)
    expect(activity.averageTradeUsd).toBe(0)
    expect(activity.windowSeconds).toBe(0)
  })

  it('derives an hourly rate from the span the sample covers', () => {
    // 25 transactions spanning 36 seconds is the observed shape of a busy pool.
    const transactions = Array.from({ length: 25 }, (_, index) =>
      tx(index * 1_500, `0xtrader${index}`),
    )

    const activity = computeActivity(transactions)

    expect(activity.sampleSize).toBe(25)
    expect(activity.windowSeconds).toBe(36)
    expect(activity.transactionsPerHour).toBeCloseTo(2500, 0)
  })

  it('measures the window as the seconds between the oldest and newest transaction', () => {
    expect(computeActivity([tx(0), tx(36_000)]).windowSeconds).toBe(36)
  })

  it('reports a slow pool as a low hourly rate', () => {
    const activity = computeActivity([tx(0), tx(7_200_000)])

    expect(activity.windowSeconds).toBe(7200)
    expect(activity.transactionsPerHour).toBeCloseTo(1, 5)
  })

  it('returns a finite zero rate when every transaction shares a timestamp', () => {
    const activity = computeActivity([tx(0, '0xa'), tx(0, '0xb'), tx(0, '0xc')])

    expect(activity.windowSeconds).toBe(0)
    expect(Number.isFinite(activity.transactionsPerHour)).toBe(true)
    expect(activity.transactionsPerHour).toBe(0)
  })

  it('returns a zero rate for a single transaction, which spans no time', () => {
    const activity = computeActivity([tx(0)])

    expect(activity.sampleSize).toBe(1)
    expect(activity.transactionsPerHour).toBe(0)
  })

  it('counts unique traders case-insensitively so one wallet is not double counted', () => {
    const transactions = [tx(0, '0xAbC'), tx(1_000, '0xabc'), tx(2_000, '0xDEF')]

    expect(computeActivity(transactions).uniqueTraders).toBe(2)
  })

  it('derives an hourly USD volume rate over the same window as the transaction rate', () => {
    // Four trades of $250 spanning one hour is $1000/hour.
    const transactions = [
      tx(0, '0xa', 250),
      tx(1_200_000, '0xb', 250),
      tx(2_400_000, '0xc', 250),
      tx(3_600_000, '0xd', 250),
    ]

    const activity = computeActivity(transactions)

    expect(activity.windowSeconds).toBe(3600)
    expect(activity.volumeUsd).toBeCloseTo(1000, 5)
    expect(activity.transactionsPerHour).toBeCloseTo(4, 5)
  })

  it('returns a zero volume rate when the sample spans no time', () => {
    const activity = computeActivity([tx(0, '0xa', 500), tx(0, '0xb', 500)])

    expect(Number.isFinite(activity.volumeUsdPerHour)).toBe(true)
    expect(activity.volumeUsdPerHour).toBe(0)
  })

  it('still reports the volume observed when the sample spans no time', () => {
    // Two trades in the same second have no span to project from, but a thousand dollars did
    // change hands. The projection is what is undefined here, not the observation.
    const activity = computeActivity([tx(0, '0xa', 500), tx(0, '0xb', 500)])

    expect(activity.volumeUsd).toBe(1_000)
  })

  it('averages trade size across the sample, ignoring missing amounts', () => {
    const transactions = [
      tx(0, '0xa', 100),
      tx(1_000, '0xb', 300),
      { timestampMs: '1786000002000', walletAddress: '0xc' },
    ]

    expect(computeActivity(transactions).averageTradeUsd).toBeCloseTo(200, 5)
  })
})
