import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  getAddress,
  type Address,
  type PublicClient,
} from 'viem'
import { decodePositionInfo, decodeSlot0, POOLS_SLOT } from '../domain/v4Math'
import type { PoolState } from '../domain/addLiquidity'

const POSITION_MANAGER = parseAbi([
  'function poolManager() view returns (address)',
  'function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, uint256 info)',
])

const POOL_MANAGER = parseAbi(['function extsload(bytes32 slot) view returns (bytes32)'])

/**
 * Reads where a position and its pool stand right now, from the chain itself.
 *
 * The client comes from the caller: wagmi supplies one bound to the app's own RPC transports,
 * so the state loads before any wallet is connected at all.
 *
 * Two reads through the position manager, then one raw storage read on the PoolManager:
 * v4 keeps pool state in a singleton and exposes it through `extsload`, so slot0 is fetched by
 * computing its storage slot the way StateLibrary documents (keccak of poolId against the pools
 * mapping slot) rather than through a view function that does not exist.
 *
 * Read at plan time, not indexing time: on a range 0.6% wide, the composition an indexer saw
 * minutes ago describes a pool that no longer exists.
 */
export const readPoolState = async (
  client: PublicClient,
  positionManager: string,
  tokenId: bigint,
  poolId: string,
): Promise<PoolState> => {
  const manager = getAddress(positionManager)

  const [, info] = await client.readContract({
    address: manager,
    abi: POSITION_MANAGER,
    functionName: 'getPoolAndPositionInfo',
    args: [tokenId],
  })
  const { tickLower, tickUpper } = decodePositionInfo(info)

  const poolManager: Address = await client.readContract({
    address: manager,
    abi: POSITION_MANAGER,
    functionName: 'poolManager',
  })

  const slot = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }],
      [poolId as `0x${string}`, `0x${POOLS_SLOT.toString(16).padStart(64, '0')}`],
    ),
  )
  const raw = await client.readContract({
    address: poolManager,
    abi: POOL_MANAGER,
    functionName: 'extsload',
    args: [slot],
  })

  const { sqrtPriceX96 } = decodeSlot0(BigInt(raw))
  if (sqrtPriceX96 === 0n) {
    throw new Error('The pool reports no price; its state slot may not match this pool id.')
  }

  return { sqrtPriceX96, tickLower, tickUpper }
}
