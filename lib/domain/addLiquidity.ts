import { amountsForLiquidity } from './v4Math'

/** One side of a position: the token and how much of it the position currently holds. */
export type PositionAmount = {
  address: string
  /** Raw integer balance in the token's smallest unit, as the chain sees it. */
  rawBalance: bigint
  decimals: number
  valueUsd: number
}

/** The live state of an open position, as needed to plan an increase. */
export type OpenPosition = {
  liquidity: bigint
  amounts: PositionAmount[]
  valueUsd: number
}

/** What to add: how much value, and how much price movement to tolerate before reverting. */
export type IncreaseRequest = {
  depositUsd: number
  slippagePercent: number
}

/** Where the pool and the position stand on chain, read at plan time. */
export type PoolState = {
  sqrtPriceX96: bigint
  tickLower: number
  tickUpper: number
}

/** The exact numbers a transaction needs: liquidity to add and the most of each token to pay. */
export type IncreasePlan = {
  liquidityDelta: bigint
  maxAmounts: { address: string; rawAmount: bigint }[]
  /** The share of the current position being added, for display. */
  ratio: number
}

/** Fixed point scale for the ratio, chosen so a sub-cent deposit into millions still resolves. */
const SCALE = 1_000_000_000n

/**
 * Plans a proportional increase of an existing position.
 *
 * Uniswap liquidity is linear in token amounts at a fixed price and range: a position holding
 * amounts A at liquidity L needs exactly r x A more tokens to hold (1+r) x L. Working from the
 * position's own reported state therefore needs no tick arithmetic at all, and inherits the
 * range the position was minted with, which is fixed by its tokenId anyway.
 *
 * Rounding is directional by design. Liquidity rounds down and token maximums round up, so the
 * amounts always cover the liquidity requested; rounding the other way could leave the contract
 * one wei short, which reverts the whole transaction.
 *
 * The maximums also carry the slippage allowance. The pool's price can move between planning and
 * execution, changing the exact tokens the same liquidity requires; the allowance bounds how far
 * that can go before the transaction reverts instead of overpaying silently.
 */
export const planIncrease = (
  position: OpenPosition,
  request: IncreaseRequest,
  state: PoolState,
): IncreasePlan => {
  if (position.liquidity <= 0n) {
    throw new Error('The position is closed (no liquidity), so there is nothing to increase.')
  }
  if (!(request.depositUsd > 0)) {
    throw new Error('The deposit must be a positive amount.')
  }
  if (!(position.valueUsd > 0)) {
    throw new Error('The position reports no current value, so a ratio cannot be computed.')
  }

  const ratio = request.depositUsd / position.valueUsd
  const scaledRatio = BigInt(Math.floor(ratio * Number(SCALE)))
  const slippage = BigInt(Math.round(request.slippagePercent * 100))

  // The delta still comes from the value ratio, which is stable: position value scales linearly
  // with liquidity, so a USD share translates to the same share of liquidity.
  const liquidityDelta = (position.liquidity * scaledRatio) / SCALE

  // The token amounts do NOT come from scaling the indexer's balances, which was this
  // function's first design and reverted on chain. A narrow range swings its composition end to
  // end within a fraction of a percent of price movement, so by the time a snapshot arrives it
  // describes a composition the pool no longer has. The pool's own math against its current
  // price is the only version the contract will agree with.
  const { amount0, amount1 } = amountsForLiquidity(
    state.sqrtPriceX96,
    state.tickLower,
    state.tickUpper,
    liquidityDelta,
  )

  const pad = (amount: bigint) => (amount * (10_000n + slippage)) / 10_000n
  const maxAmounts = [
    { address: position.amounts[0].address, rawAmount: pad(amount0) },
    { address: position.amounts[1].address, rawAmount: pad(amount1) },
  ]

  return { liquidityDelta, maxAmounts, ratio }
}
