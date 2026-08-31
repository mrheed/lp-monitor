/**
 * Robinhood Chain RPC endpoints, configurable without editing the source.
 *
 * The two public endpoints below were both failing when last checked, which takes down every
 * on-chain read the app makes. An operator with their own provider should be able to point the
 * app at it, so the configured endpoint leads and the public ones stay behind it as fallbacks
 * rather than being replaced.
 */

/** The public endpoints, used when nothing is configured. Ordered by which answered more often. */
export const ROBINHOOD_FALLBACK_RPCS = [
  'https://rpc.arrowrpc.com',
  'https://rpc.mainnet.chain.robinhood.com',
] as const

/** A trimmed environment value, or null when it is absent or blank. */
const configured = (name: string): string | null => {
  const value = process.env[name]?.trim()
  return value ? value : null
}

/**
 * The endpoints to try, best first.
 *
 * Two variables rather than one, because the two callers sit on opposite sides of the network.
 * `ROBINHOOD_RPC_URL` is read on the server only, so a provider key in it never reaches a
 * browser. `NEXT_PUBLIC_ROBINHOOD_RPC_URL` is inlined into the client bundle by Next, which is
 * what the wallet connector needs to use a private endpoint, and also means anyone loading the
 * page can read the key. Set the private one alone unless the browser genuinely needs it too.
 */
export const robinhoodRpcUrls = (): string[] => {
  const preferred = configured('ROBINHOOD_RPC_URL') ?? configured('NEXT_PUBLIC_ROBINHOOD_RPC_URL')
  if (preferred === null) return [...ROBINHOOD_FALLBACK_RPCS]

  // Deduplicated so configuring one of the public endpoints explicitly does not list it twice.
  return [preferred, ...ROBINHOOD_FALLBACK_RPCS.filter((url) => url !== preferred)]
}

/** The single endpoint server-side readers use. */
export const robinhoodRpcUrl = (): string => robinhoodRpcUrls()[0]
