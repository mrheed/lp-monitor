import { describe, expect, it } from 'vitest'
import { isStockPool } from './stockTokens'
import { buildStockFlag } from './pools'

// Guards the contract the table and the sampler both rely on: a PoolRow carries enough to be
// classified without re-reading the feed.
describe('PoolRow stock classification', () => {
  it('classifies from the row fields alone', () => {
    const row = {
      token0Address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
      token1Address: '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec',
    }

    expect(isStockPool(row)).toBe(true)
  })

  it('leaves a memecoin pool unflagged', () => {
    const row = {
      token0Address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
      token1Address: '0x7e86381a763f0ecca2bdf27c54eac403ddd48123',
    }

    expect(isStockPool(row)).toBe(false)
  })
})

describe('buildStockFlag', () => {
  it('reads both sides of the Krystal pool', () => {
    expect(
      buildStockFlag({
        token0: { address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73' },
        token1: { address: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c' },
      }),
    ).toBe(true)
  })
})
