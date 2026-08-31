'use client'

import { useMemo, useState } from 'react'
import { HOUR_MS, type VolumeBucket } from '@/lib/domain/volumeHistory'

const PLOT_HEIGHT = 200
const CHART_WIDTH = 960
/** Room on the right for the value scale, which sits there so the newest bars stay unobstructed. */
const SCALE_WIDTH = 62
const PLOT_WIDTH = CHART_WIDTH - SCALE_WIDTH
/** Surface showing between neighbouring bars, so a run of hours reads as separate marks. */
const BAR_GAP = 2
/** Headroom above the plot, so the top gridline's label is not clipped by the viewBox edge. */
const TOP_PAD = 9
/** A traded hour that rounds to nothing still gets this, so zero and unsampled look different. */
const MIN_BAR_HEIGHT = 1

/** One drawn bar and the hour it came from, so hover can report the values behind it. */
export type ChartBar = {
  x: number
  width: number
  y: number
  height: number
  bucket: VolumeBucket
}

/**
 * Bars laid out by time rather than by index.
 *
 * Positioning by `hourEndMs` means an hour with no sample leaves a gap where it belongs instead
 * of the series closing up and misdating everything after it.
 *
 * `scaleMax` lets a second series share the first's axis. Drawing a pool's own volume against its
 * own maximum would make a quiet pool look as busy as the whole chain.
 */
export const chartBars = (
  buckets: VolumeBucket[],
  width: number,
  height: number,
  scaleMax?: number,
): { bars: ChartBar[]; max: number } => {
  if (buckets.length === 0) return { bars: [], max: 0 }

  const max = scaleMax ?? Math.max(...buckets.map((bucket) => bucket.volumeUsd))
  const oldest = Math.min(...buckets.map((bucket) => bucket.hourEndMs))
  const newest = Math.max(...buckets.map((bucket) => bucket.hourEndMs))
  const rangeMs = newest - oldest

  // The plot is divided into one slot per hour the range covers, including the empty ones, and a
  // bar is placed in the slot its hour owns. Dividing by the range instead would size the slot
  // larger than the spacing between bars on a short series, and they would overlap.
  const slots = rangeMs > 0 ? rangeMs / HOUR_MS + 1 : 8
  const slot = width / slots
  const barWidth = Math.max(slot - BAR_GAP, 1)

  const bars = buckets.map((bucket) => {
    const centre = slot / 2 + ((bucket.hourEndMs - oldest) / HOUR_MS) * slot
    const scaled = max > 0 ? (bucket.volumeUsd / max) * height : 0
    const barHeight = Math.max(scaled, MIN_BAR_HEIGHT)

    return {
      x: centre - barWidth / 2,
      width: barWidth,
      y: height - barHeight,
      height: barHeight,
      bucket,
    }
  })

  return { bars, max }
}

/**
 * Gridline values from zero to just above the peak, stepping on 1, 2, 2.5 or 5 times a power of
 * ten. An axis that steps on 137,000 is arithmetically fine and unreadable.
 */
export const valueTicks = (max: number): number[] => {
  if (max <= 0) return [0]

  const rough = max / 4
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough) ?? magnitude * 10

  const ticks: number[] = []
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(value)
  return ticks
}

