import { Suspense } from 'react'
import { StocksSection } from './StocksSection'

export const dynamic = 'force-dynamic'

const Page = () => (
  <main className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6 sm:py-10">
    <header className="mb-6 sm:mb-8">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Stock pools</h1>
      {/* Needs the same snapshot the pools page measures, so it streams behind a boundary too. */}
      <Suspense
        fallback={
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
            Reading the pool feed…
          </p>
        }
      >
        <StocksSection />
      </Suspense>
    </header>
  </main>
)

export default Page
