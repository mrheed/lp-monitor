import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChallengeError, fetchTopPools } from './krystal'

/** One chain is enabled, so a call to fetchTopPools is one upstream read. */
process.env.LP_CHAINS = '4663'

const body = JSON.stringify({ result: [] })
const jsonResponse = () =>
  new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Krystal read retries', () => {
  it('retries a connection failure and succeeds on a later attempt', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (..._a: Parameters<typeof fetch>) => {
      calls += 1
      if (calls === 1) throw new TypeError('fetch failed')
      return jsonResponse()
    }))

    await expect(fetchTopPools()).resolves.toEqual([])
    expect(calls).toBe(2)
  })

  it('gives up after the cap rather than retrying forever', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (..._a: Parameters<typeof fetch>) => {
      calls += 1
      throw new TypeError('fetch failed')
    }))

    await expect(fetchTopPools()).rejects.toThrow('fetch failed')
    expect(calls).toBe(3)
  })

  it('does not retry a Cloudflare challenge, which repeating only worsens', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (..._a: Parameters<typeof fetch>) => {
      calls += 1
      return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } })
    }))

    await expect(fetchTopPools()).rejects.toBeInstanceOf(ChallengeError)
    expect(calls).toBe(1)
  })

  it('does not retry a 4xx, which says something about the request', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (..._a: Parameters<typeof fetch>) => {
      calls += 1
      return new Response('nope', { status: 404, headers: { 'content-type': 'application/json' } })
    }))

    await expect(fetchTopPools()).rejects.toThrow('404')
    expect(calls).toBe(1)
  })
})
