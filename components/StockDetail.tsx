'use client'

import { useEffect, useState } from 'react'
import { StockVolumeChart } from './StockVolumeChart'
import { stockTicker } from '@/lib/domain/stockTokens'
import {
  aggregateSeries,
  shareOfTotal,
  hourlyReadings,
  type VolumeBucket,
  type VolumeHistory,
} from '@/lib/domain/volumeHistory'
import type { Trade } from '@/lib/domain/poolTrades'
import type { PoolRow } from '@/lib/types'

const money = (value: number): string => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`
  if (value >= 1) return `$${Math.round(value)}`
  return value > 0 ? '<$1' : '$0'
}

const shortAddress = (value: string) =>
  value.length > 10 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value

/**
 * How long ago a trade landed.
 *
 * Relative rather than a wall clock: the question a trade list answers is whether this is
 * happening now, and "14:32:08" only answers that if the reader knows what time it is.
 */
const timeAgo = (ms: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - ms) / 1000))
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return `${Math.round(hours / 24)}d ago`
}

/** How often an open row re-reads its pool. Fast enough to watch, slow enough to be one request. */
const TRADE_POLL_MS = 5_000

/** A drawn arrow, so an external link is not marked with a text glyph. */
const ExternalMark = () => (
  <svg aria-hidden viewBox="0 0 8 8" className="h-2 w-2">
    <path d="M1 7 L7 1 M3 1 h4 v4" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

type Props = {
  ticker: string
  pools: PoolRow[]
  byPool: VolumeHistory
}

/**
 * Everything behind one stock: the pools trading it, its volume, and its latest trades.
 *
 * Trades are fetched when the row opens rather than with the page. Fifty swaps per pool across
 * every stock would be hundreds of requests for detail almost none of which gets read.
 */
export const StockDetail = ({ ticker, pools, byPool }: Props) => {
  const [pool, setPool] = useState<PoolRow>(pools[0])
  const [trades, setTrades] = useState<Trade[] | null>(null)
  const [failed, setFailed] = useState(false)
  // Stamped when a batch lands, so every row ages from the same instant.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let current = true
    setTrades(null)
    setFailed(false)

    const read = () => {
      void fetch('/api/pool/trades', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        poolId: pool.poolId,
        protocol: pool.protocol,
        chainId: pool.chainId,
        stockIsToken0: stockTicker(pool.token0Address) !== null,
      }),
    })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: unknown) => {
          if (!current) return
          const rows = (payload as { trades?: unknown } | null)?.trades
          if (Array.isArray(rows)) {
            setTrades(rows)
            setNow(Date.now())
            setFailed(false)
          } else if (trades === null) {
            // A failed refresh leaves the last good list on screen rather than blanking it.
            setFailed(true)
          }
        })
        .catch(() => current && trades === null && setFailed(true))
    }

    read()
    const timer = setInterval(read, TRADE_POLL_MS)

    // Ignoring a response for a pool the reader has already moved off keeps the panel honest.
    return () => {
      current = false
      clearInterval(timer)
    }
    // `trades` is read only to decide whether a failure should blank the list, and including it
    // would restart the poll on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool])

  // The ticker's own series, summed across its pools, so the detail chart matches the row.
  const own: VolumeHistory = Object.fromEntries(
    pools.map((entry) => [entry.poolId.toLowerCase(), byPool[entry.poolId.toLowerCase()] ?? []]),
  )
  const tickerSeries = aggregateSeries(own)

  const selectedSeries: VolumeBucket[] | null = (() => {
    const buckets = byPool[pool.poolId.toLowerCase()]
    if (buckets === undefined) return null
    const readings = hourlyReadings(buckets)
    return readings.length > 0 ? readings : null
  })()

  const share = shareOfTotal(tickerSeries, selectedSeries)
  const poolShare = share === null ? null : share < 1 ? share.toFixed(2) : share.toFixed(1)

  return (
    <div className="space-y-4 border-t border-line bg-canvas/40 px-4 py-4">
      <div>
        <h3 className="mb-2 text-[10px] uppercase tracking-[0.12em] text-ink-ghost">
          {pools.length} {pools.length === 1 ? 'pool' : 'pools'} trading {ticker}
        </h3>
        <table className="w-full border-collapse text-[12px]">
          <tbody>
            {pools.map((entry) => {
              const active = entry.poolId === pool.poolId
              return (
                <tr
                  key={entry.poolId}
                  className={`border-b border-line/50 last:border-b-0 ${active ? 'text-ink' : 'text-ink-muted'}`}
                >
                  <td className="py-1.5 pr-3">
                    <button
                      type="button"
                      onClick={() => setPool(entry)}
                      aria-pressed={active}
                      className={`text-left transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${active ? 'text-ink' : ''}`}
                    >
                      {entry.pair}
                      <span className="ml-2 font-mono text-[10px] tabular-nums text-ink-ghost">
                        {entry.feeTier}%
                      </span>
                      <span className="ml-2 text-[10px] uppercase tracking-[0.1em] text-ink-ghost">
                        {entry.protocol.replace('uniswap', '')}
                      </span>
                    </button>
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                    {money(entry.volume24hUsd)}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-ink-ghost">
                    {money(entry.tvlUsd)} TVL
                  </td>
                  <td className="py-1.5 text-right">
                    <span className="flex items-center justify-end gap-3">
                      <a
                        href={entry.uniswapUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-ink-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      >
                        Uniswap <ExternalMark />
                      </a>
                      <a
                        href={entry.krystalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-ink-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      >
                        Krystal <ExternalMark />
                      </a>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <StockVolumeChart
        aggregate={tickerSeries}
        aggregateLabel={`All ${ticker} pools`}
        selected={selectedSeries}
        selectedLabel={pool.pair}
      />

      {selectedSeries !== null ? (
        <div>
          <StockVolumeChart
            aggregate={selectedSeries}
            selected={null}
            selectedLabel={null}
            aggregateLabel={pool.pair}
            compact
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-ghost">
            {pool.pair} on its own scale. It is{' '}
            {poolShare === null ? 'a fraction of' : `${poolShare}% of`} {ticker} volume over these
            hours, which is a sliver against the axis above.
          </p>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-[10px] uppercase tracking-[0.12em] text-ink-ghost">
          Latest trades · {pool.pair}
        </h3>

        {failed ? (
          <p className="text-[11px] text-ink-ghost">Could not read trades for this pool.</p>
        ) : trades === null ? (
          <p className="text-[11px] text-ink-ghost">Reading trades…</p>
        ) : trades.length === 0 ? (
          <p className="text-[11px] text-ink-ghost">No trades returned for this pool.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded border border-line">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-[10px] uppercase tracking-[0.12em] text-ink-ghost">
                  <th scope="col" className="px-3 py-1.5 text-left font-normal">Time</th>
                  <th scope="col" className="px-3 py-1.5 text-left font-normal">Side</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-normal">Size</th>
                  <th scope="col" className="px-3 py-1.5 text-right font-normal">Wallet</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade, index) => (
                  <tr key={`${trade.timestampMs}-${index}`} className="border-t border-line/50">
                    <td className="px-3 py-1 font-mono tabular-nums text-ink-ghost">
                      {timeAgo(trade.timestampMs, now)}
                    </td>
                    <td
                      className={`px-3 py-1 ${trade.side === 'buy' ? 'text-[var(--gain)]' : 'text-[var(--risk)]'}`}
                    >
                      {trade.side}
                    </td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums text-ink">
                      {money(trade.amountUsd)}
                    </td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums text-ink-ghost">
                      {shortAddress(trade.wallet)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1.5 text-[11px] text-ink-ghost">
          Fifty most recent swaps, refreshed every five seconds. That span is minutes on a busy
          pool and days on a quiet one.
        </p>
      </div>
    </div>
  )
}
