'use client'

import { useEffect, useState, type ReactNode } from 'react'
import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
} from 'viem'
import { useAccount, useConfig, usePublicClient, useSwitchChain } from 'wagmi'
import { getWalletClient } from '@wagmi/core'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { DEPLOY_NETWORKS, DYNAMIC_FEE_FLAG, feeToPercent, type DeployNetwork } from '@/lib/hook/constants'
import { mineHookSalt } from '@/lib/hook/volumeTierFeeHook'
import {
  buildDeployTx,
  buildSetFeeConfigTx,
  buildSetLiquidityProviderTx,
  computePoolId,
  type FeeConfig,
  type PoolKey,
  type PreparedTx,
} from '@/lib/hook/calldata'
import {
  POSITION_MANAGER_ABI,
  buildCollectCalldata,
  buildDecreaseCalldata,
  buildInitializeAndMintCalldata,
  buildMintCalldata,
  getLiquidityForAmounts,
  nativeValueForMint,
  priceToSqrtPriceX96,
  priceToTick,
  tickToPrice,
} from '@/lib/hook/liquidity'
import { MAX_TICK, MIN_TICK, decodeSlot0, sqrtPriceAtTick } from '@/lib/domain/v4Math'
import { NATIVE } from '@/lib/domain/v4Calldata'
import { missingApprovals } from '@/lib/clients/wallet'
import { HookSourceViewer } from '@/components/HookSourceViewer'
import { HookInfo } from '@/components/HookInfo'
import { PoolInfo } from '@/components/PoolInfo'
import { RangeViz } from '@/components/RangeViz'
import { RangeSlider } from '@/components/RangeSlider'

const ERC20_DECIMALS = parseAbi(['function decimals() view returns (uint8)'])
const EXTSLOAD_ABI = parseAbi(['function extsload(bytes32 slot) view returns (bytes32)'])

/** The storage slot of a pool's slot0 inside the PoolManager, per StateLibrary. */
const poolStateSlot = (poolId: Hex): Hex =>
  keccak256(
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [
      poolId,
      `0x${(6).toString(16).padStart(64, '0')}`,
    ]),
  )

/** Parse a human decimal string into a num/den fraction, e.g. "2500.5" → { num: 25005n, den: 10n }. */
const parseFraction = (value: string): { num: bigint; den: bigint } => {
  const [whole, frac = ''] = value.trim().split('.')
  const digits = `${whole}${frac}`.replace(/[^0-9]/g, '') || '0'
  return { num: BigInt(digits), den: 10n ** BigInt(frac.length) }
}

// --- shared class strings, styled by the scoped .deploy-world tokens ---
const fieldLabel = 'block text-[13px] text-[var(--db-muted)]'
const input = 'db-input mt-2 text-sm'
const primaryBtn = 'db-pill db-pill--primary text-sm font-medium'
const ghostBtn = 'db-pill text-sm text-[var(--db-muted)]'
const groupLabel = 'db-kicker'
const code = 'db-code text-[0.8rem]'

type Step =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'sent'; hash: string }

/** Parse and checksum an address, or null if it is not a valid address. */
const parseAddr = (value: string): Address | null => {
  const trimmed = value.trim()
  return isAddress(trimmed) ? getAddress(trimmed) : null
}

/**
 * The shared write flow: connect if needed, switch to the target chain, build the
 * calldata, simulate it as a dry run, then send. Every step calls this so the
 * connect / switch / simulate / send sequence and its status states live in one place.
 */
