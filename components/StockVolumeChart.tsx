'use client'

import { useMemo } from 'react'
import type { VolumeBucket } from '@/lib/domain/volumeHistory'

const WIDTH = 960
const HEIGHT = 200

/**
 * Turns buckets into SVG polyline points.
 *
 * Exported so the scaling can be tested without rendering. The y axis is inverted because SVG
 * measures downward, so the busiest hour lands at zero.
 */
export const chartGeometry = (
  buckets: VolumeBucket[],
  width: number,
  height: number,
): { points: string; max: number } => {
  if (buckets.length === 0) return { points: '', max: 0 }

  const max = Math.max(...buckets.map((bucket) => bucket.volumeUsd))
  const step = buckets.length > 1 ? width / (buckets.length - 1) : 0

  const points = buckets
    .map((bucket, index) => {
      const y = max > 0 ? height - (bucket.volumeUsd / max) * height : height
      return `${Math.round(index * step)},${Math.round(y)}`
    })
    .join(' ')

  return { points, max }
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
  const overlay = useMemo(
    () => (selected ? chartGeometry(selected, WIDTH, HEIGHT) : null),
    [selected],
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

  const step = aggregate.length > 1 ? WIDTH / (aggregate.length - 1) : 0

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
            x={Math.round(index * step - step / 2)}
            y={0}
            width={Math.max(Math.round(step), 1)}
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
