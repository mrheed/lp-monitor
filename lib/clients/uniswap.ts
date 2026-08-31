import { z } from 'zod'
import { FETCH_CONCURRENCY, TX_SAMPLE_SIZE } from '../config'
import { hasTransactionFeed } from '../chains'
import { computeActivity, type ActivitySample } from '../domain/activity'
import type { Activity } from '../types'

const ENDPOINT =
  'https://entry-gateway.backend-prod.api.uniswap.org/data.v2.DataApiService/ListTransactions'

/** Headers the Uniswap web app sends. The gateway rejects requests without them. */
const GATEWAY_HEADERS = {
  accept: '*/*',
  'content-type': 'application/json',
  'connect-protocol-version': '1',
  origin: 'https://app.uniswap.org',
  referer: 'https://app.uniswap.org/',
  'x-request-source': 'uniswap-web',
}

/** The signed token amount on one side of a swap. Its sign is the trade's direction. */
const sideSchema = z.object({ amount: z.string().default('0') }).optional()

const transactionSchema = z.object({
  poolId: z.string().default(''),
  timestampMs: z.string(),
  token0: sideSchema,
  token1: sideSchema,
  // Distinguishes a swap from a liquidity add or remove; the feed mixes all three.
  eventType: z.string().optional(),
  walletAddress: z.string().optional(),
  amountUsd: z.number().optional(),
})

const listTransactionsSchema = z.object({
  transactions: z.array(transactionSchema).default([]),
})

const swapPageSchema = z.object({
  transactions: z.array(transactionSchema).default([]),
  page: z.object({ nextPageToken: z.string().optional() }).optional(),
})

/** A pool to measure, carrying the chain and protocol its id belongs to. */
export type ActivityTarget = { poolId: string; protocol: string; chainId: number }

/**
 * Maps a Krystal protocol name to the Uniswap protocol version enum.
 *
 * The pool feed mixes versions regardless of the protocol query param, and they use different
 * id shapes: v2 and v3 pools are 20 byte contract addresses, v4 pools are 32 byte pool ids.
 * Asking for the wrong version returns transactions that never match the requested id, which
 * looks exactly like a pool nobody trades.
 */
export const protocolVersionFor = (protocol: string) => {
  const name = protocol.toLowerCase()
  if (name.includes('v2')) return 'PROTOCOL_VERSION_V2'
  if (name.includes('v3')) return 'PROTOCOL_VERSION_V3'
  return 'PROTOCOL_VERSION_V4'
}

/** One swap as the volume history cares about it: when, how much, and by whom. */
export type PoolSwap = {
  timestampMs: number
  amountUsd: number
  walletAddress: string
  /**
   * Signed token amounts, kept because their sign is the only record of direction. The feed
   * reports `amountUsd` as a magnitude, so without these a buy and a sell look identical.
   */
  amount0: number
  amount1: number
}

/**
 * A page token that starts the feed at a point in time and reads backwards from it.
 *
 * The feed's own token is base64 JSON carrying a `(timestampMs, globalSequenceNumber)` cursor.
 * Supplying a maximal sequence number seeks to the requested instant, which is what makes a
 * backfill affordable: a pool running a hundred swaps every three minutes would otherwise need
 * thousands of sequential pages to reach yesterday.
 *
 * This relies on an undocumented encoding, so only the backfill uses it. Live sampling reads the
 * newest page and needs no cursor, and keeps working if this ever stops being accepted.
 */
export const seekPageToken = (timestampMs: number, chainId: number): string =>
  btoa(
    JSON.stringify({
      timestampMs,
      chainId,
      globalSequenceNumber: '999999999999999999999999999',
    }),
  )

/**
 * Reads one page of swaps for a pool.
 *
 * Liquidity adds and removes are dropped: the feed mixes all three event types and only swaps
 * are volume. Amounts are taken as magnitudes because the feed signs them by direction.
 *
 * The response is filtered back to the requested pool for the same reason
 * {@link fetchActivity} does it: the API accepts a pool filter and can still answer with the
 * chain wide firehose, so a response that looks right may describe twenty other pools.
 */
