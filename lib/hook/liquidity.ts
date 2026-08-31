import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import { MAX_TICK, MIN_TICK, Q96 } from '../domain/v4Math'
import { NATIVE } from '../domain/v4Calldata'
import type { PoolKey } from './calldata'

/**
 * The human price (currency1 per currency0) at a tick, given each token's decimals.
 *
 * A tick encodes a raw-unit ratio (amount1/amount0 = 1.0001^tick); folding in the decimals turns
 * that into the price a person reads. Float math is fine here — this drives display and range
 * picking, never the on-chain amounts, which use the exact bigint path.
 */
export const tickToPrice = (tick: number, decimals0: number, decimals1: number): number =>
  1.0001 ** tick * 10 ** (decimals0 - decimals1)

/**
 * The nearest usable tick for a human price (currency1 per currency0), snapped to `tickSpacing`
 * and clamped to the valid range. The inverse of {@link tickToPrice}.
 */
export const priceToTick = (
  price: number,
  decimals0: number,
  decimals1: number,
  tickSpacing: number,
): number => {
  if (!(price > 0)) throw new Error('Price must be positive')
  const rawPrice = price * 10 ** (decimals1 - decimals0)
  const tick = Math.log(rawPrice) / Math.log(1.0001)
  const snapped = Math.round(tick / tickSpacing) * tickSpacing
  const lower = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing
  const upper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing
  return Math.min(upper, Math.max(lower, snapped))
}

/**
 * The v4 PositionManager action bytes this module encodes.
 *
 * Verified against v4-periphery `src/libraries/Actions.sol` rather than recalled: a wrong byte
 * encodes a different operation, and the transaction reverts or does something other than asked.
 */
const ACTIONS = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION: 0x02,
  BURN_POSITION: 0x03,
  SETTLE_PAIR: 0x0d,
  TAKE_PAIR: 0x11,
  CLOSE_CURRENCY: 0x12,
  SWEEP: 0x14,
} as const

/** The PoolKey tuple as the pool ABI-encodes it; shared shape with lib/hook/calldata.ts. */
const POOL_KEY = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const

const MODIFY_LIQUIDITIES = parseAbi([
  'function modifyLiquidities(bytes unlockData, uint256 deadline)',
])

/**
 * The PositionManager surface this module calls or reads.
 *
 * Signatures verified against the vendored `IPositionManager.sol` / `IPoolInitializer_v4.sol`:
 * `initializePool` is payable and returns the current tick as int24; the two position getters
 * match their interface return types, with `PositionInfo` decoded as the uint256 it is declared as.
 */
export const POSITION_MANAGER_ABI = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'function initializePool(PoolKey key, uint160 sqrtPriceX96) payable returns (int24)',
  'function modifyLiquidities(bytes unlockData, uint256 deadline) payable',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'function nextTokenId() view returns (uint256)',
  'function getPoolAndPositionInfo(uint256 tokenId) view returns (PoolKey poolKey, uint256 info)',
  'function getPositionLiquidity(uint256 tokenId) view returns (uint128 liquidity)',
  'function ownerOf(uint256 tokenId) view returns (address)',
])

/** Floor(a*b/denominator) in exact integer arithmetic, matching Uniswap's mulDiv rounding down. */
const mulDiv = (a: bigint, b: bigint, denominator: bigint): bigint => (a * b) / denominator

/** Liquidity that `amt0` of token0 supports across the sqrt-price span [sA, sB). */
const getLiquidityForAmount0 = (sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint => {
  const [lower, upper] = sqrtA <= sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA]
  return mulDiv(amount0, mulDiv(lower, upper, Q96), upper - lower)
}

/** Liquidity that `amt1` of token1 supports across the sqrt-price span [sA, sB). */
const getLiquidityForAmount1 = (sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint => {
  const [lower, upper] = sqrtA <= sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA]
  return mulDiv(amount1, Q96, upper - lower)
}

/**
 * The liquidity that a pair of token amounts yields at the current price, the standard Uniswap
 * `LiquidityAmounts.getLiquidityForAmounts`.
 *
 * Three regimes, decided by where the current price sits against the range: below it only token0
 * counts, above it only token1, and inside it the binding side is whichever supports the least
 * liquidity, so the position never asks for more of either token than supplied. Bounds are sorted
 * so lower < upper regardless of caller order.
 */
