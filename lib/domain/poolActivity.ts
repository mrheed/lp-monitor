import { formatUnits, getAddress, parseAbi, type Address, type Hex, type PublicClient } from 'viem'
import { amountsForLiquidity } from './v4Math'

const POOL_EVENTS = parseAbi([
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
  'event ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)',
])

/** One fee level the pool actually charged, and how often. */
export type FeeTier = { feeHundredthsOfBip: number; percent: string; swaps: number; share: number }

/** Symbols treated as money, so a position's value reads in dollars rather than in satoshis. */
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDG', 'USDbC', 'USD₮0', 'FDUSD', 'TUSD'])

export type SwapActivity = {
  windowBlocks: number
  swaps: number
  /** Distinct `sender` contracts (routers), a rough proxy for how many venues route here. */
  routers: number
  swapsPerHour: number
  tiers: FeeTier[]
  /** True when every observed swap paid nothing, i.e. LPs receive no fee at all. */
  allFeeFree: boolean
}

/** A position in the pool, reconstructed from liquidity events. */
export type Holder = {
  /** The v4 PositionManager tokenId, taken from the position salt. */
  tokenId: string
  owner: Address | null
  tickLower: number
  tickUpper: number
  /** Net liquidity across every add and remove for this position. */
  liquidity: string
  events: number
  /** Tokens the position currently holds, in human units. */
  amount0: number
  amount1: number
  /**
   * Deployed value, in whichever side reads as money (see {@link quoteSymbol}).
   *
   * Liquidity alone cannot rank positions: the same capital spread over a narrow band carries far
   * more liquidity than over a wide one, so ordering by liquidity puts tight ranges on top
   * regardless of the money behind them.
   */
  valueToken1: number
  /** Range as human prices, once token decimals are known. */
  lowerPrice: number
  upperPrice: number
  inRange: boolean
  /** Width of the band, as a percentage of its lower bound. */
  widthPercent: number
}

const OWNER_OF = parseAbi(['function ownerOf(uint256 tokenId) view returns (address)'])

/**
 * How many provider-sized windows to walk back looking for liquidity events.
 *
 * Positions are only visible through their add and remove events, and an established pool can sit
 * untouched for days, so a single window finds nothing. Twelve chunks reaches back far enough to
 * catch active providers without turning one page load into hundreds of requests.
 */
const LIQUIDITY_CHUNKS = 12

const tickPrice = (tick: number, d0: number, d1: number) => 1.0001 ** tick * 10 ** (d0 - d1)

/**
 * Reads the pool's recent trading and its live positions straight from PoolManager logs.
 *
 * Both answer questions the pool's state cannot: `slot0` reports the fee a swap would pay next,
 * not the spread of fees actually charged, and no contract enumerates a pool's positions. The
 * `salt` on each ModifyLiquidity event is the PositionManager tokenId, so summing liquidity
 * deltas per salt rebuilds every position and drops the ones that fully exited.
 */
