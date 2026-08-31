'use client'

import { useMemo, useState } from 'react'
import { StockSparkline } from './StockSparkline'
import {
  TIMEFRAMES,
  describeSample,
  timeframeVolume,
  txPerHour,
  type Timeframe,
} from '@/lib/domain/volumeTimeframes'
import type { VolumeHistory } from '@/lib/domain/volumeHistory'
import type { PoolRow } from '@/lib/types'

/** A drawn caret, so the sort direction is not a text glyph pretending to be an icon. */
const SortCaret = ({ descending }: { descending: boolean }) => (
  <svg
    aria-hidden
    viewBox="0 0 8 5"
    className="ml-1 inline-block h-[5px] w-2 align-middle"
    style={{ transform: descending ? undefined : 'rotate(180deg)' }}
  >
    <path d="M0 0 L4 5 L8 0 Z" fill="currentColor" />
  </svg>
)

/** Sortable columns. Volume columns share one reader, so they are keyed by their timeframe. */
type SortKey = Timeframe | 'tx' | 'pair'

const money = (value: number): string => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`
  if (value >= 1) return `$${Math.round(value)}`
  return value > 0 ? '<$1' : '$0'
}

/** Sorting value for a column, with unsampled rows pushed below every measured one. */
const sortValue = (row: PoolRow, key: SortKey): number => {
  if (key === 'pair') return 0
  if (key === 'tx') return txPerHour(row)?.perHour ?? -1
  return timeframeVolume(row, key).usd ?? -1
}

type Props = {
  rows: PoolRow[]
  byPool: VolumeHistory
  selected: string | null
  onSelect: (poolId: string | null) => void
}

/**
 * The stock pools, read as volume rather than as liquidity positions.
 *
 * Separate from PoolTable rather than more columns on it: that table ranks pools to provide into,
 * so it leads with score, TVL and fee rate. This one answers what is trading and how often, which
 * wants a different set of columns and a chart per row.
 */
export const StockTable = ({ rows, byPool, selected, onSelect }: Props) => {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: '24h',
    descending: true,
  })

  const sorted = useMemo(() => {
    const direction = sort.descending ? -1 : 1
    return [...rows].sort((a, b) => {
      if (sort.key === 'pair') return a.pair.localeCompare(b.pair) * direction
      return (sortValue(a, sort.key) - sortValue(b, sort.key)) * direction
    })
  }, [rows, sort])

  /** Clicking the active column flips direction; a new column starts on its largest values. */
  const toggle = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, descending: !current.descending }
        : { key, descending: key !== 'pair' },
    )

  const heading = (key: SortKey, label: string, align: 'left' | 'right') => (
    <th key={key} scope="col" className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => toggle(key)}
        aria-sort={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none'}
        className={`text-[10px] uppercase tracking-[0.12em] transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
          sort.key === key ? 'text-ink' : 'text-ink-ghost'
        }`}
      >
        {label}
        {sort.key === key ? <SortCaret descending={sort.descending} /> : null}
      </button>
    </th>
  )

  return (
    <div className="overflow-x-auto rounded border border-line">
      <table className="w-full min-w-[860px] border-collapse text-[12px]">
        <thead className="border-b border-line bg-surface">
          <tr>
            {heading('pair', 'Pair', 'left')}
            {TIMEFRAMES.map((frame) => heading(frame.id, frame.label, 'right'))}
            {heading('tx', 'Trades/h', 'right')}
            <th scope="col" className="px-3 py-2 text-right text-[10px] uppercase tracking-[0.12em] text-ink-ghost">
              48h
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const active = row.poolId === selected
            const trades = txPerHour(row)

            return (
              <tr
                key={row.poolId}
                onClick={() => onSelect(active ? null : row.poolId)}
                aria-selected={active}
                className={`cursor-pointer border-b border-line/60 transition-colors last:border-b-0 ${
                  active ? 'bg-surface-raised' : 'hover:bg-surface'
                }`}
              >
                <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                  <span className="flex items-baseline gap-2">
                    {row.pair}
                    <span className="font-mono text-[10px] tabular-nums text-ink-ghost">
                      {row.feeTier}%
                    </span>
                  </span>
                </th>

                {TIMEFRAMES.map((frame) => {
                  const reading = timeframeVolume(row, frame.id)
                  const caveat =
                    reading.sampleSeconds !== null && reading.sampleSwaps !== null
                      ? describeSample(reading.sampleSeconds, reading.sampleSwaps)
                      : undefined

                  return (
                    <td
                      key={frame.id}
                      title={caveat}
                      className={`px-3 py-2 text-right font-mono tabular-nums ${
                        reading.usd === null
                          ? 'text-ink-ghost'
                          : reading.estimated
                            ? 'text-ink-muted decoration-dotted underline-offset-4 [text-decoration-line:underline]'
                            : 'text-ink'
                      }`}
                    >
                      {reading.usd === null ? '—' : money(reading.usd)}
                    </td>
                  )
                })}

                <td
                  title={trades ? describeSample(trades.sampleSeconds, trades.sampleSwaps) : undefined}
                  className={`px-3 py-2 text-right font-mono tabular-nums ${
                    trades ? 'text-ink-muted decoration-dotted underline-offset-4 [text-decoration-line:underline]' : 'text-ink-ghost'
                  }`}
                >
                  {trades ? Math.round(trades.perHour).toLocaleString() : '—'}
                </td>

                <td className="px-3 py-1.5">
                  <span className="flex justify-end">
                    <StockSparkline buckets={byPool[row.poolId.toLowerCase()]} active={active} />
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-ink-ghost">
        Dotted figures are rates inferred from a sample of recent trades rather than windows the
        feed reports; hover one for the swaps and span behind it. Select a row to lay its volume
        over the chart above.
      </p>
    </div>
  )
}