export const getLiquidityForAmounts = (
  sqrtPriceX96: bigint,
  sqrtLowerX96: bigint,
  sqrtUpperX96: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint => {
  const [lower, upper] =
    sqrtLowerX96 <= sqrtUpperX96 ? [sqrtLowerX96, sqrtUpperX96] : [sqrtUpperX96, sqrtLowerX96]

  if (sqrtPriceX96 <= lower) {
    return getLiquidityForAmount0(lower, upper, amount0)
  }
  if (sqrtPriceX96 >= upper) {
    return getLiquidityForAmount1(lower, upper, amount1)
  }
  const liquidity0 = getLiquidityForAmount0(sqrtPriceX96, upper, amount0)
  const liquidity1 = getLiquidityForAmount1(lower, sqrtPriceX96, amount1)
  return liquidity0 < liquidity1 ? liquidity0 : liquidity1
}

/** Packs a list of action bytes into the concatenated hex string the unlock plan expects. */
const encodeActions = (actions: number[]): Hex =>
  `0x${actions.map((action) => action.toString(16).padStart(2, '0')).join('')}`

/** Wraps an action plan and its parameters into `modifyLiquidities` calldata. */
const encodeModifyLiquidities = (actions: number[], params: Hex[], deadline: bigint): Hex => {
  const unlockData = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'bytes[]' }],
    [encodeActions(actions), params],
  )
  return encodeFunctionData({
    abi: MODIFY_LIQUIDITIES,
    functionName: 'modifyLiquidities',
    args: [unlockData, deadline],
  })
}

/**
 * Builds the `modifyLiquidities` calldata that mints a new v4 position.
 *
 * The plan is MINT_POSITION, then CLOSE_CURRENCY for each side, then SWEEP when a side is native.
 * CLOSE_CURRENCY rather than SETTLE_PAIR on both sides is deliberate: SETTLE_PAIR demands a debt
 * in both currencies, and a single-sided range owes only one, so the pool reverts DeltaNotNegative
 * for the side that owes nothing. Close resolves each currency whatever the sign, which also covers
 * a price that drifts across a range boundary between planning and execution. The sweep refunds
 * whatever the native maximum overshot by; ERC20 sides are pulled exactly and need no refund.
 */
export const buildMintCalldata = (p: {
  poolKey: PoolKey
  tickLower: number
  tickUpper: number
  liquidity: bigint
  amount0Max: bigint
  amount1Max: bigint
  owner: Address
  deadline: bigint
}): Hex => {
  const owner = getAddress(p.owner)
  const hasNative = p.poolKey.currency0 === NATIVE || p.poolKey.currency1 === NATIVE

  const mintParams = encodeAbiParameters(
    [
      POOL_KEY,
      { type: 'int24' },
      { type: 'int24' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'address' },
      { type: 'bytes' },
    ],
    [
      p.poolKey,
      p.tickLower,
      p.tickUpper,
      p.liquidity,
      p.amount0Max,
      p.amount1Max,
      owner,
      '0x',
    ],
  )

  const closeParams = (currency: Address) =>
    encodeAbiParameters([{ type: 'address' }], [currency])

  const actions: number[] = [
    ACTIONS.MINT_POSITION,
    ACTIONS.CLOSE_CURRENCY,
    ACTIONS.CLOSE_CURRENCY,
  ]
  const params: Hex[] = [
    mintParams,
    closeParams(p.poolKey.currency0),
    closeParams(p.poolKey.currency1),
  ]

  if (hasNative) {
    actions.push(ACTIONS.SWEEP)
    params.push(encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [NATIVE, owner]))
  }

  return encodeModifyLiquidities(actions, params, p.deadline)
}

/**
 * Builds `multicall` calldata that initializes an uninitialized pool and mints in one transaction.
 *
 * `initializePool` no-ops and returns type(int24).max if the pool already exists, so batching it
 * ahead of the mint is safe; the multicall is atomic, so a mint that would revert also rolls back
 * the initialization. Used when the pool has no on-chain state yet.
 */
