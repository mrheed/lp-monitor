'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ACTIVITY_BATCH_SIZE,
  ACTIVITY_PARALLEL_BATCHES,
  COUNTDOWN_TICK_MS,
  REFRESH_INTERVAL_MS,
  ROW_PAGE_SIZE,
  ACTIVITY_MAX_AGE_MS,
  SWEEP_IDLE_POLL_MS,
  SWEEP_MAX_ATTEMPTS,
  SWEEP_POOL_LIMIT,
  SWEEP_RETRY_BACKOFF_MS,
} from '@/lib/config'
import { AlertSettings } from './AlertSettings'
import { AddLiquidity } from './AddLiquidity'
import type { AlertStatus } from '@/lib/domain/alertWatcher'
import { DEFAULT_FILTERS, type AlertFilters } from '@/lib/domain/newPools'
import { rankByScore, scorePools } from '@/lib/domain/score'
import { simulateFeeShare } from '@/lib/domain/simulate'
import { HOURS, simulateCompounding, type CompoundOutcome } from '@/lib/domain/compound'
import type { Activity, PoolRow, PositionState } from '@/lib/types'
import { chainLabel, hasTransactionFeed } from '@/lib/chains'
import { sweepTargets, sweepTargetCount } from '@/lib/domain/sweep'

type SortKey =
  | 'score'
  | 'recentFeesPerHourUsd'
  | 'totalFeesUsd'
  | 'tvlAsc'
  | 'rate'
  | 'volumeRate'
  | 'traders'
  | 'priceVolatility'
  | 'myApr'
  | 'compounded'

const SORT_LABELS: Record<SortKey, string> = {
  score: 'Score',
  recentFeesPerHourUsd: 'Recent fee rate',
  totalFeesUsd: 'Fees accumulated',
  tvlAsc: 'TVL, thinnest first',
  rate: 'Trades seen ~',
  volumeRate: 'Volume traded ~',
  traders: 'Traders ~',
  priceVolatility: 'Volatility, calmest first',
  myApr: 'My projected APR',
  compounded: 'Projected profit, compounded',
}

const usd = (value: number) => {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`
  return `$${value.toFixed(0)}`
}

const rate = (perHour: number) => {
  if (perHour >= 1_000) return `${(perHour / 1_000).toFixed(1)}k/h`
  if (perHour >= 1) return `${perHour.toFixed(0)}/h`
  if (perHour > 0) return `${(perHour * 24).toFixed(1)}/d`
  return '0'
}

const missing = <span className="text-ink-ghost">—</span>

/**
 * Row treatment for a pool you hold or have held.
 *
 * The chip alone answers the question only once the eye is already on that column; a held row
 * should be findable while scanning any column. Carried by a left rule and a lift in surface,
 * both drawn from the existing neutrals, because a hue here would compete with the score for
 * the reader's attention and this is a fact rather than a judgement.
 *
 * The rule occupies the same width in every row, transparent when unheld, so no row shifts.
 */
/** The card equivalent of the row rule: held pools stay findable without a left border. */
const CARD_TONE: Record<PositionState, string> = {
  open: 'border-l-2 border-l-accent bg-surface/60',
  closed: 'border-l-2 border-l-accent-dim bg-surface/25',
  none: 'bg-surface/20',
}

const ROW_TONE: Record<PositionState, string> = {
  open: 'border-l-2 border-accent bg-surface/60 hover:bg-surface',
  closed: 'border-l-2 border-accent-dim bg-surface/25 hover:bg-surface/70',
  none: 'border-l-2 border-transparent hover:bg-surface/60',
}

/** How often the panel re-reads the watcher's state. */
const ALERT_STATUS_POLL_MS = 15_000

/*
 * Spacing rhythm.
 *
 * Every cell previously carried the same px-3 py-2, which is one interval repeated until
 * nothing groups. Cells inside a family now sit tight; the first cell of each family gets a
 * generous left inset and a hairline. The contrast between the two is what does the grouping,
 * so proximity carries meaning instead of a border around everything.
 */
const CELL = 'px-2.5 py-2.5'

/*
 * Column priority.
 *
 * Eighteen columns do not fit a laptop, let alone a phone. Rather than shrinking them all, each
 * column declares the width at which it earns its place: identity and the figures a decision
 * turns on are always present, supporting detail appears as the viewport allows.
 *
 * Below `md` the table is replaced entirely by cards, because a row scrolled sideways with no
 * anchor is not a table, it is a maze.
 */
const AT_LG = 'hidden lg:table-cell'
const AT_XL = 'hidden xl:table-cell'
const AT_2XL = 'hidden 2xl:table-cell'
const CELL_EDGE = 'border-l border-line py-2.5 pl-5 pr-2.5'
const GROUP_EDGE = 'border-l border-line pl-5 pr-2.5'

/*
 * Type scale, three steps at roughly a 1.17 ratio: 14px for the value a reader is scanning for,
 * 12px for supporting values, 11px for the labels under them. Replaces the arbitrary mix of
 * text-sm, text-xs, 10px and 11px that gave every cell the same voice.
 */
const SUB = 'text-[11px] uppercase tracking-wide text-ink-ghost'

const LINK =
  'rounded-sm text-ink-muted underline decoration-line underline-offset-2 transition-colors hover:text-ink hover:decoration-accent-dim focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent'

/** Column count, used by the empty state's spanning cell. */
const TABLE_COLUMNS = 19

/**
 * Volatility as a status colour.
 *
 * Banded rather than continuous, because a reader distinguishes three states at a glance and not
 * thirty. The number stays beside it, so the colour speeds up scanning without being the only
 * thing that carries the value.
 */
const volatilityTone = (percent: number) =>
  percent >= 60 ? 'text-risk' : percent >= 25 ? 'text-caution' : 'text-ink-muted'

/**
 * The span a sample covered, as a compact label.
 *
 * Every observed figure is shown beside one of these. A count of 25 trades means nothing until
 * you know whether it took forty seconds or three hours.
 */
const span = (seconds: number) => {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h`
  return `${Math.round(seconds / 86_400)}d`
}

/**
 * Why the trade columns carry a mark.
 *
 * TVL and fees are published totals from the pool feed. Trade rate, volume rate and trader count
 * are computed here from a sample of about 25 transactions, whose span is often under two
 * minutes, then scaled to an hour. They sit beside the reported figures, so without a mark they
 * read as though they carried the same authority.
 */
const SAMPLED_TITLE =
  'Counted from the most recent transactions Uniswap returned, over the span shown beneath. Not reported by the pool feed.'

/**
 * A sampled cell, or the reason it is empty.
 *
 * Three states rather than two: measured, not measured yet, and never measurable because
 * Uniswap's transaction feed does not index this pool's protocol. Showing the last as a dash
 * would leave the reader waiting for a number that is never coming.
 */
