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

/**
 * Hourly buckets per pool, keyed by lowercased pool id.
 *
 * Declared here rather than beside the file reading in `volumeStore`, because client components
 * need this type and `volumeStore` opens with `node:fs`. Next resolves a client component's
 * imports even when they are type-only, so importing it from there pulled `node:fs` into the
 * browser bundle and webpack refused to build the route.
 */
export type VolumeHistory = Record<string, VolumeBucket[]>

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
 *
 * An even number of buckets takes the upper of the two middle rates rather than averaging them,
 * which is deliberate. The 5x default threshold was calibrated by replaying seven days of data
 * through scripts using this same convention, so switching to an averaging median would move
 * every baseline slightly down, lower the bar a spike has to clear, and detach the threshold
 * from the evidence it was chosen on.
 */
export const medianRate = (buckets: VolumeBucket[]): number => {
  if (buckets.length === 0) return 0

  const rates = buckets.map(rateUsdPerHour).sort((a, b) => a - b)
  return rates[Math.floor(rates.length / 2)]
}

/**
 * Total hourly volume across every pool in a history.
 *
 * Each pool's bucket is scaled to a full hour before being added, because a pool sampled over
 * three minutes and one sampled over forty describe the same hour at different resolutions, and
 * adding their raw observations would weight the slow sampler higher for no reason.
 *
 * Buckets whose sample spanned more than an hour are dropped, matching what the spike detector
 * counts, so the chart and the alerts cannot disagree about which readings are real.
 */
export const aggregateSeries = (history: VolumeHistory): VolumeBucket[] => {
  const byHour = new Map<number, VolumeBucket>()

  for (const buckets of Object.values(history))
    for (const bucket of hourlyReadings(buckets)) {
      const existing = byHour.get(bucket.hourEndMs)

      byHour.set(bucket.hourEndMs, {
        hourEndMs: bucket.hourEndMs,
        volumeUsd: (existing?.volumeUsd ?? 0) + rateUsdPerHour(bucket),
        swaps: (existing?.swaps ?? 0) + bucket.swaps,
        spanMs: HOUR_MS,
      })
    }

  return [...byHour.values()].sort((a, b) => a.hourEndMs - b.hourEndMs)
}

/**
 * What fraction of a total a subset accounts for, as a percentage.
 *
 * Compared only over the hours the subset covers, so a pool sampled for six hours is not measured
 * against two days of chain volume. Stated as a figure because it is the question a second y
 * scale on one chart would be answering, and a second scale answers it wrongly.
 */
export const shareOfTotal = (
  total: VolumeBucket[],
  part: VolumeBucket[] | null,
): number | null => {
  if (part === null || part.length === 0) return null

  const hours = new Set(part.map((bucket) => bucket.hourEndMs))
  const totalUsd = total
    .filter((bucket) => hours.has(bucket.hourEndMs))
    .reduce((sum, bucket) => sum + bucket.volumeUsd, 0)
  if (totalUsd <= 0) return null

  return (part.reduce((sum, bucket) => sum + bucket.volumeUsd, 0) / totalUsd) * 100
}
