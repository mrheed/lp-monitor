import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WalletChip } from './WalletChip'

describe('the wallet chip on the server', () => {
  it('renders a neutral placeholder, never a window-dependent state', () => {
    // The injected provider exists only in the browser. If the server branched on it, the first
    // client render would disagree with the server HTML, which is the hydration failure this
    // codebase has already shipped once with locale formatting.
    const html = renderToStaticMarkup(<WalletChip />)

    expect(html).toContain('Wallet')
    expect(html).not.toContain('No wallet')
    expect(html).not.toContain('Connect wallet')
  })
})
