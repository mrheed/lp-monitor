import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  type Address,
  type Hex,
} from 'viem'
import { CREATE2_DEPLOYER } from './constants'
import { VOLUME_TIER_FEE_HOOK_ABI, VOLUME_TIER_FEE_HOOK_BYTECODE } from './volumeTierFeeHook'

/** A Uniswap v4 pool's identity. `fee` should be the dynamic-fee flag for this hook. */
export type PoolKey = {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

/** Volume-tier fee schedule for one pool. Fees are hundredths of a bip. */
export type FeeConfig = {
  baseFee: number
  tier1Fee: number
  tier2Fee: number
  tier3Fee: number
  tier1Threshold: number
  tier2Threshold: number
  tier3Threshold: number
  windowSeconds: number
}

/** A ready-to-send transaction, matching the shape the wallet client consumes. */
export type PreparedTx = { to: Address; data: Hex; value?: bigint }

const POOL_KEY_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },
] as const

/**
 * Build the deployment transaction for a mined salt. The hook is deployed through
 * the deterministic CREATE2 proxy so the resulting address matches the mined one:
 * calldata is the 32-byte salt followed by the constructor-appended init code.
 */
export const buildDeployTx = (salt: Hex, poolManager: Address, owner: Address): PreparedTx => {
  const initCode = concatHex([
    VOLUME_TIER_FEE_HOOK_BYTECODE,
    encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [poolManager, owner]),
  ])
  return { to: CREATE2_DEPLOYER, data: concatHex([salt, initCode]) }
}

/** Calldata for the whitelist gate that `beforeAddLiquidity` enforces. */
export const buildSetLiquidityProviderTx = (
  hook: Address,
  account: Address,
  allowed: boolean,
): PreparedTx => ({
  to: hook,
  data: encodeFunctionData({
    abi: VOLUME_TIER_FEE_HOOK_ABI,
    functionName: 'setLiquidityProvider',
    args: [account, allowed],
  }),
})

/** Calldata to set the volume-tier fee schedule for a target pool. */
export const buildSetFeeConfigTx = (hook: Address, key: PoolKey, config: FeeConfig): PreparedTx => ({
  to: hook,
  data: encodeFunctionData({
    abi: VOLUME_TIER_FEE_HOOK_ABI,
    functionName: 'setFeeConfig',
    args: [key, config],
  }),
})

/** Calldata to hand the hook's admin powers to a new owner. */
export const buildTransferOwnershipTx = (hook: Address, newOwner: Address): PreparedTx => ({
  to: hook,
  data: encodeFunctionData({
    abi: VOLUME_TIER_FEE_HOOK_ABI,
    functionName: 'transferOwnership',
    args: [newOwner],
  }),
})

/** The v4 pool id: keccak256 of the ABI-encoded PoolKey. */
export const computePoolId = (key: PoolKey): Hex =>
  keccak256(
    encodeAbiParameters(POOL_KEY_ABI, [
      {
        currency0: key.currency0,
        currency1: key.currency1,
        fee: key.fee,
        tickSpacing: key.tickSpacing,
        hooks: key.hooks,
      },
    ]),
  )
