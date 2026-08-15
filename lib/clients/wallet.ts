import { encodeFunctionData, getAddress, parseAbi, type Address, type PublicClient } from 'viem'
import { NATIVE, toV4Currency } from '../domain/v4Calldata'

/**
 * The canonical Permit2 contract, deployed at the same address on every chain Uniswap supports.
 * The v4 PositionManager pulls ERC20s through it rather than holding direct allowances.
 */
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

const ERC20 = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

const PERMIT2_ABI = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
])

const MAX_UINT160 = (1n << 160n) - 1n
const MAX_UINT48 = (1n << 48n) - 1n

/** One approval the wallet still has to grant before the increase can settle. */
export type RequiredApproval = {
  /** Which contract to call and what to say to it. */
  to: Address
  data: `0x${string}`
  /** Why, in words the confirmation dialog can show. */
  description: string
}

/**
 * The approvals an increase still needs for its ERC20 sides.
 *
 * Two layers, checked in order: the token must allow Permit2 to move it, and Permit2 must allow
 * the position manager to draw it. Native currency needs neither, travelling as message value.
 * Only missing approvals are returned, so a wallet that has already granted both sends nothing.
 *
 * Reads go through the client the caller provides, which wagmi builds against the app's own
 * RPC transports rather than whatever the connected wallet routes through.
 */
export const missingApprovals = async (
  client: PublicClient,
  owner: Address,
  positionManager: Address,
  sides: { address: string; symbol: string; rawAmount: bigint }[],
): Promise<RequiredApproval[]> => {
  const needed: RequiredApproval[] = []

  for (const side of sides) {
    if (toV4Currency(side.address) === NATIVE || side.rawAmount === 0n) continue
    const token = getAddress(side.address)

    const tokenAllowance = await client.readContract({
      address: token,
      abi: ERC20,
      functionName: 'allowance',
      args: [owner, PERMIT2],
    })

    if (tokenAllowance < side.rawAmount) {
      needed.push({
        to: token,
        data: encodeFunctionData({
          abi: ERC20,
          functionName: 'approve',
          args: [PERMIT2, 2n ** 256n - 1n],
        }),
        description: `Allow Permit2 to move ${side.symbol}`,
      })
    }

    const [permitAmount, expiration] = await client.readContract({
      address: PERMIT2,
      abi: PERMIT2_ABI,
      functionName: 'allowance',
      args: [owner, token, positionManager],
    })

    const nowSeconds = BigInt(Math.floor(Date.now() / 1000))
    if (permitAmount < side.rawAmount || BigInt(expiration) <= nowSeconds) {
      needed.push({
        to: PERMIT2,
        data: encodeFunctionData({
          abi: PERMIT2_ABI,
          functionName: 'approve',
          args: [token, positionManager, MAX_UINT160, Number(MAX_UINT48)],
        }),
        description: `Allow the position manager to draw ${side.symbol} through Permit2`,
      })
    }
  }

  return needed
}

/** A transaction as the wallet sees it. */
export type WalletTransaction = {
  to: Address
  data: `0x${string}`
  value?: bigint
}

/**
 * Simulates a transaction as the sending account, throwing the revert on failure.
 *
 * The single most important safety net in this flow: an encoding mistake, a missing approval or
 * a hook rejection surfaces here as an error dialog instead of a failed transaction that still
 * burned its gas.
 */
export const simulate = async (
  client: PublicClient,
  from: Address,
  transaction: WalletTransaction,
) => {
  await client.call({
    account: from,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  })
}
