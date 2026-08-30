'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { formatUnits, getAddress, parseAbi, type Address } from 'viem'
import { usePublicClient } from 'wagmi'
import { type DeployNetwork } from '@/lib/hook/constants'
import { computePoolId, type PoolKey } from '@/lib/hook/calldata'
import { VOLUME_TIER_FEE_HOOK_ABI } from '@/lib/hook/volumeTierFeeHook'
import { POSITION_MANAGER_ABI, tickToPrice } from '@/lib/hook/liquidity'
import { amountsForLiquidity, decodePositionInfo } from '@/lib/domain/v4Math'
import { NATIVE } from '@/lib/domain/v4Calldata'

const STATE_VIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
])
const ERC20_META = parseAbi(['function decimals() view returns (uint8)', 'function symbol() view returns (string)'])

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const feePct = (n: number) => `${(n / 10000).toFixed(2)}%`
const fmtPrice = (p: number | null): string => {
  if (p === null || !Number.isFinite(p) || p <= 0) return '—'
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (p >= 1) return p.toLocaleString(undefined, { maximumSignificantDigits: 5 })
  return p.toPrecision(3)
}
const fmtAmount = (raw: bigint, decimals: number): string => {
  const n = Number(formatUnits(raw, decimals))
  return n.toLocaleString(undefined, { maximumSignificantDigits: 6 })
}
const ago = (unixSeconds: number): string => {
  if (!unixSeconds) return 'no swaps yet'
  const s = Math.floor(Date.now() / 1000) - unixSeconds
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

type Schedule = {
  baseFee: number
  tier1Fee: number
  tier2Fee: number
  tier3Fee: number
  t1: number
  t2: number
  t3: number
  windowSeconds: number
}
type PoolData = {
  symbol0: string
  symbol1: string
  dec0: number
  dec1: number
  initialized: boolean
  price: number | null
  tick: number
  lpFeeNow: number
  liquidity: bigint
  schedule: Schedule | null
  currentFee: number | null
  windowStartedAt: number
  windowSwaps: number
}
type Position = {
  symbol0: string
  symbol1: string
  lowerPrice: number
  upperPrice: number
  currentPrice: number | null
  amount0: string
  amount1: string
  inRange: boolean
}
type PoolState = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; data: PoolData }

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5">
    <span className="db-kicker shrink-0">{label}</span>
    <span className="text-right text-[13px] text-[var(--db-ink)]">{children}</span>
  </div>
)
const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-t border-[var(--db-line)] pt-3">
    <p className="db-kicker mb-1 text-[var(--db-signal)]">{title}</p>
    {children}
  </div>
)

/**
 * A full read-only dashboard for the target pool: identity and price, the hook's fee schedule and
 * the fee a swap would pay right now, the volume triggers and the current window's swap count, the
 * pool's total liquidity, and an on-demand lookup of any position's range and token value. Every
 * figure is read live; a pool that is not initialized or a hook with no config for it reads as such
 * rather than erroring.
 */
