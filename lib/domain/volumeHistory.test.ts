import { describe, expect, it } from 'vitest'
import {
  BUCKET_LIMIT,
  aggregateSeries,
  HOUR_MS,
  alignHourEnd,
  bucketFromSwaps,
  hourlyReadings,
  medianRate,
  mergeBucket,
  poolSeries,
  rateUsdPerHour,
  sumSeries,
  shareOfTotal,
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
        { timestampMs: 1_000_000, amountUsd: 100, walletAddress: '0x1', amount0: 0, amount1: 0 },
        { timestampMs: 1_600_000, amountUsd: 50, walletAddress: '0x2', amount0: 0, amount1: 0 },
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
      bucketFromSwaps([{ timestampMs: 1_000_000, amountUsd: 100, walletAddress: '0x1', amount0: 0, amount1: 0 }], HOUR_MS),
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

describe('shareOfTotal', () => {
  it('measures the part against the total over the hours the part covers', () => {
    const total = [bucket(HOUR_MS, 100), bucket(2 * HOUR_MS, 100)]
    const part = [bucket(HOUR_MS, 25)]

    // 25 of the 100 traded in the one hour the part covers, not of the 200 across both.
    expect(shareOfTotal(total, part)).toBe(25)
  })

  it('is null when nothing is selected', () => {
    expect(shareOfTotal([bucket(HOUR_MS, 100)], null)).toBeNull()
  })

  it('is null rather than infinite when the total is zero over those hours', () => {
    expect(shareOfTotal([bucket(HOUR_MS, 0)], [bucket(HOUR_MS, 5)])).toBeNull()
  })

  it('handles a part covering hours the total does not', () => {
    expect(shareOfTotal([bucket(HOUR_MS, 100)], [bucket(9 * HOUR_MS, 5)])).toBeNull()
  })
})

describe('poolSeries', () => {
  it('scales a pool to hourly rates, matching the units an aggregate uses', () => {
    // Three minutes of observation: $1,000 seen is $20,000 an hour, and the aggregate says so too.
    const short = { hourEndMs: HOUR_MS, volumeUsd: 1_000, swaps: 100, spanMs: HOUR_MS / 20 }
    const history = { '0xabc': [short] }

    expect(poolSeries(history, '0xabc')?.[0].volumeUsd).toBe(20_000)
    expect(poolSeries(history, '0xabc')?.[0].volumeUsd).toBe(aggregateSeries(history)[0].volumeUsd)
  })

  it('matches on pool id regardless of casing, since the store lowercases its keys', () => {
    const history = { '0xabc': [bucket(HOUR_MS, 100)] }

    expect(poolSeries(history, '0xABC')).not.toBeNull()
  })

  it('is null for a pool with no sampled history', () => {
    expect(poolSeries({}, '0xabc')).toBeNull()
  })

  it('is null when every bucket is too smeared to place in an hour', () => {
    const smeared = { hourEndMs: HOUR_MS, volumeUsd: 10, swaps: 5, spanMs: 6 * HOUR_MS }

    expect(poolSeries({ '0xabc': [smeared] }, '0xabc')).toBeNull()
  })
})

describe('sumSeries', () => {
  it('adds values sharing an interval without scaling them', () => {
    const day = 24 * HOUR_MS
    const a = [{ hourEndMs: day, volumeUsd: 100, swaps: 0, spanMs: day }]
    const b = [{ hourEndMs: day, volumeUsd: 50, swaps: 0, spanMs: day }]

    expect(sumSeries([a, b])).toEqual([{ hourEndMs: day, volumeUsd: 150, swaps: 0, spanMs: day }])
  })

  it('keeps the step rather than forcing everything to an hour', () => {
    const day = 24 * HOUR_MS

    expect(sumSeries([[{ hourEndMs: day, volumeUsd: 1, swaps: 0, spanMs: day }]])[0].spanMs).toBe(day)
  })

  it('unions intervals the series do not share, ordered oldest first', () => {
    const a = [{ hourEndMs: 2 * HOUR_MS, volumeUsd: 1, swaps: 0, spanMs: HOUR_MS }]
    const b = [{ hourEndMs: HOUR_MS, volumeUsd: 2, swaps: 0, spanMs: HOUR_MS }]

    expect(sumSeries([a, b]).map((x) => x.hourEndMs)).toEqual([HOUR_MS, 2 * HOUR_MS])
  })

  it('is empty for no series at all', () => {
    expect(sumSeries([])).toEqual([])
  })
})
