import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPoolHistory, hasGraphHistory } from './uniswapGraph'

const v3 = { poolId: '0xabc', protocol: 'uniswapv3', chainId: 4663 }
const v4 = { poolId: '0xdef', protocol: 'uniswapv4', chainId: 4663 }

const stub = (body: unknown, ok = true) => {
  const spy = vi.fn(async (..._args: Parameters<typeof fetch>) =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 502 }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => vi.unstubAllGlobals())

describe('hasGraphHistory', () => {
  it('accepts a mapped chain', () => {
    expect(hasGraphHistory(4663, 'uniswapv3')).toBe(true)
  })

  it('rejects a chain the gateway does not name', () => {
    expect(hasGraphHistory(999_999, 'uniswapv3')).toBe(false)
  })

  it('rejects v2, which this query cannot address', () => {
    expect(hasGraphHistory(4663, 'uniswapv2')).toBe(false)
  })
})

describe('fetchPoolHistory', () => {
  it('turns points into buckets stamped at the end of their interval, on the step grid', async () => {
    stub({ data: { v3Pool: { historicalVolume: [{ timestamp: 1000, value: 500 }] } } })

    const buckets = await fetchPoolHistory(v3, '1d')

    // Opens at 1000s, so it closes inside the first hour and lands on that hour's boundary.
    expect(buckets).toEqual([
      { hourEndMs: 3_600_000, volumeUsd: 500, swaps: 0, spanMs: 3_600_000 },
    ])
  })

  it('carries the range step as the span, so no scaling is needed to compare pools', async () => {
    stub({ data: { v3Pool: { historicalVolume: [{ timestamp: 1000, value: 5 }] } } })

    expect((await fetchPoolHistory(v3, '1m'))?.[0].spanMs).toBe(24 * 3_600_000)
  })

  it('reads the v4 pool field when the protocol is v4', async () => {
    stub({ data: { v4Pool: { historicalVolume: [{ timestamp: 1000, value: 7 }] } } })

    expect((await fetchPoolHistory(v4, '1d'))?.[0].volumeUsd).toBe(7)
  })

  it('addresses v4 by poolId and v3 by address, since the wrong one silently returns null', async () => {
    const spy = stub({ data: { v4Pool: { historicalVolume: [] } } })
    await fetchPoolHistory(v4, '1d')

    const body = String(spy.mock.calls[0][1]?.body)
    expect(body).toContain('v4Pool(chain: $chain, poolId: $id)')
  })

  it('returns null on a GraphQL error rather than an empty series', async () => {
    stub({ errors: [{ message: 'FORBIDDEN' }] })

    expect(await fetchPoolHistory(v3, '1d')).toBeNull()
  })

  it('returns null on a failed request', async () => {
    stub({}, false)

    expect(await fetchPoolHistory(v3, '1d')).toBeNull()
  })

  it('returns null for an unsupported chain without calling out', async () => {
    const spy = stub({})

    expect(await fetchPoolHistory({ ...v3, chainId: 999_999 }, '1d')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('sorts points oldest first and drops malformed ones', async () => {
    stub({
      data: {
        v3Pool: {
          historicalVolume: [
            { timestamp: 4000, value: 2 },
            { timestamp: 1000, value: 1 },
          ],
        },
      },
    })

    const buckets = await fetchPoolHistory(v3, '1d')
    expect(buckets?.map((b) => b.volumeUsd)).toEqual([1, 2])
  })
})

describe('grid alignment', () => {
  it('snaps points to the step grid, so pools phased differently still sum together', async () => {
    // The API phases each pool to its own offset; these two are 72 seconds apart in the same hour.
    stub({ data: { v3Pool: { historicalVolume: [{ timestamp: 3600 + 1148, value: 1 }] } } })
    const a = await fetchPoolHistory(v3, '1d')

    stub({ data: { v3Pool: { historicalVolume: [{ timestamp: 3600 + 1220, value: 2 }] } } })
    const b = await fetchPoolHistory(v3, '1d')

    expect(a?.[0].hourEndMs).toBe(b?.[0].hourEndMs)
    expect(a?.[0].hourEndMs! % 3_600_000).toBe(0)
  })
})