export const PoolInfo = ({ network, poolKey }: { network: DeployNetwork; poolKey: PoolKey }) => {
  const publicClient = usePublicClient({ chainId: network.chainId })
  const [state, setState] = useState<PoolState>({ kind: 'loading' })
  const [tokenId, setTokenId] = useState('')
  const [position, setPosition] = useState<Position | 'loading' | 'error' | null>(null)

  const stateView = getAddress(network.stateView)
  const hook = poolKey.hooks

  const symbolOf = async (addr: Address): Promise<string> => {
    const known = network.tokens.find((t) => t.address.toLowerCase() === addr.toLowerCase())
    if (known) return known.symbol
    if (addr === NATIVE) return network.tokens.find((t) => t.address === NATIVE)?.symbol ?? 'native'
    return publicClient!.readContract({ address: addr, abi: ERC20_META, functionName: 'symbol' }).catch(() => short(addr))
  }
  const decimalsOf = async (addr: Address): Promise<number> => {
    if (addr === NATIVE) return 18
    return publicClient!.readContract({ address: addr, abi: ERC20_META, functionName: 'decimals' }).catch(() => 18)
  }

  useEffect(() => {
    let cancelled = false
    if (!publicClient) {
      setState({ kind: 'error' })
      return
    }
    setState({ kind: 'loading' })
    setPosition(null)
    const poolId = computePoolId(poolKey)
    const hookBase = { address: hook, abi: VOLUME_TIER_FEE_HOOK_ABI } as const
    const svBase = { address: stateView, abi: STATE_VIEW_ABI } as const

    const load = async () => {
      const [dec0, dec1, symbol0, symbol1, slot0, liquidity, cfg, currentFeeRaw, win] = await Promise.all([
        decimalsOf(poolKey.currency0),
        decimalsOf(poolKey.currency1),
        symbolOf(poolKey.currency0),
        symbolOf(poolKey.currency1),
        publicClient.readContract({ ...svBase, functionName: 'getSlot0', args: [poolId] }).catch(() => null),
        publicClient.readContract({ ...svBase, functionName: 'getLiquidity', args: [poolId] }).catch(() => 0n),
        publicClient.readContract({ ...hookBase, functionName: 'feeConfig', args: [poolId] }).catch(() => null),
        publicClient.readContract({ ...hookBase, functionName: 'quoteCurrentFee', args: [poolKey] }).catch(() => null),
        publicClient.readContract({ ...hookBase, functionName: 'window', args: [poolId] }).catch(() => null),
      ])
      if (cancelled) return

      const sqrt = slot0 ? slot0[0] : 0n
      const initialized = sqrt !== 0n
      const price = initialized ? (Number(sqrt) / 2 ** 96) ** 2 * 10 ** (dec0 - dec1) : null
      const schedule: Schedule | null =
        cfg && cfg[7] !== 0
          ? { baseFee: cfg[0], tier1Fee: cfg[1], tier2Fee: cfg[2], tier3Fee: cfg[3], t1: cfg[4], t2: cfg[5], t3: cfg[6], windowSeconds: cfg[7] }
          : null

      setState({
        kind: 'loaded',
        data: {
          symbol0,
          symbol1,
          dec0,
          dec1,
          initialized,
          price,
          tick: slot0 ? slot0[1] : 0,
          lpFeeNow: slot0 ? slot0[3] : 0,
          liquidity: liquidity ?? 0n,
          schedule,
          currentFee: currentFeeRaw,
          windowStartedAt: win ? win[0] : 0,
          windowSwaps: win ? win[1] : 0,
        },
      })
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey.currency0, poolKey.currency1, poolKey.tickSpacing, hook, network.chainId, publicClient])

  const lookupPosition = async () => {
    if (!publicClient || !tokenId.trim()) return
    setPosition('loading')
    try {
      const id = BigInt(tokenId)
      const pm = { address: getAddress(network.positionManager), abi: POSITION_MANAGER_ABI } as const
      const [poolAndInfo, liquidity] = await Promise.all([
        publicClient.readContract({ ...pm, functionName: 'getPoolAndPositionInfo', args: [id] }),
        publicClient.readContract({ ...pm, functionName: 'getPositionLiquidity', args: [id] }),
      ])
      const [pk, info] = poolAndInfo
      const { tickLower, tickUpper } = decodePositionInfo(info)
      const [dec0, dec1, symbol0, symbol1] = await Promise.all([
        decimalsOf(pk.currency0),
        decimalsOf(pk.currency1),
        symbolOf(pk.currency0),
        symbolOf(pk.currency1),
      ])
      const pid = computePoolId({ currency0: pk.currency0, currency1: pk.currency1, fee: pk.fee, tickSpacing: pk.tickSpacing, hooks: pk.hooks })
      const slot0 = await publicClient
        .readContract({ address: stateView, abi: STATE_VIEW_ABI, functionName: 'getSlot0', args: [pid] })
        .catch(() => null)
      const sqrt = slot0 ? slot0[0] : 0n
      const { amount0, amount1 } = amountsForLiquidity(sqrt, tickLower, tickUpper, liquidity)
      const currentPrice = sqrt !== 0n ? (Number(sqrt) / 2 ** 96) ** 2 * 10 ** (dec0 - dec1) : null
      setPosition({
        symbol0,
        symbol1,
        lowerPrice: tickToPrice(tickLower, dec0, dec1),
        upperPrice: tickToPrice(tickUpper, dec0, dec1),
        currentPrice,
        amount0: fmtAmount(amount0, dec0),
        amount1: fmtAmount(amount1, dec1),
        inRange: sqrt !== 0n ? slot0![1] >= tickLower && slot0![1] < tickUpper : false,
      })
    } catch {
      setPosition('error')
    }
  }

  if (state.kind === 'loading') return <p className="text-[13px] text-[var(--db-muted)]">Reading pool…</p>
  if (state.kind === 'error') return <p className="text-[13px] text-[var(--db-muted)]">Couldn&apos;t read this pool.</p>

  const d = state.data
  const pair = `${d.symbol0} / ${d.symbol1}`
  const unit = `${d.symbol1} per ${d.symbol0}`

  return (
    <div className="space-y-3">
      <Group title="Pair & price">
        <Row label="Pool">{pair}</Row>
        <Row label="Status">
          {d.initialized ? <span className="text-[var(--db-signal)]">initialized</span> : <span className="text-[var(--db-muted)]">not initialized</span>}
        </Row>
        <Row label="Price">{d.initialized ? `${fmtPrice(d.price)} ${unit}` : '—'}</Row>
        <Row label="Tick">{d.initialized ? d.tick.toLocaleString() : '—'}</Row>
        <Row label="Liquidity">{d.liquidity > 0n ? d.liquidity.toLocaleString() : '—'}</Row>
      </Group>

      {d.schedule ? (
        <>
          <Group title="Fee schedule">
            <Row label="Base fee">{feePct(d.schedule.baseFee)}</Row>
            <Row label="Tier 1">{feePct(d.schedule.tier1Fee)}</Row>
            <Row label="Tier 2">{feePct(d.schedule.tier2Fee)}</Row>
            <Row label="Tier 3">{feePct(d.schedule.tier3Fee)}</Row>
          </Group>
          <Group title="Current fee">
            <Row label="A swap now pays">
              {d.currentFee !== null ? <span className="text-[var(--db-signal)]">{feePct(d.currentFee)}</span> : '—'}
            </Row>
          </Group>
          <Group title="Volume triggers">
            <Row label="Tier 1 at">{d.schedule.t1} swaps</Row>
            <Row label="Tier 2 at">{d.schedule.t2} swaps</Row>
            <Row label="Tier 3 at">{d.schedule.t3} swaps</Row>
            <Row label="Window">{d.schedule.windowSeconds}s</Row>
          </Group>
          <Group title="Swaps (current window)">
            <Row label="Swaps counted">{d.windowSwaps}</Row>
            <Row label="Window started">{ago(d.windowStartedAt)}</Row>
          </Group>
        </>
      ) : (
        <Group title="Fee schedule">
          <p className="text-[13px] text-[var(--db-muted)]">No fee config set for this pool yet — set it in step 3.</p>
        </Group>
      )}

      <Group title="Position lookup">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="db-input flex-1 text-sm"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            placeholder="position id (tokenId)"
            spellCheck={false}
          />
          <button className="db-pill text-sm text-[var(--db-muted)]" onClick={() => void lookupPosition()} disabled={!tokenId.trim()}>
            Look up
          </button>
        </div>
        {position === 'loading' ? <p className="mt-2 text-[13px] text-[var(--db-muted)]">Reading position…</p> : null}
        {position === 'error' ? <p className="mt-2 text-[13px] text-[var(--db-muted)]">No position found for that id.</p> : null}
        {position && position !== 'loading' && position !== 'error' ? (
          <div className="mt-2">
            <Row label="Range">
              {fmtPrice(position.lowerPrice)} – {fmtPrice(position.upperPrice)} {position.symbol1} per {position.symbol0}
            </Row>
            <Row label="In range">
              {position.inRange ? <span className="text-[var(--db-signal)]">yes · earning</span> : <span className="text-[var(--db-muted)]">no · one token</span>}
            </Row>
            <Row label="Holds">
              {position.amount0} {position.symbol0} + {position.amount1} {position.symbol1}
            </Row>
          </div>
        ) : null}
      </Group>
    </div>
  )
}
