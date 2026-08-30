import { describe, expect, it } from 'vitest'
import { HOUR_MS } from './volumeHistory'
import { interpretVolumeHistory } from './volumeStore'

const bucket = { hourEndMs: HOUR_MS, volumeUsd: 100, swaps: 5, spanMs: HOUR_MS }

describe('interpretVolumeHistory', () => {
  it('reads a well formed file', () => {
    expect(interpretVolumeHistory({ '0xabc': [bucket] })).toEqual({ '0xabc': [bucket] })
  })

  it('lowercases pool ids so the two feeds agree on the key', () => {
    const parsed = interpretVolumeHistory({ '0xABC': [bucket] })

    expect(Object.keys(parsed)).toEqual(['0xabc'])
  })

  it('yields an empty history for a missing or unreadable file', () => {
    expect(interpretVolumeHistory(null)).toEqual({})
    expect(interpretVolumeHistory('not an object')).toEqual({})
  })

  it('drops entries that are not arrays of buckets', () => {
    expect(interpretVolumeHistory({ '0xabc': 'nonsense', '0xdef': [bucket] })).toEqual({
      '0xdef': [bucket],
    })
  })

  it('drops malformed buckets rather than failing the whole read', () => {
    const parsed = interpretVolumeHistory({
      '0xabc': [bucket, { hourEndMs: 'not a number', volumeUsd: 1, swaps: 1, spanMs: 1 }],
    })

    expect(parsed['0xabc']).toEqual([bucket])
  })

  it('keeps only the newest buckets when a file holds too many', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ ...bucket, hourEndMs: (i + 1) * HOUR_MS }))
    const parsed = interpretVolumeHistory({ '0xabc': many })

    expect(parsed['0xabc']).toHaveLength(48)
    expect(parsed['0xabc'][47].hourEndMs).toBe(100 * HOUR_MS)
  })
})
