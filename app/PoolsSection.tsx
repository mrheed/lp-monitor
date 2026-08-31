import { PoolTable } from '@/components/PoolTable'
import { getPoolsSnapshot } from '@/lib/domain/pools'

/**
 * The pool table and the figures that describe it, split out so the page can stream.
 *
 * The snapshot measures trade rates one request per pool, which takes tens of seconds on a cold
 * cache. Rendering it inside a Suspense boundary lets the shell reach the browser immediately
 * instead of holding the whole response until the last upstream call returns.
 */
export const PoolsSection = async () => {
  const { rows, totalPools, walletsTracked, scoredCount, warnings, fetchedAt } =
    await getPoolsSnapshot()

  return (
    <>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink0">
        Uniswap on Robinhood Chain. {totalPools.toLocaleString()} pools, of which{' '}
        {scoredCount.toLocaleString()} are scored on fee rate, thin TVL, trade rate, trader count
        and low volatility.
        {walletsTracked > 0
          ? ` Checking ${walletsTracked} wallet${walletsTracked === 1 ? '' : 's'}.`
          : null}
      </p>
      <p className="mt-2 max-w-3xl text-xs leading-relaxed text-ink-ghost">
        Updated {new Date(fetchedAt).toLocaleTimeString()}. Hover a score for its five components,
        or a projected figure for how the deposit was applied. In means you hold the pool now, Past
        means you closed it.
      </p>

      {warnings.length > 0 ? (
        <ul className="mb-8 mt-6 space-y-1.5 rounded border border-caution/30 bg-caution/5 px-4 py-3 text-sm leading-relaxed text-ink-muted">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 sm:mt-8">
        <PoolTable initialRows={rows} />
      </div>
    </>
  )
}
