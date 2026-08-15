import { z } from 'zod'
import { enabledChains } from '../chains'
import { krystalTopPoolsSchema, type KrystalPool } from '../types'
import type { DirectPosition, VaultPool } from '../domain/positions'

const BASE = 'https://api.krystal.app/all/v2'
const V1 = 'https://api.krystal.app/all/v1'

const userPositionsSchema = z.object({
  positions: z
    .array(
      z.object({
        status: z.string().default(''),
        pool: z.object({ id: z.string().default('') }),
      }),
    )
    .nullish()
    .transform((rows) => rows ?? []),
})

const vaultListSchema = z.object({
  data: z
    .array(z.object({ chainId: z.number(), vaultAddress: z.string() }))
    .nullish()
    .transform((rows) => rows ?? []),
})

const vaultDetailSchema = z.object({
  // `strategies` is what the vault actually holds, each with its own status. The sibling
  // `pools` array lists every pool the vault has ever touched and carries no status, so
  // reading it marks closed positions as open.
  strategies: z
    .array(
      z.object({
        status: z.string().default(''),
        pool: z.object({ id: z.string().default('') }),
      }),
    )
    .nullish()
    .transform((rows) => rows ?? []),
})

/**
 * Headers a browser would send.
 *
 * The API sits behind Cloudflare, which scores a bare request more harshly than one that looks
 * like the dashboard's own. This does not defeat a challenge, but it avoids inviting one.
 */
const BROWSER_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  origin: 'https://defi.krystal.app',
  referer: 'https://defi.krystal.app/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
}

/** Raised when Cloudflare answers with a challenge instead of the API. */
export class ChallengeError extends Error {
  constructor(url: string) {
    super(
      `Krystal returned a Cloudflare challenge rather than data (${url}). ` +
        'The host IP is being challenged; datacenter ranges are treated far more harshly than ' +
        'residential ones. Set KRYSTAL_PROXY_URL to route these requests elsewhere.',
    )
    this.name = 'ChallengeError'
  }
}

/** The little a caller needs from a response, so both fetch implementations can supply it. */
type Fetched = {
  ok: boolean
  status: number
  contentType: string
  json: () => Promise<unknown>
}

/**
 * The proxy agent, resolved once. `undefined` means not yet asked, `null` means none wanted.
 *
 * A fresh agent per request opens a fresh connection pool and loses the benefit of keeping one
 * open, so the resolution is cached either way.
 */
let agent: unknown | null | undefined

/** True when requests are being routed somewhere other than this host. */
export const usingProxy = () => Boolean(process.env.KRYSTAL_PROXY_URL)

/**
 * Fetches a URL, through a proxy when one is configured.
 *
 * undici is imported lazily rather than at the top of the file because its entry point reaches
 * `node:console`, which the bundler cannot resolve when this module is pulled into the server
 * instrumentation bundle. Most runs set no proxy and never load it at all.
 *
 * Each branch keeps its own library's types and returns the same small shape, so neither has to
 * be cast into agreement with the other.
 *
 * Cloudflare scores the requesting IP, and a datacenter range is treated far more harshly than a
 * residential one, so the same code that works from a laptop can be challenged from a host. A
 * proxy moves where the request appears to come from, which is the part being judged.
 */
const fetchThrough = async (url: string): Promise<Fetched> => {
  const proxyUrl = process.env.KRYSTAL_PROXY_URL

  if (!proxyUrl) {
    const response = await fetch(url, { headers: BROWSER_HEADERS, cache: 'no-store' })
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      json: () => response.json(),
    }
  }

  // `webpackIgnore` leaves this import alone entirely. Marking undici as a server external
  // package was not enough: the bundler still analysed the specifier, followed it into
  // `node:console`, and failed the instrumentation build before the watcher could start.
  const { ProxyAgent, fetch: undiciFetch } = await import(/* webpackIgnore: true */ 'undici')
  if (agent === undefined) agent = new ProxyAgent(proxyUrl)

  const response = await undiciFetch(url, {
    headers: BROWSER_HEADERS,
    dispatcher: agent instanceof ProxyAgent ? agent : new ProxyAgent(proxyUrl),
  })

  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    json: () => response.json(),
  }
}

