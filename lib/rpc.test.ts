import { afterEach, describe, expect, it } from 'vitest'
import { ROBINHOOD_FALLBACK_RPCS, robinhoodRpcUrls } from './rpc'

const PRIVATE = 'ROBINHOOD_RPC_URL'
const PUBLIC = 'NEXT_PUBLIC_ROBINHOOD_RPC_URL'

afterEach(() => {
  delete process.env[PRIVATE]
  delete process.env[PUBLIC]
})

describe('robinhoodRpcUrls', () => {
  it('falls back to the public endpoints when nothing is configured', () => {
    expect(robinhoodRpcUrls()).toEqual(ROBINHOOD_FALLBACK_RPCS)
  })

  it('puts a configured endpoint first, keeping the public ones behind it', () => {
    process.env[PRIVATE] = 'https://example.test/rpc'

    expect(robinhoodRpcUrls()).toEqual(['https://example.test/rpc', ...ROBINHOOD_FALLBACK_RPCS])
  })

  it('prefers the private variable over the public one on the server', () => {
    process.env[PRIVATE] = 'https://private.test/rpc'
    process.env[PUBLIC] = 'https://public.test/rpc'

    expect(robinhoodRpcUrls()[0]).toBe('https://private.test/rpc')
  })

  it('uses the public variable when only it is set, which is what the browser sees', () => {
    process.env[PUBLIC] = 'https://public.test/rpc'

    expect(robinhoodRpcUrls()[0]).toBe('https://public.test/rpc')
  })

  it('ignores a blank or whitespace value rather than sending requests nowhere', () => {
    process.env[PRIVATE] = '   '

    expect(robinhoodRpcUrls()).toEqual(ROBINHOOD_FALLBACK_RPCS)
  })

  it('never lists the same endpoint twice when it also appears in the fallbacks', () => {
    process.env[PRIVATE] = ROBINHOOD_FALLBACK_RPCS[0]

    expect(robinhoodRpcUrls()).toEqual(ROBINHOOD_FALLBACK_RPCS)
  })
})
