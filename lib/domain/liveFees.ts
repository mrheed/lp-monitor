import type { Activity, PoolRow } from '../types'
import type { FeeWindows } from './feeWindow'

/** Volume totals per window, matching the fee windows they pair with. */
export type VolumeWindows = FeeWindows

/**
 * The share of volume that reaches liquidity providers, taken from what a pool actually paid.
 *
 * Measured rather than assumed. The pool feed reports an `lpFee` percentage, but comparing it
 * against reported fees across 400 pools showed a third of them paying exactly 1/1.2 or 1/1.333
 * of it, so using `lpFee` directly overstates those by 20 to 33 per cent. Dividing reported fees
 * by reported volume asks the pool what it pays instead of assuming.
 *
 * The narrowest window with volume is preferred, since a fee tier can change and the freshest
 * evidence describes the pool as it is now.
 */
export const impliedFeeRate = (fees: FeeWindows, volume: VolumeWindows): number | null => {
  const windows = [
    [fees.hour, volume.hour],
    [fees.day, volume.day],
    [fees.week, volume.week],
    [fees.month, volume.month],
  ] as const

  for (const [fee, traded] of windows) {
    if (traded > 0 && fee > 0) return fee / traded
  }

  return null
}

/** A fee rate with the window it was measured over, so neither is read without the other. */
export type LiveFeeRate = {
  perHourUsd: number
  /** Seconds the measurement covers. Smaller is fresher. */
  windowSeconds: number
}

/**
 * Fee income per hour, measured over the transaction sample rather than a reported window.
 *
 * The shortest window the pool feed publishes is an hour, which is a long time on a chain where
 * a pool's volume can move an order of magnitude between polls. The activity sample is the same
 * 25 transactions already fetched for the trade rate, and on a busy pool it spans well under a
 * minute, so the same arithmetic over that volume gives a far fresher figure at no extra cost.
 *
 * Returns null when there is nothing to measure: no sample, or no evidence of what the pool pays.
 */
export const liveFeeRate = (
  activity: Activity | null,
  feeRate: number | null,
): LiveFeeRate | null => {
  if (activity === null || feeRate === null) return null
  if (activity.sampleSize === 0 || activity.windowSeconds <= 0) return null

  return {
    perHourUsd: activity.volumeUsdPerHour * feeRate,
    windowSeconds: activity.windowSeconds,
  }
}

/**
 * Attaches a measurement to a row, deriving the live fee figures from it.
 *
 * The single place activity lands on a row. The eager server pass and the lazy browser fetch
 * both go through it, so a row can never carry a sample without the fee figures that sample
 * implies, or keep figures from a measurement that has since been replaced.
 */
export const withActivity = (row: PoolRow, activity: Activity | null): PoolRow => {
  const live = liveFeeRate(activity, row.feeRate)

  return {
    ...row,
    activity,
    liveFeesPerHourUsd: live?.perHourUsd ?? null,
    liveFeeWindowSeconds: live?.windowSeconds ?? null,
  }
}

/**
 * The freshest fee rate a row can offer, in USD per hour.
 *
 * Prefers the live measurement and falls back to the feed's shortest reported window. Every
 * consumer reads fees through this so the score, the deposit simulation and the table can never
 * disagree about which number a pool is earning.
 *
 * The fallback matters because measurement is rationed: only the top candidates get a
 * transaction request, so most rows have no live figure and would otherwise score as zero.
 */
export const effectiveFeesPerHourUsd = (
  row: Pick<PoolRow, 'recentFeesPerHourUsd'> & Partial<Pick<PoolRow, 'liveFeesPerHourUsd'>>,
): number => row.liveFeesPerHourUsd ?? row.recentFeesPerHourUsd

/** Formats a window as a compact age, for saying how fresh a figure is. */
export const formatWindow = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h`
  return `${Math.round(seconds / 86_400)}d`
}
