import type { Activity } from '../types'

/** Windows the stocks table reports volume over, shortest first. */
export const TIMEFRAMES = [
  { id: '1m', label: '1m' },
  { id: '1h', label: '1h' },
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
] as const

export type Timeframe = (typeof TIMEFRAMES)[number]['id']

/** Just the fields the readers below touch, so callers are not forced to build a whole PoolRow. */
type VolumeSource = {
  volume1hUsd: number
  volume24hUsd: number
  volume7dUsd: number
  volume30dUsd: number
  activity: Activity | null
}

/**
 * One figure for the table, and whether it was measured or inferred.
 *
 * `estimated` and the sample fields exist because the shortest window is not a window the feed
 * reports. It is scaled down from a sampled rate, and a sample of twenty five swaps spans seconds
 * on a busy pool and hours on a quiet one. Showing the figure without the span lets a week-old
 * average read as current activity.
 */
export type VolumeReading = {
  usd: number | null
  estimated: boolean
  sampleSeconds: number | null
  sampleSwaps: number | null
}

const measured = (usd: number): VolumeReading => ({
  usd,
  estimated: false,
  sampleSeconds: null,
  sampleSwaps: null,
})

/** Whether a sample covers enough time to imply a rate at all. */
const usable = (activity: Activity | null): activity is Activity =>
  activity !== null && activity.sampleSize > 0 && activity.windowSeconds > 0

/** Volume over one window, measured where the feed reports it and inferred only for the minute. */
export const timeframeVolume = (source: VolumeSource, timeframe: Timeframe): VolumeReading => {
  if (timeframe === '1h') return measured(source.volume1hUsd)
  if (timeframe === '24h') return measured(source.volume24hUsd)
  if (timeframe === '7d') return measured(source.volume7dUsd)
  if (timeframe === '30d') return measured(source.volume30dUsd)

  if (!usable(source.activity)) {
    return { usd: null, estimated: true, sampleSeconds: null, sampleSwaps: null }
  }

  return {
    usd: source.activity.volumeUsdPerHour / 60,
    estimated: true,
    sampleSeconds: source.activity.windowSeconds,
    sampleSwaps: source.activity.sampleSize,
  }
}

/** Trades per hour from the same sample, with the window that produced it. */
export const txPerHour = (
  source: VolumeSource,
): { perHour: number; sampleSeconds: number; sampleSwaps: number } | null => {
  if (!usable(source.activity)) return null

  return {
    perHour: source.activity.transactionsPerHour,
    sampleSeconds: source.activity.windowSeconds,
    sampleSwaps: source.activity.sampleSize,
  }
}

/** How long the sample covered, phrased for a tooltip rather than a chart axis. */
export const describeSample = (sampleSeconds: number, sampleSwaps: number): string => {
  const span =
    sampleSeconds >= 3600
      ? `${(sampleSeconds / 3600).toFixed(1)} hours`
      : sampleSeconds >= 60
        ? `${(sampleSeconds / 60).toFixed(1)} min`
        : `${Math.round(sampleSeconds)}s`

  return `rate from ${sampleSwaps} swaps over ${span}`
}
