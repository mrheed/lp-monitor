'use client'

import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { createConfig, http, type Transport } from 'wagmi'
import { arbitrum, base, mainnet, optimism, polygon } from 'wagmi/chains'
import { defineChain, type Chain } from 'viem'

/**
 * Robinhood Chain is not in wagmi's registry, so it is defined from the public chain list.
 *
 * The official RPC was returning nothing but connection failures when tested, so the community
 * one leads and the official one stands behind it as the fallback.
 */
export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.arrowrpc.com', 'https://rpc.mainnet.chain.robinhood.com'],
    },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
})

/** The same six chains the tracker follows, Robinhood first as the primary. */
const chains = [robinhoodChain, mainnet, base, arbitrum, optimism, polygon] as const satisfies readonly [Chain, ...Chain[]]

const transports = Object.fromEntries(
  chains.map((chain) => [chain.id, http()]),
) as Record<(typeof chains)[number]['id'], Transport>

/**
 * WalletConnect needs a cloud project id and refuses to run on a placeholder.
 *
 * With one configured, the mobile and Coinbase connectors appear; without one, the modal offers
 * injected wallets only, which is everything a browser extension user needs. The id is public
 * by design (it ships to every visitor), hence NEXT_PUBLIC.
 */
const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? ''

const wallets = projectId
  ? [
      {
        groupName: 'Wallets',
        wallets: [injectedWallet, metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet],
      },
    ]
  : [{ groupName: 'Wallets', wallets: [injectedWallet] }]

const connectors = connectorsForWallets(wallets, {
  appName: 'LP Pool Tracker',
  projectId: projectId || 'unused-without-walletconnect',
})

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports,
  // The server renders the disconnected state and the client rehydrates the real one; without
  // this flag wagmi restores the connection during the first render and the HTML disagrees.
  ssr: true,
})
