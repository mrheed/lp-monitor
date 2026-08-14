import { chainById } from './chains'

/**
 * How many pools get their transaction activity fetched before the page is served.
 *
 * Kept small so first paint is fast. Everything past this is fetched lazily as the table is
 * scrolled, which is why this is far below the old eager limit.
 */
export const ACTIVITY_POOL_LIMIT = 60

/** How many pools one activity request covers. */
export const ACTIVITY_BATCH_SIZE = 25

/**
 * How many activity requests the table keeps in flight while sweeping.
 *
 * The sweep runs in the background until every pool is measured, because the score is a
 * percentile within the measured set: leaving most pools unmeasured would rank each pool
 * against an arbitrary handful of others and change the answer as you scrolled.
 */
export const ACTIVITY_PARALLEL_BATCHES = 4

/**
 * How many pools the background sweep measures, taken in server rank order.
 *
 * Set above the current pool count so the sweep covers everything. Six chains return 4,759
 * pools, of which 3,846 sit on protocols Uniswap's transaction feed indexes; the rest are
 * skipped before any request. At 6 requests per second that is roughly eleven minutes.
 *
 * It remains a fixed prefix of the rank order rather than whatever happened to be scrolled to,
 * so the cohort a score is computed against is reproducible, and it caps the work if the pool
 * count grows sharply.
 */
export const SWEEP_POOL_LIMIT = 6000

/**
 * How many times a pool is attempted before the sweep gives up on it.
 *
 * The upstream gateway fails a small fraction of requests under a sustained sweep. Without a
 * retry those pools were stranded and the sweep stalled short of complete; with an unbounded
 * one a genuinely unavailable pool would loop forever.
 */
export const SWEEP_MAX_ATTEMPTS = 3

/** Pause after a wave that measured nothing, so a persistent fault backs off. */
export const SWEEP_RETRY_BACKOFF_MS = 2_000

/**
 * How long a measurement stands before the sweep takes it again.
 *
 * Without this the sweep ran once and never returned, so trade rate and trader counts stayed
 * frozen at their first reading while fees and TVL refreshed every minute, and the table mixed
 * live columns with hour-old ones.
 */
export const ACTIVITY_MAX_AGE_MS = 10 * 60_000

/** How often the idle sweep looks for measurements that have aged out. */
export const SWEEP_IDLE_POLL_MS = 15_000

/** Rows rendered initially, and added each time the scroll sentinel comes into view. */
export const ROW_PAGE_SIZE = 10

/**
 * Builds the Uniswap explore link for a pool.
 *
 * The slug comes from the chain registry. Verified by content, not status: app.uniswap.org
 * returns 200 for every path, but a correct slug returns a page containing the pool's token
 * symbols while a nonsense slug returns a shorter shell without them.
 */
export const uniswapPoolUrl = (chainId: number, poolAddress: string) =>
  `https://app.uniswap.org/explore/pools/${chainById(chainId)?.slug ?? chainId}/${poolAddress}`

/**
 * Transactions sampled per pool when measuring activity.
 *
 * Payload size, not the server, governs sweep speed: a 100 transaction page is 465KB and
 * sustains 1.5 requests per second, while a 25 transaction page is 116KB and sustains 6. The
 * sample only has to span enough time to derive a rate, so the smaller page is a four fold
 * speedup for no loss in the rate calculation.
 *
 * It does bound unique trader counts, which cannot exceed this number.
 */
export const TX_SAMPLE_SIZE = 25

/**
 * Transactions sampled for a pool the operator is watching.
 *
 * The maximum the endpoint serves: 150 and above is rejected with "page_size exceeds maximum of
 * 100". Worth paying here because the watched set is a handful of pools rather than thousands,
 * and the larger page buys two things the smaller one cannot.
 *
 * Span, first: measured across four watched pools it stretched the observed window by 2.7 to 5.5
 * times, from one minute to four on the busiest and from 23 minutes to an hour on the quietest.
 *
 * Trader counts, second: they cannot exceed the sample size, so at 25 they were not counts at
 * all but a ceiling. The same pools reported 11 to 18 traders at 25 and 27 to 47 at 100.
 */
