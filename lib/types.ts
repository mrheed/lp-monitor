import { z } from 'zod'

/** Krystal serialises every numeric metric as a string; this coerces to a finite number, defaulting to 0. */
const numericString = z
  .union([z.string(), z.number(), z.null()])
  .transform((value) => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '')
    return Number.isFinite(parsed) ? parsed : 0
  })

const krystalTokenSchema = z.object({
  symbol: z.string().default(''),
  address: z.string().default(''),
  logo: z.string().default(''),
  decimals: z.union([z.string(), z.number()]).default('18'),
})

const krystalWindowSchema = z
  .object({
    volumeUsd: numericString.default(0),
    feeUsd: numericString.default(0),
    apr: z.number().default(0),
  })
  .default({ volumeUsd: '0', feeUsd: '0', apr: 0 })

export const krystalPoolSchema = z.object({
  chainId: z.number(),
  protocol: z.string(),
  poolAddress: z.string(),
  feeTier: z.number().default(0),
  tvlUsd: numericString.default(0),
  token0: krystalTokenSchema,
  token1: krystalTokenSchema,
  tag: z.string().nullish(),
  stat1h: krystalWindowSchema,
  stat24h: krystalWindowSchema,
  stat7d: krystalWindowSchema,
  stat30d: krystalWindowSchema,
  drawdown24h: z.number().default(0),
  priceVolatility: z.number().default(0),
  hooks: z.string().default(''),
  dynamicFee: z.boolean().default(false),
  lpFee: z.number().default(0),
  protocolFee: z.number().default(0),
})

export const krystalTopPoolsSchema = z.object({
  result: z.array(krystalPoolSchema),
})

export type KrystalPool = z.infer<typeof krystalPoolSchema>

/**
 * A position's relationship to a pool, used for the checklist column.
 * `open` outranks `closed` when a wallet has both in the same pool.
 */
export type PositionState = 'open' | 'closed' | 'none'

/** Recent trade activity derived from a page of pool transactions. */
export type Activity = {
  /**
   * USD actually traded across the sampled transactions. Observed, not projected: this is the
   * sum of what the feed returned, and it is what the table shows.
   */
  volumeUsd: number
  /**
   * The observed figures projected to an hour. Used for ranking, where pools measured over
   * different spans have to be compared, and deliberately not shown: a pool whose sample covers
   * forty seconds has not been seen trading for an hour.
   */
  transactionsPerHour: number
  volumeUsdPerHour: number
  uniqueTraders: number
  averageTradeUsd: number
  sampleSize: number
  /** Seconds spanned by the sampled transactions; 0 when the sample is too small to span time. */
  windowSeconds: number
}

/** One row of the tracker table: pool facts, ranking inputs, activity, and wallet involvement. */
export type PoolRow = {
  poolId: string
  chainId: number
  protocol: string
  pair: string
  token0Symbol: string
  token1Symbol: string
  token0Address: string
  token1Address: string
  /** Total swap fee as a percentage. Krystal reports this pre-converted, not in hundredths of bips. */
  feeTier: number
  /** The share of feeTier that accrues to liquidity providers; the rest is protocol fee. */
  lpFee: number
  dynamicFee: boolean
  hooks: string
  hasHook: boolean
  tag: string
  tvlUsd: number
  /** Accumulated fees over the widest window available. Shown, never scored. */
  totalFeesUsd: number
  /**
   * Fees over the shortest window that reported activity, normalised to an hourly rate.
   * This is what the score reads: it reflects what the pool is earning now, not its history.
   */
  recentFeesPerHourUsd: number
  /** Which window `recentFeesPerHourUsd` came from, for display. */
  recentFeeWindow: '1h' | '24h' | '7d' | '30d' | 'none'
  fees24hUsd: number
  volume24hUsd: number
  volume30dUsd: number
  apr24h: number
  drawdown24h: number
  priceVolatility: number
  activity: Activity | null
  position: PositionState
  /** Whether the exposure is a direct position or via a vault that holds the pool. */
  positionVia: 'direct' | 'vault' | null
  /** Which tracked wallets hold or held this pool, open first. Empty when none did. */
  positionHolders: {
    label: string
    address: string
    state: 'open' | 'closed'
    via: 'direct' | 'vault'
  }[]
  krystalUrl: string
  uniswapUrl: string
  /** How far back the pool's recorded activity extends, as a label like `3h` or `1w`. */
  age: string
  /** Composite 0..1 rank across fee rate, thinness, trade rate, traders and calmness. */
  score: number | null
  scoreParts: {
    fees: number
    tvl: number
    rate: number
    traders: number
    volatility: number
  } | null
}
