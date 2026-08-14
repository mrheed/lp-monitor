import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchActivity } from './uniswap'
import { TX_SAMPLE_SIZE, TX_SAMPLE_SIZE_WATCHED } from '../config'

const POOL = '0xabc'

/** Captures the request bodies sent, answering each with an empty transaction list. */
const captureRequests = () => {
  const bodies: Record<string, unknown>[] = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ transactions: [] }), {
        headers: { 'content-type': 'application/json' },
      })
    }),
  )

  return bodies
}

/** Reads the page size out of a captured request body without asserting its type. */
const pageSizeOf = (body: unknown): unknown => {
  if (typeof body !== 'object' || body === null) return undefined
  const page = Reflect.get(body, 'page')
  if (typeof page !== 'object' || page === null) return undefined
  return Reflect.get(page, 'pageSize')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the sample size', () => {
  it('defaults to the sweep size, which is tuned for covering every pool', () => {
    // The full sweep pays this cost 2,600 times over, where payload size governs throughput.
    expect(TX_SAMPLE_SIZE).toBe(25)
  })

  it('is the maximum the endpoint allows for watched pools', () => {
    // Measured: 150 and above is rejected with "page_size exceeds maximum of 100". Watched pools
    // are few, so they can afford the largest page the API will serve.
    expect(TX_SAMPLE_SIZE_WATCHED).toBe(100)
  })

  it('sends the default when a caller asks for nothing in particular', async () => {
    const bodies = captureRequests()

    await fetchActivity([{ poolId: POOL, protocol: 'uniswapv4', chainId: 4663 }])

    expect(pageSizeOf(bodies[0])).toBe(TX_SAMPLE_SIZE)
  })

  it('sends the size a caller asks for', async () => {
    // Without this the watcher's larger request would silently collapse back to 25, and the
    // longer span it exists to buy would never arrive.
    const bodies = captureRequests()

    await fetchActivity([{ poolId: POOL, protocol: 'uniswapv4', chainId: 4663 }], TX_SAMPLE_SIZE_WATCHED)

    expect(pageSizeOf(bodies[0])).toBe(TX_SAMPLE_SIZE_WATCHED)
  })
})
