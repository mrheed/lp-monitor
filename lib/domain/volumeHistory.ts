import type { PoolSwap } from '../clients/uniswap'

export const HOUR_MS = 3_600_000

/**
 * How many hourly buckets a pool keeps.
 *
 * Two days: enough for the chart to show a pattern and for the spike baseline to have a
 * twenty-four bucket window behind it, with nothing spare.
 */
export const BUCKET_LIMIT = 48

/**
 * One hour of observed trading for a pool.
 *
 * `volumeUsd` is what the sample actually saw and `spanMs` is how long it took to see it, kept
 * separately rather than pre-divided. A page of a hundred swaps covers three minutes on a busy
 * pool and six hours on a quiet one, and a reader has to be able to tell those apart.
 */
export type VolumeBucket = {
  hourEndMs: number
  volumeUsd: number
  swaps: number
  spanMs: number
}

/**
 * Whether a parsed value carries every bucket field as a finite number.
 *
 * Lives here rather than in the store because both sides of the wire need it: the store validates
 * what it read from disk, and the browser validates what the volume route sent back.
 */
export const isVolumeBucket = (value: unknown): value is VolumeBucket => {
  if (typeof value !== 'object' || value === null) return false

  const candidate: Record<string, unknown> = { ...value }
  return (['hourEndMs', 'volumeUsd', 'swaps', 'spanMs'] as const).every(
    (key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]),
  )
}

/** The hour boundary at or after `ms`, which is how a bucket is labelled. */
export const alignHourEnd = (ms: number): number => Math.ceil(ms / HOUR_MS) * HOUR_MS

/**
 * Turns a page of swaps into a bucket.
 *
 * Null for fewer than two swaps: one swap spans no time, so no rate can be read from it, and
 * recording it as zero volume would read as a quiet hour rather than an unmeasured one.
 */
export const bucketFromSwaps = (swaps: PoolSwap[], hourEndMs: number): VolumeBucket | null => {
  if (swaps.length < 2) return null

  const timestamps = swaps.map((swap) => swap.timestampMs)

  return {
    hourEndMs,
    volumeUsd: swaps.reduce((total, swap) => total + swap.amountUsd, 0),
    swaps: swaps.length,
    spanMs: Math.max(...timestamps) - Math.min(...timestamps),
  }
}

/** The bucket's volume scaled to a full hour. Zero when it spanned no time at all. */
export const rateUsdPerHour = (bucket: VolumeBucket): number =>
  bucket.spanMs > 0 ? (bucket.volumeUsd * HOUR_MS) / bucket.spanMs : 0

/**
 * Adds a bucket, replacing any existing one for the same hour and evicting the oldest.
 *
 * Sorted on the way out rather than assuming arrival order, since a backfill walks time
 * backwards while the live sampler walks it forwards and both write here.
 */
export const mergeBucket = (buckets: VolumeBucket[], next: VolumeBucket): VolumeBucket[] =>
  [...buckets.filter((entry) => entry.hourEndMs !== next.hourEndMs), next]
    .sort((a, b) => a.hourEndMs - b.hourEndMs)
    .slice(-BUCKET_LIMIT)

/**
 * The buckets fine enough to describe a single hour.
 *
 * A sample spanning longer than an hour cannot say which hour its volume belonged to, so it is
 * excluded from anything hourly. Quiet pools return these routinely.
 */
export const hourlyReadings = (buckets: VolumeBucket[]): VolumeBucket[] =>
  buckets.filter((bucket) => bucket.spanMs > 0 && bucket.spanMs <= HOUR_MS)

/**
 * The middle hourly rate across the buckets.
 *
 * A median rather than a mean because the baseline is compared against the very spike being
 * detected, and a mean would be dragged upward by it.
 */
export const medianRate = (buckets: VolumeBucket[]): number => {
  if (buckets.length === 0) return 0

  const rates = buckets.map(rateUsdPerHour).sort((a, b) => a - b)
  return rates[Math.floor(rates.length / 2)]
}
