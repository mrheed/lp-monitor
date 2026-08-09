import { z } from 'zod'
import { CHAIN_ID, PROTOCOL } from '../config'
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

/** Fetches and validates JSON, failing loudly so the caller can decide how to degrade. */
const getJson = async (url: string) => {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(`Krystal request failed: ${response.status} ${url}`)
  return response.json()
}

/** Fetches every tracked pool on the chain, newest stats included. */
export const fetchTopPools = async (): Promise<KrystalPool[]> => {
  const url = `${BASE}/lp_explorer/top_pools?chainId=${CHAIN_ID}&skipCheckAutomation=false&protocol=${PROTOCOL}`
  const { result } = krystalTopPoolsSchema.parse(await getJson(url))
  return result
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
    chainIds: String(CHAIN_ID),
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
