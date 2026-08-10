/** The three figures a change report tracks for a pool. */
export type PoolMetrics = {
  tvlUsd: number
  feesPerHourUsd: number
  txPerHour: number | null
  volumeUsdPerHour: number | null
}

/** A pool in the report, with the state it was last reported in. */
export type ChangeRow = {
  poolId: string
  pair: string
  before: PoolMetrics | null
  after: PoolMetrics
  /** Wallets holding this pool right now, by their configured label. */
  openHolders: string[]
  krystalUrl: string
}

/** What a caller supplies for each watched pool. */
export type ChangeInput = {
  poolId: string
  pair: string
  metrics: PoolMetrics
  openHolders: string[]
  krystalUrl: string
}

/** How many pools a single report lists, so the message stays inside Telegram's size limit. */
export const REPORT_LIMIT = 15

/**
 * Marks a figure that is extrapolated from a sample rather than reported by the pool feed.
 *
 * TVL and fees come from the feed as published totals. Trade rate and volume rate are computed
 * here from about 25 transactions, whose span is often under two minutes, then scaled to an
 * hour. The two kinds sit in adjacent rows, and without a mark a reader has no way to tell that
 * one pair carries far more uncertainty than the other.
 */
export const SAMPLED_MARK = '~'

/** Spelled out once per message, rather than repeated against every marked figure. */
export const SAMPLED_NOTE = `${SAMPLED_MARK} sampled from recent trades, not reported`

/**
 * Pairs each monitored pool with the state it was last reported in.
 *
 * Every monitored pool appears, not only those that moved: the report answers "what are my pools
 * doing now" rather than "what crossed a threshold", so a pool holding steady is a result too.
 *
 * Pools are ordered by how much their fee rate moved, so the ones worth reading come first when
 * the list is longer than a message can carry.
 */
export const buildChangeReport = (
  previous: ReadonlyMap<string, PoolMetrics>,
  current: ChangeInput[],
): ChangeRow[] => {
  const rows = current.map((pool) => ({
    poolId: pool.poolId,
    pair: pool.pair,
    before: previous.get(pool.poolId.toLowerCase()) ?? null,
    after: pool.metrics,
    openHolders: pool.openHolders,
    krystalUrl: pool.krystalUrl,
  }))

  return rows.sort((a, b) => movement(b) - movement(a))
}

/** Relative change in fee rate, used only for ordering. A new pool sorts first. */
const movement = (row: ChangeRow): number => {
  if (row.before === null) return Number.POSITIVE_INFINITY
  if (row.before.feesPerHourUsd <= 0) return row.after.feesPerHourUsd > 0 ? 1 : 0

  return Math.abs(row.after.feesPerHourUsd - row.before.feesPerHourUsd) / row.before.feesPerHourUsd
}

/** Compact USD for a fixed-width column. */
export const usdCell = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '-'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

/** Compact count for a fixed-width column. */
export const countCell = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '-'
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

/** Which way a figure moved, for callers that can show direction. */
export type Direction = 'up' | 'down' | 'flat' | 'new'

/** How a caller decorates a cell once it knows the direction. Plain text by default. */
export type Decorate = (text: string, direction: Direction) => string

const ARROW: Record<Direction, string> = { up: '↑', down: '↓', flat: '→', new: '' }

/**
 * Direction from the rendered values, not the raw ones.
 *
 * Two numbers that display identically have not moved as far as a reader is concerned, and
 * calling that a rise because the sixth decimal changed would be noise dressed as signal.
 */
const directionOf = (before: string | null, after: string): Direction => {
  if (before === null) return 'new'
  if (before === after) return 'flat'

  const a = Number(before.replace(/[^\d.-]/g, ''))
  const b = Number(after.replace(/[^\d.-]/g, ''))
  const scale = (text: string) => (text.includes('M') ? 1_000_000 : text.includes('k') ? 1_000 : 1)

  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'flat'
  return b * scale(after) > a * scale(before) ? 'up' : 'down'
}

/**
 * `before↑after`, with the arrow carrying the direction.
 *
 * The arrow is the separator rather than an extra glyph, so direction costs no width in a table
 * whose columns are already tight. Telegram cannot colour text at all, so this is the only way
 * the message itself can show which way a figure went.
 */
