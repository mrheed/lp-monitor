import { describe, expect, it } from 'vitest'
import { chartGeometry } from './StockVolumeChart'

const HOUR = 3_600_000
const bucket = (hourEndMs: number, volumeUsd: number) => ({
  hourEndMs,
  volumeUsd,
  swaps: 10,
  spanMs: HOUR,
})

describe('chartGeometry', () => {
  it('scales the tallest bucket to the full height', () => {
    const { points, max } = chartGeometry([bucket(HOUR, 0), bucket(2 * HOUR, 100)], 100, 50)

    expect(max).toBe(100)
    // Highest volume sits at y=0, lowest at the baseline.
    expect(points).toBe('0,50 100,0')
  })

  it('draws a flat line rather than dividing by zero when nothing traded', () => {
    const { points } = chartGeometry([bucket(HOUR, 0), bucket(2 * HOUR, 0)], 100, 50)

    expect(points).toBe('0,50 100,50')
  })

  it('yields no points for an empty series', () => {
    expect(chartGeometry([], 100, 50)).toEqual({ points: '', max: 0, xs: [], hourWidth: 0 })
  })

  it('places a single bucket at the left edge', () => {
    const { points } = chartGeometry([bucket(HOUR, 42)], 100, 50)

    expect(points).toBe('0,0')
  })

  it('spaces buckets by their hour, so an unsampled hour reads as a gap', () => {
    // Three buckets covering four hours. Plotted by index the missing hour would be closed up
    // and the chart would claim the pool traded continuously.
    const { xs } = chartGeometry(
      [bucket(HOUR, 10), bucket(2 * HOUR, 20), bucket(4 * HOUR, 30)],
      120,
      50,
    )

    expect(xs).toEqual([0, 40, 120])
  })

  it('draws on the span it is given, so an overlay shares the aggregate axis', () => {
    // A pool with one hour of history belongs at its own hour on the total's axis, not stretched
    // across the whole chart.
    const { xs } = chartGeometry([bucket(3 * HOUR, 10)], 100, 50, {
      fromMs: HOUR,
      toMs: 5 * HOUR,
    })

    expect(xs).toEqual([50])
  })

  it('reports how wide one hour is, so the session shading lines up with the plot', () => {
    const { hourWidth } = chartGeometry([bucket(HOUR, 10), bucket(5 * HOUR, 20)], 100, 50)

    expect(hourWidth).toBe(25)
  })
})
