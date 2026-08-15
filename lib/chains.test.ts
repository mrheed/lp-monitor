import { afterEach, describe, expect, it } from 'vitest'
import { CHAINS, chainById, chainLabel, enabledChains, hasTransactionFeed } from './chains'

const original = process.env.LP_CHAINS

afterEach(() => {
  if (original === undefined) delete process.env.LP_CHAINS
  else process.env.LP_CHAINS = original
})

describe('the chain registry', () => {
  it('knows a chain by id', () => {
    expect(chainById(8453)?.label).toBe('Base')
  })

  it('names an untracked chain by its id rather than claiming not to know it', () => {
    expect(chainLabel(99_999)).toBe('Chain 99999')
  })

  it('gives every chain a distinct id and slug', () => {
    expect(new Set(CHAINS.map((chain) => chain.id)).size).toBe(CHAINS.length)
    expect(new Set(CHAINS.map((chain) => chain.slug)).size).toBe(CHAINS.length)
  })
})

describe('which chains are queried', () => {
  it('follows every known chain when nothing is configured', () => {
    delete process.env.LP_CHAINS

    expect(enabledChains()).toHaveLength(CHAINS.length)
  })

  it('narrows to the configured ids', () => {
    process.env.LP_CHAINS = '8453,1'

    expect(enabledChains().map((chain) => chain.label)).toEqual(['Ethereum', 'Base'])
  })

  it('keeps registry order rather than the order they were typed', () => {
    // Stable grouping in the table matters more than honouring the order of an env var.
    process.env.LP_CHAINS = '1,4663'

    expect(enabledChains().map((chain) => chain.id)).toEqual([4663, 1])
  })

  it('drops an unknown id rather than querying a chain the feed does not index', () => {
    // The feed answers with an empty result for a chain it does not know, which reads exactly
    // like a chain that has no pools.
    process.env.LP_CHAINS = '8453,999999'

    expect(enabledChains().map((chain) => chain.id)).toEqual([8453])
  })

  it('falls back to every chain when the setting names none that exist', () => {
    process.env.LP_CHAINS = 'nonsense'

    expect(enabledChains()).toHaveLength(CHAINS.length)
  })
})

describe('which pools have trade data', () => {
  it('accepts the Uniswap versions the transaction feed indexes', () => {
    expect(hasTransactionFeed('uniswapv3')).toBe(true)
    expect(hasTransactionFeed('uniswapv4')).toBe(true)
  })

  it('accepts v2, which the feed does serve', () => {
    // Excluded at first on the assumption the feed covered only concentrated liquidity, which
    // wrote off 360 pools across Ethereum, Base and Robinhood. Asking with PROTOCOL_VERSION_V2
    // returns their trades normally.
    expect(hasTransactionFeed('uniswapv2')).toBe(true)
  })

  it('rejects protocols the feed returns nothing for', () => {
    // Verified against Base: Aerodrome and PancakeSwap pools return an empty transaction list
    // rather than an error, so without this they would be swept forever and never measured.
    expect(hasTransactionFeed('aerodromecl')).toBe(false)
    expect(hasTransactionFeed('aerodromecl3')).toBe(false)
    expect(hasTransactionFeed('pancakev3')).toBe(false)
    expect(hasTransactionFeed('sushiv3')).toBe(false)
  })
})
