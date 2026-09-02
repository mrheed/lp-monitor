import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
    expect(robinhoodRpcUrls()).toEqual([...ROBINHOOD_FALLBACK_RPCS])
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

    expect(robinhoodRpcUrls()).toEqual([...ROBINHOOD_FALLBACK_RPCS])
  })
})

/*
 * A behavioural test cannot catch this: these run in Node, where a dynamic process.env lookup
 * works fine. The failure only appears in a browser bundle, where Next has to have seen the
 * variable name in the source to substitute it. So the guard is on the source itself.
 */
describe('client bundle safety', () => {
  it('reads NEXT_PUBLIC_ variables by literal name, so Next can inline them', () => {
    const source = readFileSync(fileURLToPath(new URL('./rpc.ts', import.meta.url)), 'utf8')
    // Comments explain the rule and naturally quote the thing it forbids, so judge the code only.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

    expect(code).toContain('process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL')
    expect(code).not.toMatch(/process\.env\[/)
  })
})
