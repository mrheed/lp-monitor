'use client'

import { useEffect, useState } from 'react'
import { getAddress, type Address } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'
import { VOLUME_TIER_FEE_HOOK_ABI } from '@/lib/hook/volumeTierFeeHook'

type Info = { owner: Address | null; poolManager: Address | null; whitelisted: boolean | null }
type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'loaded'; info: Info }

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

/**
 * Live, read-only facts about the target hook: its owner, the PoolManager it points at, and
 * whether the connected wallet is a whitelisted liquidity provider. Lets the operator confirm they
 * pasted the right hook and hold the access the next steps need before spending gas on a revert.
 */
export const HookInfo = ({
  hook,
  chainId,
  explorerBase,
}: {
  hook: Address
  chainId: number
  explorerBase: string
}) => {
  const publicClient = usePublicClient({ chainId })
  const { address } = useAccount()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    if (!publicClient) {
      setState({ kind: 'error' })
      return
    }
    setState({ kind: 'loading' })
    const base = { address: hook, abi: VOLUME_TIER_FEE_HOOK_ABI } as const
    const load = async () => {
      const owner = await publicClient.readContract({ ...base, functionName: 'owner' }).catch(() => null)
      const poolManager = await publicClient.readContract({ ...base, functionName: 'poolManager' }).catch(() => null)
      const whitelisted = address
        ? await publicClient.readContract({ ...base, functionName: 'isLiquidityProvider', args: [address] }).catch(() => null)
        : null
      if (cancelled) return
      if (owner === null && poolManager === null) setState({ kind: 'error' })
      else setState({ kind: 'loaded', info: { owner, poolManager, whitelisted } })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [hook, chainId, address, publicClient])

  if (state.kind === 'loading') {
    return <p className="mt-3 text-[12px] text-[var(--db-muted)]">Reading hook…</p>
  }
  if (state.kind === 'error') {
    return (
      <p className="mt-3 text-[12px] text-[var(--db-muted)]">
        Couldn&apos;t read this address as a VolumeTierFeeHook on this network.
      </p>
    )
  }

  const { owner, poolManager, whitelisted } = state.info
  const isOwner = owner !== null && address !== undefined && getAddress(owner) === getAddress(address)

  return (
    <div className="mt-3 border-t border-[var(--db-line)] pt-3">
      {address === undefined ? (
        <p className="mb-3 text-[12px] text-[var(--db-muted)]">Connect a wallet to check whether you own this hook.</p>
      ) : isOwner ? (
        <p className="db-signalbox mb-3 px-3 py-2 text-[12px] text-[var(--db-signal)]">
          You own this hook — you can whitelist providers and set its fee config.
        </p>
      ) : owner !== null ? (
        <p className="db-alertbox mb-3 px-3 py-2 text-[12px]">
          You don&apos;t own this hook. Reading it is fine, but Whitelist and Set-fee-config will revert on-chain — only the
          owner ({short(owner)}) can change it.
        </p>
      ) : null}

      <div className="grid gap-x-6 gap-y-1.5 text-[12px] sm:grid-cols-2">
      <div className="flex items-center gap-2">
        <span className="db-kicker">Owner</span>
        {owner ? (
          <span className="db-code text-[var(--db-ink)]">{short(owner)}</span>
        ) : (
          <span className="text-[var(--db-muted)]">—</span>
        )}
        {isOwner ? <span className="text-[var(--db-signal)]">you</span> : null}
      </div>

      <div className="flex items-center gap-2">
        <span className="db-kicker">PoolManager</span>
        <span className="db-code text-[var(--db-muted)]">{poolManager ? short(poolManager) : '—'}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="db-kicker">Your access</span>
        {address === undefined ? (
          <span className="text-[var(--db-muted)]">connect a wallet</span>
        ) : whitelisted === null ? (
          <span className="text-[var(--db-muted)]">—</span>
        ) : whitelisted ? (
          <span className="text-[var(--db-signal)]">whitelisted LP</span>
        ) : (
          <span className="text-[var(--db-muted)]">not whitelisted</span>
        )}
      </div>

        <div className="flex items-center gap-2">
          <a
            className="text-[var(--db-muted)] underline underline-offset-2 transition-colors hover:text-[var(--db-ink)]"
            href={`${explorerBase}${hook}`}
            target="_blank"
            rel="noreferrer"
          >
            View on explorer
          </a>
        </div>
      </div>
    </div>
  )
}
