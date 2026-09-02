import { Suspense } from 'react'
import { Instrument_Serif } from 'next/font/google'
import { PoolsSection } from './PoolsSection'

export const dynamic = 'force-dynamic'

/**
 * The display voice, same face and variable as the stocks route.
 *
 * Loaded here rather than in the root layout so it is requested only where a display statement
 * uses it; the editorial CSS resolves `--font-editorial-serif` wherever the scope is present.
 */
const editorialSerif = Instrument_Serif({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-editorial-serif',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
})

/**
 * Placeholder for the streaming section, drawn in the sheet's own geometry.
 *
 * Ruled rows rather than rounded cards: the shell it stands in for has no cards, and a skeleton
 * in a different shape would flash a layout the page never shows.
 */
const SheetSkeleton = () => (
  <div className="animate-pulse" aria-hidden>
    <div className="grid border-b border-line sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className={`px-6 py-6 sm:px-10 ${index > 0 ? 'border-t border-line sm:border-t-0 sm:border-l' : ''}`}
        >
          <div className="h-2.5 w-20 bg-surface-raised" />
          <div className="mt-4 h-9 w-28 bg-surface-raised/70" />
        </div>
      ))}
    </div>
    <div className="border-b border-line px-6 py-6 sm:px-10">
      <div className="h-3 w-[36ch] max-w-full bg-surface-raised/60" />
      <div className="mt-2 h-3 w-[24ch] bg-surface-raised/40" />
    </div>
    <div className="px-6 py-8 sm:px-10">
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="flex items-center gap-6 border-b border-line/60 py-3">
          <div className="h-3.5 w-40 bg-surface-raised" />
          <div className="h-3.5 w-24 bg-surface-raised/70" />
          <div className="hidden h-3.5 w-20 bg-surface-raised/50 sm:block" />
          <div className="ml-auto h-3.5 w-28 bg-surface-raised/40" />
        </div>
      ))}
    </div>
  </div>
)

/**
 * The pools masthead, in the same editorial sheet as the stocks page.
 *
 * Full bleed with hairline rules rather than a padded card, the statement carrying the weight.
 * The two pages read as sections of one publication: "What is trading." asks about flow, this
 * page asks about the other side of it.
 */
const Page = () => (
  <div className={`editorial ${editorialSerif.variable} min-h-screen`}>
    <main className="mx-auto w-full max-w-[1560px]">
      <header className="border-b border-line px-6 pb-8 pt-10 sm:px-10">
        <p className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          Liquidity pools · Robinhood Chain
        </p>
        <h1 className="display mt-6 max-w-[9ch] text-[clamp(56px,8vw,112px)] text-ink">
          What is earning.
        </h1>
      </header>

      <Suspense
        fallback={
          <>
            <p className="border-b border-line px-6 py-6 text-[13px] leading-relaxed text-ink-muted sm:px-10">
              Reading the pool feed and measuring trade rates…
            </p>
            <SheetSkeleton />
          </>
        }
      >
        <PoolsSection />
      </Suspense>
    </main>
  </div>
)

export default Page