/** Compact USD, so the scale reads at a glance and the columns stay narrow. */
const money = (value: number): string => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`
  return `$${Math.round(value)}`
}

const easternParts = (ms: number, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', ...options }).format(new Date(ms))

/** Hour of the day in US Eastern, where the underlying equities trade. */
const easternHour = (ms: number): number => Number(easternParts(ms, { hour: 'numeric', hour12: false }))

/** Whether an hour falls inside the US cash session. Used only to shade the background. */
const inSession = (ms: number): boolean => {
  const hour = easternHour(ms)
  return hour >= 9 && hour < 16
}

type Props = {
  aggregate: VolumeBucket[]
  selected: VolumeBucket[] | null
  selectedLabel: string | null
}

/**
 * Hourly traded volume across the stock pools, with one pool's share drawn inside the total.
 *
 * The US cash session is shaded for orientation and nothing more. Measured over seven days, these
 * pools put 41% of weekday volume inside the session against 52% for a memecoin control, so the
 * session does not account for when they trade.
 */
export const StockVolumeChart = ({ aggregate, selected, selectedLabel }: Props) => {
  const [hovered, setHovered] = useState<number | null>(null)

  // Bars scale to the top gridline rather than to the tallest bar, so the axis ends on a labelled
  // value and the peak sits under a line instead of against the top edge with nothing to read it
  // against.
  const dataMax = useMemo(
    () => (aggregate.length > 0 ? Math.max(...aggregate.map((bucket) => bucket.volumeUsd)) : 0),
    [aggregate],
  )
  const ticks = useMemo(() => valueTicks(dataMax), [dataMax])
  const axisMax = ticks[ticks.length - 1]

  const total = useMemo(
    () => chartBars(aggregate, PLOT_WIDTH, PLOT_HEIGHT, axisMax),
    [aggregate, axisMax],
  )
  const overlay = useMemo(
    () => (selected ? chartBars(selected, PLOT_WIDTH, PLOT_HEIGHT, axisMax) : null),
    [selected, axisMax],
  )

  if (aggregate.length === 0) {
    return (
      <div className="rounded border border-line bg-surface px-4 py-10 text-center">
        <p className="text-[13px] text-ink-muted">No volume recorded yet</p>
        <p className="mt-1 text-[11px] text-ink-ghost">
          The watcher samples once a minute and backfills two days on first run.
        </p>
      </div>
    )
  }

  const active = hovered === null ? null : total.bars[hovered]
  const activeOverlay =
    active && overlay
      ? (overlay.bars.find((bar) => bar.bucket.hourEndMs === active.bucket.hourEndMs) ?? null)
      : null

  /** Nearest bar to the pointer, so the readout follows the cursor without needing a direct hit. */
  const trackPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * CHART_WIDTH
    if (x > PLOT_WIDTH) return setHovered(null)

    let nearest = 0
    let best = Infinity
    total.bars.forEach((bar, index) => {
      const distance = Math.abs(bar.x + bar.width / 2 - x)
      if (distance < best) {
        best = distance
        nearest = index
      }
    })
    setHovered(nearest)
  }

  return (
    <figure className="rounded border border-line bg-surface">
      <figcaption className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line px-4 py-2.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink">
          Volume per hour
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span aria-hidden className="h-2 w-2 rounded-[1px] bg-[var(--chart-total)]" />
          All stock pools
        </span>
        {selectedLabel ? (
          <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span aria-hidden className="h-2 w-2 rounded-[1px] bg-[var(--chart-pool)]" />
            {selectedLabel}
          </span>
        ) : null}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-ghost">
          peak {money(dataMax)}
        </span>
      </figcaption>

      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${PLOT_HEIGHT + TOP_PAD + 22}`}
          className="block h-56 w-full touch-none"
          role="img"
          aria-label={`Hourly volume across stock pools over ${aggregate.length} hours, peaking at ${money(dataMax)}`}
          onPointerMove={trackPointer}
          onPointerLeave={() => setHovered(null)}
        >
          <g transform={`translate(0,${TOP_PAD})`}>
          {/* Session shading sits behind the grid so it reads as ground, not as a mark. */}
          {total.bars.map((bar) =>
            inSession(bar.bucket.hourEndMs) ? (
              <rect
                key={`session-${bar.bucket.hourEndMs}`}
                x={bar.x - BAR_GAP / 2}
                y={0}
                width={bar.width + BAR_GAP}
                height={PLOT_HEIGHT}
                fill="var(--ink)"
                opacity={0.035}
              />
            ) : null,
          )}

          {ticks.map((value) => {
            const y = PLOT_HEIGHT - (axisMax > 0 ? (value / axisMax) * PLOT_HEIGHT : 0)
            return (
              <g key={value}>
                <line
                  x1={0}
                  x2={PLOT_WIDTH}
                  y1={y}
                  y2={y}
                  stroke="var(--line)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={PLOT_WIDTH + 8}
                  y={y + 3.5}
                  className="fill-[var(--ink-ghost)] font-mono text-[10px] tabular-nums"
                >
                  {money(value)}
                </text>
              </g>
            )
          })}

          {total.bars.map((bar, index) => (
            <rect
              key={bar.bucket.hourEndMs}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx={Math.min(2, bar.width / 2)}
              fill="var(--chart-total)"
              opacity={hovered === null || hovered === index ? 1 : 0.55}
            />
          ))}

          {/* The pool's own volume is part of the total, so it is drawn inside the same column. */}
          {overlay?.bars.map((bar) => (
            <rect
              key={`pool-${bar.bucket.hourEndMs}`}
              x={bar.x + bar.width / 4}
              y={bar.y}
              width={Math.max(bar.width / 2, 1)}
              height={bar.height}
              rx={Math.min(2, bar.width / 4)}
              fill="var(--chart-pool)"
            />
          ))}

          {active ? (
            <line
              x1={active.x + active.width / 2}
              x2={active.x + active.width / 2}
              y1={0}
              y2={PLOT_HEIGHT}
              stroke="var(--line-strong)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ) : null}

          {total.bars.map((bar, index) =>
            index % 6 === 0 ? (
              <text
                key={`tick-${bar.bucket.hourEndMs}`}
                x={bar.x + bar.width / 2}
                y={PLOT_HEIGHT + 15}
                textAnchor="middle"
                className="fill-[var(--ink-ghost)] font-mono text-[10px] tabular-nums"
              >
                {easternParts(bar.bucket.hourEndMs - HOUR_MS, { hour: '2-digit', hour12: false })}
              </text>
            ) : null,
          )}
          </g>
        </svg>

        {active ? (
          <div
            className="pointer-events-none absolute top-2 rounded border border-line-strong bg-surface-raised px-2.5 py-2 shadow-[var(--shadow-hover)]"
            style={{
              left: `${((active.x + active.width / 2) / CHART_WIDTH) * 100}%`,
              transform: 'translateX(-50%)',
            }}
          >
            <p className="whitespace-nowrap font-mono text-[10px] tabular-nums text-ink-ghost">
              {easternParts(active.bucket.hourEndMs - HOUR_MS, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                hour12: false,
              })}
              :00 ET
            </p>
            <p className="mt-1 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-ink">
              <span aria-hidden className="h-2 w-2 rounded-[1px] bg-[var(--chart-total)]" />
              <span className="font-mono tabular-nums">{money(active.bucket.volumeUsd)}</span>
              <span className="text-ink-ghost">all pools</span>
            </p>
            {activeOverlay ? (
              <p className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[11px] text-ink">
                <span aria-hidden className="h-2 w-2 rounded-[1px] bg-[var(--chart-pool)]" />
                <span className="font-mono tabular-nums">{money(activeOverlay.bucket.volumeUsd)}</span>
                <span className="text-ink-ghost">{selectedLabel}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <p className="border-t border-line px-4 py-2 text-[11px] leading-relaxed text-ink-ghost">
        Hours run in US Eastern; shaded columns are the 09:30 to 16:00 cash session. Shown for
        orientation, not explanation: these pools trade around the clock.
      </p>
    </figure>
  )
}
