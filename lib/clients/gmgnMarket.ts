import { z } from 'zod'
import { runGmgn } from './gmgn'

/**
 * One token as GMGN's trending feed reports it.
 *
 * Everything here is per token rather than per pool. GMGN has no per-pool fee or per-window
 * volume anywhere in its surface, which is why a row built from this source carries no fee
 * figures at all rather than zeros that would read as "earns nothing".
 */
const trendingTokenSchema = z.object({
  chain: z.string().default(''),
  address: z.string().default(''),
  symbol: z.string().default(''),
  name: z.string().default(''),
  price: z.number().nullish(),
  volume: z.number().nullish(),
  liquidity: z.number().nullish(),
  market_cap: z.number().nullish(),
  swaps: z.number().nullish(),
  buys: z.number().nullish(),
  sells: z.number().nullish(),
  holder_count: z.number().nullish(),
  top_10_holder_rate: z.number().nullish(),
  price_change_percent1h: z.number().nullish(),
  price_change_percent: z.number().nullish(),
  creation_timestamp: z.number().nullish(),
  launchpad: z.string().nullish(),
  exchange: z.string().nullish(),
})

const trendingSchema = z.object({
  code: z.number().default(0),
  data: z.object({ rank: z.array(trendingTokenSchema).default([]) }).default({ rank: [] }),
})

export type GmgnToken = z.infer<typeof trendingTokenSchema>

/** The pool GMGN names for a token: its largest, and the only one it reports. */
const poolSchema = z.object({
  pool_address: z.string().default(''),
  quote_address: z.string().default(''),
  quote_symbol: z.string().default(''),
  liquidity: z.union([z.string(), z.number()]).nullish(),
  exchange: z.string().default(''),
  token0_address: z.string().default(''),
  token1_address: z.string().default(''),
  base_address: z.string().default(''),
  creation_timestamp: z.number().nullish(),
})

export type GmgnPool = z.infer<typeof poolSchema>

/**
 * The busiest tokens on a chain, by traded volume.
 *
 * Capped at 100 by the endpoint, with no cursor: this is the whole universe a GMGN-only build
 * can see per chain, not a first page of one.
 */
export const fetchGmgnTrending = async (chain: string, limit = 100): Promise<GmgnToken[]> => {
  const stdout = await runGmgn([
    'market',
    'trending',
    '--chain',
    chain,
    '--interval',
    '24h',
    '--limit',
    String(Math.min(limit, 100)),
    '--order-by',
    'volume',
    '--direction',
    'desc',
  ])
  if (stdout === null) return []

  const parsed = trendingSchema.safeParse(JSON.parse(stdout))
  return parsed.success ? parsed.data.data.rank : []
}

/** The single pool GMGN reports for a token, or null when it names none. */
export const fetchGmgnPool = async (chain: string, address: string): Promise<GmgnPool | null> => {
  const stdout = await runGmgn(['token', 'pool', '--chain', chain, '--address', address])
  if (stdout === null) return null

  const body: unknown = JSON.parse(stdout)
  const payload =
    typeof body === 'object' && body !== null && 'data' in body
      ? (body as { data: unknown }).data
      : body

  const parsed = poolSchema.safeParse(payload)
  return parsed.success && parsed.data.pool_address ? parsed.data : null
}
