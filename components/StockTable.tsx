'use client'

import { Fragment, useMemo, useState } from 'react'
import { StockDetail } from './StockDetail'
import { StockSparkline } from './StockSparkline'
import { TIMEFRAMES, type Timeframe } from '@/lib/domain/volumeTimeframes'
import { aggregateSeries, type VolumeBucket, type VolumeHistory } from '@/lib/domain/volumeHistory'
import type { StockGroup } from '@/lib/domain/stockGroups'
import type { PoolRow } from '@/lib/types'

type Group = StockGroup<PoolRow>

/** Sortable columns. Volume columns are keyed by the window they report. */
type SortKey = Timeframe | 'tx' | 'ticker' | 'pools'

/** A drawn caret, so sort direction and row state are not text glyphs standing in for icons. */
const Caret = ({ open }: { open: boolean }) => (
  <svg
    aria-hidden
    viewBox="0 0 8 5"
    className="inline-block h-[5px] w-2 align-middle"
    style={{ transform: open ? undefined : 'rotate(-90deg)' }}
  >
    <path d="M0 0 L4 5 L8 0 Z" fill="currentColor" />
  </svg>
)

const money = (value: number): string => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`
  if (value >= 1) return `$${Math.round(value)}`
  return value > 0 ? '<$1' : '$0'
}

/**
 * The minute is not a window the feed reports.
 *
 * It sums the sampled hourly rate across the ticker's pools and scales it down, so it is drawn
 * dotted wherever it appears: a sample of twenty five swaps spans seconds on a busy stock and
 * hours on a quiet one.
 */
const perMinute = (group: Group): number | null => {
  const sampled = group.pools.filter(
    (pool) =>
      pool.activity !== null && pool.activity.sampleSize > 0 && pool.activity.windowSeconds > 0,
  )
  if (sampled.length === 0) return null

  return sampled.reduce((total, pool) => total + (pool.activity?.volumeUsdPerHour ?? 0), 0) / 60
}

const columnValue = (group: Group, key: SortKey): number => {
  if (key === 'ticker') return 0
  if (key === 'pools') return group.pools.length
  if (key === 'tx') return group.txPerHour ?? -1
  if (key === '1m') return perMinute(group) ?? -1
  if (key === '1h') return group.volume1hUsd
  if (key === '24h') return group.volume24hUsd
  if (key === '7d') return group.volume7dUsd
  return group.volume30dUsd
}

type Props = {
  groups: Group[]
  byPool: VolumeHistory
  expanded: string | null
  onExpand: (ticker: string | null) => void
}

/**
 * The equities trading on this chain, one row each, expanding to the pools behind them.
 *
 * A ticker is spread across many pools, sixteen for NVDA, so a row per pool answers "which pool"
 * when the question is "what is trading". The pools stay one click away.
 */
export const StockTable = ({ groups, byPool, expanded, onExpand }: Props) => {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: '24h',
    descending: true,
  })

  /** Each ticker's hourly series, summed over its pools, for the row sparkline. */
  const series = useMemo(() => {
    const out = new Map<string, VolumeBucket[]>()
    for (const group of groups) {
      const own: VolumeHistory = {}
      for (const pool of group.pools) {
        const buckets = byPool[pool.poolId.toLowerCase()]
        if (buckets) own[pool.poolId.toLowerCase()] = buckets
      }
      out.set(group.ticker, aggregateSeries(own))
    }
    return out
  }, [groups, byPool])

  const sorted = useMemo(() => {
    const direction = sort.descending ? -1 : 1
    return [...groups].sort((a, b) =>
      sort.key === 'ticker'
        ? a.ticker.localeCompare(b.ticker) * direction
        : (columnValue(a, sort.key) - columnValue(b, sort.key)) * direction,
    )
  }, [groups, sort])

  const toggle = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, descending: !current.descending }
        : { key, descending: key !== 'ticker' },
    )

  const heading = (key: SortKey, label: string, align: 'left' | 'right') => (
    <th
      key={key}
      scope="col"
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        type="button"
        onClick={() => toggle(key)}
        aria-sort={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none'}
        className={`text-[10px] uppercase tracking-[0.12em] transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
          sort.key === key ? 'text-ink' : 'text-ink-ghost'
        }`}
      >
        {label}
        {sort.key === key ? (
          <span className="ml-1">
            <Caret open={sort.descending} />
          </span>
        ) : null}
      </button>
    </th>
  )

  return (
    <div className="overflow-x-auto rounded border border-line">
      <table className="w-full min-w-[900px] border-collapse text-[12px]">
        <thead className="border-b border-line bg-surface">
          <tr>
            {heading('ticker', 'Stock', 'left')}
            {TIMEFRAMES.map((frame) => heading(frame.id, frame.label, 'right'))}
            {heading('tx', 'Trades/h', 'right')}
            {heading('pools', 'Pools', 'right')}
            <th
              scope="col"
              className="px-3 py-2 text-right text-[10px] uppercase tracking-[0.12em] text-ink-ghost"
            >
              48h
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((group) => {
            const open = group.ticker === expanded
            const figures: [Timeframe, number | null][] = [
              ['1m', perMinute(group)],
              ['1h', group.volume1hUsd],
              ['24h', group.volume24hUsd],
              ['7d', group.volume7dUsd],
              ['30d', group.volume30dUsd],
            ]

            return (
              <Fragment key={group.ticker}>
                <tr
                  onClick={() => onExpand(open ? null : group.ticker)}
                  aria-expanded={open}
                  className={`cursor-pointer border-b border-line/60 transition-colors ${
                    open ? 'bg-surface-raised' : 'hover:bg-surface'
                  }`}
                >
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                    <span className="flex items-center gap-2">
                      <span className="text-ink-ghost">
                        <Caret open={open} />
                      </span>
                      {group.ticker}
                    </span>
                  </th>

                  {figures.map(([id, value]) => (
                    <td
                      key={id}
                      title={id === '1m' ? 'Rate inferred from a sample of recent swaps' : undefined}
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        value === null
                          ? 'text-ink-ghost'
                          : id === '1m'
                            ? 'text-ink-muted decoration-dotted underline-offset-4 [text-decoration-line:underline]'
                            : 'text-ink'
                      }`}
                    >
                      {value === null ? '—' : money(value)}
                    </td>
                  ))}

                  <td
                    title="Rate inferred from a sample of recent swaps"
                    className={`px-3 py-2 text-right font-mono tabular-nums ${
                      group.txPerHour === null
                        ? 'text-ink-ghost'
                        : 'text-ink-muted decoration-dotted underline-offset-4 [text-decoration-line:underline]'
                    }`}
                  >
                    {group.txPerHour === null ? '—' : Math.round(group.txPerHour).toLocaleString()}
                  </td>

                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-ghost">
                    {group.pools.length}
                  </td>

                  <td className="px-3 py-1.5">
                    <span className="flex justify-end">
                      <StockSparkline buckets={series.get(group.ticker)} active={open} />
                    </span>
                  </td>
                </tr>

                {open ? (
                  <tr>
                    <td colSpan={TIMEFRAMES.length + 4} className="p-0">
                      <StockDetail ticker={group.ticker} pools={group.pools} byPool={byPool} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>

      <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-ink-ghost">
        Volume is summed across every pool holding that equity. Dotted figures are rates inferred
        from a sample of recent swaps rather than windows the feed reports. Open a row for its
        pools, their links, and its latest trades.
      </p>
    </div>
  )
}
