'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAddress, type Address } from 'viem'
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { planIncrease, type OpenPosition } from '@/lib/domain/addLiquidity'
import { buildIncreaseCalldata, nativeValueFor } from '@/lib/domain/v4Calldata'
import { missingApprovals, simulate } from '@/lib/clients/wallet'
import { readPoolState } from '@/lib/clients/poolState'
import type { PoolState } from '@/lib/domain/addLiquidity'
import { chainLabel } from '@/lib/chains'
import type { PoolRow } from '@/lib/types'

/** A position as the addable route reports it. */
type AddablePosition = {
  wallet: string
  walletLabel: string
  tokenId: string
  tokenAddress: string
  chainId: number
  status: string
  liquidity: string
  currentPositionValue: number
  minPrice: number
  maxPrice: number
  currentAmounts: {
    token: { address: string; symbol: string; decimals: number }
    balance: string
    quotes: { usd?: { value?: number } }
  }[]
  pool: { id: string; hooks: string }
}

/** Where the flow currently stands, shown as one line rather than a spinner. */
type Step =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'error'; message: string }
  | { kind: 'sent'; hash: string }

const usd = (value: number) =>
  value >= 1_000 ? `$${(value / 1_000).toFixed(1)}k` : `$${value.toFixed(2)}`

/** Renders a raw token amount in human units, trimmed to what a confirmation needs. */
const tokenAmount = (raw: bigint, decimals: number) => {
  const value = Number(raw) / 10 ** decimals
  return value >= 1 ? value.toFixed(4) : value.toPrecision(4)
}

/**
 * Adds liquidity to an existing position, signing in the operator's own browser wallet.
 *
 * The dialog never sees a private key. It plans the increase from the position's own reported
 * state, builds the calldata locally, asks the wallet for any missing Permit2 approvals, and
 * simulates the exact transaction before offering to send it; a revert surfaces here as text
 * instead of on chain as burned gas.
 */
