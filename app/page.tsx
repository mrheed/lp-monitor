import { PoolTable } from '@/components/PoolTable'
import { getPoolsSnapshot } from '@/lib/domain/pools'

export const dynamic = 'force-dynamic'

const Page = async () => {
  const { rows, totalPools, walletsTracked, scoredCount, warnings, fetchedAt } =
    await getPoolsSnapshot()

  return (
    <main className="mx-auto max-w-[1560px] px-6 py-10">
      <header className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-100">LP Pool Tracker</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-500">
          Uniswap on Robinhood Chain. {totalPools.toLocaleString()} pools, of which{' '}
          {scoredCount.toLocaleString()} are scored on fee rate, thin TVL, trade rate, trader
          count and low volatility.
          {walletsTracked > 0
            ? ` Checking ${walletsTracked} wallet${walletsTracked === 1 ? '' : 's'}.`
            : null}
        </p>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-neutral-600">
          Updated {new Date(fetchedAt).toLocaleTimeString()}. Hover a score for its five
          components, or a projected figure for how the deposit was applied. In means you hold
          the pool now, Past means you closed it.
        </p>
      </header>

      {warnings.length > 0 ? (
        <ul className="mb-8 space-y-1.5 rounded border border-neutral-800 bg-neutral-900/60 px-4 py-3 text-sm leading-relaxed text-neutral-400">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <PoolTable initialRows={rows} />
    </main>
  )
}

export default Page
