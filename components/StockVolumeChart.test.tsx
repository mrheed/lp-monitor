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
    expect(chartGeometry([], 100, 50)).toEqual({ points: '', max: 0 })
  })

  it('places a single bucket at the left edge', () => {
    const { points } = chartGeometry([bucket(HOUR, 42)], 100, 50)

    expect(points).toBe('0,0')
  })
})
