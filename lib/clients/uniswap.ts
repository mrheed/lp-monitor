import { z } from 'zod'
import { CHAIN_ID, FETCH_CONCURRENCY, TX_SAMPLE_SIZE } from '../config'
import { computeActivity, type ActivitySample } from '../domain/activity'
import type { Activity } from '../types'

const ENDPOINT =
  'https://entry-gateway.backend-prod.api.uniswap.org/data.v2.DataApiService/ListTransactions'

const transactionSchema = z.object({
  poolId: z.string().default(''),
  timestampMs: z.string(),
  // Distinguishes a swap from a liquidity add or remove; the feed mixes all three.
  eventType: z.string().optional(),
  walletAddress: z.string().optional(),
  amountUsd: z.number().optional(),
})

const listTransactionsSchema = z.object({
  transactions: z.array(transactionSchema).default([]),
})

/** A pool to measure, carrying the protocol its id belongs to. */
export type ActivityTarget = { poolId: string; protocol: string }

/**
 * Maps a Krystal protocol name to the Uniswap protocol version enum.
 *
 * The pool feed mixes v3 and v4 despite the protocol query param, and the two use different
 * id shapes: v3 pools are 20 byte contract addresses, v4 pools are 32 byte pool ids. Asking
 * for the wrong version returns transactions that never match the requested id.
 */
export const protocolVersionFor = (protocol: string) =>
  protocol.toLowerCase().includes('v3') ? 'PROTOCOL_VERSION_V3' : 'PROTOCOL_VERSION_V4'

/**
 * Fetches one page of transactions for a single pool.
 *
 * The returned rows are filtered back down to the requested pool before use. The API accepts
 * a `poolIds` array and a comma joined `poolId` without complaint, but silently ignores both
 * and answers with the chain wide firehose, so a response that looks correct can describe
 * twenty other pools. Filtering on the way out makes that failure mode impossible to inherit.
 */
const fetchPoolTransactions = async (
  { poolId, protocol }: ActivityTarget,
  sampleSize: number,
): Promise<ActivitySample[]> => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      'connect-protocol-version': '1',
      origin: 'https://app.uniswap.org',
      referer: 'https://app.uniswap.org/',
      'x-request-source': 'uniswap-web',
    },
    body: JSON.stringify({
      chainIds: [CHAIN_ID],
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
  const entries = await mapWithConcurrency(targets, FETCH_CONCURRENCY, async (target) => {
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