const sampledCell = (row: PoolRow, render: (activity: Activity) => ReactNode): ReactNode => {
  if (!hasTransactionFeed(row.protocol)) {
    return (
      <span
        className="text-ink-ghost"
        title={`Uniswap's transaction feed does not cover ${row.protocol}, so trades cannot be counted for this pool`}
      >
        n/a
      </span>
    )
  }

  return row.activity ? render(row.activity) : missing
}

const SampledHeader = ({ children }: { children: ReactNode }) => (
  <span title={SAMPLED_TITLE}>
    {children}
    <span className="text-ink-ghost" aria-hidden>
      ~
    </span>
    <span className="sr-only"> (sampled, not reported)</span>
  </span>
)

/** Reads the value a sort key refers to, unwrapping activity and inverting the ascending keys. */
/**
 * Horizons the projection is offered over.
 *
 * Nothing beyond a year is offered, because the projection holds the pool's current fee rate
 * constant and no pool on this chain has held a rate for a year.
 */
const HORIZONS = [
  { id: '7d', label: '7 days', hours: HOURS.week },
  { id: '30d', label: '30 days', hours: HOURS.month },
  { id: '90d', label: '90 days', hours: HOURS.quarter },
  { id: '1y', label: '1 year', hours: HOURS.year },
] as const

/** How often fees are put back into the position. */
const FREQUENCIES = [
  { id: 'never', label: 'Never', hours: 0 },
  { id: 'daily', label: 'Daily', hours: HOURS.day },
  { id: 'weekly', label: 'Weekly', hours: HOURS.week },
  { id: 'monthly', label: 'Monthly', hours: HOURS.month },
] as const

type HorizonId = (typeof HORIZONS)[number]['id']
type FrequencyId = (typeof FREQUENCIES)[number]['id']

/** What the reader is projecting: how much, for how long, reinvested how often, at what cost. */
type Projection = {
  depositUsd: number
  horizonHours: number
  compoundEveryHours: number
  costPerCompoundUsd: number
}

/** Names a horizon by its hour count, so the label and the projection cannot disagree. */
const horizonLabel = (hours: number) =>
  HORIZONS.find((option) => option.hours === hours)?.label ?? `${Math.round(hours / 24)} days`

/** Projects one row under the reader's current settings. */
const projectRow = (row: PoolRow, projection: Projection): CompoundOutcome =>
  simulateCompounding({
    depositUsd: projection.depositUsd,
    poolTvlUsd: row.tvlUsd,
    poolFeesPerHourUsd: row.recentFeesPerHourUsd,
    horizonHours: projection.horizonHours,
    compoundEveryHours: projection.compoundEveryHours,
    costPerCompoundUsd: projection.costPerCompoundUsd,
  })

const sortValue = (row: PoolRow, key: SortKey, projection: Projection) => {
  switch (key) {
    case 'score':
      return row.score ?? -1
    case 'priceVolatility':
      // Negated so the shared descending sort puts the calmest pool first.
      return -row.priceVolatility
    case 'myApr':
      return simulateFeeShare(projection.depositUsd, row.tvlUsd, row.recentFeesPerHourUsd)
        .aprPercent
    case 'compounded':
      return projectRow(row, projection).netProfitUsd
    case 'tvlAsc':
      // Negated so the shared descending sort puts the thinnest pool first.
      return -row.tvlUsd
    case 'rate':
      return row.activity?.transactionsPerHour ?? -1
    case 'volumeRate':
      return row.activity?.volumeUsdPerHour ?? -1
    case 'traders':
      return row.activity?.uniqueTraders ?? -1
    default:
      return row[key]
  }
}

/**
 * Which wallets hold or held a pool, and how.
 *
 * The state chip alone answered "did I hold this" but not "which of my wallets", which is the
 * question once more than one is involved. Every holder of a pool is named whenever there is
 * more than one, so a shared pool always shows all of them. A lone holder is named only when
 * several wallets are tracked, since with one wallet the name repeats on every row and
 * distinguishes nothing.
 */
const PositionChip = ({
  state,
  via,
  holders,
  multipleWalletsTracked,
}: {
  state: PositionState
  via: PoolRow['positionVia']
  holders: PoolRow['positionHolders']
  multipleWalletsTracked: boolean
}) => {
  // An unheld pool shows nothing at all. A placeholder mark here would add ink to 2,600 rows
  // to say "no", and the column is scanned for the few rows that say "yes".
  if (state === 'none') return null

  const open = state === 'open'
  const showNames = holders.length > 1 || multipleWalletsTracked
  const detail = holders
    .map(
      (holder) =>
        `${holder.label} ${holder.state === 'open' ? 'holds this' : 'held this'} ${
          holder.via === 'vault' ? 'through a vault' : 'directly'
        } (${holder.address})`,
    )
    .join('\n')

  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1" title={detail}>
      <span
        className={
          open
            ? 'inline-block rounded-sm bg-accent px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent-ink'
            : 'inline-block rounded-sm border border-line-strong px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted'
        }
      >
        {open ? 'In' : 'Past'}
      </span>
      {via === 'vault' ? (
        <span className="text-[11px] uppercase tracking-wide text-ink-ghost">vault</span>
      ) : null}
      {showNames
        ? holders.map((holder) => (
            <span
              key={holder.address}
              className={`text-[11px] ${
                holder.state === 'open' ? 'text-ink-muted' : 'text-ink-ghost line-through'
              }`}
            >
              {holder.label}
            </span>
          ))
        : null}
    </span>
  )
}

/**
 * Composite score, carried as the row's lead.
 *
 * The score is the one number the ranking exists to express, so it takes the largest numeral on
 * the row while the supporting measures were stepped back. Amplifying it meant
 * turning up weight and size the surface already uses, not adding colour: on a table read for
 * comparison, a hue would encode a judgement the score has already made.
 */
const ScoreCell = ({ row }: { row: PoolRow }) => {
  if (row.score === null) return missing

  const parts = row.scoreParts
  const detail = parts
    ? `fee rate ${(parts.fees * 100).toFixed(0)} · thinness ${(parts.tvl * 100).toFixed(0)} · tx rate ${(parts.rate * 100).toFixed(0)} · traders ${(parts.traders * 100).toFixed(0)} · calm ${(parts.volatility * 100).toFixed(0)}`
    : undefined

  return (
    <div className="flex items-center justify-end gap-2.5" title={detail}>
      <div className="h-1 w-12 overflow-hidden rounded-full bg-surface-raised">
        <div
          className="score-bar h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${row.score * 100}%` }}
        />
      </div>
      <span className="w-8 text-right text-base font-medium tabular-nums leading-none text-ink">
        {(row.score * 100).toFixed(0)}
      </span>
    </div>
  )
}

