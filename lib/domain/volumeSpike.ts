import { hourlyReadings, medianRate, rateUsdPerHour, type VolumeBucket } from './volumeHistory'

/**
 * Hourly buckets the baseline is drawn from.
 *
 * A day, so the baseline tracks what the pool has been doing recently rather than what it was
 * doing last week. These pools are new and growing; a week-long baseline makes ordinary growth
 * register as a spike every hour.
 */
export const BASELINE_WINDOW = 24

/** Fewest hourly readings before a baseline is trusted enough to fire on. */
export const MIN_HISTORY = 12

export type SpikeSettings = {
  multiple: number
  minVolumeUsd: number
  cooldownMs: number
}

export type Spike = {
  poolId: string
  rateUsdPerHour: number
  baselineUsdPerHour: number
  multiple: number
  atMs: number
}

/**
 * Whether a pool's newest hour departs from its own recent behaviour.
 *
 * Three guards, each earning its place against the seven day sample this was calibrated on:
 *
 * - The multiple catches the departure itself, measured against a median so the spike cannot
 *   raise the bar it has to clear.
 * - The volume floor keeps thin pools quiet. Without it the small stock pools alert three to
 *   four times a day, because a pool whose median hourly volume grew from $795 to $63,000 in a
 *   fortnight clears any multiple on growth alone.
 * - The cooldown stops one event alerting on every poll for as long as it lasts.
 */
export const detectSpike = (
  poolId: string,
  buckets: VolumeBucket[],
  settings: SpikeSettings,
  lastAlertedAtMs: number | null,
): Spike | null => {
  const readings = hourlyReadings(buckets)
  if (readings.length < MIN_HISTORY) return null

  const newest = readings[readings.length - 1]
  const baselineBuckets = readings.slice(-1 - BASELINE_WINDOW, -1)
  if (baselineBuckets.length < MIN_HISTORY - 1) return null

  const baseline = medianRate(baselineBuckets)
  if (baseline <= 0) return null

  const rate = rateUsdPerHour(newest)
  if (rate < settings.minVolumeUsd) return null

  const multiple = rate / baseline
  if (multiple < settings.multiple) return null

  if (lastAlertedAtMs !== null && newest.hourEndMs - lastAlertedAtMs < settings.cooldownMs) {
    return null
  }

  return {
    poolId,
    rateUsdPerHour: rate,
    baselineUsdPerHour: baseline,
    multiple,
    atMs: newest.hourEndMs,
  }
}