export const AddLiquidity = ({ row, onClose }: { row: PoolRow; onClose: () => void }) => {
  const { address: connected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { data: walletClient } = useWalletClient()
  const [positions, setPositions] = useState<AddablePosition[] | null>(null)
  const [chosen, setChosen] = useState(0)
  const [depositUsd, setDepositUsd] = useState(100)
  const [slippagePercent, setSlippagePercent] = useState(1)
  const [step, setStep] = useState<Step>({ kind: 'idle' })

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const response = await fetch('/api/positions/addable', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ poolId: row.poolId }),
        })
        if (!response.ok) throw new Error(`Positions request failed: ${response.status}`)
        const body = await response.json()
        if (!cancelled) setPositions(body.positions ?? [])
      } catch (error) {
        if (!cancelled) {
          setStep({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to load positions' })
          setPositions([])
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [row.poolId])

  const position = positions?.[chosen] ?? null

  // Read at plan time from the chain itself, through the wallet's provider. On a narrow range
  // the composition an indexer saw minutes ago is already wrong, and planning from it built
  // transactions that reverted; the pool's current price is the only state the contract agrees
  // with.
  const [poolState, setPoolState] = useState<PoolState | null>(null)
  const [poolStateError, setPoolStateError] = useState<string | null>(null)

  // wagmi's client for the position's chain runs over the app's own RPC transports, so the
  // state loads before any wallet is connected at all.
  const publicClient = usePublicClient({ chainId: position?.chainId })

  useEffect(() => {
    if (!position || !publicClient) return
    let cancelled = false
    setPoolState(null)
    setPoolStateError(null)

    readPoolState(publicClient, position.tokenAddress, BigInt(position.tokenId), position.pool.id)
      .then((state) => {
        if (!cancelled) setPoolState(state)
      })
      .catch((error) => {
        if (!cancelled)
          setPoolStateError(error instanceof Error ? error.message : 'Could not read pool state')
      })

    return () => {
      cancelled = true
    }
  }, [position, publicClient])

  /** The plan under the current inputs, or the reason there is none. */
  const plan = useMemo(() => {
    if (!position || !poolState) return null
    try {
      const open: OpenPosition = {
        liquidity: BigInt(position.liquidity),
        valueUsd: position.currentPositionValue,
        amounts: position.currentAmounts.map((amount) => ({
          address: amount.token.address,
          rawBalance: BigInt(amount.balance),
          decimals: amount.token.decimals,
          valueUsd: amount.quotes.usd?.value ?? 0,
        })),
      }
      return { plan: planIncrease(open, { depositUsd, slippagePercent }, poolState), open, error: null }
    } catch (error) {
      return { plan: null, open: null, error: error instanceof Error ? error.message : 'Cannot plan' }
    }
  }, [position, poolState, depositUsd, slippagePercent])

  const submit = useCallback(async () => {
    if (!position || !plan?.plan || !publicClient) return
    const [side0, side1] = plan.plan.maxAmounts

    // Not connected yet: RainbowKit's modal owns that flow; the send resumes on the next click.
    if (!connected) {
      openConnectModal?.()
      return
    }

    try {
      const account = connected

      if (getAddress(account) !== getAddress(position.wallet)) {
        throw new Error(
          `The connected wallet is not this position's owner. Switch to ${position.walletLabel} (${position.wallet.slice(0, 8)}…).`,
        )
      }

      setStep({ kind: 'busy', label: `Switching to ${chainLabel(position.chainId)}` })
      const switched = await switchChainAsync({ chainId: position.chainId })
      if (switched.id !== position.chainId) {
        throw new Error(`The wallet stayed on ${chainLabel(switched.id)}.`)
      }
      if (!walletClient) throw new Error('The wallet is connected but provides no signer.')

      setStep({ kind: 'busy', label: 'Checking token approvals' })
      const manager = getAddress(position.tokenAddress) as Address
      const approvals = await missingApprovals(
        publicClient,
        account,
        manager,
        plan.plan.maxAmounts.map((amount, index) => ({
          address: amount.address,
          symbol: position.currentAmounts[index]?.token.symbol ?? '?',
          rawAmount: amount.rawAmount,
        })),
      )

      for (const approval of approvals) {
        setStep({ kind: 'busy', label: approval.description })
        await walletClient.sendTransaction({ to: approval.to, data: approval.data })
      }

      const call = {
        tokenId: BigInt(position.tokenId),
        liquidityDelta: plan.plan.liquidityDelta,
        currency0: side0.address,
        currency1: side1.address,
        amount0Max: side0.rawAmount,
        amount1Max: side1.rawAmount,
        recipient: account,
        // Twenty minutes: enough for a slow confirmation, short enough that a forgotten prompt
        // cannot execute against a much older price.
        deadlineSeconds: BigInt(Math.floor(Date.now() / 1000) + 20 * 60),
      }
      const transaction = {
        to: manager,
        data: buildIncreaseCalldata(call),
        value: nativeValueFor(call),
      }

      setStep({ kind: 'busy', label: 'Simulating the exact transaction' })
      await simulate(publicClient, account, transaction)

      setStep({ kind: 'busy', label: 'Waiting for wallet confirmation' })
      const hash = await walletClient.sendTransaction({
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
      })
      setStep({ kind: 'sent', hash })
    } catch (error) {
      setStep({
        kind: 'error',
        message: error instanceof Error ? error.message : 'The transaction failed.',
      })
    }
  }, [position, plan, publicClient, connected, openConnectModal, switchChainAsync, walletClient])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Add liquidity to ${row.pair}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded border border-line bg-surface p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-ink">Add liquidity · {row.pair}</h2>
            <p className="mt-0.5 text-xs text-ink-ghost">
              {chainLabel(row.chainId)} · {row.protocol} · signs in your own wallet
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-ink-muted hover:bg-surface-raised hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Close
          </button>
        </div>

        {positions === null ? (
          <p className="mt-6 text-sm text-ink-muted">Loading your positions…</p>
        ) : positions.length === 0 ? (
          <p className="mt-6 text-sm text-ink-muted">
            No open positions in this pool among the tracked wallets. Only an existing position
            can be increased here.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            {positions.length > 1 ? (
              <label className="block text-sm text-ink-muted">
                Position
                <select
                  value={chosen}
                  onChange={(event) => setChosen(Number(event.target.value))}
                  className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
                >
                  {positions.map((entry, index) => (
                    <option key={entry.tokenId} value={index}>
                      {entry.walletLabel} · #{entry.tokenId} · {usd(entry.currentPositionValue)} ·{' '}
                      {entry.status.replace('_', ' ').toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-sm text-ink-muted">
                {position?.walletLabel} · #{position?.tokenId} ·{' '}
                {usd(position?.currentPositionValue ?? 0)} currently
              </p>
            )}

            <div className="flex gap-3">
              <label className="block flex-1 text-sm text-ink-muted">
                Add (USD)
                <input
                  type="number"
                  min={1}
                  step={10}
                  value={depositUsd}
                  onChange={(event) => setDepositUsd(Math.max(0, Number(event.target.value) || 0))}
                  className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 tabular-nums"
                />
              </label>
              <label className="block w-28 text-sm text-ink-muted">
                Slippage %
                <input
                  type="number"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={slippagePercent}
                  onChange={(event) =>
                    setSlippagePercent(Math.min(10, Math.max(0, Number(event.target.value) || 0)))
                  }
                  className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 tabular-nums"
                />
              </label>
            </div>

            {plan?.plan && position ? (
              <div className="rounded border border-line bg-surface-raised/40 px-3 py-2.5 text-sm">
                <p className="text-ink-muted">
                  Adds {(plan.plan.ratio * 100).toFixed(1)}% to the position. Up to:
                </p>
                <ul className="mt-1 space-y-0.5 tabular-nums text-ink">
                  {plan.plan.maxAmounts.map((amount, index) => (
                    <li key={amount.address}>
                      {tokenAmount(amount.rawAmount, position.currentAmounts[index]?.token.decimals ?? 18)}{' '}
                      {position.currentAmounts[index]?.token.symbol}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs text-ink-ghost">
                  Unused native currency is refunded in the same transaction. The exact call is
                  simulated first and never sent if the simulation reverts.
                </p>
              </div>
            ) : plan?.error ? (
              <p className="text-sm text-caution">{plan.error}</p>
            ) : null}

            {poolStateError ? <p className="text-sm text-caution">{poolStateError}</p> : null}
            {position && !poolState && !poolStateError ? (
              <p className="text-sm text-ink-ghost">Reading the pool's current price…</p>
            ) : null}
            {step.kind === 'error' ? <p className="text-sm text-risk">{step.message}</p> : null}
            {step.kind === 'sent' ? (
              <p className="text-sm text-gain">
                Sent. Transaction {step.hash.slice(0, 10)}…{step.hash.slice(-6)}
              </p>
            ) : null}

            <button
              type="button"
              disabled={!plan?.plan || step.kind === 'busy'}
              onClick={() => void submit()}
              className="w-full rounded border border-accent-dim bg-accent-dim/20 px-4 py-2.5 font-medium text-ink transition-colors hover:bg-accent-dim/35 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {step.kind === 'busy'
                ? `${step.label}…`
                : connected
                  ? 'Review in wallet'
                  : 'Connect wallet'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
