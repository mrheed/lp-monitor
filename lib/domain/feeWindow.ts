import type { PoolRow } from '../types'

/** Fee totals per window, as the pool feed reports them. */
export type FeeWindows = {
  hour: number
  day: number
  week: number
  month: number
}

const WINDOW_HOURS = { hour: 1, day: 24, week: 24 * 7, month: 24 * 30 } as const

const ORDER = [
  { key: 'hour', label: '1h' },
  { key: 'day', label: '24h' },
  { key: 'week', label: '7d' },
  { key: 'month', label: '30d' },
] as const

/**
 * Picks the shortest window that actually reported fees and returns it as an hourly rate.
 *
 * Scoring on the shortest window keeps the ranking responsive to what a pool earns now rather
 * than to fees it accumulated days ago and may never earn again. Shorter windows are preferred
 * strictly, falling back only when one is empty: on a chain this young many pools have no 1h
 * activity at all, and treating those as zero would rank a pool that simply had a quiet hour
 * the same as one that is dead.
 *
 * Rates are per hour so windows of different lengths stay comparable.
 */
export const recentFeeRate = (
  windows: FeeWindows,
): { perHourUsd: number; window: PoolRow['recentFeeWindow'] } => {
  for (const { key, label } of ORDER) {
    const fees = windows[key]
    if (fees > 0) return { perHourUsd: fees / WINDOW_HOURS[key], window: label }
  }

  return { perHourUsd: 0, window: 'none' }
}
