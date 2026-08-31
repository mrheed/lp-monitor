import {
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from 'viem'
import { assessHook, type HookAssessment } from '../hook/safety'
import { v4NetworkById, type V4Network } from '../hook/networks'
import { readPoolActivity, type Holder, type SwapActivity } from './poolActivity'

const STATE_VIEW = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
  'function getFeeGrowthGlobals(bytes32 poolId) view returns (uint256 feeGrowthGlobal0, uint256 feeGrowthGlobal1)',
])
const POOL_MANAGER = parseAbi([
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
])
const ERC20 = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)'])

/**
 * Admin-style getters worth surfacing; absence is itself a good sign, since a hook with no owner
 * has nobody who can change its behaviour later.
 */
const ADMIN_GETTERS = [
  { name: 'owner', abi: parseAbi(['function owner() view returns (address)']) },
  { name: 'admin', abi: parseAbi(['function admin() view returns (address)']) },
  { name: 'collector', abi: parseAbi(['function collector() view returns (address)']) },
  { name: 'paused', abi: parseAbi(['function paused() view returns (bool)']) },
  { name: 'liquidityEnabled', abi: parseAbi(['function liquidityEnabled() view returns (bool)']) },
] as const

/** A probe of one live capability, run as an `eth_call` against the chain. */
export type Probe = { name: string; outcome: 'open' | 'blocked' | 'unknown'; detail: string }

export type PoolFacts = {
  poolId: Hex
  currency0: Address
  currency1: Address
  symbol0: string
  symbol1: string
  fee: number
  dynamicFee: boolean
  tickSpacing: number
  hook: Address
  initialized: boolean
  liquidity: string
  lpFee: number
  /** True when LP fee growth is non-zero, i.e. LPs have ever been paid. */
  lpFeesAccrue: boolean
  sqrtPriceX96: string
  tick: number
  decimals0: number
  decimals1: number
}

export type Inspection = {
  network: { chainId: number; name: string; explorer: string }
  hook: Address
  assessment: HookAssessment
  admin: { key: string; value: string }[]
  probes: Probe[]
  pool: PoolFacts | null
  activity: SwapActivity | null
  holders: Holder[]
  /** Which token the holder values are denominated in. */
  quoteSymbol: string
  notes: string[]
}

const clientFor = (network: V4Network) =>
  createPublicClient({ transport: http(network.rpc), batch: { multicall: false } })

/** The storage slot holding a pool's slot0 inside the PoolManager, per StateLibrary. */
const poolStateSlot = (poolId: Hex): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }],
      [poolId, `0x${(6).toString(16).padStart(64, '0')}`],
    ),
  )

/**
 * Simulates one hook callback as though the PoolManager were calling it.
 *
 * This is the difference between "what is this hook allowed to do" and "what does it do right
 * now": a permission bit says the callback runs, only an eth_call says whether it lets you
 * through. A revert here is the same revert a real deposit or withdrawal would hit.
 */
const probeCallback = async (
  network: V4Network,
  hook: Address,
  data: Hex,
  name: string,
  blockedDetail: string,
  openDetail: string,
): Promise<Probe> => {
  try {
    await clientFor(network).call({
      account: getAddress(network.poolManager),
      to: hook,
      data,
    })
    return { name, outcome: 'open', detail: openDetail }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A hook without the flag reverts with HookNotImplemented; that means ungated, not blocked.
    if (message.includes('0x0a85dc29')) {
      return { name, outcome: 'open', detail: 'Hook is not called on this action, so it cannot interfere.' }
    }
    return { name, outcome: 'blocked', detail: `${blockedDetail} (reverted)` }
  }
}

const POOL_KEY_PARAM = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const

const MODIFY_PARAM = {
  type: 'tuple',
  components: [
    { name: 'tickLower', type: 'int24' },
    { name: 'tickUpper', type: 'int24' },
    { name: 'liquidityDelta', type: 'int256' },
    { name: 'salt', type: 'bytes32' },
  ],
} as const

const HOOK_CALLBACKS = parseAbi([
  'function beforeAddLiquidity(address sender, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt) params, bytes hookData) returns (bytes4)',
  'function afterAddLiquidity(address sender, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt) params, int256 delta, int256 feesAccrued, bytes hookData) returns (bytes4, int256)',
  'function beforeRemoveLiquidity(address sender, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt) params, bytes hookData) returns (bytes4)',
  'function afterRemoveLiquidity(address sender, (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt) params, int256 delta, int256 feesAccrued, bytes hookData) returns (bytes4, int256)',
])

/** How far back to read Swap and ModifyLiquidity logs; wide enough to see real activity. */
const LOG_WINDOW_BLOCKS = 9000

const OUTSIDER: Address = '0x000000000000000000000000000000000000dEaD'
const ZERO_SALT: Hex = `0x${'0'.repeat(64)}`

const EXTSLOAD = parseAbi(['function extsload(bytes32 slot) view returns (bytes32)'])

