import { StockVolumePanel } from '@/components/StockVolumePanel'
import { getPoolsSnapshot } from '@/lib/domain/pools'
import { STOCK_TOKEN_COUNT } from '@/lib/domain/stockTokens'
import { aggregateSeries } from '@/lib/domain/volumeSampler'
import { readVolumeHistory } from '@/lib/domain/volumeStore'

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

  const tvl = stockRows.reduce((total, row) => total + row.tvlUsd, 0)
  const volume = stockRows.reduce((total, row) => total + row.volume24hUsd, 0)

  return (
    <>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink0">
        {stockRows.length.toLocaleString()} pools holding one of the {STOCK_TOKEN_COUNT} equities
        and ETFs Robinhood has issued on this chain. ${Math.round(tvl).toLocaleString()} of TVL and
        ${Math.round(volume).toLocaleString()} traded in the last 24 hours.
      </p>
      <p className="mt-2 max-w-3xl text-xs leading-relaxed text-ink-ghost">
        Updated {new Date(fetchedAt).toLocaleTimeString()}. Pools are matched by token contract, not
        by ticker: several of these symbols also exist as unrelated memecoins here.
      </p>

      <div className="mt-6">
        <StockVolumePanel
          aggregate={aggregate}
          byPool={byPool}
          rows={stockRows}
        />
      </div>

    </>
  )
}
