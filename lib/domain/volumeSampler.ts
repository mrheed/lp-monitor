import {
  VOLUME_BACKFILL_CONCURRENCY,
  VOLUME_BACKFILL_HOURS,
  VOLUME_BACKFILL_MAX_ATTEMPTS,
  VOLUME_BACKFILL_RETRY_MS,
  VOLUME_SAMPLE_CONCURRENCY,
  VOLUME_SAMPLE_PAGE_SIZE,
  VOLUME_SAMPLE_POOL_LIMIT,
} from '../config'
import { fetchPoolSwaps, seekPageToken, type ActivityTarget } from '../clients/uniswap'
import { hasTransactionFeed } from '../chains'

// Re-exported so server callers keep importing it beside the sampler. It is declared in
// volumeHistory because client components need it, and this module reaches volumeStore, which
// opens with a filesystem import that must never resolve into a browser bundle.
export { aggregateSeries } from './volumeHistory'
import type { PoolRow } from '../types'
import {
  HOUR_MS,
  alignHourEnd,
  bucketFromSwaps,
  hourlyReadings,
  mergeBucket,
  rateUsdPerHour,
  type VolumeBucket,
} from './volumeHistory'
import {
  readVolumeStore,
  writeVolumeStore,
  type BackfillAttempt,
  type VolumeHistory,
} from './volumeStore'

/** The pool fields the sampler needs: which pools to sample, in what order, and how to fetch. */
export type VolumeSampleTarget = Pick<
  PoolRow,
  'poolId' | 'chainId' | 'protocol' | 'isStock' | 'volume24hUsd'
>


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

  for (let index = 0; index < hourEnds.length; index += VOLUME_BACKFILL_CONCURRENCY) {
    const slice = hourEnds.slice(index, index + VOLUME_BACKFILL_CONCURRENCY)
    const sampled = await Promise.all(slice.map((hourEnd) => sampleHour(target, hourEnd)))
    for (const bucket of sampled) if (bucket !== null) buckets.push(bucket)
  }

  return buckets.sort((a, b) => a.hourEndMs - b.hourEndMs)
}

/**
 * Whether a pool with no history has waited long enough for another backfill.
 *
 * A backfill costs 48 requests and can return nothing twice over: the gateway may be failing, or
 * the pool may simply be too quiet to yield two swaps in any hour. Neither case writes buckets,
 * so without a recorded attempt the pool looks untried and the full 48 requests repeat on every
 * poll for as long as the condition lasts. Each failure widens the gap by another retry interval,
 * to a ceiling of `VOLUME_BACKFILL_MAX_ATTEMPTS` of them.
 */
const backfillDue = (attempt: BackfillAttempt | undefined, now: number): boolean => {
  if (attempt === undefined) return true

  const gaps = Math.min(attempt.attempts, VOLUME_BACKFILL_MAX_ATTEMPTS)
  return now - attempt.lastAttemptMs >= gaps * VOLUME_BACKFILL_RETRY_MS
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
  rows: VolumeSampleTarget[],
  now: number = Date.now(),
): Promise<VolumeHistory> => {
  const { history, backfill } = readVolumeStore()

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
          if (!backfillDue(backfill[key], now)) return

          const backfilled = await backfillPool(target, VOLUME_BACKFILL_HOURS, now)

          if (backfilled.length > 0) {
            history[key] = backfilled
            delete backfill[key]
            return
          }

          // Recorded even though it produced nothing, which is the whole point: an unrecorded
          // failure is indistinguishable from a pool never tried.
          backfill[key] = { attempts: (backfill[key]?.attempts ?? 0) + 1, lastAttemptMs: now }
          return
        }

        const bucket = await sampleHour(target, currentHour)
        if (bucket !== null) history[key] = mergeBucket(existing, bucket)
      }),
    )
  }

  writeVolumeStore({ history, backfill })
  return history
}
