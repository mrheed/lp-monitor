import { describe, expect, it } from 'vitest'
import {
  changeBlockLines,
  changeTableLines,
  formatChangeReport,
  SAMPLED_MARK,
  type ChangeRow,
} from './poolChanges'

const row = (): ChangeRow => ({
  poolId: '0xabcdef1234',
  pair: 'ETH/USDG',
  before: { tvlUsd: 1_000, feesPerHourUsd: 10, txPerHour: 30, volumeUsdPerHour: 5_000 },
  after: { tvlUsd: 1_200, feesPerHourUsd: 15, txPerHour: 45, volumeUsdPerHour: 7_000 },
  openHolders: [],
  krystalUrl: 'https://defi.krystal.app/pools/detail?poolAddress=0xabcdef1234',
})

/*
 * Two of the four figures in a report are reported by the pool feed and two are extrapolated
 * from a sample of about 25 trades, whose span is often under two minutes. They sit in adjacent
 * rows of the same block, so without a mark a reader has no way to tell that one pair carries
 * far more uncertainty than the other.
 */
describe('the monitored pool report', () => {
  it('marks the sampled figures', () => {
    const lines = changeBlockLines([row()])

    expect(lines.some((line) => line.includes(`tx${SAMPLED_MARK}`))).toBe(true)
    expect(lines.some((line) => line.includes(`vol${SAMPLED_MARK}`))).toBe(true)
  })

  it('leaves the reported figures unmarked', () => {
    const lines = changeBlockLines([row()])

    const tvl = lines.find((line) => line.includes('tvl'))
    const fees = lines.find((line) => line.includes('fees'))

    expect(tvl).not.toContain(SAMPLED_MARK)
    expect(fees).not.toContain(SAMPLED_MARK)
  })

  it('keeps every label the same width, so the values stay in a column', () => {
    // The block is read inside a <pre>, where alignment is the only thing separating label from
    // value. A mark that lengthened one label would step that row out of line.
    const valueStarts = changeBlockLines([row()])
      .filter((line) => line.startsWith('  '))
      .map((line) => line.match(/^ {2}\S+ +/)?.[0].length)

    expect(valueStarts.length).toBeGreaterThan(1)
    expect(new Set(valueStarts).size).toBe(1)
  })

  it('explains the mark once, in the message rather than in every row', () => {
    const message = formatChangeReport([row()])

    expect(message).toContain(SAMPLED_MARK)
    expect(message.toLowerCase()).toContain('sampled')
  })

  it('marks the sampled columns in the terminal table too', () => {
    const [header] = changeTableLines([row()])

    expect(header).toContain(`TX/H${SAMPLED_MARK}`)
    expect(header).toContain(`VOL/H${SAMPLED_MARK}`)
    expect(header).not.toContain(`TVL${SAMPLED_MARK}`)
  })
})
