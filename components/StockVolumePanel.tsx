'use client'

import { useEffect, useMemo, useState } from 'react'
import { StockVolumeChart } from './StockVolumeChart'
import { StockTable } from './StockTable'
import { groupByStock } from '@/lib/domain/stockGroups'
import {
  DEFAULT_RANGE,
  VOLUME_RANGES,
  type VolumeRange,
} from '@/lib/domain/volumeRanges'
import type { PoolRow } from '@/lib/types'
import {
  aggregateSeries,
  shareOfTotal,
  isVolumeBucket,
  type VolumeBucket,
  type VolumeHistory,
} from '@/lib/domain/volumeHistory'

/** What the chart draws: the total across pools, and each pool's own series. */
type VolumeSeries = { aggregate: VolumeBucket[]; byPool: VolumeHistory }

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
  rows: PoolRow[]
}

/**
 * The volume chart plus the pools whose series can be laid over it.
 *
 * Only pools with sampled history are offered, since a chip that overlays nothing reads as a
 * broken control rather than an unsampled pool.
 */
export const StockVolumePanel = ({ aggregate, byPool, rows }: Props) => {
  const [selected, setSelected] = useState<string | null>(null)

  // Seeded from the server render so the chart is drawn on first paint, then refreshed from the
  // route. The page renders once while the watcher samples every minute, so without the poll the
  // chart froze at page load, and a first visit landing before any sampling stayed empty for the
  // whole session however long it was left open.
  const [series, setSeries] = useState<VolumeSeries>({ aggregate, byPool })

  const [range, setRange] = useState<VolumeRange>(DEFAULT_RANGE)
  const [loading, setLoading] = useState(false)

  // Keyed on the pool set so a re-render with the same pools does not refetch, and on the range
  // so switching it does.
  const poolKey = useMemo(() => rows.map((row) => row.poolId).sort().join(','), [rows])

  useEffect(() => {
    if (rows.length === 0) return
    let current = true
    setLoading(true)

    void fetch('/api/volume/series', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        range,
        pools: rows.map(({ poolId, protocol, chainId }) => ({ poolId, protocol, chainId })),
      }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (!current) return
        const parsed = readVolumePayload(payload)
        // A failed load leaves the last good series drawn rather than blanking the chart.
        if (parsed !== null) setSeries(parsed)
      })
      .catch(() => undefined)
      .finally(() => current && setLoading(false))

    return () => {
      current = false
    }
    // poolKey stands in for rows, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey, range])

  const groups = useMemo(() => groupByStock(rows), [rows])

  // The overlay is the selected ticker's own volume, summed over its pools, so the line on the
  // chart and the row that produced it describe the same thing.
  const overlay = useMemo(() => {
    if (selected === null) return null
    const group = groups.find((entry) => entry.ticker === selected)
    if (group === undefined) return null

    const own: VolumeHistory = {}
    for (const pool of group.pools) {
      const buckets = series.byPool[pool.poolId.toLowerCase()]
      if (buckets) own[pool.poolId.toLowerCase()] = buckets
    }

    const summed = aggregateSeries(own)
    return summed.length > 0 ? summed : null
  }, [groups, selected, series.byPool])

  // Stated outright rather than left to be read off two axes, which is the thing a second scale
  // on one chart would get wrong.
  const share = shareOfTotal(series.aggregate, overlay)
  const sharePercent = share === null ? null : share < 1 ? share.toFixed(2) : share.toFixed(1)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        {VOLUME_RANGES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setRange(entry.id)}
            aria-pressed={range === entry.id}
            className={`border px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
              range === entry.id
                ? 'border-line-strong text-ink'
                : 'border-line text-ink-ghost hover:text-ink'
            }`}
          >
            {entry.label}
          </button>
        ))}
        {loading ? (
          <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-ink-ghost">
            reading
          </span>
        ) : null}
      </div>

      <StockVolumeChart
        aggregate={series.aggregate}
        selected={overlay}
        selectedLabel={selected}
        range={range}
      />

      {overlay !== null && selected !== null ? (
        <div>
          <StockVolumeChart
            aggregate={overlay}
            selected={null}
            selectedLabel={null}
            aggregateLabel={selected}
            range={range}
            compact
          />
          <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-ink-ghost">
            {selected} on its own scale, because it is {sharePercent === null ? 'a fraction of' : `${sharePercent}% of`}{' '}
            total stock volume over these hours and would otherwise be a sliver on the axis above.
          </p>
        </div>
      ) : null}

      <StockTable
        groups={groups}
        byPool={series.byPool}
        expanded={selected}
        onExpand={setSelected}
      />
    </div>
  )
}
