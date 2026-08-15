import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import '@rainbow-me/rainbowkit/styles.css'
import './globals.css'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'LP Pool Tracker',
  description: 'Uniswap v4 liquidity pools on Robinhood Chain, ranked by fees, depth and volume.',
}

const RootLayout = ({ children }: { children: ReactNode }) => (
  <html lang="en">
    <body>
      <Providers>{children}</Providers>
    </body>
  </html>
)

export default RootLayout
