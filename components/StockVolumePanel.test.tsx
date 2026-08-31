import { describe, expect, it } from 'vitest'
import { overlayFor, readVolumePayload } from './StockVolumePanel'

const HOUR = 3_600_000
const buckets = [{ hourEndMs: HOUR, volumeUsd: 100, swaps: 5, spanMs: HOUR }]

describe('overlayFor', () => {
  it('finds a pool by id regardless of casing', () => {
    expect(overlayFor({ '0xabc': buckets }, '0xABC')).toEqual(buckets)
  })

  it('yields null when nothing is selected', () => {
    expect(overlayFor({ '0xabc': buckets }, null)).toBeNull()
  })

  it('yields null for a pool with no history sampled yet', () => {
    expect(overlayFor({ '0xabc': buckets }, '0xdef')).toBeNull()
  })
})

describe('readVolumePayload', () => {
  it('reads what the volume route returns', () => {
    const payload = { aggregate: buckets, byPool: { '0xabc': buckets } }

    expect(readVolumePayload(payload)).toEqual(payload)
  })

  it('reads an empty history, which is what a first visit gets', () => {
    expect(readVolumePayload({ aggregate: [], byPool: {} })).toEqual({ aggregate: [], byPool: {} })
  })

  it('rejects anything that is not the payload', () => {
    expect(readVolumePayload(null)).toBeNull()
    expect(readVolumePayload('error')).toBeNull()
    expect(readVolumePayload({ error: 'disk on fire' })).toBeNull()
  })

  it('rejects a malformed series rather than charting half of it', () => {
    // Keeping the last good series on screen beats a chart drawn from part of a bad response.
    expect(readVolumePayload({ aggregate: [{ hourEndMs: 'soon' }], byPool: {} })).toBeNull()
    expect(readVolumePayload({ aggregate: buckets, byPool: { '0xabc': 'nonsense' } })).toBeNull()
  })
})
