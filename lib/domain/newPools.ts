/** What a pool must expose to be judged against the alert filters and described in a message. */
export type AlertCandidate = {
  poolId: string
  pair: string
  feeTier: number
  dynamicFee: boolean
  hasHook: boolean
  tvlUsd: number
  /** Fees over the shortest window that reported any, as an hourly rate. */
  recentFeesPerHourUsd: number
  /** Fees accumulated over the widest window available. */
  totalFeesUsd: number
  /** Which window that rate came from, so the message does not imply more history than exists. */
  recentFeeWindow: string
  /** Trades per hour, or null when the pool has not been measured yet. */
  txPerHour: number | null
  /** USD flowing through per hour, or null when the pool has not been measured yet. */
  volumeUsdPerHour: number | null
  krystalUrl: string
  uniswapUrl: string
  /** Wallets holding this pool right now, by their configured label. */
  openHolders: string[]
}

/** Which pools an alert should fire for. */
export type AlertFilters = {
  enabled: boolean
  /** Minimum total swap fee, as a percentage. Krystal reports feeTier already converted. */
  minFeeTier: number
  /** `any` fires for every pool; the others require a hook to be present or absent. */
  hooks: 'any' | 'with' | 'without'
  /** `any` fires for every pool; the others require a dynamic fee or a fixed one. */
  dynamicFee: 'any' | 'only' | 'exclude'
  /**
   * Token symbols to watch. Empty means every pool.
   *
   * A pool matches when either side is listed, so `USDG` covers everything quoted against it
   * without having to name the other half.
   */
  tickers: string[]
  /** Telegram handles to mention, so the alert notifies people rather than just arriving. */
  mentions: string[]
  /** Whether to watch the checked pools for changes. */
  reportChanges: boolean
  /**
   * Pool ids to watch, chosen from the table.
   *
   * An explicit list rather than everything matching the filters: a report covering 2,600 pools
   * is noise, and the pools worth watching are a decision, not a query.
   */
  monitoredPoolIds: string[]
  /**
   * Smallest move worth a message, as a percentage.
   *
   * Measured against the last reported state rather than the last poll, so slow drift still
   * accumulates past it instead of creeping under the threshold forever.
   */
  minChangePercent: number
}

export const DEFAULT_FILTERS: AlertFilters = {
  // Off until switched on, so connecting a bot never starts sending on its own.
  enabled: false,
  minFeeTier: 0,
  hooks: 'any',
  dynamicFee: 'any',
  tickers: [],
  mentions: [],
  reportChanges: false,
  monitoredPoolIds: [],
  minChangePercent: 10,
}

/**
 * Whether a pool passes the alert filters.
 *
 * A dynamic-fee pool has no fixed tier to compare, so it passes any fee floor rather than being
 * silently excluded by a `0` that means "not applicable" rather than "free".
 */
export const matchesFilters = (pool: AlertCandidate, filters: AlertFilters): boolean => {
  if (!pool.dynamicFee && pool.feeTier < filters.minFeeTier) return false
  if (filters.hooks === 'with' && !pool.hasHook) return false
  if (filters.hooks === 'without' && pool.hasHook) return false
  if (filters.dynamicFee === 'only' && !pool.dynamicFee) return false
  if (filters.dynamicFee === 'exclude' && pool.dynamicFee) return false
  if (!matchesTickers(pool.pair, filters.tickers)) return false
  return true
}

/**
 * Whether either side of a pair is one of the watched tickers.
 *
 * Compared whole rather than by substring: `ETH` should not match `CASHCAT/WETH`, which a
 * substring test would, and which would quietly widen every filter that names a common symbol.
 */
export const matchesTickers = (pair: string, tickers: string[]): boolean => {
  const wanted = tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)
  if (wanted.length === 0) return true

  const sides = pair.toUpperCase().split('/')
  return sides.some((side) => wanted.includes(side))
}

/**
 * Finds pools that were not in the previous set and pass the filters.
 *
 * `previous` being null means nothing has been seen yet, which is the first load. That seeds
 * the set and reports nothing: the alternative is alerting on every pool on the chain at once,
 * which is both useless and enough messages to get a bot rate limited.
 */
export const detectNewPools = (
  previous: ReadonlySet<string> | null,
  pools: AlertCandidate[],
  filters: AlertFilters,
): { fresh: AlertCandidate[]; seen: Set<string> } => {
  const seen = new Set(pools.map((pool) => pool.poolId.toLowerCase()))

  if (previous === null || !filters.enabled) return { fresh: [], seen }

  const fresh = pools.filter(
    (pool) => !previous.has(pool.poolId.toLowerCase()) && matchesFilters(pool, filters),
  )

  return { fresh, seen }
}