export const readPoolActivity = async (
  client: PublicClient,
  poolManager: string,
  positionManager: string,
  poolId: Hex,
  sqrtPriceX96: bigint,
  currentTick: number,
  decimals0: number,
  decimals1: number,
  symbol0: string,
  symbol1: string,
  windowBlocks: number,
  blockSeconds: number,
): Promise<{ activity: SwapActivity; holders: Holder[]; quoteSymbol: string }> => {
  const address = getAddress(poolManager)
  const latest = await client.getBlockNumber()
  const from = latest > BigInt(windowBlocks) ? latest - BigInt(windowBlocks) : 0n

  // Swaps are frequent, so one window shows the fee picture. Liquidity events are rare — a pool
  // can go days without one — so those are chased further back in provider-sized chunks.
  const swaps = await client
    .getLogs({ address, event: POOL_EVENTS[0], args: { id: poolId }, fromBlock: from, toBlock: latest })
    .catch(() => [])

  type LiquidityLog = Awaited<ReturnType<typeof client.getLogs<typeof POOL_EVENTS[1]>>>[number]
  const liquidityEvents: LiquidityLog[] = []
  const chunk = BigInt(windowBlocks)
  let cursor = latest
  for (let i = 0; i < LIQUIDITY_CHUNKS && cursor > 0n; i += 1) {
    const lo = cursor > chunk ? cursor - chunk : 0n
    const found = await client
      .getLogs({ address, event: POOL_EVENTS[1], args: { id: poolId }, fromBlock: lo, toBlock: cursor })
      .catch(() => [])
    liquidityEvents.push(...found)
    cursor = lo > 0n ? lo - 1n : 0n
  }

  const counts = new Map<number, number>()
  const routers = new Set<string>()
  for (const log of swaps) {
    const fee = Number(log.args.fee ?? 0)
    counts.set(fee, (counts.get(fee) ?? 0) + 1)
    if (log.args.sender) routers.add(String(log.args.sender).toLowerCase())
  }
  const tiers: FeeTier[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([fee, n]) => ({
      feeHundredthsOfBip: fee,
      percent: `${(fee / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`,
      swaps: n,
      share: swaps.length > 0 ? n / swaps.length : 0,
    }))

  const hours = (windowBlocks * blockSeconds) / 3600
  const activity: SwapActivity = {
    windowBlocks,
    swaps: swaps.length,
    routers: routers.size,
    swapsPerHour: hours > 0 ? swaps.length / hours : 0,
    tiers,
    allFeeFree: swaps.length > 0 && tiers.length === 1 && tiers[0].feeHundredthsOfBip === 0,
  }

  // Rebuild positions: the salt is the PositionManager tokenId, so a position is the running
  // sum of its liquidity deltas. Anything that nets to zero has fully withdrawn.
  type Acc = { lower: number; upper: number; net: bigint; events: number }
  const positions = new Map<string, Acc>()
  for (const log of liquidityEvents) {
    const salt = String(log.args.salt ?? '')
    const lower = Number(log.args.tickLower ?? 0)
    const upper = Number(log.args.tickUpper ?? 0)
    const key = `${salt}:${lower}:${upper}`
    const acc = positions.get(key) ?? { lower, upper, net: 0n, events: 0 }
    acc.net += BigInt(log.args.liquidityDelta ?? 0n)
    acc.events += 1
    positions.set(key, acc)
  }

  // Value every live position at the current price, then rank. Owners are fetched only for the
  // ones that make the cut, so a busy pool does not cost one RPC call per historical position.
  const price = tickPrice(currentTick, decimals0, decimals1)   // token1 per token0
  // Quote in the stablecoin when the pair has one, so the value column is readable. Otherwise
  // fall back to token1, which is the pool's own numeraire.
  const quoteIsToken0 = STABLES.has(symbol0) && !STABLES.has(symbol1)
  const quoteSymbol = quoteIsToken0 ? symbol0 : symbol1
  const valued = [...positions.entries()]
    .filter(([, a]) => a.net > 0n)
    .map(([key, a]) => {
      const { amount0, amount1 } = amountsForLiquidity(sqrtPriceX96, a.lower, a.upper, a.net)
      const human0 = Number(formatUnits(amount0, decimals0))
      const human1 = Number(formatUnits(amount1, decimals1))
      const inToken1 = human0 * price + human1
      return { key, a, human0, human1, value: quoteIsToken0 ? inToken1 / price : inToken1 }
    })
    .sort((x, y) => y.value - x.value)
    .slice(0, 10)

  const holders: Holder[] = await Promise.all(
    valued.map(async ({ key, a, human0, human1, value }) => {
      const tokenId = BigInt(key.split(':')[0]).toString()
      const owner = await client
        .readContract({ address: getAddress(positionManager), abi: OWNER_OF, functionName: 'ownerOf', args: [BigInt(tokenId)] })
        .catch(() => null)
      const lowerPrice = tickPrice(a.lower, decimals0, decimals1)
      const upperPrice = tickPrice(a.upper, decimals0, decimals1)
      return {
        tokenId,
        owner,
        tickLower: a.lower,
        tickUpper: a.upper,
        liquidity: a.net.toString(),
        events: a.events,
        amount0: human0,
        amount1: human1,
        valueToken1: value,
        lowerPrice,
        upperPrice,
        inRange: currentTick >= a.lower && currentTick < a.upper,
        widthPercent: lowerPrice > 0 ? (upperPrice / lowerPrice - 1) * 100 : 0,
      }
    }),
  )

  return { activity, holders, quoteSymbol }
}
