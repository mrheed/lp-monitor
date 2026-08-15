'use client'

import { useEffect, useState } from 'react'
import { getAddress, type Address } from 'viem'
import {
  connectWallet,
  currentAccount,
  onAccountsChanged,
  walletAvailable,
} from '@/lib/clients/wallet'
import { shortenAddress } from '@/lib/config'

/**
 * The wallet's connection status, always visible beside the table controls.
 *
 * Before this existed, connection happened invisibly inside the add-liquidity flow, and being
 * on the wrong account only surfaced after several steps of it. The chip shows which account is
 * connected before any flow starts, names it when it is one of the tracked wallets, and follows
 * account switches live.
 *
 * The first render is the same on server and client by construction: `window` and the injected
 * provider exist only in the browser, so anything read from them waits for the mount effect.
 * Branching on them during render is the hydration mismatch this codebase has already had once.
 */
export const WalletChip = () => {
  const [mounted, setMounted] = useState(false)
  const [account, setAccount] = useState<Address | null>(null)
  const [labels, setLabels] = useState<Map<string, string>>(new Map())
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    setMounted(true)

    // eth_accounts never prompts; it only reports an authorisation that already exists.
    void currentAccount().then(setAccount)
    const unsubscribe = onAccountsChanged(setAccount)

    const loadLabels = async () => {
      try {
        const response = await fetch('/api/wallets')
        if (!response.ok) return
        const body: { wallets?: { address: string; label: string }[] } = await response.json()
        setLabels(new Map((body.wallets ?? []).map((wallet) => [wallet.address.toLowerCase(), wallet.label])))
      } catch {
        // The chip still shows the raw address; names are a nicety.
      }
    }
    void loadLabels()

    return unsubscribe
  }, [])

  const connect = async () => {
    setConnecting(true)
    try {
      setAccount(await connectWallet())
    } catch {
      // The wallet dialog was dismissed; the chip simply stays disconnected.
    } finally {
      setConnecting(false)
    }
  }

  // Identical to the server render until mounted, then the real state takes over.
  if (!mounted) {
    return (
      <span className="rounded border border-line px-3 py-2 text-sm text-ink-ghost sm:py-1.5">
        Wallet
      </span>
    )
  }

  if (!walletAvailable()) {
    return (
      <span
        className="rounded border border-line px-3 py-2 text-sm text-ink-ghost sm:py-1.5"
        title="Install a browser wallet to add liquidity from the table"
      >
        No wallet
      </span>
    )
  }

  if (account === null) {
    return (
      <button
        type="button"
        onClick={() => void connect()}
        disabled={connecting}
        className="rounded border border-line px-3 py-2 text-sm text-ink-muted transition-colors hover:border-accent-dim hover:text-ink disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent sm:py-1.5"
      >
        {connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
    )
  }

  const label = labels.get(account.toLowerCase())

  return (
    <span
      className="flex items-center gap-2 rounded border border-line px-3 py-2 text-sm sm:py-1.5"
      title={`Connected as ${getAddress(account)}${label ? ` (${label})` : ', not one of the tracked wallets'}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-gain" aria-hidden />
      <span className={label ? 'text-ink' : 'text-caution'}>
        {label ?? shortenAddress(account)}
      </span>
      {label ? <span className="text-ink-ghost">{shortenAddress(account)}</span> : null}
    </span>
  )
}
