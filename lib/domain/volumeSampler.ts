import {
  VOLUME_BACKFILL_HOURS,
  VOLUME_SAMPLE_CONCURRENCY,
  VOLUME_SAMPLE_PAGE_SIZE,
  VOLUME_SAMPLE_POOL_LIMIT,
} from '../config'
import { fetchPoolSwaps, seekPageToken, type ActivityTarget } from '../clients/uniswap'
import { hasTransactionFeed } from '../chains'
import type { PoolRow } from '../types'
import {
  HOUR_MS,
  alignHourEnd,
  bucketFromSwaps,
  mergeBucket,
  rateUsdPerHour,
  type VolumeBucket,
} from './volumeHistory'
import { readVolumeHistory, writeVolumeHistory, type VolumeHistory } from './volumeStore'

/**
 * Total hourly volume across every pool in the history.
 *
 * Each pool's bucket is scaled to a full hour before being added. A pool sampled over three
 * minutes and one sampled over forty describe the same hour at different resolutions, and adding
 * their raw observations would weight the slow sampler higher for no reason.
 */
export const aggregateSeries = (history: VolumeHistory): VolumeBucket[] => {
  const byHour = new Map<number, VolumeBucket>()

  for (const buckets of Object.values(history))
    for (const bucket of buckets) {
      const existing = byHour.get(bucket.hourEndMs)
      const scaled = rateUsdPerHour(bucket)

      byHour.set(bucket.hourEndMs, {
        hourEndMs: bucket.hourEndMs,
        volumeUsd: (existing?.volumeUsd ?? 0) + scaled,
        swaps: (existing?.swaps ?? 0) + bucket.swaps,
        spanMs: HOUR_MS,
      })
    }

  return [...byHour.values()].sort((a, b) => a.hourEndMs - b.hourEndMs)
}

/**
 * Reads one hour's worth of swaps ending at `hourEndMs`, as a bucket.
 *
 * A past hour is read by seeking to it with a page token; the current hour is read from the
 * newest page with no cursor at all. That confines the feed's undocumented page-token encoding
 * to backfill, so a change to that encoding breaks backfill only and never live sampling.
 */
const sampleHour = async (
  target: ActivityTarget,
  hourEndMs: number,
): Promise<VolumeBucket | null> => {
  try {
    const seeking = hourEndMs < Date.now()
    const { swaps } = await fetchPoolSwaps(target, {
      pageSize: VOLUME_SAMPLE_PAGE_SIZE,
      ...(seeking ? { pageToken: seekPageToken(hourEndMs, target.chainId) } : {}),
    })

    return bucketFromSwaps(swaps, hourEndMs)
  } catch {
    // One unreadable hour is a gap in a chart, not a reason to abandon the pool.
    return null
  }
}

/**
 * Fetches `hours` of history for a pool, one sample per hour.
 *
 * Used only when a pool has no history yet. Every later pass samples the current hour alone.
 */
export const backfillPool = async (
  target: ActivityTarget,
  hours: number = VOLUME_BACKFILL_HOURS,
  now: number = Date.now(),
): Promise<VolumeBucket[]> => {
  const latest = alignHourEnd(now)
  const hourEnds = Array.from({ length: hours }, (_, i) => latest - i * HOUR_MS)
  const buckets: VolumeBucket[] = []

  for (let index = 0; index < hourEnds.length; index += VOLUME_SAMPLE_CONCURRENCY) {
    const slice = hourEnds.slice(index, index + VOLUME_SAMPLE_CONCURRENCY)
    const sampled = await Promise.all(slice.map((hourEnd) => sampleHour(target, hourEnd)))
    for (const bucket of sampled) if (bucket !== null) buckets.push(bucket)
  }

  return buckets.sort((a, b) => a.hourEndMs - b.hourEndMs)
}

/**
 * Samples the busiest stock pools and returns the updated history, having persisted it.
 *
 * A pool with no history is backfilled; one that already has history has only its current hour
 * re-read, which is a single request. Ordering by 24 hour volume and taking the top slice keeps
 * the pass affordable: a pool doing under a thousand dollars an hour cannot clear the alert floor
 * whatever multiple it hits.
 */
export const sampleStockVolume = async (
  rows: PoolRow[],
  now: number = Date.now(),
): Promise<VolumeHistory> => {
  const history = readVolumeHistory()

  const targets = rows
    .filter((row) => row.isStock && hasTransactionFeed(row.protocol))
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, VOLUME_SAMPLE_POOL_LIMIT)

  const currentHour = alignHourEnd(now)

  for (let index = 0; index < targets.length; index += VOLUME_SAMPLE_CONCURRENCY) {
    const slice = targets.slice(index, index + VOLUME_SAMPLE_CONCURRENCY)

    await Promise.all(
      slice.map(async (row) => {
        const key = row.poolId.toLowerCase()
        const target = { poolId: row.poolId, protocol: row.protocol, chainId: row.chainId }
        const existing = history[key]

        if (existing === undefined || existing.length === 0) {
          const backfilled = await backfillPool(target, VOLUME_BACKFILL_HOURS, now)
          if (backfilled.length > 0) history[key] = backfilled
          return
        }

        const bucket = await sampleHour(target, currentHour)
        if (bucket !== null) history[key] = mergeBucket(existing, bucket)
      }),
    )
  }

  writeVolumeHistory(history)
  return history
}
