'use client'

/**
 * What the stocks route shows when the pool feed cannot be read.
 *
 * The page is built from one upstream call, and on a cold cache there is no stored snapshot to
 * fall back to, so an upstream outage reaches the reader. It reaches them as a sentence they can
 * act on rather than as a stack trace: the reads retry a few times before landing here, so by the
 * time this renders the feed is genuinely unreachable rather than briefly slow.
 */
const StocksError = ({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) => (
  <main className="mx-auto w-full max-w-[1560px]">
    <header className="border-b border-line px-6 pb-8 pt-10 sm:px-10">
      <p className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">
        Tokenized equities · Robinhood Chain
      </p>
      <h1 className="display mt-6 max-w-[12ch] text-[clamp(44px,6vw,84px)] text-ink">
        The feed did not answer.
      </h1>
    </header>

    <section className="px-6 py-8 sm:px-10">
      <p className="max-w-[52ch] text-[13px] leading-relaxed text-ink-muted">
        Every figure on this page comes from one pool feed, and it could not be reached. Nothing is
        wrong with the pools themselves; there is simply nothing to show until the feed responds.
      </p>

      <button
        type="button"
        onClick={reset}
        className="mt-5 border border-line-strong px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-ink transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        Try again
      </button>

      {error.digest ? (
        <p className="mt-4 font-mono text-[11px] text-ink-ghost">Reference {error.digest}</p>
      ) : null}
    </section>
  </main>
)

export default StocksError