const useHookTx = (network: DeployNetwork) => {
  const { address } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const config = useConfig()
  const publicClient = usePublicClient({ chainId: network.chainId })
  const [step, setStep] = useState<Step>({ kind: 'idle' })

  const run = async (
    prepare: () => PreparedTx | Promise<PreparedTx>,
    opts?: {
      prepareLabel?: string
      onSent?: (hash: Hex) => void
      approvals?: () => Promise<{ to: Address; data: Hex; description: string }[]>
    },
  ) => {
    try {
      if (!address) {
        openConnectModal?.()
        return
      }
      setStep({ kind: 'busy', label: `Switching to ${network.name}` })
      const switched = await switchChainAsync({ chainId: network.chainId })
      if (switched.id !== network.chainId) throw new Error(`Wallet did not switch to ${network.name}.`)
      if (!publicClient) throw new Error(`No RPC client is configured for ${network.name}.`)

      // Fetch the signer bound to the just-switched chain. Reading it after the switch (rather than
      // from a hook captured at render time) keeps the transaction's chain id in step with the
      // wallet's current chain, avoiding a chain-mismatch rejection.
      const walletClient = await getWalletClient(config, { chainId: network.chainId })
      if (!walletClient) throw new Error('The wallet is connected but provides no signer.')

      // ERC20 sides need Permit2 + PositionManager allowances before the pool can pull them.
      if (opts?.approvals) {
        const needed = await opts.approvals()
        for (const approval of needed) {
          setStep({ kind: 'busy', label: approval.description })
          await walletClient.sendTransaction({ to: approval.to, data: approval.data, chain: walletClient.chain })
        }
      }

      if (opts?.prepareLabel) setStep({ kind: 'busy', label: opts.prepareLabel })
      const tx = await prepare()

      setStep({ kind: 'busy', label: 'Simulating the transaction' })
      await publicClient.call({ account: address, to: tx.to, data: tx.data, value: tx.value })

      setStep({ kind: 'busy', label: 'Confirm in your wallet' })
      const hash = await walletClient.sendTransaction({ to: tx.to, data: tx.data, value: tx.value, chain: walletClient.chain })
      setStep({ kind: 'sent', hash })
      opts?.onSent?.(hash)
    } catch (error) {
      setStep({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  return { step, run, address }
}

const StatusLine = ({ step, explorerTx }: { step: Step; explorerTx: string }) => {
  if (step.kind === 'idle') return null
  if (step.kind === 'busy')
    return (
      <p className="mt-4 flex items-center gap-2 text-[13px] text-[var(--db-muted)]">
        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--db-signal)]" />
        {step.label}…
      </p>
    )
  if (step.kind === 'error')
    return (
      <p className="db-alertbox mt-4 px-3 py-2 text-[13px]">
        <span className="break-words">{step.message}</span>
      </p>
    )
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 text-[13px] text-[var(--db-signal)]">
      <span>Transaction sent.</span>
      <a
        className="underline underline-offset-2 transition-colors hover:text-[var(--db-ink)]"
        href={`${explorerTx}${step.hash}`}
        target="_blank"
        rel="noreferrer"
      >
        View on explorer
      </a>
    </p>
  )
}

type StepState = 'active' | 'available' | 'done' | 'locked'

/** A numbered node in the deploy flow, in the dossier style: monospace phase label, status dot. */
const FlowStep = ({
  index,
  phase,
  title,
  hint,
  state,
  children,
}: {
  index: number
  phase: string
  title: string
  hint?: string
  state: StepState
  children: ReactNode
}) => {
  const locked = state === 'locked'
  const dot = locked ? 'bg-[var(--db-muted)]' : 'bg-[var(--db-signal)]'
  return (
    <section className="db-node relative p-6 sm:p-7" data-state={state === 'active' ? 'active' : undefined}>
      <span aria-hidden className={`absolute right-5 top-5 h-[7px] w-[7px] rounded-full ${dot}`} />
      <div className={locked ? 'opacity-55' : undefined}>
        <span className={groupLabel}>
          {String(index).padStart(2, '0')} · {phase}
        </span>
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[17px] font-medium text-[var(--db-ink)]">{title}</h2>
          {state === 'done' ? <span className="text-xs text-[var(--db-signal)]">Deployed</span> : null}
          {locked ? <span className="db-kicker">Locked</span> : null}
        </div>
        {hint ? <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-[var(--db-muted)]">{hint}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </section>
  )
}

const LockedNote = ({ children }: { children: ReactNode }) => (
  <p className="text-[13px] text-[var(--db-muted)]">{children}</p>
)

/** A collapsible section for advanced controls, so the default view stays the essential path. */
const Disclosure = ({ label, children }: { label: string; children: ReactNode }) => {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="db-kicker flex items-center gap-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--db-signal)]"
      >
        <svg viewBox="0 0 16 16" className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden>
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label}
      </button>
      {open ? <div className="rise-in mt-3">{children}</div> : null}
    </div>
  )
}

// --- Step 1: Deploy ---

const DeployBody = ({ network, onDeployed }: { network: DeployNetwork; onDeployed: (hook: Address) => void }) => {
  const { step, run, address } = useHookTx(network)
  const publicClient = usePublicClient({ chainId: network.chainId })
  const [poolManager, setPoolManager] = useState<string>(network.poolManager)
  const [owner, setOwner] = useState<string>('')
  const [predicted, setPredicted] = useState<Address | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const ownerValue = owner || address || ''
  const ready = parseAddr(poolManager) !== null && parseAddr(ownerValue) !== null

  const onDeploy = async () => {
    const pm = parseAddr(poolManager)
    const ow = parseAddr(ownerValue)
    if (!pm || !ow) return
    setNotice(null)
    const mined = mineHookSalt(pm, ow)
    setPredicted(mined.hookAddress)

    // The address is deterministic in (PoolManager, owner), so the same inputs always resolve to
    // the same hook. If one already lives there, adopt it instead of sending a CREATE2 that reverts.
    if (publicClient) {
      try {
        const existing = await publicClient.getCode({ address: mined.hookAddress })
        if (existing && existing !== '0x') {
          setNotice(`This hook is already deployed — loaded ${mined.hookAddress} as the target.`)
          onDeployed(mined.hookAddress)
          return
        }
      } catch {
        // A failed code read is not fatal; fall through and let the deploy simulate/send.
      }
    }

    void run(() => buildDeployTx(mined.salt, pm, ow), {
      prepareLabel: 'Preparing the deployment',
      onSent: () => onDeployed(mined.hookAddress),
    })
  }

  return (
    <div>
      <button className={primaryBtn} onClick={() => void onDeploy()} disabled={!ready}>
        {address ? 'Deploy hook' : 'Connect wallet to deploy'}
      </button>
      {network.poolManager ? null : (
        <p className="mt-2 text-[12px] text-[var(--db-alert)]">Set the PoolManager under Advanced to deploy on {network.name}.</p>
      )}
      <div className="mt-4">
        <Disclosure label="Advanced — PoolManager & owner">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={fieldLabel}>
              PoolManager
              <input
                className={input}
                value={poolManager}
                onChange={(e) => setPoolManager(e.target.value)}
                placeholder={network.poolManager ? undefined : `paste the v4 PoolManager on ${network.name}`}
                spellCheck={false}
              />
            </label>
            <label className={fieldLabel}>
              Owner (hook admin)
              <input
                className={input}
                value={ownerValue}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="defaults to connected wallet"
                spellCheck={false}
              />
            </label>
          </div>
        </Disclosure>
      </div>
      {predicted ? (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 text-[13px] text-[var(--db-muted)]">
          Predicted address
          <span className={`${code} text-[var(--db-ink)]`}>{predicted}</span>
        </p>
      ) : null}
      {notice ? <p className="mt-3 text-[13px] text-[var(--db-signal)]">{notice}</p> : null}
      <StatusLine step={step} explorerTx={network.explorerTx} />
    </div>
  )
}

