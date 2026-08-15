import { describe, expect, it } from 'vitest'
import { planIncrease, type OpenPosition, type PoolState } from './addLiquidity'
import { amountsForLiquidity, sqrtPriceAtTick } from './v4Math'

/**
 * Liquidity and value drawn from a real position; the range is symmetric around tick zero so
 * the expected amounts are hand-checkable.
 */
const position = (over: Partial<OpenPosition> = {}): OpenPosition => ({
  liquidity: 17_419_282_465_200_987n,
  amounts: [
    { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', rawBalance: 803_065_241_726_039_405n, decimals: 18, valueUsd: 1_511.18 },
    { address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', rawBalance: 753_705_669n, decimals: 6, valueUsd: 753.6 },
  ],
  valueUsd: 2_273.8,
  ...over,
})

const inRange: PoolState = { sqrtPriceX96: sqrtPriceAtTick(0), tickLower: -600, tickUpper: 600 }

describe('planning an increase', () => {
  it('scales liquidity by the share of current value being added', () => {
    // Position value is linear in liquidity, so a USD share maps to the same liquidity share.
    const plan = planIncrease(position(), { depositUsd: 227.38, slippagePercent: 1 }, inRange)

    const expected = (17_419_282_465_200_987n * 227_380n) / 2_273_800n
    const drift = plan.liquidityDelta > expected ? plan.liquidityDelta - expected : expected - plan.liquidityDelta
    expect(drift * 10_000n < expected).toBe(true)
  })

  it('derives the amounts from the pool state, not from the indexed balances', () => {
    // The first design scaled the indexer's balances proportionally and reverted on chain: a
    // 0.6% wide range had shifted its composition between indexing and execution. The amounts
    // must be exactly what the pool's own math charges for the delta at the current price.
    const plan = planIncrease(position(), { depositUsd: 227.38, slippagePercent: 0 }, inRange)
    const exact = amountsForLiquidity(inRange.sqrtPriceX96, -600, 600, plan.liquidityDelta)

    expect(plan.maxAmounts[0].rawAmount).toBe(exact.amount0)
    expect(plan.maxAmounts[1].rawAmount).toBe(exact.amount1)
  })

  it('pads the maximums by the slippage allowance', () => {
    const tight = planIncrease(position(), { depositUsd: 227.38, slippagePercent: 0 }, inRange)
    const padded = planIncrease(position(), { depositUsd: 227.38, slippagePercent: 1 }, inRange)

    expect(padded.maxAmounts[0].rawAmount).toBe((tight.maxAmounts[0].rawAmount * 10_100n) / 10_000n)
  })

  it('needs only one token when the price sits outside the range', () => {
    // Above the range the position is entirely token1; the token0 maximum must be exactly zero
    // so SETTLE_PAIR never tries to pull a token the position does not need.
    const above: PoolState = { ...inRange, sqrtPriceX96: sqrtPriceAtTick(1_200) }
    const plan = planIncrease(position(), { depositUsd: 227.38, slippagePercent: 1 }, above)

    expect(plan.maxAmounts[0].rawAmount).toBe(0n)
    expect(plan.maxAmounts[1].rawAmount > 0n).toBe(true)
  })

  it('keeps the token order of the position, which is the pool order', () => {
    const plan = planIncrease(position(), { depositUsd: 100, slippagePercent: 1 }, inRange)

    expect(plan.maxAmounts[0].address).toBe('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
    expect(plan.maxAmounts[1].address).toBe('0x5fc5360d0400a0fd4f2af552add042d716f1d168')
  })

  it('refuses a deposit into a closed position', () => {
    expect(() =>
      planIncrease(position({ liquidity: 0n }), { depositUsd: 100, slippagePercent: 1 }, inRange),
    ).toThrow(/closed|no liquidity/i)
  })

  it('refuses a deposit of nothing', () => {
    expect(() => planIncrease(position(), { depositUsd: 0, slippagePercent: 1 }, inRange)).toThrow(
      /deposit/i,
    )
  })

  it('refuses a position whose value is unknown, rather than dividing by it', () => {
    expect(() =>
      planIncrease(position({ valueUsd: 0 }), { depositUsd: 100, slippagePercent: 1 }, inRange),
    ).toThrow(/value/i)
  })
})
