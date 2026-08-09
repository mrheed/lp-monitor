import { describe, expect, it } from 'vitest'
import { recentFeeRate } from './feeWindow'

/** Builds a set of fee windows. */
const windows = (hour: number, day: number, week: number, month: number) => ({
  hour,
  day,
  week,
  month,
})

describe('recentFeeRate', () => {
  it('prefers the one hour window when it reported fees', () => {
    const { perHourUsd, window } = recentFeeRate(windows(500, 24_000, 168_000, 720_000))

    expect(window).toBe('1h')
    expect(perHourUsd).toBe(500)
  })

  it('falls back to the daily window when the hour was empty', () => {
    const { perHourUsd, window } = recentFeeRate(windows(0, 2_400, 10_000, 20_000))

    expect(window).toBe('24h')
    expect(perHourUsd).toBeCloseTo(100, 5)
  })

  it('falls back to the weekly window when hour and day were both empty', () => {
    const { perHourUsd, window } = recentFeeRate(windows(0, 0, 1_680, 5_000))

    expect(window).toBe('7d')
    expect(perHourUsd).toBeCloseTo(10, 5)
  })

  it('falls back to the monthly window as a last resort', () => {
    const { perHourUsd, window } = recentFeeRate(windows(0, 0, 0, 7_200))

    expect(window).toBe('30d')
    expect(perHourUsd).toBeCloseTo(10, 5)
  })

  it('reports no window for a pool that earned nothing anywhere', () => {
    const { perHourUsd, window } = recentFeeRate(windows(0, 0, 0, 0))

    expect(window).toBe('none')
    expect(perHourUsd).toBe(0)
  })

  it('ranks a currently busy pool above one whose fees are historical', () => {
    // Both accumulated 72,000 over 30 days. The first is still earning 500 an hour right now;
    // the second earned it all earlier and has since gone quiet, averaging 100 an hour.
    const live = recentFeeRate(windows(500, 2_400, 16_800, 72_000))
    const stale = recentFeeRate(windows(0, 0, 0, 72_000))

    expect(live.perHourUsd).toBe(500)
    expect(stale.perHourUsd).toBeCloseTo(100, 5)
    expect(live.perHourUsd).toBeGreaterThan(stale.perHourUsd)
  })

  it('normalises windows to a common hourly rate so they stay comparable', () => {
    // 240 over a day and 10 in an hour are the same rate.
    expect(recentFeeRate(windows(0, 240, 0, 0)).perHourUsd).toBeCloseTo(10, 5)
    expect(recentFeeRate(windows(10, 0, 0, 0)).perHourUsd).toBeCloseTo(10, 5)
  })
})
