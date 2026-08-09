import type { Activity } from '../types'

/** One transaction from the Uniswap data API, narrowed to the fields activity needs. */
export type ActivitySample = {
  timestampMs: string
  /** Swap, add or remove. Absent on feeds that do not report it, which are treated as swaps. */
  eventType?: string
  walletAddress?: string
  amountUsd?: number
}

/**
 * Narrows a sample to the swaps.
 *
 * The transaction feed mixes liquidity adds and removes in with the trades. Those move USD but
 * pay no swap fee, so counting them overstates both the trade rate and any fee derived from it.
 * A single large deposit into a quiet pool is enough to make it look busy.
 *
 * A row with no event type is kept: the field is only absent on feeds that do not report it,
 * and dropping every row would be worse than assuming the common case.
 */
const swapsOnly = (transactions: ActivitySample[]) =>
  transactions.filter((entry) => entry.eventType === undefined || entry.eventType.endsWith('_SWAP'))

/** How far back a measurement may reach, and the clock to measure it from. */
export type ActivityWindow = {
  ceilingSeconds: number
  now: number
}

/** Drops transactions older than the ceiling. */
const withinCeiling = (transactions: ActivitySample[], { ceilingSeconds, now }: ActivityWindow) => {
  const oldestAllowed = now - ceilingSeconds * 1000
  return transactions.filter((entry) => Number(entry.timestampMs) >= oldestAllowed)
}

const EMPTY: Activity = {
  transactionsPerHour: 0,
  volumeUsdPerHour: 0,
  uniqueTraders: 0,
  averageTradeUsd: 0,
  sampleSize: 0,
  windowSeconds: 0,
}

/** Total USD across the trades that reported an amount, as magnitudes. */
const totalTradeUsd = (transactions: ActivitySample[]) =>
  transactions.reduce(
    (total, entry) =>
      typeof entry.amountUsd === 'number' && Number.isFinite(entry.amountUsd)
        ? total + Math.abs(entry.amountUsd)
        : total,
    0,
  )

/** Seconds between the oldest and newest transaction in the sample. */
const spanSeconds = (transactions: ActivitySample[]) => {
  const timestamps = transactions.map((entry) => Number(entry.timestampMs))
  return (Math.max(...timestamps) - Math.min(...timestamps)) / 1000
}

/** Mean USD size of the trades that reported an amount, ignoring those that did not. */
const meanTradeUsd = (transactions: ActivitySample[]) => {
  const amounts = transactions
    .map((entry) => entry.amountUsd)
    .filter((amount): amount is number => typeof amount === 'number' && Number.isFinite(amount))

  if (amounts.length === 0) return 0
  return amounts.reduce((total, amount) => total + amount, 0) / amounts.length
}

/**
 * Summarises recent trade activity from a page of pool transactions.
 *
 * The hourly rate comes from the span the sample itself covers rather than a fixed lookback,
 * so a busy pool and a dead pool cost the same single request: a hundred swaps across ninety
 * seconds and a hundred across three weeks are each measured against their own window. A sample
 * that spans no time yields a rate of 0 rather than dividing by zero.
 *
 * The optional ceiling caps how far back that window may reach. It is a ceiling rather than a
 * fixed period because the two bind in opposite directions: the busiest pool on the chain fits
 * a full page into ninety seconds, so asking it for fifteen minutes would mean thirteen more
 * requests to obtain a coarser answer, while a quiet pool needs the ceiling to stop it
 * reporting hours-old trades as current. Clipping one page gives each pool the freshest window
 * it can support for a single request.
 */
export const computeActivity = (
  transactions: ActivitySample[],
  window?: ActivityWindow,
): Activity => {
  const swaps = swapsOnly(transactions)
  const recent = window ? withinCeiling(swaps, window) : swaps

  if (recent.length === 0) return EMPTY

  const windowSeconds = spanSeconds(recent)
  const wallets = recent
    .map((entry) => entry.walletAddress?.toLowerCase())
    .filter((wallet): wallet is string => Boolean(wallet))

  const perHour = (amount: number) => (windowSeconds > 0 ? amount / (windowSeconds / 3600) : 0)

  return {
    transactionsPerHour: perHour(recent.length),
    volumeUsdPerHour: perHour(totalTradeUsd(recent)),
    uniqueTraders: new Set(wallets).size,
    averageTradeUsd: meanTradeUsd(recent),
    sampleSize: recent.length,
    windowSeconds,
  }
}