/**
 * How many pools a single alert names.
 *
 * Also the send batch size: a message must name every pool it marks as announced, otherwise the
 * ones summarised as "and N more" would be recorded as told without ever being told.
 */
export const NAMED_LIMIT = 8

/**
 * Escapes the characters Telegram's HTML parser treats as markup.
 *
 * Token symbols on this chain are user-chosen, so a pair name is untrusted input. An unescaped
 * angle bracket does not merely render oddly: Telegram rejects the whole message with a 400 and
 * the alert is lost.
 */
const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A link with a short label, so two URLs per pool do not swamp the message. */
const link = (href: string, label: string) =>
  href ? `<a href="${escapeHtml(href)}">${label}</a>` : ''

/**
 * Compact USD, matching the table's own shorthand so the two read the same.
 *
 * A missing figure renders as an em dash rather than `$NaN`: a queued pool can outlive the shape
 * it was queued with, and an alert is worth sending with a gap in it.
 */
const usd = (value: number) => {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`
  return `$${Math.round(value).toLocaleString()}`
}

/** Compact trade rate, falling back to a daily figure when hourly would round to nothing. */
const perHour = (value: number) => {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k/h`
  if (value >= 1) return `${Math.round(value)}/h`
  if (value > 0) return `${(value * 24).toFixed(1)}/d`
  return '0/h'
}

/**
 * Normalises a handle to the `@name` form Telegram notifies on.
 *
 * Accepts what a person would actually type: with or without the sigil, and with surrounding
 * whitespace. Anything that is not a plausible handle is dropped rather than sent as text that
 * would notify nobody.
 */
export const normaliseHandle = (raw: string): string | null => {
  const handle = raw.trim().replace(/^@+/, '')
  return /^[A-Za-z0-9_]{5,32}$/.test(handle) ? `@${handle}` : null
}

/**
 * Composes one message for a batch of new pools.
 *
 * A batch becomes one message rather than one each: a chain that mints pools continuously can
 * produce dozens between polls, and that many messages would be rate limited and unreadable.
 *
 * Mentions lead the message so the people named see why they were pinged before the list.
 *
 * Composed as Telegram HTML so each pool's links fit behind short labels rather than two bare
 * URLs per line. Every value drawn from chain data is escaped on the way in.
 */
export const formatAlert = (pools: AlertCandidate[], mentions: string[] = []): string => {
  const named = pools.slice(0, NAMED_LIMIT)
  const rest = pools.length - named.length

  const lines = named.flatMap((pool) => {
    const fee = pool.dynamicFee ? 'dynamic fee' : `${pool.feeTier}% fee`
    const hook = pool.hasHook ? ' · hook' : ''

    // Trade rate is omitted rather than shown as zero when the pool has not been measured:
    // a brand new pool with no reading is not the same as one nobody is trading.
    const trades = pool.txPerHour === null ? 'not yet measured' : `${perHour(pool.txPerHour)} trades`
    const window =
      pool.recentFeeWindow && pool.recentFeeWindow !== 'none' ? ` ${pool.recentFeeWindow}` : ''

    const links = [link(pool.krystalUrl, 'Krystal'), link(pool.uniswapUrl, 'Uniswap')]
      .filter(Boolean)
      .join(' · ')

    return [
      `• <b>${escapeHtml(pool.pair)}</b> — ${escapeHtml(`${fee}${hook}`)}`,
      `   ${usd(pool.tvlUsd)} TVL · ${trades}`,
      `   fees ${usd(pool.recentFeesPerHourUsd)}/h${escapeHtml(window)} · ${usd(pool.totalFeesUsd)} total`,
      links ? `   ${links}` : null,
    ].filter((line): line is string => line !== null)
  })

  const heading =
    pools.length === 1
      ? '<b>New pool on Robinhood Chain</b>'
      : `<b>${pools.length} new pools on Robinhood Chain</b>`

  const handles = mentions
    .map(normaliseHandle)
    .filter((handle): handle is string => handle !== null)

  return [
    handles.length > 0 ? handles.join(' ') : null,
    heading,
    ...lines,
    rest > 0 ? `…and ${rest} more` : null,
  ]
    .filter(Boolean)
    .join('\n')
}
