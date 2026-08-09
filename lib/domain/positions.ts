import type { PositionState } from '../types'

/**
 * A position a wallet holds directly, carrying the pool id the pool feed uses.
 *
 * Sourced from `lp/userPositions`, which reports `pool.id`: a 20 byte address for v3 and the
 * 32 byte pool id for v4. The `strategies/profile` feed was tried here first and cannot work,
 * because for v4 it reports the PoolManager singleton, the same address for every v4 pool on
 * the chain, and carries no pool id at all.
 */
export type DirectPosition = {
  /** Which tracked wallet this position belongs to. */
  wallet: string
  poolId: string
  status: string
}

/** A pool held inside a vault, which always carries a real 32 byte id. */
export type VaultPool = {
  /** Which tracked wallet owns the vault holding this pool. */
  wallet: string
  id: string
  exited: boolean
}

/** The minimum a pool must expose to be matched against a position. */
export type PoolIdentity = {
  poolId: string
}

/** How a wallet is exposed to a pool: directly, or through a vault holding it. */
export type PositionVia = 'direct' | 'vault'

/** One wallet's involvement in a pool. */
export type PositionHolder = {
  wallet: string
  state: Exclude<PositionState, 'none'>
  via: PositionVia
}

export type PositionMatch = {
  /** Strongest state across every holder: open wins over closed. */
  state: PositionState
  via: PositionVia
  holders: PositionHolder[]
}

export type PositionIndex = {
  byPool: Map<string, PositionMatch>
  /** Direct positions whose pool is not in the pool feed at all. */
  unmatched: number
}

const normalise = (value: string) => value.toLowerCase()

/**
 * Folds one holder into a pool's entry.
 *
 * Open beats closed for the pool's headline state, so a pool one wallet still holds never reads
 * as merely historical because another wallet closed out. Each wallet keeps its own state in
 * `holders`, and a wallet appearing twice for the same pool keeps its strongest.
 */
const withHolder = (existing: PositionMatch | undefined, holder: PositionHolder): PositionMatch => {
  const others = (existing?.holders ?? []).filter((entry) => entry.wallet !== holder.wallet)
  const previous = existing?.holders.find((entry) => entry.wallet === holder.wallet)
  const merged = previous?.state === 'open' ? previous : holder
  const holders = [...others, merged]

  return {
    state: holders.some((entry) => entry.state === 'open') ? 'open' : 'closed',
    via: holders.find((entry) => entry.state === 'open')?.via ?? merged.via,
    holders,
  }
}

/**
 * Builds the pool to position index the checklist reads.
 *
 * Vault holdings are treated as positions in the underlying pools, since the wallet is exposed
 * to them either way. A vault position that has been closed counts as historical.
 *
 * Both sources carry a real pool id, so this is a direct join with no guessing.
 */
export const buildPositionIndex = (
  directPositions: DirectPosition[],
  vaultPools: VaultPool[],
  pools: PoolIdentity[],
): PositionIndex => {
  const known = new Set(pools.map((pool) => normalise(pool.poolId)))

  const byPool = new Map<string, PositionMatch>()
  let unmatched = 0

  for (const position of directPositions) {
    const key = normalise(position.poolId)

    // A position in a pool the feed does not list cannot be shown against a row.
    if (known.size > 0 && !known.has(key)) {
      unmatched += 1
      continue
    }

    const state = position.status.toUpperCase() === 'CLOSED' ? 'closed' : 'open'
    byPool.set(key, withHolder(byPool.get(key), { wallet: position.wallet, state, via: 'direct' }))
  }

  for (const pool of vaultPools) {
    const key = normalise(pool.id)
    const state = pool.exited ? 'closed' : 'open'
    byPool.set(key, withHolder(byPool.get(key), { wallet: pool.wallet, state, via: 'vault' }))
  }

  return { byPool, unmatched }
}

/** Looks up a pool's position state, defaulting to `none` when the wallet was never in it. */
export const positionStateFor = (
  byPool: Map<string, PositionMatch>,
  poolId: string,
): PositionState => byPool.get(normalise(poolId))?.state ?? 'none'

/** Looks up how the wallet reached a pool, or null when it never held it. */
export const positionViaFor = (
  byPool: Map<string, PositionMatch>,
  poolId: string,
): PositionVia | null => byPool.get(normalise(poolId))?.via ?? null

/** Lists which wallets hold or held a pool, ordered open first then by wallet. */
export const holdersFor = (
  byPool: Map<string, PositionMatch>,
  poolId: string,
): PositionHolder[] => {
  const holders = byPool.get(normalise(poolId))?.holders ?? []

  return [...holders].sort(
    (a, b) =>
      Number(b.state === 'open') - Number(a.state === 'open') || a.wallet.localeCompare(b.wallet),
  )
}
