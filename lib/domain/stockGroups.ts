import { stockTicker } from './stockTokens'
import { txPerHour } from './volumeTimeframes'
import type { Activity } from '../types'

/** What grouping reads off a row, so callers are not forced to build a whole PoolRow. */
type GroupablePool = {
  poolId: string
  pair: string
  token0Address: string
  token1Address: string
  volume1hUsd: number
  volume24hUsd: number
  volume7dUsd: number
  volume30dUsd: number
  activity: Activity | null
}

/**
 * Every pool holding one issued equity, and that equity's totals.
 *
 * The table reads by stock rather than by pool because a ticker is spread across many pools:
 * NVDA alone spans sixteen. Sixteen rows saying NVDA answer "which pool" when the question is
 * "what is trading".
 */
export type StockGroup<T extends GroupablePool = GroupablePool> = {
  ticker: string
  pools: T[]
  volume1hUsd: number
  volume24hUsd: number
  volume7dUsd: number
  volume30dUsd: number
  /** Summed over the pools that have been sampled, or null when none has. */
  txPerHour: number | null
}

/** The ticker a pool trades, taken from whichever side holds the equity. */
export const stockTickerFor = (pool: {
  token0Address: string
  token1Address: string
}): string | null => stockTicker(pool.token0Address) ?? stockTicker(pool.token1Address)

/**
 * Pools folded into one group per ticker, busiest ticker first.
 *
 * A pool holding no issued equity is dropped rather than grouped under its symbol, because the
 * symbols collide: several memecoins here wear a real ticker.
 */
export const groupByStock = <T extends GroupablePool>(pools: T[]): StockGroup<T>[] => {
  const byTicker = new Map<string, T[]>()

  for (const pool of pools) {
    const ticker = stockTickerFor(pool)
    if (ticker === null) continue
    byTicker.set(ticker, [...(byTicker.get(ticker) ?? []), pool])
  }

  const sum = (entries: T[], read: (pool: T) => number) =>
    entries.reduce((total, pool) => total + read(pool), 0)

  return [...byTicker.entries()]
    .map(([ticker, entries]) => {
      const sampled = entries.map(txPerHour).filter((rate) => rate !== null)

      return {
        ticker,
        pools: [...entries].sort((a, b) => b.volume24hUsd - a.volume24hUsd),
        volume1hUsd: sum(entries, (pool) => pool.volume1hUsd),
        volume24hUsd: sum(entries, (pool) => pool.volume24hUsd),
        volume7dUsd: sum(entries, (pool) => pool.volume7dUsd),
        volume30dUsd: sum(entries, (pool) => pool.volume30dUsd),
        txPerHour:
          sampled.length > 0 ? sampled.reduce((total, rate) => total + rate.perHour, 0) : null,
      }
    })
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
}
