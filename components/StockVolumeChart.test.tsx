import { describe, expect, it } from 'vitest'
import { chartBars, valueTicks } from './StockVolumeChart'

const HOUR = 3_600_000
const bucket = (hourEndMs: number, volumeUsd: number, spanMs = HOUR) => ({
  hourEndMs,
  volumeUsd,
  swaps: 10,
  spanMs,
})

describe('chartBars', () => {
  it('scales the tallest bar to the full plot height and anchors every bar to the baseline', () => {
    const { bars, max } = chartBars([bucket(HOUR, 50), bucket(2 * HOUR, 100)], 100, 50)

    expect(max).toBe(100)
    expect(bars).toHaveLength(2)
    expect(bars[1].height).toBe(50)
    expect(bars[1].y).toBe(0)
    // Half the value is half the height, and its foot still sits on the baseline.
    expect(bars[0].height).toBe(25)
    expect(bars[0].y + bars[0].height).toBe(50)
  })

  it('positions bars by time, so a missing hour leaves a gap rather than closing up', () => {
    const { bars } = chartBars([bucket(HOUR, 10), bucket(4 * HOUR, 10)], 300, 50)

    // Three hours apart across a three hour span: first at the left edge, second at the right.
    expect(bars[0].x).toBeLessThan(bars[1].x)
    expect(bars[1].x + bars[1].width).toBeLessThanOrEqual(300)
  })

  it('gives a single bucket a real width instead of the whole plot', () => {
    const { bars } = chartBars([bucket(HOUR, 42)], 300, 50)

    expect(bars).toHaveLength(1)
    expect(bars[0].width).toBeGreaterThan(0)
    expect(bars[0].width).toBeLessThan(300 / 2)
  })

  it('leaves a gap between neighbouring bars so they read as separate marks', () => {
    const { bars } = chartBars([bucket(HOUR, 10), bucket(2 * HOUR, 10), bucket(3 * HOUR, 10)], 300, 50)

    expect(bars[1].x).toBeGreaterThan(bars[0].x + bars[0].width)
  })

  it('draws a zero-volume hour as a visible baseline tick, not as nothing', () => {
    const { bars } = chartBars([bucket(HOUR, 0), bucket(2 * HOUR, 100)], 100, 50)

    expect(bars[0].height).toBeGreaterThan(0)
    expect(bars[0].y + bars[0].height).toBe(50)
  })

  it('keeps every bar on the baseline when nothing traded at all', () => {
    const { bars, max } = chartBars([bucket(HOUR, 0), bucket(2 * HOUR, 0)], 100, 50)

    expect(max).toBe(0)
    for (const bar of bars) expect(bar.y + bar.height).toBe(50)
  })

  it('yields nothing for an empty series', () => {
    expect(chartBars([], 100, 50)).toEqual({ bars: [], max: 0 })
  })

  it('scales against a supplied max, so an overlay shares the aggregate axis', () => {
    const { bars } = chartBars([bucket(HOUR, 25)], 100, 50, 100)

    // A quarter of the shared maximum, not the full height it would take on its own.
    expect(bars[0].height).toBe(12.5)
  })
})

describe('valueTicks', () => {
  it('returns rounded values covering the range', () => {
    const ticks = valueTicks(1000)

    expect(ticks.length).toBeGreaterThanOrEqual(2)
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(1000)
    expect(ticks[0]).toBe(0)
  })

  it('never divides by zero on an empty chart', () => {
    expect(valueTicks(0)).toEqual([0])
  })

  it('steps on a human interval rather than an arbitrary fraction', () => {
    const ticks = valueTicks(430_000)
    const step = ticks[1] - ticks[0]

    expect([1, 2, 2.5, 5].some((m) => Math.abs(step / 10 ** Math.floor(Math.log10(step)) - m) < 1e-9)).toBe(true)
  })
})