// --- Step 2: Whitelist ---

const WhitelistBody = ({ network, hook }: { network: DeployNetwork; hook: Address }) => {
  const { step, run, address } = useHookTx(network)
  const [account, setAccount] = useState<string>('')
  const [allowed, setAllowed] = useState<boolean>(true)

  const accountValue = account || address || ''
  const target = parseAddr(accountValue)

  const me = parseAddr(address ?? '')

  return (
    <div>
      <button
        className={primaryBtn}
        onClick={() => me && void run(() => buildSetLiquidityProviderTx(hook, me, true))}
        disabled={me === null}
      >
        {address ? 'Whitelist my wallet' : 'Connect wallet'}
      </button>

      <div className="mt-4">
        <Disclosure label="Advanced — whitelist or revoke another address">
          <label className={fieldLabel}>
            Account
            <input
              className={input}
              value={accountValue}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="address to allow or revoke"
              spellCheck={false}
            />
          </label>
          <div className="db-seg mt-3">
            <button data-on={allowed} onClick={() => setAllowed(true)}>
              Allow
            </button>
            <button data-on={!allowed} onClick={() => setAllowed(false)}>
              Revoke
            </button>
          </div>
          <button
            className={`${primaryBtn} mt-4 block`}
            onClick={() => target && void run(() => buildSetLiquidityProviderTx(hook, target, allowed))}
            disabled={target === null}
          >
            {allowed ? 'Allow liquidity provider' : 'Revoke liquidity provider'}
          </button>
        </Disclosure>
      </div>
      <StatusLine step={step} explorerTx={network.explorerTx} />
    </div>
  )
}

// --- Step 3: Target pool + fee schedule ---

const DEFAULT_CONFIG: FeeConfig = {
  baseFee: 3000,
  tier1Fee: 10000,
  tier2Fee: 20000,
  tier3Fee: 50000,
  tier1Threshold: 3,
  tier2Threshold: 5,
  tier3Threshold: 8,
  windowSeconds: 3600,
}

/** Ready-made fee schedules; Advanced can fine-tune any field afterward. */
const FEE_PRESETS: { name: string; config: FeeConfig }[] = [
  {
    name: 'Flat 0.30% (no volume spike)',
    config: { baseFee: 3000, tier1Fee: 3000, tier2Fee: 3000, tier3Fee: 3000, tier1Threshold: 0, tier2Threshold: 0, tier3Threshold: 0, windowSeconds: 3600 },
  },
  { name: 'Standard tiers (0.30% → 1 / 2 / 5%)', config: DEFAULT_CONFIG },
  {
    name: 'Aggressive tiers (0.30% → 2 / 5 / 10%)',
    config: { baseFee: 3000, tier1Fee: 20000, tier2Fee: 50000, tier3Fee: 100000, tier1Threshold: 3, tier2Threshold: 5, tier3Threshold: 8, windowSeconds: 3600 },
  },
]

const FEE_FIELDS: { key: keyof FeeConfig; label: string }[] = [
  { key: 'baseFee', label: 'Base fee' },
  { key: 'tier1Fee', label: 'Tier 1 fee' },
  { key: 'tier2Fee', label: 'Tier 2 fee' },
  { key: 'tier3Fee', label: 'Tier 3 fee' },
]

const TRIGGER_FIELDS: { key: keyof FeeConfig; label: string }[] = [
  { key: 'tier1Threshold', label: 'Tier 1 at N swaps' },
  { key: 'tier2Threshold', label: 'Tier 2 at N swaps' },
  { key: 'tier3Threshold', label: 'Tier 3 at N swaps' },
  { key: 'windowSeconds', label: 'Window (seconds)' },
]

