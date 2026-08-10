import type { Activity } from '../types'

/** One transaction from the Uniswap data API, narrowed to the fields activity needs. */
export type ActivitySample = {
  timestampMs: string
  walletAddress?: string
  amountUsd?: number
}

const EMPTY: Activity = {
  transactionsPerHour: 0,
  volumeUsdPerHour: 0,
  uniqueTraders: 0,
  averageTradeUsd: 0,
  sampleSize: 0,
  windowSeconds: 0,
}

/** Total USD across the trades that reported an amount. */
const totalTradeUsd = (transactions: ActivitySample[]) =>
  transactions.reduce(
    (total, entry) =>
      typeof entry.amountUsd === 'number' && Number.isFinite(entry.amountUsd)
        ? total + entry.amountUsd
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
 * so a busy pool and a dead pool cost the same single request: 25 transactions across 36
 * seconds and 25 across three weeks are each measured against their own window. A sample that
 * spans no time yields a rate of 0 rather than dividing by zero.
 */
export const computeActivity = (transactions: ActivitySample[]): Activity => {
  if (transactions.length === 0) return EMPTY

  const windowSeconds = spanSeconds(transactions)
  const wallets = transactions
    .map((entry) => entry.walletAddress?.toLowerCase())
    .filter((wallet): wallet is string => Boolean(wallet))

  const perHour = (amount: number) => (windowSeconds > 0 ? amount / (windowSeconds / 3600) : 0)

  return {
    transactionsPerHour: perHour(transactions.length),
    volumeUsdPerHour: perHour(totalTradeUsd(transactions)),
    uniqueTraders: new Set(wallets).size,
    averageTradeUsd: meanTradeUsd(transactions),
    sampleSize: transactions.length,
    windowSeconds,
  }
}
