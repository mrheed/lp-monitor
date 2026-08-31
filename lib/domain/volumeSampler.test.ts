import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchPoolSwaps, seekPageToken } from '../clients/uniswap'
import { VOLUME_BACKFILL_MAX_ATTEMPTS, VOLUME_BACKFILL_RETRY_MS } from '../config'
import { HOUR_MS } from './volumeHistory'
import { aggregateSeries, backfillPool, sampleStockVolume } from './volumeSampler'
import { readVolumeStore, writeVolumeStore } from './volumeStore'

// fetchPoolSwaps is mocked so the page token behaviour can be asserted without a network call;
// seekPageToken is left real, both to build the expected token and because it is a pure function.
vi.mock('../clients/uniswap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/uniswap')>()
  return { ...actual, fetchPoolSwaps: vi.fn() }
})

vi.mock('./volumeStore', () => ({ readVolumeStore: vi.fn(), writeVolumeStore: vi.fn() }))

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

  it('leaves out samples spanning more than an hour, as the spike detector does', () => {
    // A page covering six hours cannot say which hour its volume belonged to. Counting it would
    // scale the same swaps into several buckets and show the chart a spike the detector denies.
    const series = aggregateSeries({
      '0xa': [
        { hourEndMs: HOUR_MS, volumeUsd: 100, swaps: 5, spanMs: 6 * HOUR_MS },
        { hourEndMs: 2 * HOUR_MS, volumeUsd: 40, swaps: 5, spanMs: HOUR_MS },
      ],
    })

    expect(series).toEqual([{ hourEndMs: 2 * HOUR_MS, volumeUsd: 40, swaps: 5, spanMs: HOUR_MS }])
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

describe('sampleStockVolume pacing a failed backfill', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0)
  const row = {
    poolId: '0xABC',
    chainId: 8453,
    protocol: 'uniswapv4',
    isStock: true,
    volume24hUsd: 500_000,
  }

  /** The backfill log the sampler persisted on its one write. */
  const writtenBackfill = () => vi.mocked(writeVolumeStore).mock.calls[0][0].backfill

  beforeEach(() => {
    vi.mocked(fetchPoolSwaps).mockResolvedValue({ swaps: [], nextPageToken: null })
    vi.mocked(readVolumeStore).mockReturnValue({ history: {}, backfill: {} })
  })

  afterEach(() => vi.clearAllMocks())

  it('records the attempt when the backfill yields nothing', async () => {
    // Without this the key is never written, so the whole 48 request backfill repeats on the
    // next poll and every poll after it, for as long as the gateway keeps failing.
    await sampleStockVolume([row], now)

    expect(writtenBackfill()).toEqual({ '0xabc': { attempts: 1, lastAttemptMs: now } })
  })

  it('leaves the pool alone until its backoff has passed', async () => {
    vi.mocked(readVolumeStore).mockReturnValue({
      history: {},
      backfill: { '0xabc': { attempts: 1, lastAttemptMs: now - VOLUME_BACKFILL_RETRY_MS + 1 } },
    })

    await sampleStockVolume([row], now)

    expect(fetchPoolSwaps).not.toHaveBeenCalled()
  })

  it('tries again once the gap has passed, and counts the attempt', async () => {
    vi.mocked(readVolumeStore).mockReturnValue({
      history: {},
      backfill: { '0xabc': { attempts: 1, lastAttemptMs: now - VOLUME_BACKFILL_RETRY_MS } },
    })

    await sampleStockVolume([row], now)

    expect(fetchPoolSwaps).toHaveBeenCalled()
    expect(writtenBackfill()).toEqual({ '0xabc': { attempts: 2, lastAttemptMs: now } })
  })

  it('stretches the gap to its cap rather than growing without limit', async () => {
    const capped = VOLUME_BACKFILL_MAX_ATTEMPTS * VOLUME_BACKFILL_RETRY_MS
    vi.mocked(readVolumeStore).mockReturnValue({
      history: {},
      backfill: { '0xabc': { attempts: 20, lastAttemptMs: now - capped + 1 } },
    })

    await sampleStockVolume([row], now)
    expect(fetchPoolSwaps).not.toHaveBeenCalled()

    vi.mocked(readVolumeStore).mockReturnValue({
      history: {},
      backfill: { '0xabc': { attempts: 20, lastAttemptMs: now - capped } },
    })

    await sampleStockVolume([row], now)
    expect(fetchPoolSwaps).toHaveBeenCalled()
  })

  it('clears the marker once a backfill returns buckets', async () => {
    vi.mocked(readVolumeStore).mockReturnValue({
      history: {},
      backfill: { '0xabc': { attempts: 2, lastAttemptMs: now - 10 * VOLUME_BACKFILL_RETRY_MS } },
    })
    vi.mocked(fetchPoolSwaps).mockResolvedValue({
      swaps: [
        { timestampMs: now - 600_000, amountUsd: 100, walletAddress: '0x1', amount0: 0, amount1: 0 },
        { timestampMs: now - 300_000, amountUsd: 250, walletAddress: '0x2', amount0: 0, amount1: 0 },
      ],
      nextPageToken: null,
    })

    const history = await sampleStockVolume([row], now)

    expect(writtenBackfill()).toEqual({})
    expect(history['0xabc'].length).toBeGreaterThan(0)
  })
})
