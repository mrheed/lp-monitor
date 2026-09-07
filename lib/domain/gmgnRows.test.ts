import { describe, expect, it } from 'vitest'
import { toGmgnRow } from './gmgnRows'
import type { GmgnToken, GmgnPool } from '../clients/gmgnMarket'

const token = (over: Partial<GmgnToken> = {}): GmgnToken => ({
  chain: 'robinhood',
  address: '0x39dbed3a2bd333467115de45665cc57f813c4571',
  symbol: 'PONS',
  name: 'Pons',
  price: 0.9,
  volume: 132_318_000,
  liquidity: 7_304_900,
  market_cap: 833_545_000,
  swaps: 141_134,
  buys: 70_000,
  sells: 71_134,
  holder_count: 81_638,
  top_10_holder_rate: 0.094,
  price_change_percent1h: 4.18,
  price_change_percent: 12,
  creation_timestamp: 1_783_975_341,
  launchpad: 'pons',
  exchange: '0x1f7d',
  ...over,
})

const pool = (over: Partial<GmgnPool> = {}): GmgnPool => ({
  pool_address: '0x10cc6bd38112cac182db90b6a71d8bb5939526ba',
  quote_address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  quote_symbol: 'WETH',
  liquidity: '7308385.46',
  exchange: 'uniswap_v3',
  token0_address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  token1_address: '0x39dbed3a2bd333467115de45665cc57f813c4571',
  base_address: '0x39dbed3a2bd333467115de45665cc57f813c4571',
  creation_timestamp: 1_783_975_341,
  ...over,
})

describe('a row built from GMGN alone', () => {
  it('carries the pool GMGN names, not the token address', () => {
    // The token address identifies a token; a row is a pool, and the two are different things.
    const row = toGmgnRow(4663, token(), pool())

    expect(row.poolId).toBe('0x10cc6bd38112cac182db90b6a71d8bb5939526ba')
  })

  it('names the pair from the pool sides', () => {
    expect(toGmgnRow(4663, token(), pool()).pair).toBe('PONS/WETH')
  })

  it('takes liquidity from the pool rather than the token', () => {
    // A token's liquidity sums every pool holding it; a row describes one pool.
    const row = toGmgnRow(4663, token({ liquidity: 999 }), pool({ liquidity: '7308385.46' }))

    expect(row.tvlUsd).toBeCloseTo(7_308_385.46, 2)
  })

  it('reports no fees at all, rather than zero', () => {
    // GMGN carries no fee figure anywhere: `fee_ratio` is 0 on every pool and there is no
    // per-window fee series. A zero would rank a busy pool as earning nothing, so the row says
    // "none" and the score treats it as unmeasured.
    const row = toGmgnRow(4663, token(), pool())

    expect(row.recentFeeWindow).toBe('none')
    expect(row.recentFeesPerHourUsd).toBe(0)
    expect(row.totalFeesUsd).toBe(0)
  })

  it('keeps the 24h volume, which GMGN does report', () => {
    expect(toGmgnRow(4663, token(), pool()).volume24hUsd).toBe(132_318_000)
  })

  it('carries the swap count as observed activity, over a 24h window', () => {
    const row = toGmgnRow(4663, token(), pool())

    expect(row.activity?.sampleSize).toBe(141_134)
    expect(row.activity?.windowSeconds).toBe(86_400)
  })

  it('counts holders as traders, since GMGN reports no distinct trader count', () => {
    expect(toGmgnRow(4663, token(), pool()).activity?.uniqueTraders).toBe(81_638)
  })

  it('reads volatility from the hourly price move, as a magnitude', () => {
    // A fall is as volatile as a rise; the sign belongs to drawdown, not to volatility.
    const up = toGmgnRow(4663, token({ price_change_percent1h: 4.18 }), pool())
    const down = toGmgnRow(4663, token({ price_change_percent1h: -4.18 }), pool())

    expect(up.priceVolatility).toBeCloseTo(4.18)
    expect(down.priceVolatility).toBeCloseTo(4.18)
  })

  it('leaves position fields empty, since GMGN knows nothing about the wallets', () => {
    const row = toGmgnRow(4663, token(), pool())

    expect(row.position).toBe('none')
    expect(row.positionHolders).toEqual([])
  })

  it('survives a token missing every optional figure', () => {
    const bare = toGmgnRow(
      4663,
      token({ volume: null, liquidity: null, swaps: null, holder_count: null, price_change_percent1h: null }),
      pool({ liquidity: null }),
    )

    expect(Number.isFinite(bare.tvlUsd)).toBe(true)
    expect(Number.isFinite(bare.volume24hUsd)).toBe(true)
    expect(bare.activity).toBeNull()
  })
})
