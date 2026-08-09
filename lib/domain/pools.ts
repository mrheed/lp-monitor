import { cached, peekWithAge, remember } from '../cache'
import { fetchTopPools, fetchWalletPositions } from '../clients/krystal'
import { fetchActivity } from '../clients/uniswap'
import {
  ACTIVITY_CACHE_TTL_MS,
  ACTIVITY_MAX_AGE_MS,
  ACTIVITY_POOL_LIMIT,
  CACHE_TTL_MS,
  ceilingSecondsFor,
  DEFAULT_FEE_WINDOW,
  krystalPoolUrl,
  trackedWallets,
  uniswapPoolUrl,
} from '../config'
import type { Activity, KrystalPool, PoolRow, PositionState } from '../types'
import {
  buildPositionIndex,
  holdersFor,
  positionStateFor,
  positionViaFor,
  type PoolIdentity,
  type PositionIndex,
  type PositionVia,
} from './positions'
import { rankPools } from './rank'
import { rankByScore, scorePools, type ScoreWeights } from './score'
import { recentFeeRate } from './feeWindow'
import { impliedFeeRate, withActivity } from './liveFees'
import { estimatePoolAge } from './poolAge'
import { getFirstSeen } from './alertWatcher'

const ZERO_HOOK = '0x0000000000000000000000000000000000000000'

/**
 * Weights for the candidate pass, which runs before any transaction data exists.
 *
 * Fee rate, TVL and volatility all come from the pool feed and are known for every pool, so
 * they carry the whole weight; only the activity factors are zeroed rather than scored against
 * absent data.
 */
const PRESELECT_WEIGHTS: ScoreWeights = {
  fees: 0.45,
  tvl: 0.3,
  volatility: 0.25,
  rate: 0,
  traders: 0,
}

/** What the tracker returns to the UI, including which sources degraded. */
export type PoolsSnapshot = {
  rows: PoolRow[]
  totalPools: number
  walletsTracked: number
  activityCovered: number
  /** How many pools carry a full four factor score; the rest are ranked on fees and TVL. */
  scoredCount: number
  warnings: string[]
  fetchedAt: string
}

/**
 * Flattens a Krystal pool into a table row.
 *
 * `totalFeesUsd` reads from the 30 day window because that is the widest one available. On a
 * chain this young most pools have less than a day of history, so the 30 day figure collapses
 * to the 24 hour figure on its own rather than needing a special case.
 */
const toRow = (
  pool: KrystalPool,
  position: PositionState,
  positionVia: PositionVia | null,
  positionHolders: PoolRow['positionHolders'],
  firstSeenAt: number | undefined,
): PoolRow => {
  const fees = {
    hour: pool.stat1h.feeUsd,
    day: pool.stat24h.feeUsd,
    week: pool.stat7d.feeUsd,
    month: pool.stat30d.feeUsd,
  }
  const volumes = {
    hour: pool.stat1h.volumeUsd,
    day: pool.stat24h.volumeUsd,
    week: pool.stat7d.volumeUsd,
    month: pool.stat30d.volumeUsd,
  }

  const recent = recentFeeRate(fees)

  return {
    poolId: pool.poolAddress,
    chainId: pool.chainId,
    protocol: pool.protocol,
    pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
    token0Symbol: pool.token0.symbol,
    token1Symbol: pool.token1.symbol,
    token0Address: pool.token0.address,
    token1Address: pool.token1.address,
    feeTier: pool.feeTier,
    lpFee: pool.lpFee,
    dynamicFee: pool.dynamicFee,
    hooks: pool.hooks,
    hasHook: Boolean(pool.hooks) && pool.hooks !== ZERO_HOOK,
    tag: pool.tag ?? '',
    tvlUsd: pool.tvlUsd,
    totalFeesUsd: pool.stat30d.feeUsd,
    recentFeesPerHourUsd: recent.perHourUsd,
    recentFeeWindow: recent.window,
    feeRate: impliedFeeRate(fees, volumes),
    // Both stay null until activity arrives; the sweep fills them in when it attaches a sample.
    liveFeesPerHourUsd: null,
    liveFeeWindowSeconds: null,
    fees24hUsd: pool.stat24h.feeUsd,
    volume24hUsd: pool.stat24h.volumeUsd,
    volume30dUsd: pool.stat30d.volumeUsd,
    apr24h: pool.stat24h.apr,
    drawdown24h: pool.drawdown24h,
    priceVolatility: pool.priceVolatility,
    activity: null,
    position,
    positionVia,
    positionHolders,
    krystalUrl: krystalPoolUrl(pool.chainId, pool.poolAddress, pool.protocol),
    uniswapUrl: uniswapPoolUrl(pool.poolAddress),
    age: estimatePoolAge(
      {
        hour: pool.stat1h.volumeUsd,
        day: pool.stat24h.volumeUsd,
        week: pool.stat7d.volumeUsd,
        month: pool.stat30d.volumeUsd,
      },
      firstSeenAt,
    ),
    score: null,
    scoreParts: null,
  }
}

