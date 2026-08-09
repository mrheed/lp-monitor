import { describe, expect, it } from 'vitest'
import { buildChangeReport, changeTableLines, type PoolMetrics } from './poolChanges'

const metrics = (
  fees: number,
  tx: number | null,
  volume: number | null,
  tvl = 50_000,
): PoolMetrics => ({
  tvlUsd: tvl,
  feesPerHourUsd: fees,
  txPerHour: tx,
  volumeUsdPerHour: volume,
})

/** Builds the single-row report that a direction assertion reads. */
const rowsFrom = (before: PoolMetrics, after: PoolMetrics) =>
  buildChangeReport(new Map([['0xa', before]]), [
    {
      poolId: '0xa',
      pair: 'ETH/USDG',
      metrics: after,
      openHolders: [],
      krystalUrl: 'https://defi.krystal.app/pools/detail?poolAddress=0xa',
    },
  ])

const dataRow = (before: PoolMetrics, after: PoolMetrics, decorate?: Parameters<typeof changeTableLines>[1]) =>
  changeTableLines(rowsFrom(before, after), decorate)[1]

describe('direction', () => {
  it('marks a rise with an up arrow', () => {
    expect(dataRow(metrics(100, 5, 900), metrics(400, 5, 900))).toContain('100↑400')
  })

  it('marks a fall with a down arrow', () => {
    expect(dataRow(metrics(400, 5, 900), metrics(100, 5, 900))).toContain('400↓100')
  })

  it('marks no movement with a plain arrow', () => {
    expect(dataRow(metrics(100, 5, 900), metrics(100, 5, 900))).toContain('100→100')
  })

  it('reads direction from the rendered value, not the raw one', () => {
    // 2600 and 2600.4 both render as 2.6k, so as far as a reader is concerned nothing moved.
    const line = dataRow(metrics(2_600, 5, 900), metrics(2_600.4, 5, 900))

    expect(line).toContain('2.6k→2.6k')
    expect(line).not.toContain('↑')
  })

  it('compares across magnitude suffixes rather than by digits', () => {
    // 900 to 1.2k is a rise, though "900" sorts above "1.2" as text.
    expect(dataRow(metrics(100, 5, 900), metrics(100, 5, 1_200))).toContain('900↑1.2k')
  })

  it('shows only the current value when there is nothing to compare against', () => {
    const line = changeTableLines(
      buildChangeReport(new Map(), [
        {
          poolId: '0xa',
          pair: 'ETH/USDG',
          metrics: metrics(100, 5, 900),
          openHolders: [],
          krystalUrl: '',
        },
      ]),
    )[1]

    expect(line).not.toContain('↑')
    expect(line).not.toContain('→')
  })
})

describe('decoration', () => {
  it('lets a caller style each cell by direction', () => {
    const line = dataRow(metrics(100, 5, 900), metrics(400, 5, 900), (text, direction) =>
      direction === 'up' ? `<${text}>` : text,
    )

    expect(line).toContain('<100↑400>')
  })

  it('keeps columns aligned when a decorator adds invisible characters', () => {
    // Padding measures visible width. Counting escape codes would shorten each cell by the
    // length of its sequence and break every column to its right.
    const green = (text: string) => `[32m${text}[0m`

    const plain = dataRow(metrics(100, 5, 900), metrics(400, 5, 900))
    const coloured = dataRow(metrics(100, 5, 900), metrics(400, 5, 900), green)

    expect(coloured.replace(/\[[0-9;]*m/g, '')).toBe(plain)
  })

  it('leaves the table untouched when no decorator is given', () => {
    expect(dataRow(metrics(100, 5, 900), metrics(400, 5, 900))).not.toContain('')
  })
})