const PoolBody = ({ network, hook }: { network: DeployNetwork; hook: Address }) => {
  const { step, run, address } = useHookTx(network)
  const [currency0, setCurrency0] = useState<string>(network.tokens[0]?.address ?? '')
  const [currency1, setCurrency1] = useState<string>(network.tokens[1]?.address ?? '')
  const [tickSpacing, setTickSpacing] = useState<number>(60)
  const [presetIdx, setPresetIdx] = useState<number>(1)
  const [config, setConfig] = useState<FeeConfig>(DEFAULT_CONFIG)

  const a0 = parseAddr(currency0)
  const a1 = parseAddr(currency1)
  const sorted =
    a0 && a1 && a0.toLowerCase() !== a1.toLowerCase()
      ? BigInt(a0) < BigInt(a1)
        ? { c0: a0, c1: a1 }
        : { c0: a1, c1: a0 }
      : null

  const poolKey: PoolKey | null = sorted
    ? { currency0: sorted.c0, currency1: sorted.c1, fee: DYNAMIC_FEE_FLAG, tickSpacing, hooks: hook }
    : null

  const setField = (key: keyof FeeConfig, value: number) =>
    setConfig((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : 0 }))

  const tokenRow = (onPick: (address: string) => void, keyPrefix: string) =>
    network.tokens.length > 0 ? (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {network.tokens.map((t) => (
          <button key={`${keyPrefix}-${t.symbol}`} className="db-chip" onClick={() => onPick(t.address)}>
            {t.symbol}
          </button>
        ))}
      </div>
    ) : null

  const feeInput = (f: { key: keyof FeeConfig; label: string }, isFee: boolean) => (
    <label key={f.key} className={fieldLabel}>
      {f.label}
      <input className={input} type="number" value={config[f.key]} onChange={(e) => setField(f.key, Number(e.target.value))} />
      {isFee ? <span className="mt-1 block text-xs text-[var(--db-muted)]">{feeToPercent(config[f.key])}</span> : null}
    </label>
  )

  return (
    <div className="space-y-7">
      <div>
        <p className={groupLabel}>Pair</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={fieldLabel}>
              Currency 0
              <input className={input} value={currency0} onChange={(e) => setCurrency0(e.target.value)} spellCheck={false} />
            </label>
            {tokenRow(setCurrency0, 'c0')}
          </div>
          <div>
            <label className={fieldLabel}>
              Currency 1
              <input className={input} value={currency1} onChange={(e) => setCurrency1(e.target.value)} spellCheck={false} />
            </label>
            {tokenRow(setCurrency1, 'c1')}
          </div>
        </div>
      </div>

      <label className={fieldLabel}>
        Fee schedule
        <select
          className={input}
          value={presetIdx}
          onChange={(e) => {
            const i = Number(e.target.value)
            setPresetIdx(i)
            setConfig(FEE_PRESETS[i].config)
          }}
        >
          {FEE_PRESETS.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <Disclosure label="Advanced — fine-tune fees, triggers & tick spacing">
        <div className="space-y-5">
          <div>
            <p className={groupLabel}>Fee schedule (hundredths of a bip)</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-4">{FEE_FIELDS.map((f) => feeInput(f, true))}</div>
          </div>
          <div>
            <p className={groupLabel}>Volume triggers</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-4">{TRIGGER_FIELDS.map((f) => feeInput(f, false))}</div>
          </div>
          <label className={`${fieldLabel} w-40`}>
            Tick spacing
            <input className={input} type="number" value={tickSpacing} onChange={(e) => setTickSpacing(Number(e.target.value))} />
          </label>
        </div>
      </Disclosure>

      {a0 && a1 && !sorted ? (
        <p className="text-[13px] text-[var(--db-alert)]">Currency 0 and 1 must be two different tokens.</p>
      ) : null}

      <button className={primaryBtn} onClick={() => poolKey && void run(() => buildSetFeeConfigTx(hook, poolKey, config))} disabled={!poolKey}>
        Set fee config for this pool
      </button>
      {!address ? <span className="ml-3 text-xs text-[var(--db-muted)]">Connect a wallet to send.</span> : null}
      <StatusLine step={step} explorerTx={network.explorerTx} />

      {poolKey ? (
        <div className="mt-6 border-t border-[var(--db-line)] pt-5">
          <Disclosure label="Live pool details">
            <PoolInfo network={network} poolKey={poolKey} />
          </Disclosure>
        </div>
      ) : null}
    </div>
  )
}

// --- Step 4: Liquidity (add / remove / claim) ---

type LiquidityMode = 'add' | 'remove' | 'claim'
const DEADLINE_SECONDS = 20 * 60

/** The widest tick range aligned to a spacing — a position that brackets any price. */
const fullRange = (spacing: number): { lower: number; upper: number } => ({
  lower: Math.ceil(MIN_TICK / spacing) * spacing,
  upper: Math.floor(MAX_TICK / spacing) * spacing,
})

