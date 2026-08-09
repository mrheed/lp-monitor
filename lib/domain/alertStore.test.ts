import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, interpretAlertState, toRecord } from './alertStore'

describe('toRecord', () => {
  const pools = [
    { pair: 'ETH/USDG', poolId: '0xAAA' },
    { pair: 'WETH/PONS', poolId: '0xBBB' },
  ]

  it('records what was announced and when', () => {
    const record = toRecord(pools, ['@someone_here'], { status: 'sent' })

    expect(record.status).toBe('sent')
    expect(record.poolCount).toBe(2)
    expect(record.pairs).toEqual(['ETH/USDG', 'WETH/PONS'])
    expect(record.mentions).toEqual(['@someone_here'])
    expect(record.at).toBeGreaterThan(0)
  })

  it('records pool ids, so what was announced survives a change of message format', () => {
    const record = toRecord(pools, [], { status: 'sent' })

    expect(record.poolIds).toEqual(['0xaaa', '0xbbb'])
  })

  it('defaults to the new-pool alert, and can name the change report', () => {
    expect(toRecord(pools, [], { status: 'sent' }).kind).toBe('new-pool')
    expect(toRecord(pools, [], { status: 'sent' }, 'change').kind).toBe('change')
  })

  it('records a failure with its reason, so silence and breakage look different', () => {
    const record = toRecord(pools, [], { status: 'failed', error: 'HTTP 401' })

    expect(record.status).toBe('failed')
    expect(record.error).toBe('HTTP 401')
  })

  it('keeps the full count while naming only the first few pairs', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ pair: `P${i}/USDG`, poolId: `0x${i}` }))
    const record = toRecord(many, [], { status: 'sent' })

    expect(record.poolCount).toBe(30)
    expect(record.pairs).toHaveLength(8)
    // Ids are not truncated: they are the record of what was announced, not display text.
    expect(record.poolIds).toHaveLength(30)
  })

  it('caps history at a size worth writing on every send', () => {
    expect(HISTORY_LIMIT).toBeLessThanOrEqual(100)
  })
})

describe('interpretAlertState', () => {
  it('ignores the old seeded list rather than treating it as announcements', () => {
    // An earlier file seeded `known` with everything present when watching began. Reading it as
    // an announcement record would mark hundreds of pools as told without anyone being told.
    expect(interpretAlertState({ known: ['0xseeded'], history: [] }).announced).toEqual([])
  })

  it('reads announced ids', () => {
    expect(interpretAlertState({ announced: ['0xabc', '0xdef'] }).announced).toEqual([
      '0xabc',
      '0xdef',
    ])
  })

  it('falls back to defaults for a missing or unreadable file', () => {
    expect(interpretAlertState(null).filters.enabled).toBe(false)
    expect(interpretAlertState(null).announced).toEqual([])
  })

  it('restores the change baseline, so a restart does not skip a report', () => {
    // Losing this resets the watcher to "establishing a baseline" and silently swallows the
    // comparison that a restart interrupted.
    const state = interpretAlertState({
      reported: { '0xa': { feesPerHourUsd: 100, txPerHour: 5, volumeUsdPerHour: 900 } },
      reportedSignature: '0xa:100:5:900',
      lastReportAt: 1_700_000_000_000,
    })

    expect(state.reported['0xa'].feesPerHourUsd).toBe(100)
    expect(state.reportedSignature).toBe('0xa:100:5:900')
    expect(state.lastReportAt).toBe(1_700_000_000_000)
  })

  it('treats a missing baseline as none rather than throwing', () => {
    expect(interpretAlertState({}).reported).toEqual({})
    expect(interpretAlertState({}).reportedSignature).toBe(null)
  })

  it('keeps stored filters over the defaults', () => {
    const state = interpretAlertState({ filters: { enabled: true, hooks: 'with' } })

    expect(state.filters.enabled).toBe(true)
    expect(state.filters.hooks).toBe('with')
    // Anything the stored file lacks still comes from the defaults.
    expect(state.filters.minFeeTier).toBe(0)
  })

  it('drops non-string ids rather than trusting the file', () => {
    expect(interpretAlertState({ announced: ['0xabc', 42, null] }).announced).toEqual(['0xabc'])
  })
})
