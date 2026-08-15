import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbi } from 'viem'

/**
 * The v4 PositionManager action bytes this module uses.
 *
 * Verified against v4-periphery `src/libraries/Actions.sol` on main rather than recalled: a
 * wrong byte here encodes a different operation entirely, and the transaction either reverts or
 * does something other than asked.
 */
export const ACTIONS = {
  INCREASE_LIQUIDITY: 0x00,
  SETTLE_PAIR: 0x0d,
  SWEEP: 0x14,
} as const

/** How v4 identifies the chain's native currency: the zero address, not the 0xeee sentinel. */
export const NATIVE = '0x0000000000000000000000000000000000000000' as const

const EEE_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/**
 * Translates an address from how the position feed reports it to how the pool identifies it.
 *
 * Krystal reports native ETH as the 0xeee…e sentinel; the v4 PoolManager keys pools on
 * address(0). Settling against the sentinel names a currency the pool does not contain.
 */
export const toV4Currency = (address: string): `0x${string}` =>
  address.toLowerCase() === EEE_SENTINEL ? NATIVE : getAddress(address)

const MODIFY_LIQUIDITIES = parseAbi([
  'function modifyLiquidities(bytes unlockData, uint256 deadline)',
])

/** Everything the calldata needs; amounts already planned and slippage-padded. */
export type IncreaseCall = {
  tokenId: bigint
  liquidityDelta: bigint
  /** Token addresses in pool order, as the position feed reports them. */
  currency0: string
  currency1: string
  amount0Max: bigint
  amount1Max: bigint
  /** Receives any refunded native currency; the caller's own address. */
  recipient: string
  deadlineSeconds: bigint
}

/**
 * Builds the `modifyLiquidities` calldata that adds liquidity to an existing v4 position.
 *
 * The unlock plan is INCREASE_LIQUIDITY, SETTLE_PAIR, then SWEEP when a side is native. The
 * increase creates a debt to the pool, the settle pays it in both currencies, and the sweep
 * returns whatever the native maximum overshot by; ERC20 sides are pulled exactly and need no
 * refund, which is why the sweep is omitted for token-token pools.
 *
 * Hook data is empty. Pools with hooks still take this shape; a hook that requires custom data
 * on modify is out of scope and will revert in simulation rather than on chain.
 */
export const buildIncreaseCalldata = (call: IncreaseCall): `0x${string}` => {
  const currency0 = toV4Currency(call.currency0)
  const currency1 = toV4Currency(call.currency1)
  const hasNative = currency0 === NATIVE || currency1 === NATIVE

  const increaseParams = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [call.tokenId, call.liquidityDelta, call.amount0Max, call.amount1Max, '0x'],
  )

  const settleParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }],
    [currency0, currency1],
  )

  const actions: number[] = [ACTIONS.INCREASE_LIQUIDITY, ACTIONS.SETTLE_PAIR]
  const params: `0x${string}`[] = [increaseParams, settleParams]

  if (hasNative) {
    actions.push(ACTIONS.SWEEP)
    params.push(
      encodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }],
        [NATIVE, getAddress(call.recipient)],
      ),
    )
  }

  const actionBytes: `0x${string}` = `0x${actions
    .map((action) => action.toString(16).padStart(2, '0'))
    .join('')}`

  const unlockData = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [actionBytes, params],
  )

  return encodeFunctionData({
    abi: MODIFY_LIQUIDITIES,
    functionName: 'modifyLiquidities',
    args: [unlockData, call.deadlineSeconds],
  })
}

/**
 * The native currency a transaction must carry: the padded maximum for whichever side is
 * native, or nothing for a token-token pool. Overpayment returns via the sweep.
 */
export const nativeValueFor = (call: IncreaseCall): bigint => {
  if (toV4Currency(call.currency0) === NATIVE) return call.amount0Max
  if (toV4Currency(call.currency1) === NATIVE) return call.amount1Max
  return 0n
}
