import { cached } from '../cache'
import { fetchPoolHistory, hasGraphHistory } from '../clients/uniswapGraph'
import { GRAPH_HISTORY_CONCURRENCY, GRAPH_HISTORY_TTL_MS } from '../config'
import { sumSeries, type VolumeBucket } from './volumeHistory'
import { rangeSpec, type VolumeRange } from './volumeRanges'

/** A pool to read history for. */
export type HistoryTarget = { poolId: string; protocol: string; chainId: number }

export type VolumeSeriesResult = {
  aggregate: VolumeBucket[]
  byPool: Record<string, VolumeBucket[]>
  /** Pools the API had no history for, so an empty chart can say which. */
  missing: number
  stepMs: number
}

/** Runs `task` over `items`, keeping at most `limit` in flight. */
const mapWithConcurrency = async <TIn, TOut>(
  items: TIn[],
  limit: number,
  task: (item: TIn) => Promise<TOut>,
): Promise<TOut[]> => {
  const results = new Array<TOut>(items.length)
  let cursor = 0

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Volume history for a set of pools over one range, plus their total.
 *
 * Cached per pool rather than per request, so two pages asking for overlapping pools pay once and
 * changing the pool list does not discard everything already fetched.
 *
 * One request per pool per range, against a source that returns whole measured intervals. That is
 * the difference from the swap sampler, which needed a request per hour and could only reach back
 * as far as the transaction feed retains, about seven days.
 */
export const loadVolumeSeries = async (
  targets: HistoryTarget[],
  range: VolumeRange,
): Promise<VolumeSeriesResult> => {
  const askable = targets.filter((target) => hasGraphHistory(target.chainId, target.protocol))

  const fetched = await mapWithConcurrency(askable, GRAPH_HISTORY_CONCURRENCY, async (target) => {
    const key = `graph:${target.chainId}:${target.poolId.toLowerCase()}:${range}`
    // A failure caches as null too, briefly, so one unreachable pool does not get retried on
    // every request while the rest of the page waits.
    const buckets = await cached(key, GRAPH_HISTORY_TTL_MS, () => fetchPoolHistory(target, range))
    return [target.poolId.toLowerCase(), buckets] as const
  })

  const byPool: Record<string, VolumeBucket[]> = {}
  let missing = 0

  for (const [poolId, buckets] of fetched) {
    if (buckets === null || buckets.length === 0) missing += 1
    else byPool[poolId] = buckets
  }

  return {
    aggregate: sumSeries(Object.values(byPool)),
    byPool,
    missing: missing + (targets.length - askable.length),
    stepMs: rangeSpec(range).stepMs,
  }
}
