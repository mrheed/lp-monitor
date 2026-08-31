import { describe, expect, it } from 'vitest'
import { overlayFor } from './StockVolumePanel'

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
