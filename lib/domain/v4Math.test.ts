import { describe, expect, it } from 'vitest'
import { amountsForLiquidity, sqrtPriceAtTick, MIN_TICK, MAX_TICK, Q96 } from './v4Math'

describe('sqrtPriceAtTick', () => {
  it('is exactly 2^96 at tick zero', () => {
    expect(sqrtPriceAtTick(0)).toBe(Q96)
  })

  it('matches the published bounds at the extremes', () => {
    // MIN_SQRT_PRICE and MAX_SQRT_PRICE as v4-core publishes them. If any ported constant were
    // wrong these would drift, since the extreme ticks exercise every magic constant at once.
    expect(sqrtPriceAtTick(MIN_TICK)).toBe(4_295_128_739n)
    expect(sqrtPriceAtTick(MAX_TICK)).toBe(
      1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n,
    )
  })

  it('tracks the closed form within float precision at every individual bit', () => {
    // Each power-of-two tick uses exactly one magic constant, so a typo in any one of the
    // twenty shows up at its own bit rather than hiding in an aggregate.
    for (let bit = 0; bit < 20; bit += 1) {
      const tick = 2 ** bit
      const exact = Number(sqrtPriceAtTick(tick)) / Number(Q96)
      const expected = Math.sqrt(1.0001 ** tick)
      expect(Math.abs(exact / expected - 1)).toBeLessThan(1e-9)

      const exactNeg = Number(sqrtPriceAtTick(-tick)) / Number(Q96)
      expect(Math.abs(exactNeg / (1 / expected) - 1)).toBeLessThan(1e-9)
    }
  })

  it('is strictly increasing', () => {
    expect(sqrtPriceAtTick(1)).toBeGreaterThan(sqrtPriceAtTick(0))
    expect(sqrtPriceAtTick(0)).toBeGreaterThan(sqrtPriceAtTick(-1))
  })

  it('rejects a tick outside the domain', () => {
    expect(() => sqrtPriceAtTick(MAX_TICK + 1)).toThrow(/tick/i)
  })
})

describe('amountsForLiquidity', () => {
  const L = 10n ** 18n

  it('needs both tokens when the price sits inside the range', () => {
    const { amount0, amount1 } = amountsForLiquidity(
      sqrtPriceAtTick(0),
      -600,
      600,
      L,
    )

    expect(amount0 > 0n).toBe(true)
    expect(amount1 > 0n).toBe(true)
  })

  it('is symmetric around the middle of a symmetric range', () => {
    // At price 1 with a symmetric range, both sides carry the same value; amount0 is in token0
    // units and amount1 in token1 units, and at price 1 those units coincide.
    const { amount0, amount1 } = amountsForLiquidity(sqrtPriceAtTick(0), -600, 600, L)
    const drift = amount0 > amount1 ? amount0 - amount1 : amount1 - amount0

    expect(drift * 1_000_000n < amount0).toBe(true)
  })

  it('needs only token0 when the price is below the range', () => {
    const { amount0, amount1 } = amountsForLiquidity(sqrtPriceAtTick(-1_200), -600, 600, L)

    expect(amount0 > 0n).toBe(true)
    expect(amount1).toBe(0n)
  })

  it('needs only token1 when the price is above the range', () => {
    const { amount0, amount1 } = amountsForLiquidity(sqrtPriceAtTick(1_200), -600, 600, L)

    expect(amount0).toBe(0n)
    expect(amount1 > 0n).toBe(true)
  })

  it('matches the closed form for amount1 above the range', () => {
    // amount1 = L * (sqrtUpper - sqrtLower) / Q96, rounded up: directly checkable.
    const sqrtLower = sqrtPriceAtTick(0)
    const sqrtUpper = sqrtPriceAtTick(60)
    const { amount1 } = amountsForLiquidity(sqrtPriceAtTick(120), 0, 60, L)

    const numerator = L * (sqrtUpper - sqrtLower)
    const expected = numerator / Q96 + (numerator % Q96 > 0n ? 1n : 0n)
    expect(amount1).toBe(expected)
  })

  it('rounds up, never down, so the amounts always cover the liquidity', () => {
    // One unit of liquidity across a one-tick range costs a fraction of a wei; the contract
    // still charges a whole one.
    const { amount1 } = amountsForLiquidity(sqrtPriceAtTick(120), 0, 60, 1n)

    expect(amount1).toBe(1n)
  })

  it('normalises a reversed range rather than producing negative amounts', () => {
    const forward = amountsForLiquidity(sqrtPriceAtTick(0), -600, 600, L)
    const reversed = amountsForLiquidity(sqrtPriceAtTick(0), 600, -600, L)

    expect(reversed).toEqual(forward)
  })
})