/**
 * Fetches activity for a batch of pools and returns it as a plain object.
 *
 * Used by the lazy loading route: the table asks for the pools the reader has scrolled to,
 * rather than every pool being measured before the page can render. Results are cached per
 * batch, so scrolling back over rows costs nothing.
 */
export const loadActivityFor = async (
  targets: { poolId: string; protocol: string }[],
  ceilingSeconds: number,
) => {
  const answers = new Map<string, Activity>()
  const missing: typeof targets = []
  const stale: typeof targets = []

  for (const target of targets) {
    const hit = peekWithAge<Activity>(activityKey(target.poolId, ceilingSeconds))

    if (hit === undefined) {
      missing.push(target)
      continue
    }

    answers.set(target.poolId.toLowerCase(), hit.value)
    if (hit.ageMs > ACTIVITY_MAX_AGE_MS) stale.push(target)
  }

  // Anything already measured answers from cache, however old, so a request never waits on the
  // network for a pool that has a usable number. Aged entries are refreshed behind the response
  // instead, which is why the table fills instantly and then sharpens.
  if (stale.length > 0) void refreshInBackground(stale, ceilingSeconds)

  if (missing.length > 0) {
    const fetched = await fetchActivity(missing, ceilingSeconds)
    for (const [poolId, activity] of fetched) {
      remember(activityKey(poolId, ceilingSeconds), activity, ACTIVITY_CACHE_TTL_MS)
      answers.set(poolId, activity)
    }
  }

  return Object.fromEntries(answers)
}

/**
 * Cache key for one pool's activity. Per pool, so a batch is never the unit of reuse.
 *
 * The ceiling is part of the key because it changes the answer: the same transactions clipped
 * to 15 minutes and to an hour give different rates, and serving one for the other would show
 * the reader a window they did not ask for.
 */
const activityKey = (poolId: string, ceilingSeconds: number) =>
  `activity:${ceilingSeconds}:${poolId.toLowerCase()}`

/** Pools currently being refreshed behind a response, so a slow refresh is not started twice. */
const refreshing = new Set<string>()

/** Re-measures aged pools without holding up the request that noticed they were aged. */
const refreshInBackground = async (
  targets: { poolId: string; protocol: string }[],
  ceilingSeconds: number,
) => {
  const due = targets.filter((target) => !refreshing.has(target.poolId.toLowerCase()))
  if (due.length === 0) return

  due.forEach((target) => refreshing.add(target.poolId.toLowerCase()))

  try {
    const fetched = await fetchActivity(due, ceilingSeconds)
    for (const [poolId, activity] of fetched) {
      remember(activityKey(poolId, ceilingSeconds), activity, ACTIVITY_CACHE_TTL_MS)
    }
  } catch {
    // The stale value stays served; the next request past the age threshold tries again.
  } finally {
    due.forEach((target) => refreshing.delete(target.poolId.toLowerCase()))
  }
}

const EMPTY_INDEX: PositionIndex = { byPool: new Map(), unmatched: 0 }

type PositionSources = Awaited<ReturnType<typeof fetchWalletPositions>> | null

/**
 * Fetches the tracked wallets' positions, degrading to nothing on failure.
 *
 * Split from the index build so it can run alongside the pool feed: fetching needs no pools,
 * only the join afterwards does.
 */