const getJson = async (url: string) => {
  const response = await fetchThrough(url)

  if (response.contentType.includes('text/html')) throw new ChallengeError(url)
  if (!response.ok) throw new Error(`Krystal request failed: ${response.status} ${url}`)

  return response.json()
}

/** Fetches every pool the feed lists for one chain, newest stats included. */
const fetchChainPools = async (chainId: number): Promise<KrystalPool[]> => {
  const url = `${BASE}/lp_explorer/top_pools?chainId=${chainId}&skipCheckAutomation=false`
  const { result } = krystalTopPoolsSchema.parse(await getJson(url))
  return result
}

/**
 * Fetches every tracked pool across every enabled chain.
 *
 * The `protocol` query parameter is not sent because the endpoint ignores it: asking Base for
 * `uniswapv4`, for `aerodrome`, or for nothing at all returns the same 761 pools spanning six
 * protocols. Sending it would suggest a filter that does not exist.
 *
 * Chains are fetched together rather than in sequence, since they share nothing but the merge.
 * One chain failing takes the whole refresh down deliberately: a partial pool list would rank
 * pools against an incomplete cohort, and the score is a percentile within whatever it is given.
 */
export const fetchTopPools = async (): Promise<KrystalPool[]> => {
  const perChain = await Promise.all(enabledChains().map((chain) => fetchChainPools(chain.id)))
  return perChain.flat()
}

/**
 * Fetches one page of a wallet's direct positions for a single status.
 *
 * Only `pool.id` identifies the pool. The sibling `pool.poolAddress` is the v4 PoolManager
 * singleton, identical for every v4 pool on the chain, so joining on it matches nothing.
 */
const fetchDirectPositionsByStatus = async (
  wallet: string,
  status?: 'closed',
): Promise<DirectPosition[]> => {
  const params = new URLSearchParams({
    addresses: wallet,
    walletAddress: wallet,
    chainIds: enabledChains()
      .map((chain) => chain.id)
      .join(','),
    quoteSymbols: 'usd',
    limit: '200',
  })
  if (status) params.set('positionStatus', status)

  const { positions } = userPositionsSchema.parse(
    await getJson(`${BASE}/lp/userPositions?${params}`),
  )

  return positions
    .filter((entry) => entry.pool.id)
    .map((entry) => ({ wallet, poolId: entry.pool.id, status: entry.status }))
}

/**
 * Fetches a wallet's direct positions, open and closed.
 *
 * Only open positions come back by default, so closed history needs its own call. This endpoint
 * is used in place of `strategies/profile`, which reports no pool id for v4 at all: on this
 * chain ETH/USDG alone spans sixteen v4 pools, so a token pair cannot identify one.
 */
const fetchDirectPositions = async (wallet: string): Promise<DirectPosition[]> => {
  const [open, closed] = await Promise.all([
    fetchDirectPositionsByStatus(wallet),
    fetchDirectPositionsByStatus(wallet, 'closed'),
  ])

  return [...open, ...closed]
}

/** Lists a wallet's vaults for one exited state. */
const fetchVaultList = async (wallet: string, isExited: boolean) => {
  const params = new URLSearchParams({
    ownerAddress: wallet,
    userAddress: '',
    isExited: String(isExited),
    vaultTypes: 'autofarm',
    page: '0',
    perPage: '5000',
  })

  const { data } = vaultListSchema.parse(await getJson(`${V1}/vaults/profile?${params}`))
  return data.map((vault) => ({ ...vault, exited: isExited }))
}

/**
 * Fetches the positions one vault holds, each with its own open or closed status.
 *
 * Only `pool.id` is read: the sibling `pool.poolAddress` is the Uniswap v4 PoolManager
 * singleton, identical for every v4 pool on the chain, so joining on it would match nothing.
 */
