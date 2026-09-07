import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoolRow } from '../types'
import { DEFAULT_FILTERS } from './newPools'
import { HOUR_MS } from './volumeHistory'

// The watcher's own state is the subject here, so only what it talks to is mocked: the pool feed,
// the sampler, Telegram, and the two files it persists through. `fs` and `node:fs` are both
// stubbed because alertStore imports one and volumeStore the other.
const noFile = () => {
  throw new Error('no file')
}

vi.mock('fs', () => ({ readFileSync: vi.fn(noFile), writeFileSync: vi.fn() }))
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(noFile),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}))
vi.mock('./pools', () => ({ getPoolsSnapshot: vi.fn(), loadActivityFor: vi.fn() }))
vi.mock('./volumeSampler', () => ({ sampleStockVolume: vi.fn() }))
vi.mock('../clients/telegram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../clients/telegram')>()
  return {
    ...actual,
    telegramConfigured: vi.fn(() => true),
    sendTelegramMessage: vi.fn(),
    deleteTelegramMessage: vi.fn(),
  }
})

const { getPoolsSnapshot, loadActivityFor } = await import('./pools')
const { sampleStockVolume } = await import('./volumeSampler')
const { sendTelegramMessage } = await import('../clients/telegram')
const { pollOnce, resetAlertWatcher, setAlertFilters } = await import('./alertWatcher')

const row: PoolRow = {
  poolId: '0xabc',
  chainId: 4663,
  protocol: 'uniswapv4',
  pair: 'WETH/NVDA',
  token0Symbol: 'WETH',
  token1Symbol: 'NVDA',
  token0Address: '0x1',
  token1Address: '0x2',
  feeTier: 0.3,
  lpFee: 0.25,
  dynamicFee: false,
  hooks: '',
  hasHook: false,
  tag: '',
  isStock: true,
  tvlUsd: 500_000,
  totalFeesUsd: 9_000,
  recentFeesPerHourUsd: 19,
  recentFeeWindow: '1h',
  fees24hUsd: 456,
  volume1hUsd: 0,
  volume24hUsd: 4_000_000,
  volume7dUsd: 0,
  volume30dUsd: 30_000_000,
  apr24h: 20,
  drawdown24h: 2,
  priceVolatility: 12,
  activity: null,
  position: 'none',
  positionVia: null,
  positionHolders: [],
  krystalUrl: 'https://defi.krystal.app/pools/detail',
  uniswapUrl: 'https://app.uniswap.org/explore/pools',
  age: '3d',
  ageMs: 3 * 24 * 60 * 60_000,
  risk: null,
  score: 0.5,
  scoreParts: null,
}

/**
 * Twelve quiet hours and one at eight times the rate, which is a spike by the defaults.
 *
 * Each test names its own pool, because the cooldown a sent spike records outlives the watcher
 * reset: interpretAlertState hands out one shared empty state, and the watcher writes into it.
 */
const spiking = (poolId: string) => {
  const latest = Math.ceil(Date.now() / HOUR_MS) * HOUR_MS
  const quiet = Array.from({ length: 12 }, (_, i) => ({
    hourEndMs: latest - (12 - i) * HOUR_MS,
    volumeUsd: 50_000,
    swaps: 100,
    spanMs: HOUR_MS,
  }))

  return {
    [poolId]: [...quiet, { hourEndMs: latest, volumeUsd: 400_000, swaps: 100, spanMs: HOUR_MS }],
  }
}

beforeEach(() => {
  resetAlertWatcher()
  vi.mocked(getPoolsSnapshot).mockResolvedValue({
    rows: [row],
    totalPools: 1,
    walletsTracked: 0,
    activityCovered: 0,
    scoredCount: 1,
    warnings: [],
    fetchedAt: new Date().toISOString(),
  })
  vi.mocked(loadActivityFor).mockResolvedValue({})
  vi.mocked(sendTelegramMessage).mockResolvedValue(1)
})

afterEach(() => {
  resetAlertWatcher()
  vi.clearAllMocks()
})

describe('spike alerts sharing the send throttle', () => {
  it('sends the spike when nothing else has sent this poll', async () => {
    vi.mocked(sampleStockVolume).mockResolvedValue(spiking('0xaaa'))
    setAlertFilters({ ...DEFAULT_FILTERS, spikeEnabled: true })

    await pollOnce()

    expect(sendTelegramMessage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendTelegramMessage).mock.calls[0][0]).toContain('Volume spike')
  })

  it('holds the spike back when the new pool alert already sent this poll', async () => {
    // Two messages a minute is what Telegram rate limits and nobody reads. The spike waits for
    // the next poll rather than going out beside the announcement.
    vi.mocked(sampleStockVolume).mockResolvedValue(spiking('0xbbb'))
    setAlertFilters({ ...DEFAULT_FILTERS, enabled: true, spikeEnabled: true })

    await pollOnce()

    expect(sendTelegramMessage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendTelegramMessage).mock.calls[0][0]).not.toContain('Volume spike')
  })

  it('backs off after a rejected send rather than retrying on the next poll', async () => {
    vi.mocked(sampleStockVolume).mockResolvedValue(spiking('0xccc'))
    setAlertFilters({ ...DEFAULT_FILTERS, spikeEnabled: true })
    vi.mocked(sendTelegramMessage).mockRejectedValue(new Error('429 Too Many Requests'))

    await pollOnce()
    await pollOnce()

    expect(sendTelegramMessage).toHaveBeenCalledTimes(1)
  })
})
