import { z } from 'zod'
import { chainById } from '../chains'
import type { TokenSecurity } from '../domain/tokenRisk'

/**
 * Runs the CLI, importing `node:child_process` only when a query actually happens.
 *
 * A static import broke the build. This module is reached from the alert watcher, which Next
 * compiles for the edge runtime as well as for Node, and edge has no child_process: the bundler
 * failed on the unhandled `node:` scheme before anything could run. `webpackIgnore` leaves the
 * specifier alone entirely, which is the same treatment undici needed in the Krystal client for
 * the same reason.
 *
 * Nothing calls this outside a Node server, so the import resolves wherever it is reached.
 */
/**
 * Shortest gap between two calls to the API.
 *
 * Set from a real ban rather than a guess: eight concurrent calls returned
 * `RATE_LIMIT_BANNED`, with the endpoint refusing every request from this IP for a stretch
 * afterwards. Spacing requests is what keeps a full table read inside the allowance, and it
 * matters more than parallelism because a ban stops every caller, not just the greedy one.
 */
const MIN_CALL_GAP_MS = 120

/** How long to wait after a rate-limit refusal before trying again, doubling each time. */
const RATE_LIMIT_BACKOFF_MS = 2_000

/** Attempts per call, so one refusal is survivable and a persistent one still ends. */
const RATE_LIMIT_ATTEMPTS = 3

/** The instant the next call may start. Shared by every caller in the process. */
let nextSlot = 0

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Waits for this call's turn, so concurrent callers still leave a gap between requests. */
const takeSlot = async () => {
  const now = Date.now()
  const start = Math.max(now, nextSlot)
  nextSlot = start + MIN_CALL_GAP_MS
  if (start > now) await sleep(start - now)
}

/** Whether a failure was the API refusing for rate reasons rather than a real error. */
const isRateLimited = (error: unknown): boolean => {
  const text = error instanceof Error ? `${error.message}` : String(error)
  return /RATE_LIMIT|429/i.test(text)
}

/**
 * Runs the CLI with rate limiting, returning null for anything that fails.
 *
 * Every GMGN call in the app goes through here, so the spacing and the backoff apply to the
 * whole process rather than to one feature.
 */
export const runGmgn = async (args: string[]): Promise<string | null> => {
  for (let attempt = 0; attempt < RATE_LIMIT_ATTEMPTS; attempt += 1) {
    await takeSlot()
    try {
      return await runCli(args)
    } catch (error) {
      if (!isRateLimited(error) || attempt === RATE_LIMIT_ATTEMPTS - 1) {
        // A missing CLI, an unconfigured key, a timeout: the caller treats null as unread.
        return null
      }
      await sleep(RATE_LIMIT_BACKOFF_MS * 2 ** attempt)
    }
  }

  return null
}

const runCli = async (args: string[]): Promise<string> => {
  const { execFile } = await import(/* webpackIgnore: true */ 'node:child_process')
  const { promisify } = await import(/* webpackIgnore: true */ 'node:util')

  const { stdout } = await promisify(execFile)('gmgn-cli', args, {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  })

  return stdout
}

/**
 * GMGN's own name for each chain, which is not the numeric id.
 *
 * Only the chains it serves appear here; a pool on any other chain is left unchecked rather
 * than queried with a name the CLI would reject.
 */
const GMGN_CHAIN: Record<number, string> = {
  1: 'eth',
  56: 'bsc',
  8453: 'base',
  4663: 'robinhood',
}

/** Whether GMGN can be asked about a chain at all. */
export const gmgnSupportsChain = (chainId: number): boolean => chainId in GMGN_CHAIN

/**
 * Whether a value is shaped like an address and therefore safe to pass as a CLI argument.
 *
 * This is a security boundary, not a formatting nicety. The address below becomes an element of
 * an argv, and while `execFile` spawns no shell — so `;` and `$()` are inert — a value beginning
 * with a dash is still read by the CLI as a FLAG rather than as the address: passing
 * `--address --version` made gmgn-cli print its version and exit 0 instead of querying anything.
 * The value arrives from a request body, so it is matched against the shape an address actually
 * has rather than filtered for characters known to be dangerous.
 */
