import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPoolSwaps, seekPageToken } from '../clients/uniswap'
import { HOUR_MS } from './volumeHistory'
import { aggregateSeries, backfillPool } from './volumeSampler'

// fetchPoolSwaps is mocked so the page token behaviour can be asserted without a network call;
// seekPageToken is left real, both to build the expected token and because it is a pure function.
vi.mock('../clients/uniswap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/uniswap')>()
  return { ...actual, fetchPoolSwaps: vi.fn() }
})

describe('aggregateSeries', () => {
  it('sums each hour across pools', () => {
    const series = aggregateSeries({
      '0xa': [{ hourEndMs: HOUR_MS, volumeUsd: 100, swaps: 5, spanMs: HOUR_MS }],
      '0xb': [{ hourEndMs: HOUR_MS, volumeUsd: 50, swaps: 3, spanMs: HOUR_MS }],
    })

    expect(series).toEqual([{ hourEndMs: HOUR_MS, volumeUsd: 150, swaps: 8, spanMs: HOUR_MS }])
  })

  it('scales a partial sample to the hour before summing, so pools are comparable', () => {
    // Half an hour of $100 is $200/h, and belongs in the total as $200 rather than $100.
    const series = aggregateSeries({
      '0xa': [{ hourEndMs: HOUR_MS, volumeUsd: 100, swaps: 5, spanMs: HOUR_MS / 2 }],
    })

    expect(series[0].volumeUsd).toBe(200)
  })

  it('orders hours oldest first', () => {
    const series = aggregateSeries({
      '0xa': [
        { hourEndMs: 2 * HOUR_MS, volumeUsd: 10, swaps: 1, spanMs: HOUR_MS },
        { hourEndMs: HOUR_MS, volumeUsd: 20, swaps: 1, spanMs: HOUR_MS },
      ],
    })

    expect(series.map((entry) => entry.hourEndMs)).toEqual([HOUR_MS, 2 * HOUR_MS])
  })

  it('is empty for an empty history', () => {
    expect(aggregateSeries({})).toEqual([])
  })
})

describe('backfillPool sampling the current hour', () => {
  const target = { poolId: '0xabc', protocol: 'uniswapv4', chainId: 8453 }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(fetchPoolSwaps).mockResolvedValue({ swaps: [], nextPageToken: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.mocked(fetchPoolSwaps).mockReset()
  })

  it('seeks past hours with a page token, but reads the current hour from the newest page', async () => {
    // A pool's undocumented page-token encoding could change without notice. Confining it to
    // backfill, and reading the live hour with no cursor, means that change breaks backfill
    // only and never alerting.
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    vi.setSystemTime(now)

    await backfillPool(target, 2, now)

    const calls = vi.mocked(fetchPoolSwaps).mock.calls
    expect(calls).toHaveLength(2)

    const [currentHourCall, pastHourCall] = calls
    expect(currentHourCall[1]).not.toHaveProperty('pageToken')
    expect(pastHourCall[1]).toMatchObject({
      pageToken: seekPageToken(now - HOUR_MS, target.chainId),
    })
  })
})