export const TX_SAMPLE_SIZE_WATCHED = 100

/**
 * Simultaneous outbound requests during the frequency fan out.
 *
 * Measured at 25 transactions per page: 12 concurrent gives 5.2 requests per second, 24 gives
 * 6.1, and 48 drops back to 5.1. Past roughly 24 the endpoint over saturates and gets slower,
 * so this is a measured optimum rather than a guess. No rate limiting was seen at any level.
 */
export const FETCH_CONCURRENCY = 24

/**
 * How often the table asks the server for fresh pool data.
 *
 * Raised well above the original five seconds: the background sweep issues far more requests
 * than a single snapshot, and refetching a multi megabyte feed every five seconds alongside it
 * spends bandwidth on numbers that barely move between polls.
 */
export const REFRESH_INTERVAL_MS = 60_000

/** How often the refresh countdown redraws. Fine enough to look continuous, cheap enough to ignore. */
export const COUNTDOWN_TICK_MS = 250

/**
 * Server side cache lifetimes.
 *
 * `pools` sits below the refresh interval so a poll returns fresh numbers rather than the same
 * cached snapshot. Positions, activity and tokens are held longer because they move slowly and
 * cost one request per wallet, pool or token.
 */
export const CACHE_TTL_MS = {
  pools: 30_000,
  positions: 60_000,
}

/**
 * How long a measurement is kept at all.
 *
 * Far longer than the age at which it is considered stale, because an old measurement is still
 * worth serving while a fresh one is fetched. Staleness decides when to refresh; this decides
 * when there is nothing to show.
 */
export const ACTIVITY_CACHE_TTL_MS = 6 * 60 * 60_000

/** How often the server re-reads the pool feed to look for pools it has not seen. */
export const ALERT_POLL_INTERVAL_MS = 60_000

/**
 * Shortest gap between two alert messages.
 *
 * One message per poll is already the ceiling; this guards the case where polls are triggered
 * more often than the interval. Overflow waits for the next poll rather than going out as a
 * burst, which Telegram rate limits and nobody reads.
 */
export const ALERT_MIN_SEND_INTERVAL_MS = 60_000

/** Ceiling on the geometric backoff after repeated send failures. */
export const ALERT_MAX_BACKOFF_MS = 15 * 60_000

/** A wallet to check positions for, with the name shown in the table. */
export type TrackedWallet = { address: string; label: string }

/** Shortens an address to its leading and trailing hex, for use when no label was given. */
export const shortenAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

/**
 * Wallets whose positions mark the position column.
 *
 * Set LP_WALLETS in .env.local as a comma separated list. An entry may carry a label after an
 * equals sign, `0xabc…=Main`, which is what the table shows; without one the address is
 * shortened. Labels matter once more than one wallet is tracked, because a column of truncated
 * hex cannot be read at a glance.
 *
 * Addresses stay out of the repo so the column works without committing wallet identity to
 * version control.
 */
export const trackedWallets = (): TrackedWallet[] =>
  (process.env.LP_WALLETS ?? '')
    .split(',')
    .map((entry) => {
      const [rawAddress, ...labelParts] = entry.split('=')
      const address = rawAddress.trim().toLowerCase()
      const label = labelParts.join('=').trim()
      return { address, label: label || shortenAddress(address) }
    })
    .filter((wallet) => /^0x[0-9a-f]{40}$/.test(wallet.address))

/** Builds the Krystal dashboard link for a pool, matching the template used by their own app. */
export const krystalPoolUrl = (chainId: number, poolAddress: string, protocol: string) =>
  `https://defi.krystal.app/pools/detail?chainId=${chainId}&poolAddress=${poolAddress}&protocol=${protocol}`
