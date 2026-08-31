import { StockVolumePanel } from '@/components/StockVolumePanel'
import { getPoolsSnapshot } from '@/lib/domain/pools'
import { STOCK_TOKEN_COUNT } from '@/lib/domain/stockTokens'
import { groupByStock } from '@/lib/domain/stockGroups'
import { aggregateSeries } from '@/lib/domain/volumeSampler'
import { readVolumeHistory } from '@/lib/domain/volumeStore'

const money = (value: number): string =>
  value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1_000)}k`

/**
 * The stock pools and their volume history.
 *
 * Reuses the snapshot the pools page already builds rather than fetching the feed again; the
 * filtering is the only difference between the two pages.
 */
export const StocksSection = async () => {
  const { rows, fetchedAt } = await getPoolsSnapshot()
  const stockRows = rows.filter((row) => row.isStock)
  const byPool = readVolumeHistory()
  const aggregate = aggregateSeries(byPool)
  const groups = groupByStock(stockRows)

  const volume = stockRows.reduce((total, row) => total + row.volume24hUsd, 0)
  const tvl = stockRows.reduce((total, row) => total + row.tvlUsd, 0)

  /** The standing figures, as a rule-divided row rather than a strip of cards. */
  const figures: [string, string][] = [
    ['Traded, 24h', money(volume)],
    ['Liquidity', money(tvl)],
    ['Equities', `${groups.length} of ${STOCK_TOKEN_COUNT}`],
    ['Pools', stockRows.length.toLocaleString()],
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
          Every pool holding one of the equities Robinhood issued on this chain, matched by token
          contract rather than by ticker. Several of these symbols also trade here as unrelated
          memecoins.
        </p>
        <p className="mt-2 text-[11px] text-ink-ghost">
          Feed read {new Date(fetchedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta' })} WIB
        </p>
      </section>

      <div className="px-6 py-8 sm:px-10">
        <StockVolumePanel aggregate={aggregate} byPool={byPool} rows={stockRows} />
      </div>
    </>
  )
}