/**
 * Ring that depletes as the next automatic refresh approaches.
 *
 * Drawn as a stroked arc rather than a filled wedge so it reads at 18px, and rotated so it
 * starts at twelve o'clock. The dash offset carries the whole animation, which keeps it to one
 * attribute update per tick.
 */
const CountdownRing = ({ fraction }: { fraction: number }) => {
  const radius = 7
  const circumference = 2 * Math.PI * radius

  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
      <circle cx="9" cy="9" r={radius} fill="none" stroke="currentColor" strokeWidth="2" className="text-line-strong" />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="text-ink-muted"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
        transform="rotate(-90 9 9)"
      />
    </svg>
  )
}

/**
 * Progress of the background measurement sweep.
 *
 * Worth showing because scores shift while it runs: each one is a position within the measured
 * set, so a partly swept table is ranking against a partial cohort. The bar says how far from
 * final the ordering is, and gives way to the rolling re-measurement line once it completes.
 */
const SweepProgress = ({
  measured,
  unmeasurable,
  due,
  target,
  total,
  notIndexed,
}: {
  measured: number
  unmeasurable: number
  due: number
  target: number
  total: number
  /** Pools on protocols Uniswap's feed does not index, which the sweep never attempts. */
  notIndexed: number
}) => {
  if (target === 0) return null

  // Pools the sweep gave up on count as resolved, otherwise the bar parks a few short of the
  // target forever and reads as stuck when in fact it has finished all it can.
  const settled = measured + unmeasurable
  const done = settled >= target
  const percent = Math.min(100, Math.round((settled / target) * 100))

  if (done) {
    return (
      <div className="text-xs text-ink-ghost">
        {measured.toLocaleString()} of {total.toLocaleString()} pools scored
        {notIndexed > 0
          ? `, ${notIndexed.toLocaleString()} on protocols Uniswap does not index`
          : null}
        {unmeasurable > 0
          ? `, ${unmeasurable.toLocaleString()} unavailable upstream after ${SWEEP_MAX_ATTEMPTS} attempts`
          : null}
        .{' '}
        {due > 0
          ? `Re-measuring ${due.toLocaleString()} that aged past ${Math.round(ACTIVITY_MAX_AGE_MS / 60_000)} minutes.`
          : `Measurements are re-taken as they pass ${Math.round(ACTIVITY_MAX_AGE_MS / 60_000)} minutes old.`}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink-muted">
          Measuring pools: {measured.toLocaleString()} of {target.toLocaleString()}
          {notIndexed > 0 ? `, ${notIndexed.toLocaleString()} not indexed` : null}
          {unmeasurable > 0 ? `, ${unmeasurable.toLocaleString()} unavailable` : null}
        </span>
        <span className="tabular-nums text-ink-ghost">{percent}%</span>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-sm bg-surface"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Measuring pool activity"
      >
        <div
          className="h-full bg-accent-dim transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-[11px] text-ink-ghost">
        Scores rank each pool against the pools measured so far, so the ordering keeps changing
        until this completes.
      </p>
    </div>
  )
}

/** A labelled figure inside a card, so a value is never orphaned from its name. */
const CardStat = ({
  label,
  children,
  tone = 'text-ink',
}: {
  label: string
  children: ReactNode
  tone?: string
}) => (
  <div className="min-w-0">
    <div className="text-[11px] uppercase tracking-wide text-ink-ghost">{label}</div>
    <div className={`truncate tabular-nums ${tone}`}>{children}</div>
  </div>
)

/**
 * One pool as a card, for widths where a table cannot work.
 *
 * A phone cannot show eighteen columns, and a row scrolled sideways with nothing anchoring it is
 * unreadable. The card keeps the same information in the same priority order the table uses, but
 * stacked: verdict and identity first, then the figures a decision turns on, then the rest.
 */
const PoolCard = ({
  row,
  rank,
  depositUsd,
  projection,
  watched,
  onToggleWatch,
  showWalletNames,
}: {
  row: PoolRow
  rank: number
  depositUsd: number
  projection: Projection
  watched: boolean
  onToggleWatch: (poolId: string) => void
  showWalletNames: boolean
}) => {
  const sim = simulateFeeShare(depositUsd, row.tvlUsd, row.recentFeesPerHourUsd)
  const projected = projectRow(row, projection)

  return (
    <li className={`rounded border border-line px-3.5 py-3 ${CARD_TONE[row.position]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base font-medium text-ink">{row.pair}</span>
            <PositionChip
              state={row.position}
              via={row.positionVia}
              holders={row.positionHolders}
              multipleWalletsTracked={showWalletNames}
            />
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-ink-ghost">
            {row.poolId.slice(0, 10)}…{row.poolId.slice(-6)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {row.score !== null ? (
            <span className="text-lg font-medium tabular-nums leading-none text-accent">
              {(row.score * 100).toFixed(0)}
            </span>
          ) : null}
          {/* A 44px target, because a checkbox sized for a mouse is not tappable. */}
          <label className="-m-3 flex h-11 w-11 cursor-pointer items-center justify-center p-3">
            <input
              type="checkbox"
              checked={watched}
              onChange={() => onToggleWatch(row.poolId)}
              aria-label={`Watch ${row.pair} for changes`}
              className="accent-[var(--accent)]"
            />
          </label>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5 text-sm">
        <CardStat label="Fee rate" tone="text-gain">{`${usd(row.recentFeesPerHourUsd)}/h`}</CardStat>
        <CardStat label="Pool TVL">{usd(row.tvlUsd)}</CardStat>
        <CardStat label={`Profit ${horizonLabel(projection.horizonHours)}`} tone="text-gain">
          {projected.netProfitUsd > 0 ? usd(projected.netProfitUsd) : missing}
        </CardStat>
        <CardStat label="My APR" tone="text-gain">
          {sim.aprPercent >= 1000
            ? `${(sim.aprPercent / 1000).toFixed(1)}k%`
            : `${sim.aprPercent.toFixed(0)}%`}
        </CardStat>
        <CardStat label="Trades ~">
          {row.activity
            ? `${row.activity.sampleSize} in ${span(row.activity.windowSeconds)}`
            : missing}
        </CardStat>
        <CardStat label="Volatility" tone={volatilityTone(row.priceVolatility)}>
          {`${row.priceVolatility.toFixed(1)}%`}
        </CardStat>
        <CardStat label="Age">{row.age}</CardStat>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs">
        <span className="text-ink-ghost">
          #{rank} · {row.dynamicFee ? 'dynamic' : `${row.feeTier}%`}
          {row.hasHook ? ' · hook' : ''}
        </span>
        <span className="whitespace-nowrap">
          <a href={row.krystalUrl} target="_blank" rel="noreferrer" className={LINK}>
            Krystal
          </a>
          <span className="mx-1.5 text-line-strong">/</span>
          <a href={row.uniswapUrl} target="_blank" rel="noreferrer" className={LINK}>
            Uniswap
          </a>
        </span>
      </div>
    </li>
  )
}

/**
 * Scored, filterable pool table.
 *
 * Rendering and measuring are deliberately independent. Scrolling only reveals more rows; a
 * background sweep measures the whole rank order in parallel batches regardless of where the
 * reader is. Tying the two together made a pool's score depend on how far anyone had scrolled,
 * because the score is a position within the measured set.
 */
export const PoolTable = ({ initialRows }: { initialRows: PoolRow[] }) => {
  const [serverRows, setServerRows] = useState(initialRows)
  const [lazyActivity, setLazyActivity] = useState<Record<string, Activity>>({})
  const [visibleCount, setVisibleCount] = useState(ROW_PAGE_SIZE)
  const [depositUsd, setDepositUsd] = useState(1_000)
  const [horizon, setHorizon] = useState<HorizonId>('30d')
  const [frequency, setFrequency] = useState<FrequencyId>('weekly')
  const [costPerCompoundUsd, setCostPerCompoundUsd] = useState(2)
  const [refreshing, setRefreshing] = useState(false)
  const [staleSince, setStaleSince] = useState<number | null>(null)
  const [unmeasurable, setUnmeasurable] = useState(0)
  // Alerts are watched and sent by the server, so the browser holds no known-pool state and
  // closing the tab does not stop them. This is a view of the watcher plus a way to steer it.
  const [alertStatus, setAlertStatus] = useState<AlertStatus | null>(null)
  /** The pool an add-liquidity dialog is open for, or null. */
  const [addingTo, setAddingTo] = useState<PoolRow | null>(null)
  const alertStatusRef = useRef<AlertStatus | null>(null)
  alertStatusRef.current = alertStatus

  const watched = useMemo(
    () => new Set((alertStatus?.filters.monitoredPoolIds ?? []).map((id) => id.toLowerCase())),
    [alertStatus],
  )
  const [remainingMs, setRemainingMs] = useState(REFRESH_INTERVAL_MS)
  const [query, setQuery] = useState('')
  const [minTvl, setMinTvl] = useState(0)
  const [onlyMine, setOnlyMine] = useState(false)
  const [protocol, setProtocol] = useState('all')
  const [chain, setChain] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('score')

  const sentinel = useRef<HTMLDivElement | null>(null)
  const requested = useRef(new Set<string>())
  const rowsRef = useRef<PoolRow[]>(initialRows)
  const deadline = useRef(Date.now() + REFRESH_INTERVAL_MS)
  const inFlight = useRef(false)
  const refreshAbort = useRef<AbortController | null>(null)
  const attempts = useRef(new Map<string, number>())
  const measuredAt = useRef(new Map<string, number>())

  /**
   * Reloads pool data and restarts the countdown.
   *
   * Lazily measured activity lives in its own state, so a refresh replaces prices and fees
   * without discarding measurements already paid for.
   */
  const refresh = useCallback(async ({ force = false } = {}) => {
    // The ticker fires every 250ms while the deadline sits in the past, so an automatic refresh
    // must not start a second request on every tick. A manual press is the opposite: it means
    // "I want current data now", so it cancels whatever is in flight and starts again.
    if (inFlight.current) {
      if (!force) return
      refreshAbort.current?.abort()
    }

    const controller = new AbortController()
    refreshAbort.current = controller
    inFlight.current = true
    setRefreshing(true)

    try {
      // A manual press bypasses the server's own cache. Without this the route answers from a
      // snapshot up to its TTL old, so the button re-requested the same numbers and appeared to
      // do nothing. The timed refresh leaves the cache alone, since its interval already exceeds
      // the TTL and a cached answer there is by definition current.
      const url = force ? '/api/pools?refresh=1' : '/api/pools'
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(String(response.status))

      const snapshot = await response.json()
      if (Array.isArray(snapshot.rows)) setServerRows(snapshot.rows)
      setStaleSince(null)
    } catch (error) {
      // An abort is this component replacing its own request, not a failure to report.
      if (error instanceof DOMException && error.name === 'AbortError') return
      // Keeping the previous rows on screen is right, but saying nothing is not: the countdown
      // would restart and the table would look freshly loaded while the numbers aged. Record
      // when the data stopped updating so the toolbar can say so.
      setStaleSince((current) => current ?? Date.now())
    } finally {
      // A superseded request still runs its finally, so it must not reset the countdown or
      // clear the loading state belonging to the request that replaced it.
      if (refreshAbort.current === controller) {
        refreshAbort.current = null
        deadline.current = Date.now() + REFRESH_INTERVAL_MS
        setRemainingMs(REFRESH_INTERVAL_MS)
        setRefreshing(false)
        inFlight.current = false
      }
    }
  }, [])

  // One ticker drives both the ring and the automatic refresh, so the countdown a reader sees
  // is the same clock that triggers the reload rather than a separate approximation of it.
  useEffect(() => {
    const timer = setInterval(() => {
      const left = deadline.current - Date.now()
      if (left <= 0) void refresh()
      else setRemainingMs(left)
    }, COUNTDOWN_TICK_MS)

    return () => clearInterval(timer)
  }, [refresh])

  // Poll the watcher so the panel reflects what the server is actually doing, including sends
  // that happened while this tab was closed.
  useEffect(() => {
    const read = () => {
      void fetch('/api/alerts')
        .then((response) => (response.ok ? response.json() : null))
        .then((status) => status && setAlertStatus(status))
        .catch(() => undefined)
    }

    read()
    const timer = setInterval(read, ALERT_STATUS_POLL_MS)
    return () => clearInterval(timer)
  }, [])

  /** Adds or removes a pool from the change watchlist, which the watcher owns. */
  const toggleWatch = useCallback(
    (poolId: string) => {
      const filters = alertStatusRef.current?.filters
      if (!filters) return

      const id = poolId.toLowerCase()
      const already = filters.monitoredPoolIds.some((entry) => entry.toLowerCase() === id)

      void updateFilters({
        ...filters,
        monitoredPoolIds: already
          ? filters.monitoredPoolIds.filter((entry) => entry.toLowerCase() !== id)
          : [...filters.monitoredPoolIds, id],
      })
    },
    // updateFilters is stable, and the current filters are read through a ref so a toggle always
    // acts on what the server last reported rather than a value captured when the row rendered.
    [],
  )

  /** Sends the filters to the watcher, which owns them from then on. */
  const updateFilters = useCallback(async (next: AlertFilters) => {
    setAlertStatus((current) => (current ? { ...current, filters: next } : current))

    try {
      const response = await fetch('/api/alerts', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (response.ok) setAlertStatus(await response.json())
    } catch {
      // The next status poll will show what the server actually holds.
    }
  }, [])

  const projection = useMemo<Projection>(
    () => ({
      depositUsd,
      horizonHours: HORIZONS.find((option) => option.id === horizon)?.hours ?? HOURS.month,
      compoundEveryHours: FREQUENCIES.find((option) => option.id === frequency)?.hours ?? 0,
      costPerCompoundUsd,
    }),
    [depositUsd, horizon, frequency, costPerCompoundUsd],
  )

  const protocols = useMemo(
    () => [...new Set(serverRows.map((row) => row.protocol))].sort(),
    [serverRows],
  )

  // Built from the rows rather than the registry, so a chain with no pools never appears as an
  // option that filters everything away.
  const chains = useMemo(
    () =>
      [...new Set(serverRows.map((row) => row.chainId))]
        .map((id) => ({ id, label: chainLabel(id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [serverRows],
  )

  // Server measured rows and lazily measured rows are merged, then rescored together so every
  // score on screen is drawn from the same cohort.
  const rows = useMemo(() => {
    const merged = serverRows.map((row) => ({
      ...row,
      activity: row.activity ?? lazyActivity[row.poolId.toLowerCase()] ?? null,
    }))

    // The server pre-measures the first rows, and those arrive without a local timestamp. Left
    // unstamped they read as never measured, so the sweep skipped them for good.
    const stampedAt = Date.now()
    for (const row of serverRows) {
      if (row.activity === null) continue
      const key = row.poolId.toLowerCase()
      if (!measuredAt.current.has(key)) measuredAt.current.set(key, stampedAt)
    }

    const measured = merged.filter((row) => row.activity !== null)
    const unmeasured = merged.filter((row) => row.activity === null)
    const scored = rankByScore(scorePools(measured))

    return [...scored, ...unmeasured]
  }, [serverRows, lazyActivity])

  // The sweep reads rows through a ref so it is not restarted by its own results arriving.
  rowsRef.current = rows

  const measuredCount = useMemo(
    () => rows.filter((row) => row.activity !== null).length,
    [rows],
  )

  // Counts only what the sweep will attempt. Including pools it skips left the bar short of its
  // target forever, which reads as a stall rather than as completion.
  const sweepTarget = useMemo(() => sweepTargetCount(rows, SWEEP_POOL_LIMIT), [rows])

  // How many measurements have aged out and are queued to be taken again. Shown because the
  // re-sweep is a rolling window: pools fall due at the rate they were first measured, so only
  // a handful are ever outstanding and the activity is otherwise invisible.
  const [dueForRemeasure, setDueForRemeasure] = useState(0)

  // Naming a wallet only earns its space when there is more than one to tell apart.
  const walletCount = useMemo(
    () => new Set(rows.flatMap((row) => row.positionHolders.map((h) => h.address))).size,
    [rows],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = rows.filter((row) => {
      if (row.tvlUsd < minTvl) return false
      if (onlyMine && row.position === 'none') return false
      if (protocol !== 'all' && row.protocol !== protocol) return false
      if (chain !== 'all' && String(row.chainId) !== chain) return false
      if (
        needle &&
        !row.pair.toLowerCase().includes(needle) &&
        !row.poolId.toLowerCase().includes(needle)
      ) {
        return false
      }
      return true
    })

    return [...filtered].sort(
      (a, b) => sortValue(b, sortKey, projection) - sortValue(a, sortKey, projection),
    )
  }, [rows, query, minTvl, onlyMine, protocol, chain, sortKey, projection])

  const onScreen = visible.slice(0, visibleCount)

  /**
   * Returns pools to the queue after a failed or partial batch, giving up after a few tries.
   *
   * Needed because a 200 does not mean every pool was measured: the server omits pools whose
   * own upstream request failed, and a pool left marked as requested but never measured is
   * excluded from the queue forever, which stalls the sweep a few pools short of complete.
   */
  const releaseForRetry = useCallback((batch: PoolRow[]) => {
    let exhausted = 0

    for (const row of batch) {
      const tried = (attempts.current.get(row.poolId) ?? 0) + 1
      attempts.current.set(row.poolId, tried)

      if (tried < SWEEP_MAX_ATTEMPTS) requested.current.delete(row.poolId)
      else exhausted += 1
    }

    if (exhausted > 0) setUnmeasurable((current) => current + exhausted)
  }, [])

  /** Requests activity for one batch of pools. */
  const fetchBatch = useCallback(async (batch: PoolRow[]) => {
    const targets = batch.map(({ poolId, protocol: poolProtocol, chainId }) => ({
      poolId,
      protocol: poolProtocol,
      chainId,
    }))

    try {
      const response = await fetch('/api/activity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets }),
      })
      if (!response.ok) throw new Error(String(response.status))

      const { activity } = await response.json()
      if (activity) {
        setLazyActivity((current) => ({ ...current, ...activity }))
        const now = Date.now()
        for (const poolId of Object.keys(activity)) measuredAt.current.set(poolId, now)
      }

      // Pools the server could not measure come back absent rather than zeroed, so the gap
      // between what was asked for and what returned is what needs another attempt.
      const measured = new Set(Object.keys(activity ?? {}))
      const missed = batch.filter((row) => !measured.has(row.poolId.toLowerCase()))

      // Every pool that came back is released so it can be measured again once it ages. This
      // runs regardless of whether siblings failed: releasing only on a fully clean batch left
      // one failure locking its twenty four successful neighbours out of every later pass.
      for (const row of batch) {
        if (measured.has(row.poolId.toLowerCase())) requested.current.delete(row.poolId)
      }

      if (missed.length > 0) releaseForRetry(missed)
    } catch {
      releaseForRetry(batch)
    }
  }, [releaseForRetry])

  // Sweep every pool in the background, a few batches at a time, until all are measured.
  //
  // This exists because the score is a percentile within the measured set. Measuring only the
  // rows on screen ranked each pool against whatever happened to be loaded, so the same pool
  // scored differently depending on how far the reader had scrolled.
  useEffect(() => {
    let cancelled = false

    const sweep = async () => {
      while (!cancelled) {
        // Only the fixed prefix of the rank order is measured, so every score is computed
        // against the same cohort regardless of scrolling.
        const now = Date.now()
        const pending = sweepTargets(rowsRef.current, SWEEP_POOL_LIMIT).filter((row) => {
          if (requested.current.has(row.poolId)) return false
          if (row.activity === null) return true

          // A measurement older than its lifetime is taken again, so trade rates keep pace with
          // the fees and TVL beside them instead of standing still after the first pass.
          const taken = measuredAt.current.get(row.poolId.toLowerCase())
          return taken !== undefined && now - taken > ACTIVITY_MAX_AGE_MS
        })

        if (pending.length === 0) {
          // Nothing to do now, but measurements age, so the sweep waits rather than ending.
          setDueForRemeasure(0)
          await new Promise((resolve) => setTimeout(resolve, SWEEP_IDLE_POLL_MS))
          continue
        }

        setDueForRemeasure(pending.filter((row) => row.activity !== null).length)

        const wave = pending.slice(0, ACTIVITY_BATCH_SIZE * ACTIVITY_PARALLEL_BATCHES)
        wave.forEach((row) => {
          requested.current.add(row.poolId)
          attempts.current.delete(row.poolId)
        })

        const batches: PoolRow[][] = []
        for (let index = 0; index < wave.length; index += ACTIVITY_BATCH_SIZE) {
          batches.push(wave.slice(index, index + ACTIVITY_BATCH_SIZE))
        }

        await Promise.all(batches.map(fetchBatch))

        // A wave that measured nothing is retrying failures; pause so a persistent upstream
        // fault backs off instead of burning through the attempt budget in a few seconds.
        const stillPending = rowsRef.current
          .slice(0, SWEEP_POOL_LIMIT)
          .filter((row) => row.activity === null && !requested.current.has(row.poolId)).length

        if (stillPending >= wave.length) {
          await new Promise((resolve) => setTimeout(resolve, SWEEP_RETRY_BACKOFF_MS))
        }
      }
    }

    void sweep()
    return () => {
      cancelled = true
    }
  }, [fetchBatch])

  // Reveal another page when the sentinel scrolls into view.
  useEffect(() => {
    const node = sentinel.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((current) => Math.min(current + ROW_PAGE_SIZE, visible.length))
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [visible.length])

  // A changed filter should start from the top rather than keep a deep scroll position.
  useEffect(() => {
    setVisibleCount(ROW_PAGE_SIZE)
  }, [query, minTvl, onlyMine, protocol, chain, sortKey])

  // Focus is a visible ring, not just a border tint: a one-step border shift is invisible to a
  // keyboard user moving through seven controls.
  // py-2 on touch widths keeps every control at a usable target height; the desktop density
  // returns from sm up, where a pointer makes a shorter control fine.
  const control =
    'rounded border border-line bg-surface px-3 py-2 outline-none focus-visible:border-line-strong focus-visible:ring-1 focus-visible:ring-accent sm:py-1.5'

  const secondsUntilRefresh = Math.max(0, Math.ceil(remainingMs / 1000))

  return (
    <div className="space-y-5">
      {addingTo === null ? null : (
        <AddLiquidity row={addingTo} onClose={() => setAddingTo(null)} />
      )}
      {/*
        Controls cluster by job rather than sitting in one undifferentiated row: narrowing the
        set, then the deposit the projection is built on, then status and refresh. The dividers
        do the grouping so the eye can jump to a cluster instead of reading seven controls.
      */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-3 text-sm">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by pair or pool id"
          className={`w-full sm:w-52 ${control} placeholder:text-ink-ghost`}
        />
        <select value={minTvl} onChange={(e) => setMinTvl(Number(e.target.value))} className={control}>
          <option value={0}>Any TVL</option>
          <option value={10_000}>TVL over $10k</option>
          <option value={100_000}>TVL over $100k</option>
          <option value={1_000_000}>TVL over $1M</option>
        </select>
        {chains.length < 2 ? null : (
          <select value={chain} onChange={(e) => setChain(e.target.value)} className={control}>
            <option value="all">All chains</option>
            {chains.map((option) => (
              <option key={option.id} value={String(option.id)}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        <select value={protocol} onChange={(e) => setProtocol(e.target.value)} className={control}>
          <option value="all">All protocols</option>
          {protocols.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={sortKey}
          onChange={(event) => setSortKey(sortKeyFrom(event.target.value))}
          className={control}
        >
          {Object.entries(SORT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              Sort: {label}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer select-none items-center gap-2 pl-1 text-ink-muted hover:text-ink-muted">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(event) => setOnlyMine(event.target.checked)}
            className="accent-[var(--accent)]"
          />
          Only pools I have held
        </label>

        <span aria-hidden="true" className="mx-1 h-5 w-px bg-surface-raised" />

        <label className="flex items-center gap-2 text-ink-muted">
          <span className="text-ink0">Deposit</span>
          <span className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-ghost">
              $
            </span>
            <input
              type="number"
              min={0}
              step={100}
              value={depositUsd}
              onChange={(event) => setDepositUsd(Math.max(0, Number(event.target.value) || 0))}
              className={`w-24 pl-5 ${control} tabular-nums sm:w-28`}
            />
          </span>
        </label>

        {/*
          Grouped with the deposit because they answer one question together: what this much
          money does in this pool over this long. Split across the control bar they would read as
          four unrelated filters.
        */}
        <label className="flex items-center gap-2 text-ink-muted">
          <span className="text-ink0">for</span>
          <select
            value={horizon}
            onChange={(event) => setHorizon(horizonIdFrom(event.target.value))}
            className={control}
          >
            {HORIZONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-ink-muted">
          <span className="text-ink0">reinvest</span>
          <select
            value={frequency}
            onChange={(event) => setFrequency(frequencyIdFrom(event.target.value))}
            className={control}
          >
            {FREQUENCIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {frequency === 'never' ? null : (
          <label
            className="flex items-center gap-2 text-ink-muted"
            title="Gas and swap cost of one reinvestment. A reinvestment is skipped when the extra fees it would earn do not repay this."
          >
            <span className="text-ink0">at</span>
            <span className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-ghost">
                $
              </span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={costPerCompoundUsd}
                onChange={(event) =>
                  setCostPerCompoundUsd(Math.max(0, Number(event.target.value) || 0))
                }
                className={`w-20 pl-5 ${control} tabular-nums`}
              />
            </span>
            <span className="text-ink-ghost">gas</span>
          </label>
        )}

        {staleSince === null ? null : (
          <span
            className="w-full text-xs text-ink-muted sm:ml-auto sm:w-auto"
            role="status"
            title="The last refresh failed. The figures below are from the last successful load."
          >
            Not updating since {new Date(staleSince).toLocaleTimeString()}
          </span>
        )}
        <span
          className={`${staleSince === null ? 'ml-auto' : ''} tabular-nums text-ink0`}
        >
          {onScreen.length} of {visible.length}
        </span>
        <button
          type="button"
          onClick={() => void refresh({ force: true })}
          aria-busy={refreshing}
          title={
            refreshing
              ? 'Refreshing. Press again to restart with current data.'
              : `Refresh now, bypassing the cache. Next automatic refresh in ${secondsUntilRefresh}s`
          }
          // Deliberately never disabled: a press during a refresh is what cancels it and starts
          // again, so greying the control out would block the one interaction it exists for.
          className={`flex items-center gap-2 ${control} tabular-nums text-ink-muted hover:border-line-strong hover:text-ink`}
        >
          <CountdownRing fraction={refreshing ? 1 : remainingMs / REFRESH_INTERVAL_MS} />
          {refreshing ? 'Refreshing' : `Refresh ${secondsUntilRefresh}s`}
        </button>
      </div>

      <AlertSettings status={alertStatus} onChange={updateFilters} />

      <SweepProgress
        measured={measuredCount}
        notIndexed={rows.length - sweepTarget}
        unmeasurable={unmeasurable}
        due={dueForRemeasure}
        target={sweepTarget}
        total={rows.length}
      />

      {/* Below md the table is replaced rather than squeezed: eighteen columns scrolled
          sideways with no anchor is not a table anyone can read. */}
      <ul className="space-y-2 md:hidden">
        {onScreen.map((row, index) => (
          <PoolCard
            key={row.poolId}
            row={row}
            rank={index + 1}
            depositUsd={depositUsd}
            projection={projection}
            watched={watched.has(row.poolId.toLowerCase())}
            onToggleWatch={toggleWatch}
            showWalletNames={walletCount > 1}
          />
        ))}
        {visible.length === 0 ? (
          <li className="rounded border border-line px-4 py-10 text-center">
            <p className="text-sm text-ink-muted">No pools match these filters.</p>
            <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-ink-ghost">
              {rows.length.toLocaleString()} pools are loaded.{' '}
              {onlyMine
                ? 'Only pools you have held are shown; clear that to widen the search.'
                : minTvl > 0
                  ? `The TVL floor of $${minTvl.toLocaleString()} may be excluding them.`
                  : 'Try a shorter search term, or a different protocol.'}
            </p>
          </li>
        ) : null}
      </ul>

      <div className="hidden overflow-x-auto rounded border border-line md:block">
        <table className="w-full min-w-[720px] text-sm lg:min-w-[980px] xl:min-w-[1200px] 2xl:min-w-[1540px]">
          {/*
            Two header tiers because seventeen flat columns hid five families. The upper tier
            names the family, the lower names the measure, and a hairline at each family's first
            column carries the grouping so the reader can aim at a region instead of counting
            columns. TVL sits beside the projection because the projection is derived from it.
          */}
          <thead className="sticky top-0 z-10 bg-surface text-left">
            <tr className="hidden text-[11px] uppercase tracking-[0.08em] text-ink-ghost 2xl:table-row">
              <th className="border-l-2 border-transparent px-2.5 pb-1 pt-3 font-medium" colSpan={5} />
              <th className={`${GROUP_EDGE} pb-1 pt-3 text-right font-medium`} colSpan={2}>
                Earnings
              </th>
              <th className={`${GROUP_EDGE} pb-1 pt-3 text-right font-medium`} colSpan={5}>
                Capital, at ${depositUsd.toLocaleString()}
              </th>
              <th className={`${GROUP_EDGE} pb-1 pt-3 text-right font-medium`} colSpan={3}>
                Activity
              </th>
              <th className={`${GROUP_EDGE} pb-1 pt-3 text-right font-medium`} colSpan={2}>
                Risk
              </th>
              <th className={`${GROUP_EDGE} pb-1 pt-3 font-medium`} colSpan={2} />
            </tr>
            <tr className="border-b border-line text-[11px] uppercase tracking-[0.06em] text-ink0 [&>th]:pt-3 2xl:[&>th]:pt-0">
              <th className="border-l-2 border-transparent px-2.5 pb-2.5 font-medium" title="Watch for changes">
                Watch
              </th>
              <th className={`${AT_XL} px-2.5 pb-2.5 font-medium`}>#</th>
              <th className="px-2.5 pb-2.5 text-right font-medium">Score</th>
              <th className="px-2.5 pb-2.5 font-medium">Pos</th>
              <th className="px-2.5 pb-2.5 font-medium">Pair</th>
              <th className={`${GROUP_EDGE} pb-2.5 text-right font-medium`}>Rate</th>
              <th className={`${AT_XL} px-2.5 pb-2.5 text-right font-medium`}>Total</th>
              <th className={`${GROUP_EDGE} pb-2.5 text-right font-medium`}>Pool TVL</th>
              <th className={`${AT_2XL} px-2.5 pb-2.5 text-right font-medium`}>My share</th>
              <th className={`${AT_2XL} px-2.5 pb-2.5 text-right font-medium`}>My fees</th>
              <th className="px-2.5 pb-2.5 text-right font-medium">My APR</th>
              <th
                className="px-2.5 pb-2.5 text-right font-medium"
                title="Net profit over the chosen horizon, after the cost of each reinvestment. A projection at the pool's current fee rate, ignoring impermanent loss."
              >
                Profit {horizonLabel(projection.horizonHours)}
              </th>
              <th className={`${AT_LG} ${GROUP_EDGE} pb-2.5 text-right font-medium`}><SampledHeader>Trades</SampledHeader></th>
              <th className={`${AT_2XL} px-2.5 pb-2.5 text-right font-medium`}><SampledHeader>Traded</SampledHeader></th>
              <th className={`${AT_XL} px-2.5 pb-2.5 text-right font-medium`}><SampledHeader>Traders</SampledHeader></th>
              <th className={`${AT_LG} ${GROUP_EDGE} pb-2.5 text-right font-medium`}>Volatility</th>
              <th className={`${AT_LG} px-2.5 pb-2.5 font-medium`}>Age</th>
              <th className={`${AT_LG} ${GROUP_EDGE} pb-2.5 font-medium`}>Fee</th>
              <th className="px-2.5 pb-2.5 font-medium">Links</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLUMNS} className="px-5 py-14 text-center">
                  <p className="text-sm text-ink-muted">No pools match these filters.</p>
                  <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-ghost">
                    {rows.length.toLocaleString()} pools are loaded.{' '}
                    {onlyMine
                      ? 'Only pools you have held are shown; clear that to widen the search.'
                      : minTvl > 0
                        ? `The TVL floor of $${minTvl.toLocaleString()} may be excluding them.`
                        : 'Try a shorter search term, or a different protocol.'}
                  </p>
                </td>
              </tr>
            ) : null}
            {onScreen.map((row, index) => {
              const sim = simulateFeeShare(depositUsd, row.tvlUsd, row.recentFeesPerHourUsd)
              const projected = projectRow(row, projection)

              return (
                <tr
                  key={row.poolId}
                  className={`border-t border-line transition-colors duration-150 ${ROW_TONE[row.position]}`}
                >
                  <td className={CELL}>
                    <label
                      className="-m-2 flex h-9 w-9 cursor-pointer items-center justify-center p-2"
                      title={`Watch ${row.pair} for changes`}
                    >
                      <input
                        type="checkbox"
                        checked={watched.has(row.poolId.toLowerCase())}
                        onChange={() => toggleWatch(row.poolId)}
                        aria-label={`Watch ${row.pair} for changes`}
                        className="accent-[var(--accent)]"
                      />
                    </label>
                  </td>
                  <td className={`${AT_XL} ${CELL} text-ink-ghost`}>{index + 1}</td>
                  <td className={CELL}>
                    <ScoreCell row={row} />
                  </td>
                  <td className={CELL}>
                    <PositionChip
                      state={row.position}
                      via={row.positionVia}
                      holders={row.positionHolders}
                      multipleWalletsTracked={walletCount > 1}
                    />
                    {/*
                      Only where an open direct position exists: a closed one cannot be
                      increased, and a vault's liquidity belongs to the vault contract rather
                      than the wallet that would be signing.
                    */}
                    {row.position === 'open' && row.positionVia === 'direct' ? (
                      <button
                        type="button"
                        onClick={() => setAddingTo(row)}
                        className="mt-1 block rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted transition-colors hover:border-accent-dim hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                        title={`Add liquidity to your ${row.pair} position`}
                      >
                        + Add
                      </button>
                    ) : null}
                  </td>
                  <td className={CELL}>
                    <div className="font-medium text-ink">{row.pair}</div>
                    <div className={`${SUB} normal-case tracking-normal`}>
                      {chainLabel(row.chainId)} · {row.protocol}
                    </div>
                    <div className={`${SUB} font-mono normal-case tracking-normal`}>
                      {row.poolId.slice(0, 10)}…{row.poolId.slice(-6)}
                    </div>
                  </td>

                  <td className={`${CELL_EDGE} text-right tabular-nums text-gain`}>
                    <span title={`Measured over the ${row.recentFeeWindow} window`}>
                      {row.recentFeeWindow === 'none'
                        ? missing
                        : `${usd(row.recentFeesPerHourUsd)}/h`}
                    </span>
                    <div className={SUB}>{row.recentFeeWindow}</div>
                  </td>
                  <td className={`${AT_XL} ${CELL} text-right tabular-nums text-ink0`}>
                    {usd(row.totalFeesUsd)}
                  </td>

                  <td className={`${CELL_EDGE} text-right tabular-nums text-ink-muted`}>
                    {usd(row.tvlUsd)}
                  </td>
                  <td
                    className={`${AT_2XL} ${CELL} text-right tabular-nums text-ink0`}
                    title={`A $${depositUsd.toLocaleString()} deposit would be ${(sim.share * 100).toFixed(1)}% of the pool once added to it`}
                  >
                    {(sim.share * 100).toFixed(sim.share < 0.01 ? 2 : 1)}%
                  </td>
                  <td className={`${AT_2XL} ${CELL} text-right tabular-nums text-ink-muted`}>
                    {usd(sim.feesPerDayUsd)}
                    <div className={SUB}>per day</div>
                  </td>
                  <td className={`${CELL} text-right tabular-nums text-gain`}>
                    {sim.aprPercent >= 1000
                      ? `${(sim.aprPercent / 1000).toFixed(1)}k%`
                      : `${sim.aprPercent.toFixed(0)}%`}
                  </td>
                  <td
                    className={`${CELL} text-right tabular-nums text-gain`}
                    title={
                      projected.compounds > 0
                        ? `${projected.compounds} reinvestments costing ${usd(projected.costsUsd)}, ` +
                          `worth ${usd(projected.compoundingGainUsd)} more than leaving fees unclaimed`
                        : 'No reinvestment repays its cost here, so fees are left to accumulate'
                    }
                  >
                    {projected.netProfitUsd > 0 ? usd(projected.netProfitUsd) : missing}
                    <div className={SUB}>
                      {projected.compounds > 0 ? `+${usd(projected.compoundingGainUsd)}` : 'no compound'}
                    </div>
                  </td>

                  <td className={`${AT_LG} ${CELL_EDGE} text-right tabular-nums text-ink-muted`}>
                    {sampledCell(row, (activity) => (
                      <>
                        {activity.sampleSize}
                        <div className={SUB}>in {span(activity.windowSeconds)}</div>
                      </>
                    ))}
                  </td>
                  <td className={`${AT_2XL} ${CELL} text-right tabular-nums text-ink-muted`}>
                    {sampledCell(row, (activity) => (
                      <>
                        {usd(activity.volumeUsd)}
                        <div className={SUB}>in {span(activity.windowSeconds)}</div>
                      </>
                    ))}
                  </td>
                  <td className={`${AT_XL} ${CELL} text-right tabular-nums text-ink0`}>
                    {sampledCell(row, (activity) => activity.uniqueTraders)}
                  </td>

                  <td
                    className={`${AT_LG} ${CELL_EDGE} text-right tabular-nums`}
                    title={`24h drawdown ${row.drawdown24h.toFixed(1)}%`}
                  >
                    {/* Krystal reports both of these already expressed as percentages. */}
                    <span className={volatilityTone(row.priceVolatility)}>
                      {row.priceVolatility.toFixed(1)}%
                    </span>
                    <div className={`${SUB} normal-case`}>{row.drawdown24h.toFixed(1)}% dd</div>
                  </td>
                  <td className={`${AT_LG} ${CELL} whitespace-nowrap text-xs text-ink0`}>{row.age}</td>

                  <td className={`${AT_LG} ${CELL_EDGE} whitespace-nowrap text-xs text-ink-muted`}>
                    <span title={`LP fee ${row.lpFee}%, total swap fee ${row.feeTier}%`}>
                      {row.dynamicFee ? 'dynamic' : `${row.feeTier}%`}
                    </span>
                    {row.hasHook ? <span className="ml-1 text-ink-ghost">hook</span> : null}
                  </td>
                  <td className={`${CELL} whitespace-nowrap text-xs`}>
                    <a
                      href={row.krystalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={LINK}
                    >
                      Krystal
                    </a>
                    <span className="mx-1.5 text-line-strong">/</span>
                    <a
                      href={row.uniswapUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={LINK}
                    >
                      Uniswap
                    </a>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div ref={sentinel} className="h-8 text-center text-xs text-ink-ghost">
        {visibleCount < visible.length ? 'Scroll for more rows' : 'End of results'}
      </div>
    </div>
  )
}

/** Narrows a select value back to a SortKey without asserting the type away. */
const sortKeyFrom = (value: string): SortKey => (isSortKey(value) ? value : 'score')

/** Type guard tying the SortKey union to the label map that enumerates it. */
const isSortKey = (value: string): value is SortKey => value in SORT_LABELS

/**
 * Narrows a select value back to its option id by looking it up in the options themselves.
 *
 * Derived from the option list rather than asserted, so adding a horizon or a frequency cannot
 * leave a value the type says is impossible.
 */
const horizonIdFrom = (value: string): HorizonId =>
  HORIZONS.find((option) => option.id === value)?.id ?? '30d'

const frequencyIdFrom = (value: string): FrequencyId =>
  FREQUENCIES.find((option) => option.id === value)?.id ?? 'weekly'
