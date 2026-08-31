import { describe, expect, it } from 'vitest'
import { tradeSide } from './poolTrades'

const swap = (amount0: number, amount1: number) => ({
  timestampMs: 1_000,
  amountUsd: 100,
  walletAddress: '0x1',
  amount0,
  amount1,
})

describe('tradeSide', () => {
  it('reads the equity leaving the pool as a buy of that stock', () => {
    expect(tradeSide(swap(-1, 2_000), true)).toBe('buy')
    expect(tradeSide(swap(2_000, -1), false)).toBe('buy')
  })

  it('reads the equity entering the pool as a sell', () => {
    expect(tradeSide(swap(1, -2_000), true)).toBe('sell')
    expect(tradeSide(swap(-2_000, 1), false)).toBe('sell')
  })

  it('is decided by the equity side, not by whichever amount is larger', () => {
    // The quote leg dwarfs the equity leg, and the direction still follows the equity.
    expect(tradeSide(swap(-0.0001, 900_000), true)).toBe('buy')
  })
})
