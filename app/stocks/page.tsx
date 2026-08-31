import { Suspense } from 'react'
import { StocksSection } from './StocksSection'

export const dynamic = 'force-dynamic'

/**
 * The stocks page masthead.
 *
 * Full bleed with hairline rules rather than a padded card, so the page reads as one sheet.
 * The statement carries the weight; there is no eyebrow above it.
 */
const Page = () => (
  <main className="mx-auto w-full max-w-[1560px]">
    <header className="border-b border-line px-6 pb-8 pt-10 sm:px-10">
      <p className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">
        Tokenized equities · Robinhood Chain
      </p>
      <h1 className="display mt-6 max-w-[9ch] text-[clamp(56px,8vw,112px)] text-ink">
        What is trading.
      </h1>
    </header>

    <Suspense
      fallback={
        <p className="px-6 py-10 text-[13px] leading-relaxed text-ink-muted sm:px-10">
          Reading the pool feed…
        </p>
      }
    >
      <StocksSection />
    </Suspense>
  </main>
)

export default Page