type Client = ReturnType<typeof clientFor>
type InitArgs = {
  currency0?: Address
  currency1?: Address
  fee?: number
  tickSpacing?: number
  hooks?: Address
}

/**
 * Finds a pool's Initialize event, coping with RPCs that cap `eth_getLogs` at 10,000 blocks.
 *
 * The whole-history query is tried first because it is one request when the provider allows it.
 * Otherwise the creation block is found by bisecting on the pool's slot0 storage — it reads zero
 * before the pool exists and non-zero after — and only that narrow window is queried for the log.
 */
const findInitialize = async (
  network: V4Network,
  client: Client,
  id: Hex,
): Promise<{ args: InitArgs } | null> => {
  const address = getAddress(network.poolManager)
  try {
    const logs = await client.getLogs({ address, event: POOL_MANAGER[0], args: { id }, fromBlock: 0n, toBlock: 'latest' })
    if (logs[0]) return { args: logs[0].args }
  } catch {
    // Provider limits the range; fall through to the bisection path.
  }

  const slot = poolStateSlot(id)
  const existsAt = async (block: bigint): Promise<boolean> => {
    try {
      const raw = await client.readContract({ address, abi: EXTSLOAD, functionName: 'extsload', args: [slot], blockNumber: block })
      return BigInt(raw) !== 0n
    } catch {
      return false
    }
  }

  const latest = await client.getBlockNumber()
  if (!(await existsAt(latest))) return null
  let low = 0n
  let high = latest
  while (high - low > 1n) {
    const mid = (low + high) / 2n
    if (await existsAt(mid)) high = mid
    else low = mid
  }

  const span = 2000n
  const from = high > span ? high - span : 0n
  // Clamp to the head: asking past it is rejected outright by some providers.
  const to = high + span > latest ? latest : high + span
  const logs = await client.getLogs({ address, event: POOL_MANAGER[0], args: { id }, fromBlock: from, toBlock: to })
  return logs[0] ? { args: logs[0].args } : null
}

/**
 * Reads a v4 hook's real, current behaviour: its immutable permission bits, whatever admin
 * surface it exposes, and live simulations of the deposit and withdrawal paths.
 *
 * `poolId` is optional. Without it only the hook is graded; with it the pool's state and the
 * callback simulations (which need a PoolKey) are included too.
 */
