import { z } from 'zod'
import type { VolumeBucket } from '../domain/volumeHistory'
import { rangeSpec, type VolumeRange } from '../domain/volumeRanges'

const ENDPOINT = 'https://interface.gateway.uniswap.org/v1/graphql'

/**
 * The gateway's own chain names.
 *
 * Its `Chain` enum is not the numeric id, and it does not accept one. A chain absent from this
 * map has no history here, which is different from having none at all, so callers get null rather
 * than an empty series they would read as a quiet pool.
 */
const GRAPH_CHAINS: Record<number, string> = {
  1: 'ETHEREUM',
  10: 'OPTIMISM',
  56: 'BNB',
  137: 'POLYGON',
  4663: 'ROBINHOOD',
  8453: 'BASE',
  42161: 'ARBITRUM',
}

/** Headers the web app sends. The gateway answers a bare request with FORBIDDEN. */
const HEADERS = {
  accept: '*/*',
  'content-type': 'application/json',
  origin: 'https://app.uniswap.org',
  referer: 'https://app.uniswap.org/',
  'x-request-source': 'uniswap-web',
}

const pointSchema = z.object({
  timestamp: z.number(),
  value: z.number(),
})

const responseSchema = z.object({
  data: z
    .object({
      v3Pool: z.object({ historicalVolume: z.array(pointSchema).nullish() }).nullish(),
      v4Pool: z.object({ historicalVolume: z.array(pointSchema).nullish() }).nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
})

/**
 * v4 pools are addressed by `poolId` and v3 by `address`, and the field names differ too.
 *
 * Asking for the wrong one returns a null pool rather than an error, which reads exactly like a
 * pool nobody trades.
 */
const queryFor = (protocol: string) =>
  protocol.toLowerCase().includes('v4')
    ? `query PoolVolume($chain: Chain!, $id: String!, $duration: HistoryDuration!) {
         v4Pool(chain: $chain, poolId: $id) { historicalVolume(duration: $duration) { timestamp value } }
       }`
    : `query PoolVolume($chain: Chain!, $id: String!, $duration: HistoryDuration!) {
         v3Pool(chain: $chain, address: $id) { historicalVolume(duration: $duration) { timestamp value } }
       }`

/** Whether this chain and protocol can be asked at all. */
export const hasGraphHistory = (chainId: number, protocol: string): boolean =>
  GRAPH_CHAINS[chainId] !== undefined && !protocol.toLowerCase().includes('v2')

/**
 * One pool's volume history over a range.
 *
 * Each point is a whole interval the API measured, not a sample of one, so the bucket's span is
 * the range's own step. That is the difference from the swap sampler, where the span was however
 * long a page of trades happened to cover and every reading had to be scaled before it could be
 * compared with another.
 *
 * Returns null when the chain is unsupported or the request fails, so a caller can tell "no data
 * for this pool" apart from "this pool did not trade".
 */
export const fetchPoolHistory = async (
  target: { poolId: string; protocol: string; chainId: number },
  range: VolumeRange,
): Promise<VolumeBucket[] | null> => {
  const chain = GRAPH_CHAINS[target.chainId]
  if (chain === undefined || !hasGraphHistory(target.chainId, target.protocol)) return null

  const { duration, stepMs } = rangeSpec(range)

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      query: queryFor(target.protocol),
      variables: { chain, id: target.poolId, duration },
    }),
    cache: 'no-store',
  })

  if (!response.ok) return null

  const parsed = responseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success || parsed.data.errors?.length) return null

  const points = parsed.data.data?.v3Pool?.historicalVolume ?? parsed.data.data?.v4Pool?.historicalVolume
  if (!points) return null

  return points
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value))
    .map((point) => ({
      /*
       * The API stamps each point at the start of its interval; buckets are keyed by the end.
       *
       * Snapped to the step grid because the API phases each pool to its own offset: three pools
       * asked for the same hour came back at 07:19:08, 07:20:20 and 07:19:11. Summing on the raw
       * stamps merges nothing, and the total becomes one pool per bar instead of their sum.
       */
      hourEndMs: Math.round((point.timestamp * 1000 + stepMs) / stepMs) * stepMs,
      volumeUsd: Math.max(point.value, 0),
      // Unknown from this endpoint, and not needed: nothing reads swap counts off a history point.
      swaps: 0,
      spanMs: stepMs,
    }))
    .sort((a, b) => a.hourEndMs - b.hourEndMs)
}
