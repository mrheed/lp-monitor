/**
 * Robinhood Chain RPC endpoints, configurable without editing the source.
 *
 * Both public endpoints for this chain were failing when last checked, which takes down every
 * on-chain read the app makes. An operator with their own provider points the app at it here, so
 * the configured endpoint leads and what remains public stays behind it rather than being
 * replaced.
 */

/**
 * The public endpoint, used when nothing is configured.
 *
 * `rpc.arrowrpc.com` was here and has been dropped: it answers every request with Cloudflare
 * 1033, so leaving it first meant every on-chain read waited for a failure before trying anything
 * else. The official endpoint below was also refusing connections when last checked, which is why
 * configuring your own is worth doing rather than optional.
 */
export const ROBINHOOD_FALLBACK_RPCS = ['https://rpc.mainnet.chain.robinhood.com'] as const

/** A trimmed value, or null when it is absent or blank. */
const usable = (value: string | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
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
  /*
   * Read as literal member expressions, never `process.env[name]`.
   *
   * Next substitutes NEXT_PUBLIC_ variables into the client bundle at build time, and only where
   * it can see the name in the source. A dynamic key is invisible to that pass, so in the browser
   * it resolved to undefined and the wallet silently fell through to the public endpoint however
   * the environment was set.
   */
  const preferred =
    usable(process.env.ROBINHOOD_RPC_URL) ?? usable(process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL)
  if (preferred === null) return [...ROBINHOOD_FALLBACK_RPCS]

  // Deduplicated so configuring one of the public endpoints explicitly does not list it twice.
  return [preferred, ...ROBINHOOD_FALLBACK_RPCS.filter((url) => url !== preferred)]
}

/** The single endpoint server-side readers use. */
export const robinhoodRpcUrl = (): string => robinhoodRpcUrls()[0]
