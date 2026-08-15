'use client'

import { useEffect, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'

/**
 * RainbowKit's connect button, dressed to name the tracked wallets.
 *
 * `ConnectButton.Custom` instead of the stock button for one reason: the stock one shows an
 * address, and this dashboard knows those addresses by name. Connected as a tracked wallet it
 * shows the label; connected as anything else it warns in colour, which is the early version of
 * the refusal the add-liquidity flow would give at the end.
 *
 * RainbowKit's `mounted` flag guards hydration: until it is true the markup must not depend on
 * anything only the browser knows, the mismatch this codebase has already shipped once.
 */
export const WalletChip = () => {
  const [labels, setLabels] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/wallets')
        if (!response.ok) return
        const body: { wallets?: { address: string; label: string }[] } = await response.json()
        setLabels(
          new Map((body.wallets ?? []).map((wallet) => [wallet.address.toLowerCase(), wallet.label])),
        )
      } catch {
        // The chip still shows the address RainbowKit renders; names are a nicety.
      }
    }
    void load()
  }, [])

  const chip =
    'rounded border border-line px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent sm:py-1.5'

  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        if (!mounted) {
          return <span className={`${chip} text-ink-ghost`}>Wallet</span>
        }

        if (!account || !chain) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className={`${chip} text-ink-muted hover:border-accent-dim hover:text-ink`}
            >
              Connect wallet
            </button>
          )
        }

        if (chain.unsupported) {
          return (
            <button
              type="button"
              onClick={openChainModal}
              className={`${chip} text-risk hover:border-risk`}
            >
              Unsupported chain
            </button>
          )
        }

        const label = labels.get(account.address.toLowerCase())

        return (
          <button
            type="button"
            onClick={openAccountModal}
            className={`${chip} flex items-center gap-2 hover:border-accent-dim`}
            title={
              label
                ? `Connected as ${label} on ${chain.name}`
                : `Connected on ${chain.name}. This is not one of the tracked wallets, so positions here cannot be increased.`
            }
          >
            <span className="h-1.5 w-1.5 rounded-full bg-gain" aria-hidden />
            <span className={label ? 'text-ink' : 'text-caution'}>
              {label ?? account.displayName}
            </span>
            {label ? <span className="text-ink-ghost">{account.displayName}</span> : null}
          </button>
        )
      }}
    </ConnectButton.Custom>
  )
}