export const buildInitializeAndMintCalldata = (p: {
  positionManager: Address
  poolKey: PoolKey
  sqrtPriceX96: bigint
  tickLower: number
  tickUpper: number
  liquidity: bigint
  amount0Max: bigint
  amount1Max: bigint
  owner: Address
  deadline: bigint
}): Hex => {
  const initCalldata = encodeFunctionData({
    abi: POSITION_MANAGER_ABI,
    functionName: 'initializePool',
    args: [p.poolKey, p.sqrtPriceX96],
  })
  const mintCalldata = buildMintCalldata(p)
  return encodeFunctionData({
    abi: POSITION_MANAGER_ABI,
    functionName: 'multicall',
    args: [[initCalldata, mintCalldata]],
  })
}

/**
 * Builds `modifyLiquidities` calldata that removes liquidity from a position and pays out.
 *
 * DECREASE_LIQUIDITY burns the requested liquidity and credits its tokens plus any accrued fees;
 * TAKE_PAIR then transfers both currencies' credits to the recipient. Hook data is empty. Slippage
 * floors (`amount0Min`, `amount1Min`) guard the amounts realized against a price move.
 */
export const buildDecreaseCalldata = (p: {
  tokenId: bigint
  liquidity: bigint
  amount0Min: bigint
  amount1Min: bigint
  currency0: Address
  currency1: Address
  recipient: Address
  deadline: bigint
}): Hex => {
  const recipient = getAddress(p.recipient)

  const decreaseParams = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint128' },
      { type: 'uint128' },
      { type: 'bytes' },
    ],
    [p.tokenId, p.liquidity, p.amount0Min, p.amount1Min, '0x'],
  )

  const takeParams = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'address' }],
    [p.currency0, p.currency1, recipient],
  )

  return encodeModifyLiquidities(
    [ACTIONS.DECREASE_LIQUIDITY, ACTIONS.TAKE_PAIR],
    [decreaseParams, takeParams],
    p.deadline,
  )
}

/**
 * Builds `modifyLiquidities` calldata that collects a position's accrued fees without touching
 * its liquidity.
 *
 * A decrease of zero liquidity still settles the fee growth owed since the last touch, so the
 * position's principal stays put while only fees are credited and taken. Slippage floors are zero
 * because no principal moves; there is nothing to protect against a price change.
 */
export const buildCollectCalldata = (p: {
  tokenId: bigint
  currency0: Address
  currency1: Address
  recipient: Address
  deadline: bigint
}): Hex =>
  buildDecreaseCalldata({
    tokenId: p.tokenId,
    liquidity: 0n,
    amount0Min: 0n,
    amount1Min: 0n,
    currency0: p.currency0,
    currency1: p.currency1,
    recipient: p.recipient,
    deadline: p.deadline,
  })

/**
 * The native currency a mint transaction must carry as msg.value: the padded maximum for whichever
 * side is native, or nothing for a token-token pool. Overpayment returns via the mint's sweep.
 */
export const nativeValueForMint = (
  poolKey: PoolKey,
  amount0Max: bigint,
  amount1Max: bigint,
): bigint => {
  if (poolKey.currency0 === NATIVE) return amount0Max
  if (poolKey.currency1 === NATIVE) return amount1Max
  return 0n
}

/** Integer square root of a non-negative bigint (Newton's method). */
export const isqrt = (value: bigint): bigint => {
  if (value < 0n) throw new Error('isqrt of a negative number')
  if (value < 2n) return value
  let x = value
  let y = (x + 1n) / 2n
  while (y < x) {
    x = y
    y = (x + value / x) / 2n
  }
  return x
}

/**
 * The starting sqrtPriceX96 for a fresh pool from a human price of currency1 per currency0,
 * given as the fraction priceNum/priceDen. The pool prices raw units, so the token decimals are
 * folded in: sqrtPriceX96 = isqrt(price · 10^dec1 / 10^dec0 · 2^192), since sqrtP = sqrt(ratio)·2^96.
 */
export const priceToSqrtPriceX96 = (
  priceNum: bigint,
  priceDen: bigint,
  decimals0: number,
  decimals1: number,
): bigint => {
  const numerator = priceNum * 10n ** BigInt(decimals1) * (1n << 192n)
  const denominator = priceDen * 10n ** BigInt(decimals0)
  if (denominator === 0n) throw new Error('Invalid price')
  return isqrt(numerator / denominator)
}
