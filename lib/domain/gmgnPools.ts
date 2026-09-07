import { cached } from '../cache'
import { CACHE_TTL_MS } from '../config'
import { enabledChains } from '../chains'
import { fetchGmgnPool, fetchGmgnTrending, type GmgnToken } from '../clients/gmgnMarket'
import { fetchTokenSecurityBatch } from '../clients/gmgn'
import { poolRisk } from './tokenRisk'
import { rankByScore, scorePools } from './score'
import { toGmgnRow } from './gmgnRows'
import type { PoolsSnapshot } from './pools'

/** GMGN's chain names, for the chains this tracker follows that it also serves. */
const GMGN_CHAIN: Record<number, string> = { 1: 'eth', 56: 'bsc', 8453: 'base', 4663: 'robinhood' }

/** Runs `task` over `items`, keeping at most `limit` in flight. */
const mapWithConcurrency = async <TIn, TOut>(
  items: TIn[],
  limit: number,
  task: (item: TIn) => Promise<TOut>,
): Promise<TOut[]> => {
  const results = new Array<TOut>(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Builds the table from GMGN alone, with no other upstream.
 *
 * What this source can and cannot do is a property of GMGN, not of this code, and the warnings
 * it returns say so on the page rather than only in a commit message:
 *
 * Its trending endpoint caps at 100 tokens per chain with no cursor, so this is the whole
 * universe rather than a first page. It reports one pool per token, its largest, so the sixteen
 * ETH/USDG pools that differ only by fee tier collapse to one row. And it publishes no fee
 * figure at all, which removes the column this tracker ranks on.
 *
 * What it adds over the other sources is the security verdict, which is read here for every row
 * rather than lazily, because a hundred rows is a size the whole table can be checked at.
 */
export const getGmgnSnapshot = async (): Promise<PoolsSnapshot> => {
  const warnings: string[] = []
  const chains = enabledChains().filter((chain) => chain.id in GMGN_CHAIN)

  const skipped = enabledChains().filter((chain) => !(chain.id in GMGN_CHAIN))
  if (skipped.length > 0) {
    warnings.push(
      `${skipped.map((chain) => chain.label).join(', ')} ${skipped.length === 1 ? 'is' : 'are'} not served by GMGN, so ${skipped.length === 1 ? 'its' : 'their'} pools are absent.`,
    )
  }

  const perChain = await Promise.all(
    chains.map(async (chain) => {
      const tokens = await fetchGmgnTrending(GMGN_CHAIN[chain.id])
      return tokens.map((token) => ({ chainId: chain.id, token }))
    }),
  )
  const listed = perChain.flat()

  if (listed.length === 0) {
    warnings.push('GMGN returned no tokens. Check that `gmgn-cli` is installed and configured.')
    return {
      rows: [],
      totalPools: 0,
      walletsTracked: 0,
      activityCovered: 0,
      scoredCount: 0,
      warnings,
      fetchedAt: new Date().toISOString(),
    }
  }

  // One pool lookup per token, which is the only way GMGN names a pool at all.
  // Three at a time, matching the security client: the API bans an IP that asks faster.
  const withPools = await mapWithConcurrency(listed, 3, async (entry) => {
    const pool = await fetchGmgnPool(GMGN_CHAIN[entry.chainId], entry.token.address)
    return pool === null ? null : toGmgnRow(entry.chainId, entry.token, pool)
  })

  const rows = withPools.filter((row): row is NonNullable<typeof row> => row !== null)

  // Every row's security verdict, read in one pass: a hundred per chain is small enough to check
  // whole, unlike the thousands the pool feed returns.
  const security = await fetchTokenSecurityBatch(
    rows.map((row) => ({ chainId: row.chainId, address: row.token0Address })),
  )
  for (const row of rows) {
    row.risk = poolRisk(security.get(row.token0Address.toLowerCase()) ?? null, null)
  }

  warnings.push(
    'Source: GMGN only. It publishes no fee data, so fee columns and the fee half of the score are absent.',
    `GMGN lists at most 100 tokens per chain and one pool per token, so this is ${rows.length} rows rather than the full pool set.`,
  )

  const scored = rankByScore(scorePools(rows))

  return {
    rows: scored,
    totalPools: rows.length,
    walletsTracked: 0,
    activityCovered: rows.filter((row) => row.activity !== null).length,
    scoredCount: scored.length,
    warnings,
    fetchedAt: new Date().toISOString(),
  }
}

/** The GMGN snapshot, cached on the same interval as the pool feed it stands in for. */
export const getCachedGmgnSnapshot = () =>
  cached('gmgn-pools', CACHE_TTL_MS.pools, getGmgnSnapshot)

/** Tokens GMGN listed but named no pool for, useful when diagnosing a short table. */
export const gmgnTokensWithoutPools = (tokens: GmgnToken[], rows: { poolId: string }[]) =>
  tokens.length - rows.length
