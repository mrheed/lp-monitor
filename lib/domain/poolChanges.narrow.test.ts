import { describe, expect, it } from 'vitest'
import {
  buildChangeReport,
  changeBlockLines,
  formatChangeReport,
  type PoolMetrics,
} from './poolChanges'

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

const input = (poolId: string, pair: string, m: PoolMetrics, openHolders: string[] = []) => ({
  poolId,
  pair,
  metrics: m,
  openHolders,
  krystalUrl: `https://defi.krystal.app/pools/detail?poolAddress=${poolId}`,
})

/** The widest figures a real pool produces, to size the layout against the worst case. */
const wide = buildChangeReport(
  // Keyed by the pool's own id, otherwise there is no previous state to compare against.
  new Map([['0x30dac7167c', metrics(617_000, 8_200, 34_700_000, 1_600_000)]]),
  [input('0x30dac7167c', 'CASHHIPPO/WETH', metrics(5_300, 1_100, 2_900_000, 1_600_000), [
    'Whale3',
    'Me',
  ])],
)

describe('changeBlockLines', () => {
  it('stacks each figure on its own line', () => {
    const lines = changeBlockLines(wide)

    expect(lines.some((line) => line.startsWith('  tvl'))).toBe(true)
    expect(lines.some((line) => line.startsWith('  fees'))).toBe(true)
    expect(lines.some((line) => line.startsWith('  tx'))).toBe(true)
    expect(lines.some((line) => line.startsWith('  vol'))).toBe(true)
  })

  it('fits a phone, where the wide table wraps and loses its columns', () => {
    // Telegram shows roughly 30 characters of a preformatted block on a narrow phone. The
    // holders line is prose and may wrap harmlessly, so it is measured separately.
    const figures = changeBlockLines(wide).filter((line) => !line.startsWith('  held'))
    const widest = Math.max(...figures.map((line) => line.length))

    expect(widest).toBeLessThanOrEqual(30)
  })

  it('names the pool so two rows of the same pair are distinguishable', () => {
    expect(changeBlockLines(wide)[0]).toContain('30dac7')
  })

  it('names who holds it, and omits the line when nobody does', () => {
    expect(changeBlockLines(wide).some((line) => line.includes('Whale3, Me'))).toBe(true)

    const unheld = buildChangeReport(new Map(), [input('0xb', 'ETH/USDG', metrics(1, 1, 1))])
    expect(changeBlockLines(unheld).some((line) => line.startsWith('  held'))).toBe(false)
  })

  it('carries the same direction arrows the table uses', () => {
    const lines = changeBlockLines(wide).join('\n')

    expect(lines).toContain('↓')
  })

  it('shows only the current value when there is nothing to compare against', () => {
    const fresh = buildChangeReport(new Map(), [input('0xb', 'ETH/USDG', metrics(100, 5, 900))])

    expect(changeBlockLines(fresh).join('\n')).not.toContain('→')
  })
})

describe('the message uses the narrow layout', () => {
  it('sends stacked blocks rather than the wide table', () => {
    const message = formatChangeReport(wide)

    expect(message).toContain('  fees  ')
    expect(message).not.toContain('FEES/H')
  })

  it('keeps every preformatted line inside a phone width', () => {
    const message = formatChangeReport(wide)
    const block = message.slice(message.indexOf('<pre>') + 5, message.indexOf('</pre>'))
    const figures = block.split('\n').filter((line) => !line.startsWith('  held'))

    expect(Math.max(...figures.map((line) => line.length))).toBeLessThanOrEqual(30)
  })
})
