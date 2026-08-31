'use client'

import { useEffect, useState } from 'react'
import { StockVolumeChart } from './StockVolumeChart'
import { hourlyReadings, isVolumeBucket, type VolumeBucket } from '@/lib/domain/volumeHistory'
import type { VolumeHistory } from '@/lib/domain/volumeStore'

/** How often the panel re-reads the history. The watcher samples once a minute. */
const VOLUME_POLL_MS = 60_000

/** What the chart draws: the total across pools, and each pool's own series. */
type VolumeSeries = { aggregate: VolumeBucket[]; byPool: VolumeHistory }

/** One pool's series filtered to hourly readings, or null when nothing is selected, the pool has not been sampled, or all buckets were filtered out. */
export const overlayFor = (
  byPool: VolumeHistory,
  poolId: string | null,
): VolumeBucket[] | null => {
  if (poolId === null) return null
  const buckets = byPool[poolId.toLowerCase()]
  if (buckets === undefined) return null
  const filtered = hourlyReadings(buckets)
  return filtered.length > 0 ? filtered : null
}

/** Every bucket in a parsed array, or null if any of them is not a bucket. */
const readSeries = (value: unknown): VolumeBucket[] | null => {
  if (!Array.isArray(value)) return null

  const buckets = value.filter(isVolumeBucket)
  return buckets.length === value.length ? buckets : null
}

/**
 * What `/api/volume` returned, or null when the response was not that.
 *
 * Validated rather than trusted: a parsed response arrives untyped and everything below this is
 * arithmetic on it. Rejected whole rather than in part, because keeping the last good series on
 * screen reads better than half a chart.
 */
export const readVolumePayload = (value: unknown): VolumeSeries | null => {
  if (typeof value !== 'object' || value === null) return null

  const payload: Record<string, unknown> = { ...value }
  const aggregate = readSeries(payload.aggregate)

  if (aggregate === null || typeof payload.byPool !== 'object' || payload.byPool === null) {
    return null
  }

  const byPool: VolumeHistory = {}

  for (const [poolId, entry] of Object.entries(payload.byPool)) {
    const buckets = readSeries(entry)
    if (buckets === null) return null
    byPool[poolId.toLowerCase()] = buckets
  }

  return { aggregate, byPool }
}

type Props = {
  aggregate: VolumeBucket[]
  byPool: VolumeHistory
  pools: { poolId: string; pair: string }[]
}

/**
 * The volume chart plus the pools whose series can be laid over it.
 *
 * Only pools with sampled history are offered, since a chip that overlays nothing reads as a
 * broken control rather than an unsampled pool.
 */
export const StockVolumePanel = ({ aggregate, byPool, pools }: Props) => {
  const [selected, setSelected] = useState<string | null>(null)

  // Seeded from the server render so the chart is drawn on first paint, then refreshed from the
  // route. The page renders once while the watcher samples every minute, so without the poll the
  // chart froze at page load, and a first visit landing before any sampling stayed empty for the
  // whole session however long it was left open.
  const [series, setSeries] = useState<VolumeSeries>({ aggregate, byPool })

  useEffect(() => {
    const read = () => {
      void fetch('/api/volume')
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          const parsed = readVolumePayload(payload)
          if (parsed !== null) setSeries(parsed)
        })
        .catch(() => undefined)
    }

    read()
    const timer = setInterval(read, VOLUME_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  const selectable = pools.filter((pool) => series.byPool[pool.poolId.toLowerCase()] !== undefined)
  const active = selectable.find((pool) => pool.poolId === selected) ?? null

  return (
    <div>
      <StockVolumeChart
        aggregate={series.aggregate}
        selected={overlayFor(series.byPool, selected)}
        selectedLabel={active?.pair ?? null}
      />

      {selectable.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectable.map((pool) => {
            const on = pool.poolId === selected
            return (
              <button
                key={pool.poolId}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected(on ? null : pool.poolId)}
                className={`rounded border px-2 py-1 text-[11px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                  on
                    ? 'border-accent text-ink'
                    : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                {pool.pair}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