const loadPositionSources = async (warnings: string[]): Promise<PositionSources> => {
  const wallets = trackedWallets()
  if (wallets.length === 0) {
    warnings.push('No wallets configured. Set LP_WALLETS in .env.local to enable the checklist.')
    return null
  }

  try {
    const addresses = wallets.map((wallet) => wallet.address)
    return await cached(`positions:${addresses.join(',')}`, CACHE_TTL_MS.positions, () =>
      fetchWalletPositions(addresses),
    )
  } catch {
    warnings.push('Could not load wallet positions. The position column is unavailable.')
    return null
  }
}

/** Joins fetched positions against the pool list. */
const buildIndex = (sources: PositionSources, pools: PoolIdentity[]): PositionIndex =>
  sources === null
    ? EMPTY_INDEX
    : buildPositionIndex(sources.directPositions, sources.vaultPools, pools)

/**
 * Builds the ranked pool table from all three upstream sources.
 *
 * Each source degrades on its own: a ranked table missing one column is still useful, so a
 * failure in activity or positions leaves those cells blank and records a warning rather than
 * failing the whole request.
 */
export const getPoolsSnapshot = async (
  ceilingSeconds: number = ceilingSecondsFor(DEFAULT_FEE_WINDOW),
): Promise<PoolsSnapshot> => {
  const warnings: string[] = []

  // The pool feed and the wallet's positions do not depend on each other, only on being
  // combined afterwards, so they are fetched together rather than one after the other.
  const [pools, positionSources] = await Promise.all([
    cached('pools', CACHE_TTL_MS.pools, fetchTopPools),
    loadPositionSources(warnings),
  ])

  if (pools.length === 0) {
    warnings.push('The pool feed returned nothing. The upstream API may be rejecting this host.')
  }

  const identities: PoolIdentity[] = pools.map((pool) => ({ poolId: pool.poolAddress }))
  const { byPool } = buildIndex(positionSources, identities)

  // Wallet addresses are resolved to their configured labels here rather than in the table, so
  // the client never has to know which addresses are being tracked.
  const labels = new Map(trackedWallets().map((wallet) => [wallet.address, wallet.label]))

  // Pools the watcher saw appear carry a real age; the rest fall back to the window estimate.
  const firstSeen = getFirstSeen()

  let rows = pools.map((pool) =>
    toRow(
      pool,
      positionStateFor(byPool, pool.poolAddress),
      positionViaFor(byPool, pool.poolAddress),
      holdersFor(byPool, pool.poolAddress).map((holder) => ({
        label: labels.get(holder.wallet) ?? holder.wallet,
        address: holder.wallet,
        state: holder.state,
        via: holder.via,
      })),
      firstSeen.get(pool.poolAddress.toLowerCase()),
    ),
  )

  // Stage one: the composite score needs trade rate and trader counts, but those cost one
  // request per pool and only the leaders get them. Fees and TVL are known for every pool, so
  // a two factor pass picks which pools are worth measuring.
  const candidates = rankByScore(scorePools(rows, PRESELECT_WEIGHTS)).slice(0, ACTIVITY_POOL_LIMIT)

  let activity = new Map<string, Activity>()
  try {
    // Goes through the same cache-first path the route uses, so the eager pass and the browser
    // share measurements instead of each paying for its own.
    const measured = await loadActivityFor(
      candidates.map(({ poolId, protocol }) => ({ poolId, protocol })),
      ceilingSeconds,
    )
    activity = new Map(Object.entries(measured))
  } catch {
    warnings.push('Could not load transaction rates. Ranking falls back to fees and TVL only.')
  }

  rows = rows.map((row) => withActivity(row, activity.get(row.poolId.toLowerCase()) ?? null))

  // Stage two: score the measured pools on all four factors. Pools that were never measured
  // cannot be compared on rate or traders, so they are ranked below on fees and TVL alone.
  const measuredIds = new Set(candidates.map((row) => row.poolId))
  const measured = rows.filter((row) => measuredIds.has(row.poolId))
  const unmeasured = rows.filter((row) => !measuredIds.has(row.poolId))

  const scored = rankByScore(scorePools(measured)).map((row) => ({
    ...row,
    score: row.score,
    scoreParts: row.scoreParts,
  }))

  const ranked = [...scored, ...rankPools(unmeasured)]

  return {
    rows: ranked,
    totalPools: pools.length,
    walletsTracked: trackedWallets().length,
    activityCovered: measured.filter((row) => row.activity !== null).length,
    scoredCount: scored.length,
    warnings,
    fetchedAt: new Date().toISOString(),
  }
}
