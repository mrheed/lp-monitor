import { fetchPoolSwaps, type ActivityTarget, type PoolSwap } from '../clients/uniswap'

/** How many recent swaps a detail row shows. One page, so opening a row costs one request. */
export const TRADE_HISTORY_LIMIT = 50

/** One swap as the detail row lists it. */
export type Trade = {
  timestampMs: number
  amountUsd: number
  wallet: string
  /** Direction from the equity's point of view, not the pool's. */
  side: 'buy' | 'sell'
}

/**
 * Which way the equity moved.
 *
 * The feed signs token amounts from the pool's side, so a negative amount is the token leaving
 * the pool. The equity leaving means a trader took it, which is a buy of that stock. `amountUsd`
 * is a magnitude and cannot answer this on its own.
 */
export const tradeSide = (swap: PoolSwap, stockIsToken0: boolean): 'buy' | 'sell' =>
  (stockIsToken0 ? swap.amount0 : swap.amount1) < 0 ? 'buy' : 'sell'

/**
 * The most recent trades for one pool.
 *
 * Read on demand when a row is opened rather than kept in the sampler's history, which stores
 * hourly totals and deliberately keeps no per-swap detail.
 */
export const recentTrades = async (
  target: ActivityTarget,
  stockIsToken0: boolean,
  limit: number = TRADE_HISTORY_LIMIT,
): Promise<Trade[]> => {
  const { swaps } = await fetchPoolSwaps(target, { pageSize: limit })

  return swaps
    .slice(0, limit)
    .sort((a, b) => b.timestampMs - a.timestampMs)
    .map((swap) => ({
      timestampMs: swap.timestampMs,
      amountUsd: swap.amountUsd,
      wallet: swap.walletAddress,
      side: tradeSide(swap, stockIsToken0),
    }))
}