export const fetchPoolSwaps = async (
  { poolId, protocol, chainId }: ActivityTarget,
  options: { pageSize?: number; pageToken?: string } = {},
): Promise<{ swaps: PoolSwap[]; nextPageToken: string | null }> => {
  const { pageSize = 100, pageToken } = options

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: GATEWAY_HEADERS,
    body: JSON.stringify({
      chainIds: [chainId],
      filter: { protocolVersions: [protocolVersionFor(protocol)], poolId },
      page: { pageSize, ...(pageToken ? { pageToken } : {}) },
    }),
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(`Uniswap swap request failed: ${response.status}`)

  const parsed = swapPageSchema.parse(await response.json())
  const wanted = poolId.toLowerCase()

  const swaps = parsed.transactions
    .filter(
      (entry) =>
        entry.poolId.toLowerCase() === wanted &&
        entry.eventType === 'TRANSACTION_EVENT_TYPE_SWAP',
    )
    .map((entry) => ({
      timestampMs: Number(entry.timestampMs),
      amountUsd: Math.abs(entry.amountUsd ?? 0),
      walletAddress: entry.walletAddress ?? '',
      amount0: Number(entry.token0?.amount ?? 0),
      amount1: Number(entry.token1?.amount ?? 0),
    }))
    .filter((swap) => Number.isFinite(swap.timestampMs))

  return { swaps, nextPageToken: parsed.page?.nextPageToken ?? null }
}

/**
 * Fetches one page of transactions for a single pool.
 *
 * The returned rows are filtered back down to the requested pool before use. The API accepts
 * a `poolIds` array and a comma joined `poolId` without complaint, but silently ignores both
 * and answers with the chain wide firehose, so a response that looks correct can describe
 * twenty other pools. Filtering on the way out makes that failure mode impossible to inherit.
 */
const fetchPoolTransactions = async (
  { poolId, protocol, chainId }: ActivityTarget,
  sampleSize: number,
): Promise<ActivitySample[]> => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: GATEWAY_HEADERS,
    body: JSON.stringify({
      chainIds: [chainId],
      filter: { protocolVersions: [protocolVersionFor(protocol)], poolId },
      page: { pageSize: sampleSize },
    }),
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(`Uniswap request failed: ${response.status}`)

  const { transactions } = listTransactionsSchema.parse(await response.json())
  const wanted = poolId.toLowerCase()

  return transactions.filter((entry) => entry.poolId.toLowerCase() === wanted)
}

/** Runs `task` over `items`, keeping at most `limit` requests in flight. */
const mapWithConcurrency = async <TIn, TOut>(
  items: TIn[],
  limit: number,
  task: (item: TIn) => Promise<TOut>,
): Promise<TOut[]> => {
  const results = new Array<TOut>(items.length)
  let cursor = 0

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Measures recent trade activity for each pool id.
 *
 * A pool whose request fails is omitted from the map rather than failing the batch, so the
 * table renders with a blank frequency cell instead of no table at all.
 *
 * `sampleSize` trades payload against the span a measurement covers. The default suits the full
 * sweep, where 2,600 pools make throughput the constraint; a caller measuring a handful of pools
 * should ask for more.
 */
export const fetchActivity = async (
  targets: ActivityTarget[],
  sampleSize: number = TX_SAMPLE_SIZE,
): Promise<Map<string, Activity>> => {
  // Pools on protocols the feed does not index are dropped before any request. Asking about an
  // Aerodrome pool returns an empty list rather than an error, so without this they would be
  // retried on every sweep and never measured.
  const askable = targets.filter((target) => hasTransactionFeed(target.protocol))

  const entries = await mapWithConcurrency(askable, FETCH_CONCURRENCY, async (target) => {
    // One retry, because the gateway returns intermittent 5xx under a sustained sweep and a
    // single failure previously stranded that pool for the rest of the pass.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const activity = computeActivity(await fetchPoolTransactions(target, sampleSize))
        return [target.poolId.toLowerCase(), activity] as const
      } catch {
        if (attempt === 1) return null
      }
    }

    return null
  })

  return new Map(entries.filter((entry): entry is [string, Activity] => entry !== null))
}
