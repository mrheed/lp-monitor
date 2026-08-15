/**
 * Chains the tracker can follow.
 *
 * `slug` is Uniswap's path segment for the chain, used only for building explore links. The pool
 * feed itself is queried by numeric id.
 */
export type Chain = {
  id: number
  /** Short name shown in the table. */
  label: string
  slug: string
}

export const CHAINS: Chain[] = [
  { id: 4663, label: 'Robinhood', slug: 'robinhood' },
  { id: 1, label: 'Ethereum', slug: 'ethereum' },
  { id: 8453, label: 'Base', slug: 'base' },
  { id: 42161, label: 'Arbitrum', slug: 'arbitrum' },
  { id: 10, label: 'Optimism', slug: 'optimism' },
  { id: 137, label: 'Polygon', slug: 'polygon' },
]

const byId = new Map(CHAINS.map((chain) => [chain.id, chain]))

/** Looks up a chain, or undefined when the feed returns one that is not tracked. */
export const chainById = (id: number): Chain | undefined => byId.get(id)

/** A chain's short name, falling back to its id so an untracked chain is still identifiable. */
export const chainLabel = (id: number): string => byId.get(id)?.label ?? `Chain ${id}`

/**
 * Chains actually queried, set by LP_CHAINS as a comma separated list of ids.
 *
 * Defaults to every known chain. Each one costs a request per refresh and adds its pools to the
 * sweep, so an operator watching a single chain can narrow it rather than paying for the rest.
 * Unknown ids are dropped rather than queried, since the feed answers with an empty result for
 * chains it does not index and that is indistinguishable from a chain having no pools.
 */
export const enabledChains = (): Chain[] => {
  const configured = (process.env.LP_CHAINS ?? '')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((id) => Number.isFinite(id) && byId.has(id))

  if (configured.length === 0) return CHAINS

  // Ordered by the registry rather than by how the operator typed them, so the table's grouping
  // is stable across restarts.
  return CHAINS.filter((chain) => configured.includes(chain.id))
}

/**
 * Whether Uniswap's transaction feed carries trades for a protocol.
 *
 * The feed is Uniswap's own and indexes their v2, v3 and v4 pools. Krystal's pool list is far
 * broader: Base alone returns Aerodrome and PancakeSwap pools, and asking the transaction
 * endpoint about any of them returns an empty list rather than an error. Checking first turns a
 * silent blank into a pool that is simply never asked about.
 *
 * v2 is included on evidence: it was excluded at first on the assumption the feed covered only
 * concentrated liquidity, which wrote off 360 pools. Asking with PROTOCOL_VERSION_V2 returns
 * their trades normally.
 */
export const hasTransactionFeed = (protocol: string): boolean => {
  const name = protocol.toLowerCase()
  if (!name.startsWith('uniswap')) return false
  return name.includes('v2') || name.includes('v3') || name.includes('v4')
}
