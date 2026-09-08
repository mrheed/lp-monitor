import { describe, expect, it } from 'vitest'
import { readSignals, continuationScore, type Candle } from './absorption'

/** Builds a window from close prices and volumes, with a small range around each close. */
const window = (closes: number[], volumes: number[]): Candle[] =>
  closes.map((close, i) => ({
    timeMs: i * 3_600_000,
    open: i === 0 ? close : closes[i - 1],
    high: close * 1.01,
    low: close * 0.99,
    close,
    volumeUsd: volumes[i],
  }))

const flat = [100, 100, 100, 100, 100, 100, 100, 100]

describe('price response', () => {
  it('is lower when the same move takes more volume to produce', () => {
    // The note's own example: $300k of selling for -25% is a market that resists; $70k for the
    // same -25% is fragile liquidity. Lower response is the stronger market.
    const heavy = readSignals(window([100, 95, 90, 88, 82, 78, 76, 75], Array(8).fill(300_000)))
    const thin = readSignals(window([100, 95, 90, 88, 82, 78, 76, 75], Array(8).fill(70_000)))

    expect(heavy!.priceResponse).toBeLessThan(thin!.priceResponse)
  })

  it('reads near zero when price holds through heavy volume', () => {
    const absorbed = readSignals(window(flat, Array(8).fill(1_000_000)))

    expect(absorbed!.priceResponse).toBeCloseTo(0, 5)
  })
})

describe('absorption', () => {
  it('rises when volume expands and price does not fall', () => {
    // The note's chart: 100 → 92 → 95 → 91 → 96 → 94 → 99 on rising volume. Ugly, but absorbed.
    const absorbing = readSignals(
      window([100, 92, 95, 91, 96, 94, 99, 100], [1e5, 2e5, 3e5, 4e5, 5e5, 6e5, 7e5, 8e5]),
    )
    const dumping = readSignals(
      window([100, 92, 85, 78, 70, 64, 58, 50], [1e5, 2e5, 3e5, 4e5, 5e5, 6e5, 7e5, 8e5]),
    )

    expect(absorbing!.absorption).toBeGreaterThan(dumping!.absorption)
  })

  it('separates expanding volume from shrinking volume', () => {
    const expanding = readSignals(window(flat, [1e5, 1e5, 1e5, 1e5, 5e5, 5e5, 5e5, 5e5]))
    const fading = readSignals(window(flat, [5e5, 5e5, 5e5, 5e5, 1e5, 1e5, 1e5, 1e5]))

    expect(expanding!.volumeExpansion).toBeGreaterThan(1)
    expect(fading!.volumeExpansion).toBeLessThan(1)
  })
})

describe('failed breakdown', () => {
  it('counts a candle that pierced support and closed back above it', () => {
    // Support is the first half's low. The later candles wick below and reclaim.
    const candles = window([100, 100, 100, 100, 98, 99, 100, 101], Array(8).fill(1e5))
    for (const c of candles.slice(4)) c.low = 90

    expect(readSignals(candles)!.failedBreakdowns).toBeGreaterThan(0)
  })

  it('does not count a break that stayed broken', () => {
    const candles = window([100, 100, 100, 100, 85, 84, 83, 82], Array(8).fill(1e5))
    for (const c of candles.slice(4)) c.low = 80

    expect(readSignals(candles)!.failedBreakdowns).toBe(0)
  })
})

describe('structure', () => {
  it('sees higher lows when the second half holds above the first', () => {
    expect(readSignals(window([100, 98, 102, 100, 106, 104, 110, 108], Array(8).fill(1e5)))!.higherLows).toBe(true)
  })

  it('sees no higher lows in a decline', () => {
    expect(readSignals(window([100, 96, 92, 88, 84, 80, 76, 72], Array(8).fill(1e5)))!.higherLows).toBe(false)
  })
})

describe('guards', () => {
  it('refuses a window too short to measure', () => {
    expect(readSignals(window([100, 101, 102], [1e5, 1e5, 1e5]))).toBeNull()
  })

  it('refuses a window with no volume, rather than dividing by it', () => {
    expect(readSignals(window(flat, Array(8).fill(0)))).toBeNull()
  })
})

describe('the continuation score', () => {
  it('ranks an absorbing window above a dumping one', () => {
    const absorbing = readSignals(
      window([100, 92, 95, 91, 96, 94, 99, 100], [1e5, 2e5, 3e5, 4e5, 5e5, 6e5, 7e5, 8e5]),
    )!
    const dumping = readSignals(
      window([100, 92, 85, 78, 70, 64, 58, 50], [8e5, 7e5, 6e5, 5e5, 4e5, 3e5, 2e5, 1e5]),
    )!

    expect(continuationScore(absorbing)).toBeGreaterThan(continuationScore(dumping))
  })

  it('stays inside 0 and 1 whatever it is given', () => {
    const wild = readSignals(window([100, 1, 500, 2, 900, 3, 800, 5], [1, 1e9, 1, 1e9, 1, 1e9, 1, 1e9]))!

    expect(continuationScore(wild)).toBeGreaterThanOrEqual(0)
    expect(continuationScore(wild)).toBeLessThanOrEqual(1)
  })
})