export const isQueryableAddress = (address: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(address)

/**
 * The security fields this tracker reads, as the CLI returns them.
 *
 * Everything is optional and nullable: GMGN returns null for a check it could not run, omits
 * fields entirely on some chains, and the difference between "false" and "absent" decides
 * whether a token reads as clear or unchecked.
 */
const securitySchema = z.object({
  address: z.string().default(''),
  is_honeypot: z.boolean().nullish(),
  is_show_alert: z.boolean().nullish(),
  is_open_source: z.boolean().nullish(),
  is_blacklist: z.boolean().nullish(),
  buy_tax: z.union([z.string(), z.number()]).nullish(),
  sell_tax: z.union([z.string(), z.number()]).nullish(),
  top_10_holder_rate: z.union([z.string(), z.number()]).nullish(),
})

/** A percentage that may arrive as a string, a number, or not at all. */
const percent = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** A boolean that may be absent, which is not the same as false. */
const flag = (value: boolean | null | undefined): boolean | null => value ?? null

/**
 * Reads one token's security fields through the GMGN CLI.
 *
 * The CLI rather than the HTTP API because it owns the API key and the request signing; the
 * key lives in the operator's `~/.config/gmgn/.env` and never passes through this process.
 *
 * Returns null for anything that fails, including an unsupported chain, a missing CLI and an
 * unconfigured key. A null here means unchecked, and the risk layer above is careful never to
 * read that as safe.
 */
export const fetchTokenSecurity = async (
  chainId: number,
  address: string,
): Promise<TokenSecurity | null> => {
  const chain = GMGN_CHAIN[chainId]
  if (!chain) return null
  // Refused before the process is spawned: an unrecognised value is unchecked, never trusted.
  if (!isQueryableAddress(address)) return null

  try {
    const stdout = await runGmgn(['token', 'security', '--chain', chain, '--address', address])
    if (stdout === null) return null

    const parsed = securitySchema.safeParse(JSON.parse(stdout))
    if (!parsed.success) return null

    const raw = parsed.data
    return {
      address: raw.address || address,
      isHoneypot: flag(raw.is_honeypot),
      showsAlert: flag(raw.is_show_alert),
      isOpenSource: flag(raw.is_open_source),
      isBlacklisted: flag(raw.is_blacklist),
      buyTaxPercent: percent(raw.buy_tax),
      sellTaxPercent: percent(raw.sell_tax),
      topTenHolderRate: percent(raw.top_10_holder_rate),
    }
  } catch {
    // A missing CLI, an unconfigured key, a timeout: all mean unchecked, never safe.
    return null
  }
}

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
 * How many CLI processes to keep in flight.
 *
 * Lowered from eight after eight concurrent calls earned a `RATE_LIMIT_BANNED` response that
 * refused every later request from this IP. The endpoint parallelises fine locally; the ceiling
 * is the API's allowance, which the shared gap in `runGmgn` is what actually enforces.
 */
const GMGN_CONCURRENCY = 3

/** Reads several tokens at once, keyed by lowercased address. */
export const fetchTokenSecurityBatch = async (
  targets: { chainId: number; address: string }[],
): Promise<Map<string, TokenSecurity>> => {
  const askable = targets.filter(
    (target) => gmgnSupportsChain(target.chainId) && isQueryableAddress(target.address),
  )

  const entries = await mapWithConcurrency(askable, GMGN_CONCURRENCY, async (target) => {
    const security = await fetchTokenSecurity(target.chainId, target.address)
    return security === null ? null : ([target.address.toLowerCase(), security] as const)
  })

  return new Map(entries.filter((entry): entry is [string, TokenSecurity] => entry !== null))
}

/** Names a chain GMGN cannot answer for, so the UI can say why a pool is unchecked. */
export const unsupportedChainNote = (chainId: number): string =>
  `${chainById(chainId)?.label ?? `Chain ${chainId}`} is not covered by the security feed`
