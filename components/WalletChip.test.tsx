import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Providers } from '@/app/providers'
import { WalletChip } from './WalletChip'

describe('the wallet chip on the server', () => {
  it('renders a neutral placeholder, never a browser-dependent state', () => {
    // RainbowKit reports mounted=false during SSR, and the chip must render nothing that
    // depends on the browser until that flips: branching on wallet presence during the first
    // render is the hydration failure this codebase has already shipped once with locale
    // formatting.
    const html = renderToStaticMarkup(
      <Providers>
        <WalletChip />
      </Providers>,
    )

    expect(html).toContain('Wallet')
    expect(html).not.toContain('Connect wallet')
    expect(html).not.toContain('Unsupported')
  })
})
