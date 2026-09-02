import { PoolTable } from '@/components/PoolTable'
import { getPoolsSnapshot } from '@/lib/domain/pools'

const money = (value: number): string =>
  value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1_000)}k`

/**
 * The pool figures and table, laid out as the same ruled sheet the stocks page uses.
 *
 * Split from the page so it can stream: the snapshot measures trade rates one request per pool,
 * which takes tens of seconds on a cold cache, and the masthead should not wait for it.
 */
export const PoolsSection = async () => {
  const { rows, totalPools, walletsTracked, scoredCount, warnings, fetchedAt } =
    await getPoolsSnapshot()

  const fees24h = rows.reduce((total, row) => total + row.fees24hUsd, 0)
  const tvl = rows.reduce((total, row) => total + row.tvlUsd, 0)

  /** The standing figures, rule-divided rather than carded, mirroring the stocks page. */
  const figures: [string, string][] = [
    ['Fees earned, 24h', money(fees24h)],
    ['Liquidity', money(tvl)],
    ['Pools scored', `${scoredCount.toLocaleString()} of ${totalPools.toLocaleString()}`],
    ['Wallets checked', walletsTracked.toLocaleString()],
  ]

  return (
    <>
      <section className="grid border-b border-line sm:grid-cols-2 lg:grid-cols-4">
        {figures.map(([label, value], index) => (
          <div
            key={label}
            className={`px-6 py-6 sm:px-10 ${index > 0 ? 'border-t border-line sm:border-t-0 sm:border-l' : ''}`}
          >
            <p className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">{label}</p>
            <p className="display mt-3 text-[34px] text-ink">{value}</p>
          </div>
        ))}
      </section>

      <section className="border-b border-line px-6 py-6 sm:px-10">
        <p className="max-w-[52ch] text-[13px] leading-relaxed text-ink-muted">
          Every Uniswap pool on the chain, scored on fee rate, thin liquidity, trade rate, trader
          count and low volatility. Hover a score for its five components, or a projected figure
          for how the deposit was applied. In means a tracked wallet holds the pool now; Past
          means it closed.
        </p>
        <p className="mt-2 text-[11px] text-ink-ghost">
          Feed read{' '}
          {new Date(fetchedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta' })} WIB
        </p>
      </section>

      {warnings.length > 0 ? (
        <section className="border-b border-line px-6 py-4 sm:px-10">
          <ul className="space-y-1.5 text-[13px] leading-relaxed text-caution">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="px-6 py-8 sm:px-10">
        <PoolTable initialRows={rows} />
      </div>
    </>
  )
}
