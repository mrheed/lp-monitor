import { describe, expect, it } from 'vitest'
import { readVolumePayload } from './StockVolumePanel'

const HOUR = 3_600_000
const buckets = [{ hourEndMs: HOUR, volumeUsd: 100, swaps: 5, spanMs: HOUR }]

describe('readVolumePayload', () => {
  it('reads what the volume route returns', () => {
    const payload = { aggregate: buckets, byPool: { '0xabc': buckets }, missing: 3 }

    expect(readVolumePayload(payload)).toEqual(payload)
  })

  it('defaults missing to zero, so an older payload without it still reads', () => {
    expect(readVolumePayload({ aggregate: buckets, byPool: {} })?.missing).toBe(0)
  })

  it('reads an empty history, which is what a first visit gets', () => {
    expect(readVolumePayload({ aggregate: [], byPool: {} })).toEqual({ aggregate: [], byPool: {}, missing: 0 })
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
