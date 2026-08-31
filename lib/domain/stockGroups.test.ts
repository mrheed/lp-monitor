import { describe, expect, it } from 'vitest'
import { groupByStock, stockTickerFor } from './stockGroups'

const NVDA = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec'
const SPY = '0x117cc2133c37b721f49de2a7a74833232b3b4c0c'
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'
const MEMECOIN_GME = '0x7e86381a763f0ecca2bdf27c54eac403ddd48123'

/** Only the fields grouping reads, so a test does not have to build a whole PoolRow. */
const pool = (
  poolId: string,
  token0Address: string,
  token1Address: string,
  volume24hUsd: number,
  transactionsPerHour: number | null = null,
) => ({
  poolId,
  pair: 'X/Y',
  token0Address,
  token1Address,
  volume1hUsd: volume24hUsd / 24,
  volume24hUsd,
  volume7dUsd: volume24hUsd * 7,
  volume30dUsd: volume24hUsd * 30,
  activity:
    transactionsPerHour === null
      ? null
      : {
          volumeUsd: 100,
          transactionsPerHour,
          volumeUsdPerHour: volume24hUsd / 24,
          uniqueTraders: 3,
          averageTradeUsd: 50,
          sampleSize: 25,
          windowSeconds: 300,
        },
})

describe('stockTickerFor', () => {
  it('reads the ticker off whichever side holds the equity', () => {
    expect(stockTickerFor(pool('0xa', WETH, NVDA, 1))).toBe('NVDA')
    expect(stockTickerFor(pool('0xb', SPY, USDG, 1))).toBe('SPY')
  })

  it('yields null for a pool holding no issued equity', () => {
    expect(stockTickerFor(pool('0xc', WETH, MEMECOIN_GME, 1))).toBeNull()
  })
})

describe('groupByStock', () => {
  it('collects every pool for a ticker into one group', () => {
    const groups = groupByStock([
      pool('0xa', WETH, NVDA, 100),
      pool('0xb', USDG, NVDA, 300),
      pool('0xc', WETH, SPY, 50),
    ])

    expect(groups.map((group) => group.ticker).sort()).toEqual(['NVDA', 'SPY'])
    expect(groups.find((group) => group.ticker === 'NVDA')?.pools).toHaveLength(2)
  })

  it('sums volume across the ticker rather than reporting its busiest pool', () => {
    const groups = groupByStock([pool('0xa', WETH, NVDA, 100), pool('0xb', USDG, NVDA, 300)])

    expect(groups[0].volume24hUsd).toBe(400)
    expect(groups[0].volume7dUsd).toBe(2800)
  })

  it('sums trade rate over the pools that have been sampled, ignoring those that have not', () => {
    const groups = groupByStock([
      pool('0xa', WETH, NVDA, 100, 40),
      pool('0xb', USDG, NVDA, 300, 60),
      pool('0xc', USDG, NVDA, 10, null),
    ])

    expect(groups[0].txPerHour).toBe(100)
  })

  it('reports a null trade rate when no pool for the ticker has been sampled', () => {
    expect(groupByStock([pool('0xa', WETH, NVDA, 100)])[0].txPerHour).toBeNull()
  })

  it('orders groups by 24 hour volume, busiest first', () => {
    const groups = groupByStock([
      pool('0xa', WETH, NVDA, 100),
      pool('0xb', WETH, SPY, 900),
    ])

    expect(groups.map((group) => group.ticker)).toEqual(['SPY', 'NVDA'])
  })

  it('orders each group\'s own pools by volume too, so the busiest reads first', () => {
    const groups = groupByStock([
      pool('0xa', WETH, NVDA, 100),
      pool('0xb', USDG, NVDA, 700),
    ])

    expect(groups[0].pools.map((entry) => entry.poolId)).toEqual(['0xb', '0xa'])
  })

  it('drops pools holding no issued equity rather than inventing a group for them', () => {
    expect(groupByStock([pool('0xz', WETH, MEMECOIN_GME, 500)])).toEqual([])
  })
})
