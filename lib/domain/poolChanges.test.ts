import { describe, expect, it } from 'vitest'
import {
  buildChangeReport,
  changeLinkLines,
  changeTableLines,
  formatChangeReport,
  hasMaterialChange,
  REPORT_LIMIT,
  reportSignature,
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

const pool = (poolId: string, pair: string, m: PoolMetrics, openHolders: string[] = []) => ({
  poolId,
  pair,
  metrics: m,
  openHolders,
  krystalUrl: `https://defi.krystal.app/pools/detail?poolAddress=${poolId}`,
})

describe('buildChangeReport', () => {
  it('lists every monitored pool, moved or not', () => {
    // The report answers "what are my pools doing", so a steady pool is a result too.
    const previous = new Map([['0xa', metrics(100, 10, 500)]])
    const rows = buildChangeReport(previous, [pool('0xa', 'ETH/USDG', metrics(100, 10, 500))])

    expect(rows).toHaveLength(1)
    expect(rows[0].before).toEqual(metrics(100, 10, 500))
  })

  it('pairs each pool with the state it was last reported in', () => {
    const previous = new Map([['0xa', metrics(100, 10, 500)]])
    const rows = buildChangeReport(previous, [pool('0xa', 'ETH/USDG', metrics(250, 30, 900))])

    expect(rows[0].before?.feesPerHourUsd).toBe(100)
    expect(rows[0].after.feesPerHourUsd).toBe(250)
  })

  it('matches ids case insensitively', () => {
    const previous = new Map([['0xabc', metrics(100, 10, 500)]])
    const rows = buildChangeReport(previous, [pool('0xABC', 'ETH/USDG', metrics(150, 10, 500))])

    expect(rows[0].before).not.toBeNull()
  })

  it('reports a pool with no previous state as having none', () => {
    const rows = buildChangeReport(new Map(), [pool('0xa', 'ETH/USDG', metrics(100, 10, 500))])

    expect(rows[0].before).toBeNull()
  })

  it('orders by how much the fee rate moved', () => {
    const previous = new Map([
      ['0xa', metrics(100, 10, 500)],
      ['0xb', metrics(100, 10, 500)],
    ])
    const rows = buildChangeReport(previous, [
      pool('0xa', 'STEADY/USDG', metrics(105, 10, 500)),
      pool('0xb', 'MOVER/USDG', metrics(400, 10, 500)),
    ])

    expect(rows[0].pair).toBe('MOVER/USDG')
  })

  it('puts a pool with no previous state first', () => {
    const previous = new Map([['0xa', metrics(100, 10, 500)]])
    const rows = buildChangeReport(previous, [
      pool('0xa', 'KNOWN/USDG', metrics(400, 10, 500)),
      pool('0xb', 'NEW/USDG', metrics(100, 10, 500)),
    ])

    expect(rows[0].pair).toBe('NEW/USDG')
  })

  it('does not divide by a previous rate of zero', () => {
    const previous = new Map([['0xa', metrics(0, 0, 0)]])
    const rows = buildChangeReport(previous, [pool('0xa', 'ETH/USDG', metrics(500, 10, 500))])

    expect(rows).toHaveLength(1)
    expect(Number.isNaN(rows[0].after.feesPerHourUsd)).toBe(false)
  })
})

describe('formatChangeReport', () => {
  const rows = buildChangeReport(new Map([['0xa', metrics(2_600, 1_400, 102_000)]]), [
    pool('0xa', 'ETH/USDG', metrics(4_100, 2_900, 210_000)),
  ])

  it('shows the previous and current value for each figure', () => {
    const message = formatChangeReport(rows)

    // The separator carries direction: a rise reads with an up arrow, not a plain one.
    expect(message).toContain('2.6k↑4.1k')
    expect(message).toContain('1.4k↑2.9k')
    expect(message).toContain('102.0k↑210.0k')
  })

  it('renders as a preformatted block so the figures line up', () => {
    // The message stacks each pool rather than tabulating them, because it is read on a phone.
    expect(formatChangeReport(rows)).toContain('<pre>')
    expect(formatChangeReport(rows)).toContain('  fees  ')
  })

  it('shows only the current value when there is nothing to compare against', () => {
    const fresh = buildChangeReport(new Map(), [pool('0xa', 'ETH/USDG', metrics(100, 5, 900))])

    expect(formatChangeReport(fresh)).not.toContain('→')
  })

  it('marks an unmeasured figure rather than showing it as zero', () => {
    const fresh = buildChangeReport(new Map(), [pool('0xa', 'ETH/USDG', metrics(100, null, null))])

    expect(formatChangeReport(fresh)).toContain('-')
  })

  it('caps the table and says how many were left out', () => {
    const many = Array.from({ length: REPORT_LIMIT + 5 }, (_, i) =>
      pool(`0x${i}`, `P${i}/USDG`, metrics(100, 10, 500)),
    )
    const message = formatChangeReport(buildChangeReport(new Map(), many))

    expect(message).toContain('…and 5 more not shown')
  })

  it('leads with the mentions', () => {
    expect(formatChangeReport(rows, ['@someone_here']).split('\n')[0]).toBe('@someone_here')
  })

  it('returns nothing when no pool is monitored', () => {
    expect(formatChangeReport([])).toBe('')
  })

  it('escapes a pair name so a token symbol cannot break the message', () => {
    const hostile = buildChangeReport(new Map(), [pool('0xa', '<b>X</b>/USDG', metrics(1, 1, 1))])

    expect(formatChangeReport(hostile)).toContain('&lt;b&gt;')
  })
})

describe('reportSignature', () => {
  const watched = [{ poolId: '0xa', metrics: metrics(2_600, 1_400, 102_000) }]

  it('is unchanged by movement too small to render', () => {
    // A fee rate drifts on every poll. Comparing raw numbers would alert every minute about a
    // difference nobody can see, which is the failure this exists to prevent.
    const drifted = [{ poolId: '0xa', metrics: metrics(2_600.4, 1_400.2, 102_000.9) }]

    expect(reportSignature(drifted)).toBe(reportSignature(watched))
  })

  it('changes when a displayed figure moves', () => {
    const moved = [{ poolId: '0xa', metrics: metrics(4_100, 1_400, 102_000) }]

    expect(reportSignature(moved)).not.toBe(reportSignature(watched))
  })

  it('changes when a measurement is lost', () => {
    const lost = [{ poolId: '0xa', metrics: metrics(2_600, null, 102_000) }]

    expect(reportSignature(lost)).not.toBe(reportSignature(watched))
  })

  it('changes when a pool joins the watchlist', () => {
    const added = [...watched, { poolId: '0xb', metrics: metrics(10, 1, 20) }]

    expect(reportSignature(added)).not.toBe(reportSignature(watched))
  })

  it('does not depend on the order pools arrive in', () => {
    const a = { poolId: '0xa', metrics: metrics(1, 1, 1) }
    const b = { poolId: '0xb', metrics: metrics(2, 2, 2) }

    expect(reportSignature([a, b])).toBe(reportSignature([b, a]))
  })

  it('ignores the case of a pool id', () => {
    expect(reportSignature([{ poolId: '0xABC', metrics: metrics(1, 1, 1) }])).toBe(
      reportSignature([{ poolId: '0xabc', metrics: metrics(1, 1, 1) }]),
    )
  })
})

describe('hasMaterialChange', () => {
  const previous = new Map([['0xa', metrics(1_000, 100, 10_000)]])
  const rowsFor = (m: PoolMetrics) => buildChangeReport(previous, [pool('0xa', 'ETH/USDG', m)])

  it('ignores drift below the threshold', () => {
    // A few percent between polls is the normal state of a live pool, not news.
    expect(hasMaterialChange(rowsFor(metrics(1_030, 102, 10_200)), 0.1)).toBe(false)
  })

  it('fires once a figure moves past it', () => {
    expect(hasMaterialChange(rowsFor(metrics(1_200, 100, 10_000)), 0.1)).toBe(true)
  })

  it('fires on any one of the three figures', () => {
    expect(hasMaterialChange(rowsFor(metrics(1_000, 100, 14_000)), 0.1)).toBe(true)
    expect(hasMaterialChange(rowsFor(metrics(1_000, 140, 10_000)), 0.1)).toBe(true)
  })

  it('treats a measurement appearing or disappearing as material', () => {
    expect(hasMaterialChange(rowsFor(metrics(1_000, null, 10_000)), 0.5)).toBe(true)
  })

  it('treats a pool new to the watchlist as material', () => {
    const fresh = buildChangeReport(new Map(), [pool('0xz', 'NEW/USDG', metrics(1, 1, 1))])

    expect(hasMaterialChange(fresh, 0.9)).toBe(true)
  })

  it('does not divide by a previous value of zero', () => {
    const fromZero = buildChangeReport(new Map([['0xa', metrics(0, 0, 0)]]), [
      pool('0xa', 'ETH/USDG', metrics(0, 0, 0)),
    ])

    expect(hasMaterialChange(fromZero, 0.1)).toBe(false)
  })

  it('fires when a figure rises from zero', () => {
    const fromZero = buildChangeReport(new Map([['0xa', metrics(0, 0, 0)]]), [
      pool('0xa', 'ETH/USDG', metrics(500, 0, 0)),
    ])

    expect(hasMaterialChange(fromZero, 0.1)).toBe(true)
  })

  it('fires on everything when the threshold is zero', () => {
    expect(hasMaterialChange(rowsFor(metrics(1_001, 100, 10_000)), 0)).toBe(true)
  })
})

describe('pool identity and holders in the table', () => {
  const rows = buildChangeReport(new Map(), [
    pool('0x205e1ed5aa', 'ETH/USDG', metrics(100, 5, 900), ['Me', 'Whale1']),
    pool('0xa53aed8ebb', 'ETH/USDG', metrics(200, 6, 800)),
  ])

  it('distinguishes two watched pools that share a pair', () => {
    // ETH/USDG spans sixteen pools on this chain, so the pair alone identifies nothing.
    const lines = changeTableLines(rows)

    expect(lines.join('\n')).toContain('205e1e')
    expect(lines.join('\n')).toContain('a53aed')
  })

  it('names the wallets currently holding a pool', () => {
    expect(changeTableLines(rows).join('\n')).toContain('Me, Whale1')
  })

  it('marks a pool nobody holds rather than leaving the column blank', () => {
    const lines = changeTableLines(rows)

    expect(lines[2].trimEnd().endsWith('-')).toBe(true)
  })

  it('lists a link per pool for placing beneath the table', () => {
    const links = changeLinkLines(rows)

    expect(links).toHaveLength(2)
    expect(links[0].url).toContain('defi.krystal.app')
    expect(links[0].label).toContain('ETH/USDG')
  })

  it('puts the links outside the preformatted block, where they can be clicked', () => {
    const message = formatChangeReport(rows)
    const table = message.slice(message.indexOf('<pre>'), message.indexOf('</pre>'))

    expect(table).not.toContain('<a href')
    expect(message).toContain('<a href="https://defi.krystal.app')
  })
})

describe('tvl in the report', () => {
  it('shows the depth alongside what it earned', () => {
    const rows = buildChangeReport(new Map([['0xa', metrics(100, 5, 900, 400_000)]]), [
      pool('0xa', 'ETH/USDG', metrics(100, 5, 900, 610_000)),
    ])

    expect(changeTableLines(rows).join('\n')).toContain('400.0k↑610.0k')
  })

  it('counts a move in depth as material on its own', () => {
    // Liquidity leaving is worth knowing about even when the fee rate has not caught up yet.
    const rows = buildChangeReport(new Map([['0xa', metrics(100, 5, 900, 400_000)]]), [
      pool('0xa', 'ETH/USDG', metrics(100, 5, 900, 200_000)),
    ])

    expect(hasMaterialChange(rows, 0.1)).toBe(true)
  })

  it('folds depth into the signature, so a change in it is not silently dropped', () => {
    const before = [{ poolId: '0xa', metrics: metrics(100, 5, 900, 400_000) }]
    const after = [{ poolId: '0xa', metrics: metrics(100, 5, 900, 800_000) }]

    expect(reportSignature(after)).not.toBe(reportSignature(before))
  })
})
