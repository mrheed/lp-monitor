import { describe, expect, it } from 'vitest'
import { TIMEFRAMES, timeframeVolume, txPerHour } from './volumeTimeframes'

/** A row carrying only what the timeframe readers touch. */
const row = (over: Partial<Parameters<typeof timeframeVolume>[0]> = {}) => ({
  volume1hUsd: 500_000,
  volume24hUsd: 12_000_000,
  volume7dUsd: 70_000_000,
  volume30dUsd: 90_000_000,
  activity: null,
  ...over,
})

const activity = (over: Partial<NonNullable<Parameters<typeof timeframeVolume>[0]['activity']>> = {}) => ({
  volumeUsd: 1_000,
  transactionsPerHour: 120,
  volumeUsdPerHour: 600_000,
  uniqueTraders: 9,
  averageTradeUsd: 40,
  sampleSize: 25,
  windowSeconds: 156,
  ...over,
})

describe('TIMEFRAMES', () => {
  it('runs shortest to longest, so the row reads left to right in time order', () => {
    expect(TIMEFRAMES.map((frame) => frame.id)).toEqual(['1m', '1h', '24h', '7d', '30d'])
  })
})

describe('timeframeVolume', () => {
  it('reports the feed windows as measured, not estimated', () => {
    expect(timeframeVolume(row(), '1h')).toMatchObject({ usd: 500_000, estimated: false })
    expect(timeframeVolume(row(), '24h')).toMatchObject({ usd: 12_000_000, estimated: false })
    expect(timeframeVolume(row(), '7d')).toMatchObject({ usd: 70_000_000, estimated: false })
    expect(timeframeVolume(row(), '30d')).toMatchObject({ usd: 90_000_000, estimated: false })
  })

  it('derives the minute from the sampled hourly rate and marks it estimated', () => {
    const reading = timeframeVolume(row({ activity: activity() }), '1m')

    expect(reading.usd).toBe(10_000)
    expect(reading.estimated).toBe(true)
  })

  it('carries the sample window, so a rate from hours of data can be told from a live one', () => {
    const reading = timeframeVolume(row({ activity: activity({ windowSeconds: 27_360 }) }), '1m')

    expect(reading.sampleSeconds).toBe(27_360)
    expect(reading.sampleSwaps).toBe(25)
  })

  it('yields null for the minute when the pool has not been sampled', () => {
    expect(timeframeVolume(row(), '1m').usd).toBeNull()
  })

  it('yields null rather than zero when the sample spans no time', () => {
    expect(timeframeVolume(row({ activity: activity({ windowSeconds: 0 }) }), '1m').usd).toBeNull()
  })

  it('leaves feed windows unestimated even when an activity sample exists', () => {
    expect(timeframeVolume(row({ activity: activity() }), '24h').sampleSeconds).toBeNull()
  })
})

describe('txPerHour', () => {
  it('reads the sampled trade rate', () => {
    expect(txPerHour(row({ activity: activity() }))?.perHour).toBe(120)
  })

  it('is null for a pool with no sample yet, which is not the same as a pool nobody trades', () => {
    expect(txPerHour(row())).toBeNull()
  })

  it('is null when the sample spans no time, so a single swap cannot imply a rate', () => {
    expect(txPerHour(row({ activity: activity({ windowSeconds: 0 }) }))).toBeNull()
  })

  it('carries the window so the rate can be qualified where it is shown', () => {
    expect(txPerHour(row({ activity: activity({ windowSeconds: 156 }) }))?.sampleSeconds).toBe(156)
  })
})
