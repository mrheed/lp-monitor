import { describe, expect, it } from 'vitest'
import { effectiveFeesPerHourUsd, formatWindow, impliedFeeRate, liveFeeRate } from './liveFees'
import type { Activity } from '../types'

const NO_WINDOWS = { hour: 0, day: 0, week: 0, month: 0 }

const activity = (over: Partial<Activity> = {}): Activity => ({
  transactionsPerHour: 0,
  volumeUsdPerHour: 0,
  uniqueTraders: 0,
  averageTradeUsd: 0,
  sampleSize: 10,
  windowSeconds: 90,
  ...over,
})

describe('the fee rate a pool actually pays', () => {
  it('comes from reported fees over reported volume', () => {
    const rate = impliedFeeRate({ ...NO_WINDOWS, hour: 10 }, { ...NO_WINDOWS, hour: 1_000 })

    expect(rate).toBe(0.01)
  })

  it('is measured rather than taken from the advertised fee tier', () => {
    // Across 400 pools on this chain the reported fee matched `lpFee` for 63 per cent and came
    // in at exactly 1/1.2 or 1/1.333 of it for the rest. Trusting `lpFee` would overstate that
    // remainder by 20 to 33 per cent, so the pool's own numbers decide.
    const paidLessThanAdvertised = impliedFeeRate(
      { ...NO_WINDOWS, hour: 833.33 },
      { ...NO_WINDOWS, hour: 100_000 },
    )

    expect(paidLessThanAdvertised).toBeCloseTo(0.008333, 6)
  })

  it('prefers the narrowest window that reported both fees and volume', () => {
    // A fee tier can change. The freshest evidence describes the pool as it is now.
    const rate = impliedFeeRate(
      { hour: 5, day: 1_000, week: 0, month: 0 },
      { hour: 1_000, day: 500_000, week: 0, month: 0 },
    )

    expect(rate).toBe(0.005)
  })

  it('falls back to a wider window when the narrow one is empty', () => {
    // Most pools on this chain have no activity in any given hour. Treating a quiet hour as a
    // zero fee rate would wipe out the fee estimate for a pool that trades perfectly well.
    const rate = impliedFeeRate(
      { hour: 0, day: 300, week: 0, month: 0 },
      { hour: 0, day: 30_000, week: 0, month: 0 },
    )

    expect(rate).toBe(0.01)
  })

  it('reports nothing when the pool has never recorded a fee', () => {
    expect(impliedFeeRate(NO_WINDOWS, NO_WINDOWS)).toBeNull()
  })

  it('reports nothing rather than dividing by zero volume', () => {
    expect(impliedFeeRate({ ...NO_WINDOWS, hour: 10 }, NO_WINDOWS)).toBeNull()
  })
})

describe('the live fee rate', () => {
  it('applies the measured rate to the sampled volume', () => {
    const rate = liveFeeRate(activity({ volumeUsdPerHour: 50_000 }), 0.01)

    expect(rate?.perHourUsd).toBe(500)
  })

  it('carries the window it was measured over', () => {
    // The figure is meaningless without it. A rate from a 90 second sample and one from a
    // 30 minute sample deserve different confidence, and the reader can only tell if it is shown.
    const rate = liveFeeRate(activity({ volumeUsdPerHour: 50_000, windowSeconds: 90 }), 0.01)

    expect(rate?.windowSeconds).toBe(90)
  })

  it('reports nothing without a sample to measure', () => {
    expect(liveFeeRate(null, 0.01)).toBeNull()
  })

  it('reports nothing when the sample spans no time', () => {
    // A single transaction has no span, so dividing by it would give an infinite rate.
    expect(liveFeeRate(activity({ sampleSize: 1, windowSeconds: 0 }), 0.01)).toBeNull()
  })

  it('reports nothing when the pool never revealed what it pays', () => {
    expect(liveFeeRate(activity({ volumeUsdPerHour: 50_000 }), null)).toBeNull()
  })
})

describe('the fee rate everything reads', () => {
  it('prefers the live measurement over the reported window', () => {
    const fees = effectiveFeesPerHourUsd({
      liveFeesPerHourUsd: 500,
      recentFeesPerHourUsd: 120,
    })

    expect(fees).toBe(500)
  })

  it('falls back to the reported window when nothing was measured', () => {
    // Measurement is rationed to the top candidates, so most rows have no live figure. Scoring
    // those as zero would bury every pool the sweep did not reach.
    const fees = effectiveFeesPerHourUsd({
      liveFeesPerHourUsd: null,
      recentFeesPerHourUsd: 120,
    })

    expect(fees).toBe(120)
  })

  it('keeps a measured zero rather than falling back over it', () => {
    // A pool measured as having stopped trading is a real finding, not missing data. Falling
    // back here would resurrect an hour-old rate for a pool that has since gone quiet.
    const fees = effectiveFeesPerHourUsd({
      liveFeesPerHourUsd: 0,
      recentFeesPerHourUsd: 120,
    })

    expect(fees).toBe(0)
  })
})

describe('a window label', () => {
  it('reads in seconds under a minute', () => {
    expect(formatWindow(45)).toBe('45s')
  })

  it('reads in minutes under an hour', () => {
    expect(formatWindow(900)).toBe('15m')
  })

  it('reads in hours under a day', () => {
    expect(formatWindow(7_200)).toBe('2h')
  })
})
