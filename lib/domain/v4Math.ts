/**
 * The Uniswap tick and liquidity arithmetic an increase needs, ported exactly.
 *
 * Ported from v4-core `TickMath.sol` and `SqrtPriceMath.sol` with the magic constants copied
 * verbatim from source rather than recalled. The tests pin tick 0 to exactly 2^96 and the
 * extreme ticks to the published MIN/MAX sqrt prices, which exercise every constant at once.
 */

export const MIN_TICK = -887_272
export const MAX_TICK = 887_272

export const Q96 = 1n << 96n

const MAX_UINT256 = (1n << 256n) - 1n

/** The multiplier for each bit of |tick|, from TickMath.sol verbatim. */
const TICK_CONSTANTS: [number, bigint][] = [
  [0x2, 0xfff97272373d413259a46990580e213an],
  [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000, 0x48a170391f7dc42444e8fa2n],
]

/** The sqrt of the price at a tick, in Q64.96, exactly as the pool computes it. */
export const sqrtPriceAtTick = (tick: number): bigint => {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`Tick ${tick} is outside the valid range.`)
  }

  const absTick = tick < 0 ? -tick : tick

  let price =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n

  for (const [bit, constant] of TICK_CONSTANTS) {
    if ((absTick & bit) !== 0) price = (price * constant) >> 128n
  }

  if (tick > 0) price = MAX_UINT256 / price

  // Q128.128 to Q64.96, rounding up, exactly as the contract does.
  return (price + (1n << 32n) - 1n) >> 32n
}

/** Ceil(a*b/denominator) in exact integer arithmetic. */
const mulDivRoundingUp = (a: bigint, b: bigint, denominator: bigint): bigint => {
  const product = a * b
  return product / denominator + (product % denominator > 0n ? 1n : 0n)
}

/** Token0 owed for a liquidity delta between two sqrt prices, rounded up as the pool charges. */
const amount0Delta = (sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint => {
  const [lower, upper] = sqrtA <= sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA]
  const numerator = mulDivRoundingUp(liquidity << 96n, upper - lower, upper)
  return numerator / lower + (numerator % lower > 0n ? 1n : 0n)
}

/** Token1 owed for a liquidity delta between two sqrt prices, rounded up as the pool charges. */
const amount1Delta = (sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint => {
  const [lower, upper] = sqrtA <= sqrtB ? [sqrtA, sqrtB] : [sqrtB, sqrtA]
  return mulDivRoundingUp(liquidity, upper - lower, Q96)
}

/**
 * The tokens required to add `liquidity` to a position, at the pool's current price.
 *
 * Three regimes, decided by where the current price sits against the range: below it the
 * position is entirely token0, above it entirely token1, and inside it a mix that shifts with
 * every price move. This last case is why amounts must come from live chain state: on a range
 * 0.6% wide the composition swings end to end within a fraction of a percent of price movement,
 * and an indexer's snapshot is stale before it can be used.
 */
export const amountsForLiquidity = (
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } => {
  const [lo, hi] = tickLower <= tickUpper ? [tickLower, tickUpper] : [tickUpper, tickLower]
  const sqrtLower = sqrtPriceAtTick(lo)
  const sqrtUpper = sqrtPriceAtTick(hi)

  if (sqrtPriceX96 <= sqrtLower) {
    return { amount0: amount0Delta(sqrtLower, sqrtUpper, liquidity), amount1: 0n }
  }
  if (sqrtPriceX96 >= sqrtUpper) {
    return { amount0: 0n, amount1: amount1Delta(sqrtLower, sqrtUpper, liquidity) }
  }
  return {
    amount0: amount0Delta(sqrtPriceX96, sqrtUpper, liquidity),
    amount1: amount1Delta(sqrtLower, sqrtPriceX96, liquidity),
  }
}

/** Unpacks slot0 as StateLibrary lays it out: sqrtPrice in the low 160 bits, tick above it. */
export const decodeSlot0 = (raw: bigint): { sqrtPriceX96: bigint; tick: number } => {
  const sqrtPriceX96 = raw & ((1n << 160n) - 1n)
  let tick = Number((raw >> 160n) & ((1n << 24n) - 1n))
  if (tick >= 1 << 23) tick -= 1 << 24
  return { sqrtPriceX96, tick }
}

/**
 * Unpacks a PositionInfo word as PositionInfoLibrary lays it out: subscriber flag in the low
 * byte, tickLower above it, tickUpper above that, the truncated pool id in the top 200 bits.
 */
export const decodePositionInfo = (raw: bigint): { tickLower: number; tickUpper: number } => {
  const signed24 = (value: bigint): number => {
    let tick = Number(value & ((1n << 24n) - 1n))
    if (tick >= 1 << 23) tick -= 1 << 24
    return tick
  }
  return { tickLower: signed24(raw >> 8n), tickUpper: signed24(raw >> 32n) }
}

/** The storage slot of the PoolManager's pools mapping, per StateLibrary. */
export const POOLS_SLOT = 6n
