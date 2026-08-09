import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTopPools } from './krystal'

const CHALLENGE_HTML =
  '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>' +
  '<noscript>Enable JavaScript and cookies to continue</noscript></body></html>'

/** Replaces fetch with one canned response. */
const respondWith = (body: string, { status = 200, contentType = 'text/html' } = {}) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(body, { status, headers: { 'content-type': contentType } }),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a Cloudflare challenge', () => {
  it('is named, rather than surfacing as a schema failure', async () => {
    // The challenge arrives as HTML with a 200, so the status alone does not reveal it. Left
    // unchecked it reached the schema and complained about a missing `result` field, which tells
    // nobody what actually happened.
    respondWith(CHALLENGE_HTML)

    await expect(fetchTopPools()).rejects.toThrow(/Cloudflare challenge/)
  })

  it('says the host is the likely cause, which is the actionable part', async () => {
    respondWith(CHALLENGE_HTML)

    await expect(fetchTopPools()).rejects.toThrow(/host IP/)
  })

  it('is detected even when served with an error status', async () => {
    respondWith(CHALLENGE_HTML, { status: 403 })

    await expect(fetchTopPools()).rejects.toThrow(/Cloudflare challenge/)
  })

  it('leaves a genuine HTTP failure reported as itself', async () => {
    respondWith('{"error":"nope"}', { status: 500, contentType: 'application/json' })

    await expect(fetchTopPools()).rejects.toThrow(/500/)
  })

  it('passes real data through untouched', async () => {
    respondWith(JSON.stringify({ result: [] }), { contentType: 'application/json' })

    await expect(fetchTopPools()).resolves.toEqual([])
  })

  it('sends headers a browser would, so a bare request does not invite a challenge', async () => {
    respondWith(JSON.stringify({ result: [] }), { contentType: 'application/json' })

    await fetchTopPools()

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const headers = (init?.headers ?? {}) as Record<string, string>

    expect(headers['user-agent']).toContain('Mozilla')
    expect(headers.referer).toContain('krystal.app')
  })
})
