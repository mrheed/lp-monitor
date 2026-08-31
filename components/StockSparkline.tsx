'use client'

import { hourlyReadings, type VolumeBucket } from '@/lib/domain/volumeHistory'
import { chartBars } from './StockVolumeChart'

const WIDTH = 96
const HEIGHT = 22

type Props = {
  buckets: VolumeBucket[] | undefined
  /** Highlighted when its row is the one driving the chart above. */
  active: boolean
}

/**
 * One pool's recent volume, small enough to sit in a table cell.
 *
 * Shares `chartBars` with the full chart so a row and the chart above it cannot disagree about
 * where an hour sits, and filters through `hourlyReadings` for the same reason the aggregate
 * does: a sample spanning more than an hour cannot say which hour its volume belonged to.
 *
 * Each row scales to its own maximum. These are shape, not magnitude; the numeric columns beside
 * them carry the magnitude, and scaling every row to the busiest pool would flatten most of them
 * into an empty strip.
 */
export const StockSparkline = ({ buckets, active }: Props) => {
  const readings = buckets ? hourlyReadings(buckets) : []

  if (readings.length < 2) {
    return (
      <span className="text-[10px] text-ink-ghost" title="No sampled history for this pool yet">
        not sampled
      </span>
    )
  }

  const { bars } = chartBars(readings, WIDTH, HEIGHT)

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      className="block"
      role="img"
      aria-label={`Volume over the last ${readings.length} sampled hours`}
    >
      {bars.map((bar) => (
        <rect
          key={bar.bucket.hourEndMs}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          fill={active ? 'var(--chart-pool)' : 'var(--chart-total)'}
          opacity={active ? 1 : 0.75}
        />
      ))}
    </svg>
  )
}