export const inspectHook = async (
  chainId: number,
  hookOrPool: string,
  poolId?: string,
): Promise<Inspection> => {
  const network = v4NetworkById(chainId)
  if (!network) throw new Error(`Chain ${chainId} has no known Uniswap v4 deployment.`)
  const client = clientFor(network)
  const notes: string[] = []

  let pool: PoolFacts | null = null
  let hook: Address

  const looksLikePoolId = (poolId ?? hookOrPool).replace(/^0x/, '').length === 64
  const id = looksLikePoolId ? ((poolId ?? hookOrPool) as Hex) : undefined

  if (id) {
    const init = await findInitialize(network, client, id)
    if (!init) throw new Error('No Initialize event found for that pool id on this chain.')
    const a = init.args
    hook = getAddress(a.hooks as Address)
    const [slot0, liquidity, growth] = await Promise.all([
      client.readContract({ address: getAddress(network.stateView), abi: STATE_VIEW, functionName: 'getSlot0', args: [id] }),
      client.readContract({ address: getAddress(network.stateView), abi: STATE_VIEW, functionName: 'getLiquidity', args: [id] }).catch(() => 0n),
      client.readContract({ address: getAddress(network.stateView), abi: STATE_VIEW, functionName: 'getFeeGrowthGlobals', args: [id] }).catch(() => [0n, 0n] as const),
    ])
    const meta = async (t: Address) =>
      t === '0x0000000000000000000000000000000000000000'
        ? { symbol: 'native', decimals: 18 }
        : {
            symbol: await client.readContract({ address: t, abi: ERC20, functionName: 'symbol' }).catch(() => '?'),
            decimals: await client.readContract({ address: t, abi: ERC20, functionName: 'decimals' }).catch(() => 18),
          }
    const c0 = getAddress(a.currency0 as Address)
    const c1 = getAddress(a.currency1 as Address)
    const [m0, m1] = await Promise.all([meta(c0), meta(c1)])
    pool = {
      poolId: id,
      currency0: c0,
      currency1: c1,
      symbol0: m0.symbol,
      symbol1: m1.symbol,
      fee: Number(a.fee),
      dynamicFee: Number(a.fee) === 0x800000,
      tickSpacing: Number(a.tickSpacing),
      hook,
      initialized: slot0[0] !== 0n,
      liquidity: liquidity.toString(),
      lpFee: Number(slot0[3]),
      lpFeesAccrue: growth[0] !== 0n || growth[1] !== 0n,
      sqrtPriceX96: slot0[0].toString(),
      tick: Number(slot0[1]),
      decimals0: m0.decimals,
      decimals1: m1.decimals,
    }
  } else {
    hook = getAddress(hookOrPool)
  }

  const assessment = assessHook(hook)

  const admin: { key: string; value: string }[] = []
  for (const getter of ADMIN_GETTERS) {
    try {
      const value = await client.readContract({
        address: hook,
        abi: getter.abi,
        functionName: getter.name,
      })
      admin.push({ key: getter.name, value: String(value) })
    } catch {
      // Absent getter: the hook simply does not expose this control.
    }
  }
  if (admin.length === 0) {
    notes.push('No owner or admin getter found — the hook exposes no obvious control surface.')
  }

  const probes: Probe[] = []
  if (pool) {
    const key = {
      currency0: pool.currency0,
      currency1: pool.currency1,
      fee: pool.fee,
      tickSpacing: pool.tickSpacing,
      hooks: hook,
    }
    const span = pool.tickSpacing * 10
    const params = { tickLower: -span, tickUpper: span, liquidityDelta: 10n ** 15n, salt: ZERO_SALT }

    const out = { ...params, liquidityDelta: -(10n ** 15n) }
    const p = assessment.permissions
    const ungated = (what: string): Probe => ({
      name: what,
      outcome: 'open',
      detail: 'The hook is never called on this action, so nobody can interfere with it.',
    })

    // Probe only the callbacks the address actually enables: calling a callback a hook does not
    // implement reverts for that reason alone, which would read as a block that is not real.
    if (p.beforeAddLiquidity) {
      probes.push(
        await probeCallback(
          network, hook,
          encodeFunctionData({ abi: HOOK_CALLBACKS, functionName: 'beforeAddLiquidity', args: [OUTSIDER, key, params, '0x'] }),
          'Deposit (as an outsider)',
          'This pool refuses deposits from addresses it has not approved',
          'Anyone can add liquidity right now.',
        ),
      )
    } else if (p.afterAddLiquidity) {
      probes.push(
        await probeCallback(
          network, hook,
          encodeFunctionData({ abi: HOOK_CALLBACKS, functionName: 'afterAddLiquidity', args: [OUTSIDER, key, params, -(10n ** 15n), 0n, '0x'] }),
          'Deposit (as an outsider)',
          'This pool refuses deposits from addresses it has not approved',
          'Anyone can add liquidity right now.',
        ),
      )
    } else {
      probes.push(ungated('Deposit (as an outsider)'))
    }

    if (p.beforeRemoveLiquidity) {
      probes.push(
        await probeCallback(
          network, hook,
          encodeFunctionData({ abi: HOOK_CALLBACKS, functionName: 'beforeRemoveLiquidity', args: [OUTSIDER, key, out, '0x'] }),
          'Withdrawal, pre-check',
          'The hook rejects withdrawals',
          'Withdrawals are not blocked at this stage.',
        ),
      )
    } else {
      probes.push(ungated('Withdrawal, pre-check'))
    }

    if (p.afterRemoveLiquidity) {
      probes.push(
        await probeCallback(
          network, hook,
          encodeFunctionData({ abi: HOOK_CALLBACKS, functionName: 'afterRemoveLiquidity', args: [OUTSIDER, key, out, 10n ** 15n, 0n, '0x'] }),
          'Withdrawal, settlement',
          'The hook rejects or taxes the withdrawal',
          'Withdrawal settles without the hook taking a cut.',
        ),
      )
    } else {
      probes.push(ungated('Withdrawal, settlement'))
    }

    if (pool.initialized && !pool.lpFeesAccrue) {
      notes.push('LP fee growth is zero: swaps here have never paid the liquidity providers.')
    }
    if (pool.liquidity === '0') notes.push('The pool currently holds no liquidity.')
  } else {
    notes.push('Supply a pool id to also simulate the live deposit and withdrawal paths.')
  }

  // Trading and positions come from PoolManager logs; a failure here degrades the report
  // rather than losing the safety verdict, which is the part that matters most.
  let activity: SwapActivity | null = null
  let holders: Holder[] = []
  let quoteSymbol = ''
  if (pool) {
    try {
      const read = await readPoolActivity(
        client, network.poolManager, network.positionManager, pool.poolId,
        BigInt(pool.sqrtPriceX96), pool.tick, pool.decimals0, pool.decimals1,
        pool.symbol0, pool.symbol1, LOG_WINDOW_BLOCKS, network.blockSeconds,
      )
      activity = read.activity
      holders = read.holders
      quoteSymbol = read.quoteSymbol
      if (activity.allFeeFree) {
        notes.push('Every recent swap charged 0%: the hook is taking the trading fee, not the LPs.')
      }
    } catch {
      notes.push('Could not read recent trading; the RPC may limit log queries.')
    }
  }

  return {
    network: { chainId: network.chainId, name: network.name, explorer: network.explorer },
    hook,
    assessment,
    admin,
    probes,
    pool,
    activity,
    holders,
    quoteSymbol,
    notes,
  }
}
