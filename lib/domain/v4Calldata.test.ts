import { describe, expect, it } from 'vitest'
import { decodeAbiParameters, decodeFunctionData, parseAbi } from 'viem'
import { ACTIONS, NATIVE, buildIncreaseCalldata, toV4Currency } from './v4Calldata'

const MODIFY_LIQUIDITIES = parseAbi([
  'function modifyLiquidities(bytes unlockData, uint256 deadline)',
])

const input = {
  tokenId: 701_650n,
  liquidityDelta: 1_741_928_246_520_098n,
  currency0: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  currency1: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
  amount0Max: 81_000_000_000_000_000n,
  amount1Max: 76_000_000n,
  recipient: '0x1111111111111111111111111111111111111111',
  deadlineSeconds: 1_755_300_000n,
} as const

/** Decodes the built calldata back to its unlock plan, so every assertion reads real bytes. */
const decode = (data: `0x${string}`) => {
  const call = decodeFunctionData({ abi: MODIFY_LIQUIDITIES, data })
  const [unlockData, deadline] = call.args
  const [actions, params] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    unlockData,
  )
  return { actions, params, deadline }
}

describe('the v4 increase calldata', () => {
  it('calls modifyLiquidities with the deadline it was given', () => {
    const { deadline } = decode(buildIncreaseCalldata(input))

    expect(deadline).toBe(1_755_300_000n)
  })

  it('encodes increase, settle pair, then sweep, in that order', () => {
    // Order is the contract's protocol: the increase creates the debt, SETTLE_PAIR pays it in
    // both currencies, and SWEEP refunds whatever native currency the maximum overshot by.
    // Constants verified against v4-periphery Actions.sol, not recalled.
    const { actions } = decode(buildIncreaseCalldata(input))

    expect(actions).toBe(
      `0x${[ACTIONS.INCREASE_LIQUIDITY, ACTIONS.SETTLE_PAIR, ACTIONS.SWEEP]
        .map((a) => a.toString(16).padStart(2, '0'))
        .join('')}`,
    )
  })

  it('carries the position and limits in the increase parameters', () => {
    const { params } = decode(buildIncreaseCalldata(input))
    const [tokenId, liquidity, amount0Max, amount1Max, hookData] = decodeAbiParameters(
      [
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'uint128' },
        { type: 'uint128' },
        { type: 'bytes' },
      ],
      params[0],
    )

    expect(tokenId).toBe(701_650n)
    expect(liquidity).toBe(1_741_928_246_520_098n)
    expect(amount0Max).toBe(81_000_000_000_000_000n)
    expect(amount1Max).toBe(76_000_000n)
    expect(hookData).toBe('0x')
  })

  it('settles the pair in v4 currency form, where native is the zero address', () => {
    // Krystal reports native as 0xeee…e; the v4 PoolManager identifies it as address(0). Sending
    // the 0xeee form would name a currency the pool does not contain and revert.
    const { params } = decode(buildIncreaseCalldata(input))
    const [currency0, currency1] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }],
      params[1],
    )

    expect(currency0).toBe(NATIVE)
    expect(currency1.toLowerCase()).toBe(input.currency1)
  })

  it('sweeps unspent native currency back to the caller', () => {
    const { params } = decode(buildIncreaseCalldata(input))
    const [currency, to] = decodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }],
      params[2],
    )

    expect(currency).toBe(NATIVE)
    expect(to.toLowerCase()).toBe(input.recipient)
  })

  it('omits the sweep when neither side is native, where there is nothing to refund', () => {
    const { actions, params } = decode(
      buildIncreaseCalldata({
        ...input,
        currency0: '0x4200000000000000000000000000000000000006',
      }),
    )

    expect(actions).toBe(
      `0x${[ACTIONS.INCREASE_LIQUIDITY, ACTIONS.SETTLE_PAIR]
        .map((a) => a.toString(16).padStart(2, '0'))
        .join('')}`,
    )
    expect(params).toHaveLength(2)
  })
})

describe('currency translation', () => {
  it('maps the 0xeee sentinel to the zero address', () => {
    expect(toV4Currency('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')).toBe(NATIVE)
  })

  it('leaves an ordinary token address alone, checksummed or not', () => {
    expect(toV4Currency('0x5fc5360d0400a0fd4f2af552add042d716f1d168').toLowerCase()).toBe(
      '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    )
  })
})