const shift = (before: string | null, after: string, decorate: Decorate) => {
  const direction = directionOf(before, after)
  const text = before === null ? after : `${before}${ARROW[direction]}${after}`

  return decorate(text, direction)
}

/**
 * Pads to a visible width, ignoring any ANSI escapes a decorator added.
 *
 * `padEnd` counts every character, so colouring a cell and then padding it would shorten the
 * visible text by the length of the escape sequence and break every column to its right.
 */
const pad = (value: string, width: number) => {
  const visible = value.replace(/\u001b\[[0-9;]*m/g, '')
  if (visible.length >= width) {
    return visible.length === value.length ? value.slice(0, width) : value
  }

  return value + ' '.repeat(width - visible.length)
}

/** Escapes the characters Telegram's HTML parser treats as markup. */
const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Renders the report as a fixed-width table.
 *
 * Wrapped in `<pre>` because a proportional font destroys column alignment, and the comparison
 * only reads as a table if the arrows line up. Columns are deliberately narrow: Telegram on a
 * phone wraps a long line and the alignment goes with it.
 */
/**
 * The comparison as plain fixed-width lines, without any markup.
 *
 * Shared by the message and the terminal so both render the same table from the same code; a
 * separate formatter for the CLI would drift from what actually gets sent.
 */
export const changeTableLines = (
  rows: ChangeRow[],
  decorate: Decorate = (text) => text,
): string[] => {
  const listed = rows.slice(0, REPORT_LIMIT)

  // Several watched pools can share a pair, since ETH/USDG alone spans sixteen on this chain, so
  // the id fragment is what actually tells two rows apart.
  const header = `${pad('POOL', 22)}${pad('TVL', 15)}${pad('FEES/H', 15)}${pad(`TX/H${SAMPLED_MARK}`, 13)}${pad(`VOL/H${SAMPLED_MARK}`, 15)}HELD BY`
  const lines = listed.map((row) => {
    const fees = shift(
      row.before ? usdCell(row.before.feesPerHourUsd) : null,
      usdCell(row.after.feesPerHourUsd),
      decorate,
    )
    const tx = shift(
      row.before ? countCell(row.before.txPerHour) : null,
      countCell(row.after.txPerHour),
      decorate,
    )
    const volume = shift(
      row.before ? usdCell(row.before.volumeUsdPerHour) : null,
      usdCell(row.after.volumeUsdPerHour),
      decorate,
    )

    const tvl = shift(row.before ? usdCell(row.before.tvlUsd) : null, usdCell(row.after.tvlUsd), decorate)
    const name = `${row.pair} ${row.poolId.slice(2, 8)}`
    const held = row.openHolders.length > 0 ? row.openHolders.join(', ') : '-'

    return `${pad(name, 22)}${pad(tvl, 15)}${pad(fees, 15)}${pad(tx, 13)}${pad(volume, 15)}${held}`
  })

  return [header, ...lines]
}

/**
 * The comparison as a stacked block per pool, for narrow screens.
 *
 * The table is about eighty five characters wide, and a phone shows roughly thirty before it
 * wraps, at which point the columns the comparison depends on are gone. Stacking each pool keeps
 * every line under twenty five characters, so it reads on a phone without scrolling sideways.
 *
 * Same figures, same order, same arrows as the table; only the arrangement differs.
 */
export const changeBlockLines = (rows: ChangeRow[], decorate: Decorate = (text) => text): string[] =>
  rows.slice(0, REPORT_LIMIT).flatMap((row) => {
    const cell = (
      before: number | null | undefined,
      after: number | null,
      format: (value: number | null) => string,
    ) => shift(row.before ? format(before ?? null) : null, format(after), decorate)

    const lines = [
      `${row.pair} ${row.poolId.slice(2, 8)}`,
      `  tvl   ${cell(row.before?.tvlUsd, row.after.tvlUsd, usdCell)}`,
      `  fees  ${cell(row.before?.feesPerHourUsd, row.after.feesPerHourUsd, usdCell)}`,
      // The mark is absorbed into the existing label padding rather than added after it, so
      // every value still begins at the same column.
      `  tx${SAMPLED_MARK}   ${cell(row.before?.txPerHour, row.after.txPerHour, countCell)}`,
      `  vol${SAMPLED_MARK}  ${cell(row.before?.volumeUsdPerHour, row.after.volumeUsdPerHour, usdCell)}`,
    ]

    return row.openHolders.length > 0 ? [...lines, `  held  ${row.openHolders.join(', ')}`] : lines
  })

/** One link per listed pool, for placing beneath the table. */
export const changeLinkLines = (rows: ChangeRow[]): { label: string; url: string }[] =>
  rows
    .slice(0, REPORT_LIMIT)
    .filter((row) => row.krystalUrl)
    .map((row) => ({ label: `${row.pair} ${row.poolId.slice(2, 8)}`, url: row.krystalUrl }))

export const formatChangeReport = (rows: ChangeRow[], mentions: string[] = []): string => {
  if (rows.length === 0) return ''

  const rest = rows.length - Math.min(rows.length, REPORT_LIMIT)
  const handles = mentions.join(' ')

  // Links sit below the table rather than in it: a URL inside <pre> is not clickable, and one
  // per row would destroy the column widths the comparison depends on.
  const links = changeLinkLines(rows)
    .map((link) => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`)
    .join(' · ')

  return [
    handles || null,
    `<b>Pool update: ${rows.length} monitored</b>`,
    // Stacked rather than tabular: the message is read on a phone far more often than the
    // terminal report is, and a wide table there loses the alignment it depends on.
    `<pre>${escapeHtml(changeBlockLines(rows).join('\n'))}</pre>`,
    links || null,
    rest > 0 ? `…and ${rest} more not shown` : null,
    `<i>${escapeHtml(SAMPLED_NOTE)}</i>`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/**
 * A signature of what the report would show, for deciding whether it is worth sending.
 *
 * Built from the rendered values rather than the raw numbers. A fee rate changes on almost every
 * poll in the sixth decimal place, so comparing raw floats would fire an alert every minute and
 * say nothing; comparing what a reader would actually see fires only when the displayed figure
 * moves. Checking often and sending rarely is the point.
 */
export const reportSignature = (
  pools: { poolId: string; metrics: PoolMetrics }[],
): string =>
  [...pools]
    .sort((a, b) => a.poolId.localeCompare(b.poolId))
    .map(
      (pool) =>
        `${pool.poolId.toLowerCase()}:${usdCell(pool.metrics.tvlUsd)}:${usdCell(
          pool.metrics.feesPerHourUsd,
        )}:${countCell(pool.metrics.txPerHour)}:${usdCell(pool.metrics.volumeUsdPerHour)}`,
    )
    .join('|')

/**
 * Relative movement between two figures, as a fraction.
 *
 * A value appearing or disappearing counts as a complete change: gaining a measurement where
 * there was none, or losing one, is exactly the kind of thing worth being told about.
 */
const moved = (before: number | null, after: number | null): number => {
  if (before === after) return 0
  if (before === null || after === null) return 1
  if (before === 0) return after === 0 ? 0 : 1

  return Math.abs(after - before) / Math.abs(before)
}

/**
 * Whether any watched pool has moved enough to be worth a message.
 *
 * Movement is measured against the last reported state, not the last poll, so a pool drifting a
 * little every minute still crosses the threshold eventually rather than creeping indefinitely
 * under it. That is why the baseline is only advanced when a report actually goes out.
 */
export const hasMaterialChange = (rows: ChangeRow[], minFraction: number): boolean =>
  rows.some((row) => {
    // A pool with nothing to compare against is new to the watchlist, which is always material.
    if (row.before === null) return true

    return (
      moved(row.before.tvlUsd, row.after.tvlUsd) >= minFraction ||
      moved(row.before.feesPerHourUsd, row.after.feesPerHourUsd) >= minFraction ||
      moved(row.before.txPerHour, row.after.txPerHour) >= minFraction ||
      moved(row.before.volumeUsdPerHour, row.after.volumeUsdPerHour) >= minFraction
    )
  })
