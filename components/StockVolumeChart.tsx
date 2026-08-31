'use client'

import { useMemo } from 'react'
import { HOUR_MS, type VolumeBucket } from '@/lib/domain/volumeHistory'

const WIDTH = 960
const HEIGHT = 200

/** The stretch of time an x axis covers, so two series can be drawn on the same one. */
export type TimeSpan = { fromMs: number; toMs: number }

/**
 * Turns buckets into SVG polyline points, plus the x positions they were drawn at.
 *
 * Exported so the scaling can be tested without rendering. The y axis is inverted because SVG
 * measures downward, so the busiest hour lands at zero.
 *
 * X is the bucket's hour against the span, not its position in the array. Plotted by index, an
 * hour nobody sampled was closed up and the chart claimed continuous trading across a gap.
 *
 * `span` is what lets an overlay share the aggregate's axis; drawn on its own range instead, a
 * pool holding three hours of history would stretch across two days of chart.
 */
export const chartGeometry = (
  buckets: VolumeBucket[],
  width: number,
  height: number,
  span?: TimeSpan,
): { points: string; max: number; xs: number[]; hourWidth: number } => {
  if (buckets.length === 0) return { points: '', max: 0, xs: [], hourWidth: 0 }

  const hours = buckets.map((bucket) => bucket.hourEndMs)
  const fromMs = span?.fromMs ?? Math.min(...hours)
  const rangeMs = (span?.toMs ?? Math.max(...hours)) - fromMs

  const max = Math.max(...buckets.map((bucket) => bucket.volumeUsd))
  const xs = buckets.map((bucket) =>
    rangeMs > 0 ? ((bucket.hourEndMs - fromMs) / rangeMs) * width : 0,
  )

  const points = buckets
    .map((bucket, index) => {
      const y = max > 0 ? height - (bucket.volumeUsd / max) * height : height
      return `${Math.round(xs[index])},${Math.round(y)}`
    })
    .join(' ')

  // A single bucket has no time span to base the calculation on, so assume it represents one hour
  // and scale to a sensible fraction of the chart width. Multi-bucket spans use the actual time range.
  const hourWidth =
    rangeMs > 0 ? (HOUR_MS / rangeMs) * width : Math.max(Math.round(width / 20), 1)
  return { points, max, xs, hourWidth }
}

/** Hour label in US Eastern, where the underlying equities trade. */
const easternHour = (ms: number) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).format(new Date(ms))

/** Whether an hour falls inside the US cash session, used only to shade the background. */
const inSession = (ms: number) => {
  const hour = Number(easternHour(ms))
  return hour >= 9 && hour < 16
}

/** Format a volume value as a short money string. */
const money = (value: number) =>
  value >= 1_000_000
    ? `$${(value / 1_000_000).toFixed(1)}M`
    : `$${Math.round(value / 1000).toLocaleString()}k`

type Props = {
  aggregate: VolumeBucket[]
  selected: VolumeBucket[] | null
  selectedLabel: string | null
}

/**
 * Hourly volume across stock pools, with the US cash session shaded.
 *
 * The shading is orientation for someone holding a tokenized equity, not an explanation. Measured
 * over seven days, stock pools put 41% of weekday volume inside the session against 52% for a
 * memecoin control, so the session does not account for when these pools trade.
 */
export const StockVolumeChart = ({ aggregate, selected, selectedLabel }: Props) => {
  const total = useMemo(() => chartGeometry(aggregate, WIDTH, HEIGHT), [aggregate])

  // The aggregate owns the axis. An overlay drawn on its own hours would put the same clock time
  // in a different place on each line, which is the one thing the overlay exists to compare.
  const span = useMemo(
    () =>
      aggregate.length > 0
        ? { fromMs: aggregate[0].hourEndMs, toMs: aggregate[aggregate.length - 1].hourEndMs }
        : null,
    [aggregate],
  )

  const overlay = useMemo(
    () => (selected && span ? chartGeometry(selected, WIDTH, HEIGHT, span) : null),
    [selected, span],
  )

  if (aggregate.length === 0) {
    return (
      <div className="rounded border border-line px-4 py-8 text-center text-xs text-ink-ghost">
        No volume history yet. It fills in as the watcher samples.
      </div>
    )
  }

  const sessions = aggregate
    .map((bucket, index) => ({ bucket, index }))
    .filter(({ bucket }) => inSession(bucket.hourEndMs))

  return (
    <figure className="rounded border border-line bg-surface px-4 py-3">
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-3 text-[11px] uppercase tracking-[0.12em] text-ink-muted">
        <span className="text-ink">Stock pool volume per hour</span>
        <span>peak {money(total.max)}</span>
        {selectedLabel ? <span className="text-accent">{selectedLabel}</span> : null}
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-48 w-full"
        role="img"
        aria-label={`Hourly volume across stock pools, peaking at ${money(total.max)}`}
      >
        {sessions.map(({ index }) => (
          <rect
            key={index}
            x={Math.round(total.xs[index] - total.hourWidth / 2)}
            y={0}
            width={Math.max(Math.round(total.hourWidth), 1)}
            height={HEIGHT}
            fill="var(--accent)"
            opacity={0.06}
          />
        ))}

        <polyline points={total.points} fill="none" stroke="var(--ink-muted)" strokeWidth={1.5} />

        {overlay ? (
          <polyline points={overlay.points} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        ) : null}
      </svg>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-ghost">
        Shaded columns mark the US cash session, 09:30 to 16:00 Eastern. Shown for orientation;
        these pools trade around the clock and the session does not explain their volume.
      </p>
    </figure>
  )
}
