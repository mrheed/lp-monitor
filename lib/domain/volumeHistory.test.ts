import { describe, expect, it } from 'vitest'
import {
  BUCKET_LIMIT,
  HOUR_MS,
  alignHourEnd,
  bucketFromSwaps,
  hourlyReadings,
  medianRate,
  mergeBucket,
  rateUsdPerHour,
} from './volumeHistory'

/** A bucket with the fields a test cares about, defaulting the rest. */
const bucket = (hourEndMs: number, volumeUsd: number, spanMs = HOUR_MS, swaps = 10) => ({
  hourEndMs,
  volumeUsd,
  spanMs,
  swaps,
})

describe('alignHourEnd', () => {
  it('rounds up to the next hour boundary', () => {
    expect(alignHourEnd(HOUR_MS + 1)).toBe(2 * HOUR_MS)
  })

  it('leaves an exact boundary alone', () => {
    expect(alignHourEnd(3 * HOUR_MS)).toBe(3 * HOUR_MS)
  })
})

describe('bucketFromSwaps', () => {
  it('sums the swaps and records the span they covered', () => {
    const result = bucketFromSwaps(
      [
        { timestampMs: 1_000_000, amountUsd: 100, walletAddress: '0x1' },
        { timestampMs: 1_600_000, amountUsd: 50, walletAddress: '0x2' },
      ],
      HOUR_MS,
    )

    expect(result).toEqual({ hourEndMs: HOUR_MS, volumeUsd: 150, swaps: 2, spanMs: 600_000 })
  })

  it('yields null for an empty page, which is not the same as a quiet hour', () => {
    expect(bucketFromSwaps([], HOUR_MS)).toBeNull()
  })

  it('yields null for a single swap, which spans no time and implies no rate', () => {
    expect(
      bucketFromSwaps([{ timestampMs: 1_000_000, amountUsd: 100, walletAddress: '0x1' }], HOUR_MS),
    ).toBeNull()
  })
})

describe('rateUsdPerHour', () => {
  it('scales the observed volume to an hour', () => {
    expect(rateUsdPerHour(bucket(HOUR_MS, 150, 600_000))).toBe(900)
  })

  it('returns the volume unchanged when the span is exactly an hour', () => {
    expect(rateUsdPerHour(bucket(HOUR_MS, 150, HOUR_MS))).toBe(150)
  })

  it('is zero for a bucket that spans nothing, rather than infinite', () => {
    expect(rateUsdPerHour(bucket(HOUR_MS, 150, 0))).toBe(0)
  })
})

describe('mergeBucket', () => {
  it('appends a newer hour', () => {
    const merged = mergeBucket([bucket(HOUR_MS, 10)], bucket(2 * HOUR_MS, 20))

    expect(merged.map((entry) => entry.hourEndMs)).toEqual([HOUR_MS, 2 * HOUR_MS])
  })

  it('replaces a bucket for an hour already recorded', () => {
    const merged = mergeBucket([bucket(HOUR_MS, 10)], bucket(HOUR_MS, 99))

    expect(merged).toHaveLength(1)
    expect(merged[0].volumeUsd).toBe(99)
  })

  it('keeps the newest buckets when the limit is passed', () => {
    const full = Array.from({ length: BUCKET_LIMIT }, (_, i) => bucket((i + 1) * HOUR_MS, i))
    const merged = mergeBucket(full, bucket((BUCKET_LIMIT + 1) * HOUR_MS, 999))

    expect(merged).toHaveLength(BUCKET_LIMIT)
    expect(merged[0].hourEndMs).toBe(2 * HOUR_MS)
    expect(merged[merged.length - 1].volumeUsd).toBe(999)
  })

  it('keeps the list ordered oldest first regardless of arrival order', () => {
    const merged = mergeBucket([bucket(2 * HOUR_MS, 20)], bucket(HOUR_MS, 10))

    expect(merged.map((entry) => entry.hourEndMs)).toEqual([HOUR_MS, 2 * HOUR_MS])
  })
})

describe('hourlyReadings', () => {
  it('drops buckets whose sample spanned more than an hour', () => {
    const kept = bucket(HOUR_MS, 10, HOUR_MS)
    const smeared = bucket(2 * HOUR_MS, 10, 6 * HOUR_MS)

    expect(hourlyReadings([kept, smeared])).toEqual([kept])
  })
})

describe('medianRate', () => {
  it('takes the middle rate, not the mean, so one spike cannot lift the baseline', () => {
    const buckets = [
      bucket(HOUR_MS, 100),
      bucket(2 * HOUR_MS, 100),
      bucket(3 * HOUR_MS, 100),
      bucket(4 * HOUR_MS, 10_000),
    ]

    expect(medianRate(buckets)).toBe(100)
  })

  it('is zero with nothing to measure', () => {
    expect(medianRate([])).toBe(0)
  })
})