const LiquidityBody = ({ network, hook }: { network: DeployNetwork; hook: Address }) => {
  const { step, run, address } = useHookTx(network)
  const publicClient = usePublicClient({ chainId: network.chainId })
  const positionManager = getAddress(network.positionManager)

  const [mode, setMode] = useState<LiquidityMode>('add')
  // Add mode
  const [currency0, setCurrency0] = useState<string>(network.tokens[0]?.address ?? '')
  const [currency1, setCurrency1] = useState<string>(network.tokens[1]?.address ?? '')
  const [tickSpacing, setTickSpacing] = useState<number>(60)
  const [fullRangeOn, setFullRangeOn] = useState<boolean>(true)
  const [minPrice, setMinPrice] = useState<string>('')
  const [maxPrice, setMaxPrice] = useState<string>('')
  const [amount0, setAmount0] = useState<string>('')
  const [amount1, setAmount1] = useState<string>('')
  const [initialPrice, setInitialPrice] = useState<string>('')
  // Live pool preview for the visualization: token decimals and the current price if it exists.
  const [preview, setPreview] = useState<{ dec0: number; dec1: number; currentPrice: number | null; initialized: boolean } | null>(null)
  // Remove / claim
  const [tokenId, setTokenId] = useState<string>('')
  const [removePct, setRemovePct] = useState<number>(100)
  const [mintedTokenId, setMintedTokenId] = useState<string | null>(null)

  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)

  const symbolOf = (addr: Address): string =>
    network.tokens.find((t) => t.address.toLowerCase() === addr.toLowerCase())?.symbol ?? 'token'

  // Native has 18 decimals and no on-chain decimals() to read.
  const readDecimals = async (addr: Address): Promise<number> => {
    if (addr === NATIVE) return 18
    if (!publicClient) throw new Error('No RPC client.')
    return publicClient.readContract({ address: addr, abi: ERC20_DECIMALS, functionName: 'decimals' })
  }

  // Read slot0 to learn whether the pool exists yet and at what price.
  const readPoolPrice = async (poolKey: PoolKey): Promise<{ sqrtPriceX96: bigint; initialized: boolean }> => {
    if (!publicClient) throw new Error('No RPC client.')
    const poolManager = getAddress(network.poolManager)
    const raw = await publicClient.readContract({
      address: poolManager,
      abi: EXTSLOAD_ABI,
      functionName: 'extsload',
      args: [poolStateSlot(computePoolId(poolKey))],
    })
    const { sqrtPriceX96 } = decodeSlot0(BigInt(raw))
    return { sqrtPriceX96, initialized: sqrtPriceX96 !== 0n }
  }

  const readPoolKeyOf = async (id: bigint): Promise<PoolKey> => {
    if (!publicClient) throw new Error('No RPC client.')
    const [poolKey] = await publicClient.readContract({
      address: positionManager,
      abi: POSITION_MANAGER_ABI,
      functionName: 'getPoolAndPositionInfo',
      args: [id],
    })
    return {
      currency0: poolKey.currency0,
      currency1: poolKey.currency1,
      fee: poolKey.fee,
      tickSpacing: poolKey.tickSpacing,
      hooks: poolKey.hooks,
    }
  }

  // Load the pool's decimals and current price whenever the pair changes, for the visualization.
  useEffect(() => {
    let cancelled = false
    const a0 = parseAddr(currency0)
    const a1 = parseAddr(currency1)
    if (!a0 || !a1 || a0.toLowerCase() === a1.toLowerCase() || !publicClient) {
      setPreview(null)
      return
    }
    const load = async () => {
      try {
        const swapped = BigInt(a1) < BigInt(a0)
        const s0 = swapped ? a1 : a0
        const s1 = swapped ? a0 : a1
        const [dec0, dec1] = await Promise.all([readDecimals(s0), readDecimals(s1)])
        const state = await readPoolPrice({ currency0: s0, currency1: s1, fee: DYNAMIC_FEE_FLAG, tickSpacing, hooks: hook })
        let currentPrice: number | null = null
        if (state.initialized) {
          const sp = Number(state.sqrtPriceX96) / 2 ** 96
          currentPrice = sp * sp * 10 ** (dec0 - dec1)
        }
        if (!cancelled) setPreview({ dec0, dec1, currentPrice, initialized: state.initialized })
      } catch {
        if (!cancelled) setPreview(null)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency0, currency1, tickSpacing, hook, publicClient])

  // Sorted, decimal-aware plan for the add flow, memoised so approvals and the send agree.
  type AddPlan = {
    poolKey: PoolKey
    raw0: bigint
    raw1: bigint
    liquidity: bigint
    sqrtPriceX96: bigint
    initialized: boolean
    tickLower: number
    tickUpper: number
  }
  let addPlan: AddPlan | null = null
  const buildAddPlan = async (): Promise<AddPlan> => {
    if (addPlan) return addPlan
    const a0 = parseAddr(currency0)
    const a1 = parseAddr(currency1)
    if (!a0 || !a1 || a0.toLowerCase() === a1.toLowerCase()) throw new Error('Enter two different tokens.')
    if (!address) throw new Error('Connect a wallet.')

    // v4 orders currencies by address; carry each side's amount with it through the sort.
    const swapped = BigInt(a1) < BigInt(a0)
    const c0 = swapped ? a1 : a0
    const c1 = swapped ? a0 : a1
    const amtFor0 = swapped ? amount1 : amount0
    const amtFor1 = swapped ? amount0 : amount1

    const [dec0, dec1] = await Promise.all([readDecimals(c0), readDecimals(c1)])
    const raw0 = parseUnits(amtFor0 || '0', dec0)
    const raw1 = parseUnits(amtFor1 || '0', dec1)

    const poolKey: PoolKey = { currency0: c0, currency1: c1, fee: DYNAMIC_FEE_FLAG, tickSpacing, hooks: hook }
    const state = await readPoolPrice(poolKey)

    let sqrtPriceX96 = state.sqrtPriceX96
    if (!state.initialized) {
      if (!initialPrice.trim()) throw new Error('This pool is new — set an initial price to create it.')
      const { num, den } = parseFraction(initialPrice)
      sqrtPriceX96 = priceToSqrtPriceX96(num, den, dec0, dec1)
    }

    // The range as ticks: full range, or snapped from the low/high prices the user entered.
    const range = fullRangeOn
      ? fullRange(tickSpacing)
      : (() => {
          const minP = Number(minPrice)
          const maxP = Number(maxPrice)
          if (!(minP > 0) || !(maxP > 0) || minP >= maxP) throw new Error('Enter a valid low and high price.')
          return { lower: priceToTick(minP, dec0, dec1, tickSpacing), upper: priceToTick(maxP, dec0, dec1, tickSpacing) }
        })()
    if (range.lower >= range.upper) throw new Error('The price range is too narrow for this tick spacing.')

    const sqrtLower = sqrtPriceAtTick(range.lower)
    const sqrtUpper = sqrtPriceAtTick(range.upper)
    const liquidity = getLiquidityForAmounts(sqrtPriceX96, sqrtLower, sqrtUpper, raw0, raw1)
    if (liquidity <= 0n) throw new Error('Amounts are too small for this range.')

    addPlan = {
      poolKey,
      raw0,
      raw1,
      liquidity,
      sqrtPriceX96,
      initialized: state.initialized,
      tickLower: range.lower,
      tickUpper: range.upper,
    }
    return addPlan
  }

  const submitAdd = () => {
    if (!address) return
    void run(
      async () => {
        const plan = await buildAddPlan()
        if (publicClient) {
          const next = await publicClient.readContract({
            address: positionManager,
            abi: POSITION_MANAGER_ABI,
            functionName: 'nextTokenId',
          })
          setMintedTokenId(next.toString())
        }
        const common = {
          poolKey: plan.poolKey,
          tickLower: plan.tickLower,
          tickUpper: plan.tickUpper,
          liquidity: plan.liquidity,
          amount0Max: plan.raw0,
          amount1Max: plan.raw1,
          owner: address,
          deadline: deadline(),
        }
        const data = plan.initialized
          ? buildMintCalldata(common)
          : buildInitializeAndMintCalldata({ ...common, positionManager, sqrtPriceX96: plan.sqrtPriceX96 })
        return { to: positionManager, data, value: nativeValueForMint(plan.poolKey, plan.raw0, plan.raw1) }
      },
      {
        prepareLabel: 'Planning the position',
        approvals: async () => {
          const plan = await buildAddPlan()
          if (!address) return []
          return missingApprovals(publicClient!, address, positionManager, [
            { address: plan.poolKey.currency0, symbol: symbolOf(plan.poolKey.currency0), rawAmount: plan.raw0 },
            { address: plan.poolKey.currency1, symbol: symbolOf(plan.poolKey.currency1), rawAmount: plan.raw1 },
          ])
        },
      },
    )
  }

  const submitRemove = () => {
    if (!address || !tokenId.trim()) return
    void run(async () => {
      const id = BigInt(tokenId)
      const [poolKey, liquidity] = await Promise.all([
        readPoolKeyOf(id),
        publicClient!.readContract({
          address: positionManager,
          abi: POSITION_MANAGER_ABI,
          functionName: 'getPositionLiquidity',
          args: [id],
        }),
      ])
      const removeLiquidity = (liquidity * BigInt(Math.max(0, Math.min(100, removePct)))) / 100n
      if (removeLiquidity <= 0n) throw new Error('Nothing to remove for this position.')
      const data = buildDecreaseCalldata({
        tokenId: id,
        liquidity: removeLiquidity,
        amount0Min: 0n,
        amount1Min: 0n,
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        recipient: address,
        deadline: deadline(),
      })
      return { to: positionManager, data }
    })
  }

  const submitClaim = () => {
    if (!address || !tokenId.trim()) return
    void run(async () => {
      const id = BigInt(tokenId)
      const poolKey = await readPoolKeyOf(id)
      const data = buildCollectCalldata({
        tokenId: id,
        currency0: poolKey.currency0,
        currency1: poolKey.currency1,
        recipient: address,
        deadline: deadline(),
      })
      return { to: positionManager, data }
    })
  }

  const c0 = parseAddr(currency0)
  const c1 = parseAddr(currency1)
  const orientation =
    c0 && c1 && c0.toLowerCase() !== c1.toLowerCase()
      ? BigInt(c0) < BigInt(c1)
        ? { first: symbolOf(c0), second: symbolOf(c1) }
        : { first: symbolOf(c1), second: symbolOf(c0) }
      : null

  const unit = orientation ? `${orientation.second} per ${orientation.first}` : 'currency1 / currency0'
  const poolInitialized = preview?.initialized ?? false
  const previewCurrent = poolInitialized
    ? (preview?.currentPrice ?? null)
    : Number(initialPrice) > 0
      ? Number(initialPrice)
      : null
  const vizLower = fullRangeOn ? null : Number(minPrice) > 0 ? Number(minPrice) : null
  const vizUpper = fullRangeOn ? null : Number(maxPrice) > 0 ? Number(maxPrice) : null

  // A short, parseable string for the price inputs (no grouping commas).
  const asInput = (price: number): string => String(Number(price.toPrecision(6)))
  // Round a dragged price to the nearest valid tick, once decimals are known.
  const snapPrice = preview
    ? (price: number): number =>
        price > 0 ? tickToPrice(priceToTick(price, preview.dec0, preview.dec1, tickSpacing), preview.dec0, preview.dec1) : price
    : undefined
  const applyRange = (lo: number, hi: number) => {
    setFullRangeOn(false)
    setMinPrice(asInput(lo))
    setMaxPrice(asInput(hi))
  }
  const applyPreset = (fraction: number) => {
    if (!previewCurrent) return
    applyRange(previewCurrent * (1 - fraction), previewCurrent * (1 + fraction))
  }
  const PRESETS = [0.05, 0.1, 0.25, 0.5]

  return (
    <div>
      <div className="db-seg">
        <button data-on={mode === 'add'} onClick={() => setMode('add')}>
          Add
        </button>
        <button data-on={mode === 'remove'} onClick={() => setMode('remove')}>
          Remove
        </button>
        <button data-on={mode === 'claim'} onClick={() => setMode('claim')}>
          Claim fees
        </button>
      </div>

      {mode === 'add' ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={fieldLabel}>
              Currency 0
              <input className={input} value={currency0} onChange={(e) => setCurrency0(e.target.value)} spellCheck={false} />
            </label>
            <label className={fieldLabel}>
              Currency 1
              <input className={input} value={currency1} onChange={(e) => setCurrency1(e.target.value)} spellCheck={false} />
            </label>
          </div>
          <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <span className={fieldLabel}>Range</span>
                <div className="db-seg mt-2">
                  <button data-on={fullRangeOn} onClick={() => setFullRangeOn(true)}>
                    Full range
                  </button>
                  <button data-on={!fullRangeOn} onClick={() => setFullRangeOn(false)}>
                    Custom
                  </button>
                </div>
              </div>
              <label className="w-28">
                <span className={fieldLabel}>Tick spacing</span>
                <input className={input} type="number" value={tickSpacing} onChange={(e) => setTickSpacing(Number(e.target.value))} />
              </label>
            </div>

            {!poolInitialized ? (
              <label className={`${fieldLabel} mt-4 block`}>
                Initial price · {unit} <span className="text-[var(--db-muted)]">— sets the starting price of a new pool</span>
                <input className={input} value={initialPrice} onChange={(e) => setInitialPrice(e.target.value)} placeholder="e.g. 2500" spellCheck={false} />
              </label>
            ) : null}

            {fullRangeOn ? (
              <div className="mt-5">
                <RangeViz current={previewCurrent} lower={null} upper={null} fullRange unit={unit} />
              </div>
            ) : previewCurrent ? (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="db-kicker">Around price</span>
                  {PRESETS.map((p) => (
                    <button key={p} type="button" className="db-chip" onClick={() => applyPreset(p)}>
                      ±{Math.round(p * 100)}%
                    </button>
                  ))}
                </div>
                <RangeSlider current={previewCurrent} lower={vizLower} upper={vizUpper} onChange={applyRange} unit={unit} snap={snapPrice} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className={fieldLabel}>
                    Low price · {unit}
                    <input className={input} value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="0.0" spellCheck={false} />
                  </label>
                  <label className={fieldLabel}>
                    High price · {unit}
                    <input className={input} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="0.0" spellCheck={false} />
                  </label>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-[13px] text-[var(--db-muted)]">Set an initial price above to use the range slider.</p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={fieldLabel}>
              Amount, currency 0
              <input className={input} value={amount0} onChange={(e) => setAmount0(e.target.value)} placeholder="0.0" spellCheck={false} />
            </label>
            <label className={fieldLabel}>
              Amount, currency 1
              <input className={input} value={amount1} onChange={(e) => setAmount1(e.target.value)} placeholder="0.0" spellCheck={false} />
            </label>
          </div>
          <button className={primaryBtn} onClick={submitAdd} disabled={!address}>
            {address ? 'Add liquidity' : 'Connect wallet'}
          </button>
          {mintedTokenId ? (
            <p className="text-[13px] text-[var(--db-muted)]">
              New position id <span className={`${code} text-[var(--db-ink)]`}>{mintedTokenId}</span> — use it to remove or claim.
            </p>
          ) : null}
        </div>
      ) : null}

      {mode === 'remove' ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={fieldLabel}>
              Position id (tokenId)
              <input className={input} value={tokenId} onChange={(e) => setTokenId(e.target.value)} placeholder="e.g. 12345" spellCheck={false} />
            </label>
            <label className={fieldLabel}>
              Remove {removePct}%
              <input className={input} type="range" min={1} max={100} value={removePct} onChange={(e) => setRemovePct(Number(e.target.value))} />
            </label>
          </div>
          <button className={primaryBtn} onClick={submitRemove} disabled={!address || !tokenId.trim()}>
            Remove liquidity
          </button>
        </div>
      ) : null}

      {mode === 'claim' ? (
        <div className="mt-5 space-y-5">
          <label className={fieldLabel}>
            Position id (tokenId)
            <input className={input} value={tokenId} onChange={(e) => setTokenId(e.target.value)} placeholder="e.g. 12345" spellCheck={false} />
          </label>
          <button className={primaryBtn} onClick={submitClaim} disabled={!address || !tokenId.trim()}>
            Claim accrued fees
          </button>
        </div>
      ) : null}

      <StatusLine step={step} explorerTx={network.explorerTx} />
    </div>
  )
}

// --- The console ---

/** The deploy console: a network-aware, guided flow to deploy, whitelist, and target a pool. */
export const DeployHook = () => {
  const [network, setNetwork] = useState<DeployNetwork>(DEPLOY_NETWORKS[0])
  const [hook, setHook] = useState<Address | null>(null)
  const [hookSource, setHookSource] = useState<'deployed' | 'supplied' | null>(null)
  const [hookInput, setHookInput] = useState<string>('')
  const supplied = parseAddr(hookInput)

  const adoptDeployed = (h: Address) => {
    setHook(h)
    setHookSource('deployed')
  }
  const adoptSupplied = (h: Address) => {
    setHook(h)
    setHookSource('supplied')
  }
  const clearHook = () => {
    setHook(null)
    setHookInput('')
    setHookSource(null)
  }

  // A hook is chain-specific, so switching networks starts a fresh flow.
  const selectNetwork = (next: DeployNetwork) => {
    if (next.chainId === network.chainId) return
    setNetwork(next)
    clearHook()
  }

  return (
    <div className="space-y-5">
      {/* Context spine: the network and the hook every step below acts on. */}
      <div className="db-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className={groupLabel}>Network</span>
          <div className="db-seg">
            {DEPLOY_NETWORKS.map((n) => (
              <button
                key={n.chainId}
                data-on={n.chainId === network.chainId}
                aria-current={n.chainId === network.chainId ? 'true' : undefined}
                onClick={() => selectNetwork(n)}
              >
                {n.name}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span aria-hidden className={`h-2 w-2 rounded-full ${hook ? 'bg-[var(--db-signal)]' : 'bg-[var(--db-muted)]'}`} />
          <span className={groupLabel}>Active hook — every step below acts on this</span>
          {hookSource === 'deployed' ? <span className="text-[12px] text-[var(--db-signal)]">deployed by you</span> : null}
          {hookSource === 'supplied' ? <span className="text-[12px] text-[var(--db-muted)]">pasted address</span> : null}
        </div>
        {hook ? (
          <p className={`${code} mt-1 break-all text-[var(--db-ink)]`}>{hook}</p>
        ) : (
          <p className="mt-1 text-[13px] text-[var(--db-muted)]">not set — deploy below, or paste an existing hook</p>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            className="db-input flex-1 text-sm"
            value={hook ?? hookInput}
            onChange={(e) => {
              setHook(null)
              setHookSource(null)
              setHookInput(e.target.value)
            }}
            placeholder="0x… paste an existing VolumeTierFeeHook"
            spellCheck={false}
          />
          {hook ? (
            <button className={ghostBtn} onClick={clearHook}>
              Clear
            </button>
          ) : (
            <button className={primaryBtn} onClick={() => supplied && adoptSupplied(supplied)} disabled={supplied === null}>
              Use this hook
            </button>
          )}
        </div>
        {hook ? (
          <HookInfo hook={hook} chainId={network.chainId} explorerBase={network.explorerTx.replace('/tx/', '/address/')} />
        ) : null}
      </div>

      <FlowStep
        index={1}
        phase="Deploy"
        title="Deploy the hook"
        hint="The address must encode the hook's permission bits, so a CREATE2 salt is mined in your browser, then deployed through the canonical proxy on the selected network."
        state={hook ? 'done' : 'active'}
      >
        <DeployBody key={network.chainId} network={network} onDeployed={adoptDeployed} />
      </FlowStep>

      <FlowStep
        index={2}
        phase="Access"
        title="Whitelist liquidity providers"
        hint="Only whitelisted accounts can add liquidity — the gate the hook enforces in beforeAddLiquidity. Owner only."
        state={hook ? 'available' : 'locked'}
      >
        {hook ? (
          <WhitelistBody key={network.chainId} network={network} hook={hook} />
        ) : (
          <LockedNote>Deploy or paste a hook above to manage its whitelist.</LockedNote>
        )}
      </FlowStep>

      <FlowStep
        index={3}
        phase="Pool"
        title="Target pool & fee schedule"
        hint="Choose the pair the hook governs and its volume-tier fees. The pool is dynamic-fee; the hook sets the real fee per swap."
        state={hook ? 'available' : 'locked'}
      >
        {hook ? (
          <PoolBody key={network.chainId} network={network} hook={hook} />
        ) : (
          <LockedNote>Deploy or paste a hook above to configure a pool.</LockedNote>
        )}
      </FlowStep>

      <FlowStep
        index={4}
        phase="Liquidity"
        title="Add, remove & claim"
        hint="Add liquidity (initializing the pool on the first add), remove a position, or collect its accrued fees. You must be whitelisted in step 2 to add."
        state={hook && network.positionManager ? 'available' : 'locked'}
      >
        {!network.positionManager ? (
          <LockedNote>Liquidity needs the v4 PositionManager, which isn&apos;t configured for {network.name} yet.</LockedNote>
        ) : hook ? (
          <LiquidityBody key={network.chainId} network={network} hook={hook} />
        ) : (
          <LockedNote>Deploy or paste a hook above to manage liquidity.</LockedNote>
        )}
      </FlowStep>

      <HookSourceViewer />
    </div>
  )
}
