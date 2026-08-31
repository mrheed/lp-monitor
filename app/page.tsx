import { Suspense } from 'react'
import { PoolsSection } from './PoolsSection'

export const dynamic = 'force-dynamic'

/** Placeholder rows, so the wait reads as a table loading rather than a blank page. */
const TableSkeleton = () => (
  <div className="mt-6 animate-pulse sm:mt-8" aria-hidden>
    <div className="mb-3 flex flex-wrap gap-2.5">
      {[52, 36, 30, 30, 44].map((w, i) => (
        <div key={i} className="h-9 rounded border border-line bg-surface" style={{ width: `${w * 4}px` }} />
      ))}
    </div>
    <div className="rounded border border-line">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0">
          <div className="h-4 w-40 rounded bg-surface-raised" />
          <div className="h-4 w-24 rounded bg-surface-raised/70" />
          <div className="h-4 w-20 rounded bg-surface-raised/50" />
          <div className="ml-auto h-4 w-28 rounded bg-surface-raised/40" />
        </div>
      ))}
    </div>
  </div>
)

const Page = () => (
  <main className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6 sm:py-10">
    <header className="mb-6 sm:mb-8">
      <h1 className="text-xl font-semibold tracking-tight text-ink">LP Pool Tracker</h1>
      {/*
        Everything below the title needs the snapshot, which measures trade rates one request per
        pool. It streams in behind this boundary so the shell is interactive straight away.
      */}
      <Suspense
        fallback={
          <>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
              Reading the pool feed and measuring trade rates…
            </p>
            <TableSkeleton />
          </>
        }
      >
        <PoolsSection />
      </Suspense>
    </header>
  </main>
)

export default Page
