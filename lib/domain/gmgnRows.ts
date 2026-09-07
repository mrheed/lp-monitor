import { krystalPoolUrl, uniswapPoolUrl } from '../config'
import { formatAge } from './poolAge'
import type { GmgnPool, GmgnToken } from '../clients/gmgnMarket'
import type { PoolRow } from '../types'

/** A finite number, or zero. GMGN returns null for anything it did not measure. */
const num = (value: number | string | null | undefined): number => {
  if (value === null || value === undefined) return 0
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Builds a table row from GMGN's token and pool records.
 *
 * The shape is lossy in one direction that matters, and the loss is made explicit rather than
 * papered over: GMGN publishes no fee figure anywhere. `fee_ratio` reads 0 on every pool and
 * there is no per-window fee series, so the row reports its fee window as `none` and its fee
 * figures as zero, which the score already treats as unmeasured. A fabricated fee would be worse
 * than an absent one; this tracker's whole failure mode has been figures that looked real.
 *
 * Volume, liquidity, swap counts, holders and price movement are all genuine GMGN readings.
 */
export const toGmgnRow = (chainId: number, token: GmgnToken, pool: GmgnPool): PoolRow => {
  const quote = pool.quote_symbol || 'ETH'
  const swaps = num(token.swaps)
  const holders = num(token.holder_count)
  const volume24h = num(token.volume)

  return {
    poolId: pool.pool_address,
    chainId,
    protocol: pool.exchange || 'unknown',
    pair: `${token.symbol}/${quote}`,
    token0Symbol: token.symbol,
    token1Symbol: quote,
    token0Address: token.address,
    token1Address: pool.quote_address,
    // GMGN reports no fee tier and no hook, so neither is claimed.
    feeTier: 0,
    lpFee: 0,
    dynamicFee: false,
    hooks: '',
    hasHook: false,
    tag: token.launchpad ?? '',
    // GMGN has no notion of Robinhood's tokenized equities, so no row from it claims to be one.
    isStock: false,
    tvlUsd: num(pool.liquidity) || num(token.liquidity),

    // No fee data exists in this source. Reported as absent, never as zero income.
    totalFeesUsd: 0,
    recentFeesPerHourUsd: 0,
    recentFeeWindow: 'none',
    fees24hUsd: 0,

    // Only the 24h window exists in this source; the others are absent, not zero-volume.
    volume1hUsd: 0,
    volume24hUsd: volume24h,
    volume7dUsd: 0,
    volume30dUsd: 0,
    apr24h: 0,
    drawdown24h: Math.min(0, num(token.price_change_percent1h)),
    // Magnitude, since a fall is as volatile as a rise.
    priceVolatility: Math.abs(num(token.price_change_percent1h)),

    /*
     * Swap and holder counts stand in for the sampled activity the Uniswap feed provides.
     * The window is a full day because that is the window GMGN's figures cover, and holders
     * stand in for traders because GMGN reports no distinct trader count.
     */
    activity:
      swaps > 0 || holders > 0
        ? {
            volumeUsd: volume24h,
            transactionsPerHour: swaps / 24,
            volumeUsdPerHour: volume24h / 24,
            uniqueTraders: holders,
            averageTradeUsd: swaps > 0 ? volume24h / swaps : 0,
            sampleSize: swaps,
            windowSeconds: 86_400,
          }
        : null,

    // GMGN knows nothing about the operator's wallets, so no position can be claimed.
    position: 'none',
    positionVia: null,
    positionHolders: [],

    krystalUrl: krystalPoolUrl(chainId, pool.pool_address, pool.exchange || '', 0),
    uniswapUrl: uniswapPoolUrl(chainId, pool.pool_address),
    // Creation time is reported, so age is real here rather than inferred from volume windows.
    age: token.creation_timestamp
      ? formatAge(Date.now() - token.creation_timestamp * 1000, true)
      : '',
    ageMs: token.creation_timestamp ? Date.now() - token.creation_timestamp * 1000 : 0,
    risk: null,
    score: null,
    scoreParts: null,
  }
}