const fetchVaultPositions = async (chainId: number, vaultAddress: string, wallet: string) => {
  const url = `${V1}/vaults/${chainId}/${vaultAddress}?userAddress=${wallet}`
  const { strategies } = vaultDetailSchema.parse(await getJson(url))

  return strategies
    .filter((entry) => entry.pool.id)
    .map((entry) => ({
      wallet,
      id: entry.pool.id,
      exited: entry.status.toUpperCase() === 'CLOSED',
    }))
}

/**
 * Collects every pool a wallet is exposed to through a vault, live and exited.
 *
 * Both vault exited states are queried because historical exposure is wanted, but each
 * position's own status decides whether it counts as open, since a live vault routinely holds
 * closed positions alongside its active one.
 */
const fetchAllVaultPositions = async (wallet: string): Promise<VaultPool[]> => {
  const vaults = (
    await Promise.all([fetchVaultList(wallet, false), fetchVaultList(wallet, true)])
  ).flat()

  const seen = new Set<string>()
  const unique = vaults.filter((vault) => {
    const key = `${vault.chainId}:${vault.vaultAddress.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const perVault = await Promise.all(
    unique.map((vault) => fetchVaultPositions(vault.chainId, vault.vaultAddress, wallet)),
  )

  return perVault.flat()
}

const tokenAmountsSchema = z
  .array(
    z.object({
      token: z.object({
        address: z.string().default(''),
        symbol: z.string().default(''),
        decimals: z.number().default(18),
      }),
      balance: z.string().default('0'),
      quotes: z
        .object({ usd: z.object({ value: z.number().default(0) }).partial() })
        .partial()
        .default({}),
    }),
  )
  .default([])

const addablePositionSchema = z.object({
  tokenId: z.string().default(''),
  /** The position manager contract that minted this position's NFT. */
  tokenAddress: z.string().default(''),
  chainId: z.number(),
  status: z.string().default(''),
  liquidity: z.string().default('0'),
  currentPositionValue: z.number().default(0),
  minPrice: z.number().default(0),
  maxPrice: z.number().default(0),
  currentAmounts: tokenAmountsSchema,
  /** Fees earned but not yet collected. An increase collects them as a side effect. */
  feePending: tokenAmountsSchema,
  pool: z.object({
    id: z.string().default(''),
    hooks: z.string().default(''),
  }),
})

const addablePositionsSchema = z.object({
  positions: z.array(addablePositionSchema).nullish().transform((rows) => rows ?? []),
})

export type AddablePosition = z.infer<typeof addablePositionSchema> & { wallet: string }

/**
 * Fetches a wallet's open positions in one pool, with the details an increase transaction needs.
 *
 * Separate from the slim positions fetch that drives the held column: that one keeps only pool
 * id and status for thousands of rows, while this one preserves tokenId, the manager address,
 * raw amounts and liquidity for the handful of positions in a single pool.
 */
export const fetchAddablePositions = async (
  wallet: string,
  poolId: string,
): Promise<AddablePosition[]> => {
  const params = new URLSearchParams({
    addresses: wallet,
    walletAddress: wallet,
    chainIds: enabledChains()
      .map((chain) => chain.id)
      .join(','),
    quoteSymbols: 'usd',
    limit: '200',
  })

  const { positions } = addablePositionsSchema.parse(
    await getJson(`${BASE}/lp/userPositions?${params}`),
  )

  const wanted = poolId.toLowerCase()
  return positions
    .filter((entry) => entry.pool.id.toLowerCase() === wanted)
    .filter((entry) => entry.status.toUpperCase() !== 'CLOSED' && entry.liquidity !== '0')
    .map((entry) => ({ ...entry, wallet }))
}

/** Fetches direct and vault held positions for every tracked wallet, tagged by wallet. */
export const fetchWalletPositions = async (wallets: string[]) => {
  const perWallet = await Promise.all(
    wallets.map(async (wallet) => ({
      directPositions: await fetchDirectPositions(wallet),
      vaultPools: await fetchAllVaultPositions(wallet),
    })),
  )

  return {
    directPositions: perWallet.flatMap((entry) => entry.directPositions),
    vaultPools: perWallet.flatMap((entry) => entry.vaultPools),
  }
}
