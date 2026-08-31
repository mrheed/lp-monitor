import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPoolSwaps, seekPageToken } from './uniswap'

const target = { poolId: '0xAbC', protocol: 'uniswapv3', chainId: 4663 }

/** Replies with one ListTransactions body, capturing the request for assertions. */
const stubFetch = (body: unknown) => {
  const spy = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify(body), { status: 200 }))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => vi.unstubAllGlobals())

describe('seekPageToken', () => {
  it('encodes the cursor the feed expects', () => {
    const decoded: unknown = JSON.parse(atob(seekPageToken(1_788_109_384_000, 4663)))

    expect(decoded).toMatchObject({ timestampMs: 1_788_109_384_000, chainId: 4663 })
  })
})

describe('fetchPoolSwaps', () => {
  it('keeps only swaps belonging to the requested pool', async () => {
    stubFetch({
      transactions: [
        { poolId: '0xabc', timestampMs: '1000', eventType: 'TRANSACTION_EVENT_TYPE_SWAP', amountUsd: 10, walletAddress: '0x1' },
        { poolId: '0xOTHER', timestampMs: '2000', eventType: 'TRANSACTION_EVENT_TYPE_SWAP', amountUsd: 99, walletAddress: '0x2' },
      ],
      page: {},
    })

    const { swaps } = await fetchPoolSwaps(target)

    expect(swaps).toEqual([
      { timestampMs: 1000, amountUsd: 10, walletAddress: '0x1', amount0: 0, amount1: 0 },
    ])
  })

  it('drops liquidity events, which are not volume', async () => {
    stubFetch({
      transactions: [
        { poolId: '0xabc', timestampMs: '1000', eventType: 'TRANSACTION_EVENT_TYPE_ADD', amountUsd: 500 },
      ],
      page: {},
    })

    const { swaps } = await fetchPoolSwaps(target)

    expect(swaps).toEqual([])
  })

  it('reads a negative amountUsd as its magnitude', async () => {
    stubFetch({
      transactions: [
        { poolId: '0xabc', timestampMs: '1000', eventType: 'TRANSACTION_EVENT_TYPE_SWAP', amountUsd: -42 },
      ],
      page: {},
    })

    const { swaps } = await fetchPoolSwaps(target)

    expect(swaps[0].amountUsd).toBe(42)
  })

  it('returns the continuation token when the feed gives one', async () => {
    stubFetch({ transactions: [], page: { nextPageToken: 'abc123' } })

    const { nextPageToken } = await fetchPoolSwaps(target)

    expect(nextPageToken).toBe('abc123')
  })

  it('sends the seek token when asked to start from a point in time', async () => {
    const spy = stubFetch({ transactions: [], page: {} })

    await fetchPoolSwaps(target, { pageToken: 'seek-me', pageSize: 50 })

    const body: unknown = JSON.parse(String(spy.mock.calls[0][1]?.body))
    expect(body).toMatchObject({ page: { pageSize: 50, pageToken: 'seek-me' } })
  })

  it('throws on a non-ok response so the caller can retry or skip', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })))

    await expect(fetchPoolSwaps(target)).rejects.toThrow('502')
  })
})
