# Stock Pools Tab, Volume History and Spike Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/stocks` route that lists the 214 tokenized-equity pools on Robinhood Chain, charts their hourly volume read from Uniswap, and fires a Telegram alert when a pool's volume departs from its own trailing baseline.

**Architecture:** A frozen address allowlist identifies stock pools. A sampler reads the Uniswap transaction feed into 48 hourly buckets per pool, persisted to a JSON file following the existing `alertStore` pattern. A pure detector compares the newest bucket against the trailing median and hands spikes to the alert watcher already running. The route reuses `getPoolsSnapshot` filtered through the allowlist, so it costs no extra pool fetch.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Zod, Vitest, Tailwind, bun.

**Spec:** `docs/superpowers/specs/2026-08-31-stock-pools-volume-design.md`

## Global Constraints

- Package manager is **bun**. Run tests with `bun run test`, types with `bun run typecheck`. Never run `bun run dev` or `bun run build`.
- **TDD is mandatory.** Every task writes a failing test first, watches it fail, then implements. No exceptions for UI.
- **No `as <Type>` casts** to silence the type checker. `as const` is allowed. Narrow with type guards or fix the type at its source.
- **Separation of concerns.** Route handlers read input, call one domain function, map the result or a typed error to a response. No logic in handlers. All network and file IO lives in `lib/clients/` or a store module.
- **Comment every function** you create. Concise by default; explain *why*, not *how*.
- **No emdashes** anywhere, including code comments and commit messages. Use a semicolon, a comma, parentheses, or restructure.
- Imports are ES modules, destructured where possible.
- Test files sit beside the module they test as `<name>.test.ts`, matching `lib/domain/feeWindow.test.ts`.
- Commit after every task.

---

### Task 1: Stock token allowlist

**Files:**
- Create: `lib/domain/stockTokens.ts`
- Test: `lib/domain/stockTokens.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `isStockToken(address: string): boolean`, `stockTicker(address: string): string | null`, `isStockPool(pool: { token0Address: string; token1Address: string }): boolean`, `STOCK_TOKEN_COUNT: number`

- [ ] **Step 1: Write the failing test**

Create `lib/domain/stockTokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { STOCK_TOKEN_COUNT, isStockPool, isStockToken, stockTicker } from './stockTokens'

// Every symbol below exists on Robinhood Chain as both an issued equity and an unrelated
// memecoin, which is why identification is by address and never by symbol.
const ISSUED = {
  NVDA: '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec',
  GME: '0x1b0e319c6a659f002271b69db8a7df2f911c153e',
  COIN: '0x6330d8c3178a418788df01a47479c0ce7ccf450b',
  MU: '0xff080c8ce2e5feadaca0da81314ae59d232d4afd',
  SNDK: '0xb90a19ff0af67f7779aff50a882a9cff42446400',
  AMC: '0x05a3d1cd21d0c88145e82600e62e7e496e0f222b',
}

const MEMECOINS = {
  GME: '0x7e86381a763f0ecca2bdf27c54eac403ddd48123',
  COIN: '0x3df44cf14a20d3e3d44fbaabce27126f0e908e83',
  MU: '0x2a921859109eac8784a6ffc9d86d2583390b3065',
  SNDK: '0x2bbd7874fe57cedcb92d71fc13fe9f1ba41877d9',
  AMC: '0x6055706234dd0cc9965400296f2ca950941f6253',
}

const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'

describe('isStockToken', () => {
  it('accepts every issued equity contract', () => {
    for (const address of Object.values(ISSUED)) expect(isStockToken(address)).toBe(true)
  })

  it('rejects the memecoins sharing those tickers', () => {
    for (const address of Object.values(MEMECOINS)) expect(isStockToken(address)).toBe(false)
  })

  it('rejects HOOD, which exists only as memecoins on this chain', () => {
    expect(isStockToken('0x32ac8c1d7672667d5ebdea22935f7b06fc8d496f')).toBe(false)
    expect(isStockToken('0xdaa8f3f54c66e9be2c44c1b6b566cbd07229ced3')).toBe(false)
  })

  it('is case insensitive, since the feeds disagree on checksumming', () => {
    expect(isStockToken(ISSUED.NVDA.toUpperCase().replace('0X', '0x'))).toBe(true)
  })

  it('rejects the quote assets', () => {
    expect(isStockToken(WETH)).toBe(false)
    expect(isStockToken(USDG)).toBe(false)
  })
})

describe('stockTicker', () => {
  it('names the issued contract', () => {
    expect(stockTicker(ISSUED.NVDA)).toBe('NVDA')
  })

  it('yields null for a contract that is not an issued equity', () => {
    expect(stockTicker(MEMECOINS.GME)).toBeNull()
  })
})

describe('isStockPool', () => {
  it('matches when either side is an issued equity', () => {
    expect(isStockPool({ token0Address: WETH, token1Address: ISSUED.NVDA })).toBe(true)
    expect(isStockPool({ token0Address: ISSUED.GME, token1Address: USDG })).toBe(true)
  })

  it('does not match a memecoin pool wearing a ticker', () => {
    expect(isStockPool({ token0Address: WETH, token1Address: MEMECOINS.GME })).toBe(false)
  })
})

describe('STOCK_TOKEN_COUNT', () => {
  it('holds the 47 contracts Robinhood has issued on this chain', () => {
    expect(STOCK_TOKEN_COUNT).toBe(47)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/domain/stockTokens.test.ts`
Expected: FAIL, cannot resolve `./stockTokens`.

- [ ] **Step 3: Write the implementation**

Create `lib/domain/stockTokens.ts`:

```ts
/**
 * The tokenized equities and ETFs Robinhood has issued on Robinhood Chain, by contract address.
 *
 * Identification is by address rather than by symbol because ticker-shaped symbols are the house
 * style on this chain and they collide: `HOOD` resolves to six unrelated memecoin contracts and
 * none of them is Robinhood stock, while `COIN`, `GME`, `NET`, `MU`, `SNDK` and `AMC` each exist
 * as both an issued equity and a memecoin. A symbol match would be wrong in both directions.
 *
 * The list was derived once from Krystal's logo slugs, where an issued equity's filename ends in
 * `robinhood-tokenized-stock` or `robinhood-token`, and confirmed against Uniswap's transaction
 * feed, which names the same 47 contracts `... • Robinhood Token`. The derivation is deliberately
 * not shipped: a CDN filename is not a contract and can change, whereas these addresses cannot.
 * A newly listed ticker is added here by hand.
 */
const STOCK_TOKENS = new Map<string, string>([
  ['0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', 'AAPL'], // Apple
  ['0x05a3d1cd21d0c88145e82600e62e7e496e0f222b', 'AMC'], // AMC Entertainment Holdings
  ['0x86923f96303d656e4aa86d9d42d1e57ad2023fdc', 'AMD'], // AMD
  ['0x12f190a9f9d7d37a250758b26824b97ce941bf54', 'AMZN'], // Amazon
  ['0x47f93d52cbec7c6d2cfc080e154002370a60daea', 'ASML'], // ASML Holding NV
  ['0xad25ac6c84d497db898fa1e8387bf6af3532a1c4', 'BABA'], // Alibaba
  ['0x48e39e56acdba37b09020c0b734a613c9a2f100a', 'BB'], // BlackBerry
  ['0x6330d8c3178a418788df01a47479c0ce7ccf450b', 'COIN'], // Coinbase
  ['0x4ea005168d7f09a7a0ba9d1def21a479950e44c2', 'COST'], // Costco
  ['0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5', 'CRCL'], // Circle Internet Group
  ['0x5f10a1c971b69e47e059e1dc91901b59b3fb49c3', 'CRWV'], // CoreWeave
  ['0x1d11f0496982706c5e14a514d4e79f2e6bde4516', 'DJT'], // Trump Media and Technology Group
  ['0xc9a981fee1f9dec688bb123ccdecc63d0debfc4e', 'GLD'], // SPDR Gold Shares
  ['0x2d427692e928fa156ec22acfabafa0447c5805b7', 'GLXY'], // Galaxy Digital
  ['0x1b0e319c6a659f002271b69db8a7df2f911c153e', 'GME'], // GameStop
  ['0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3', 'GOOGL'], // Alphabet Class A
  ['0xccee82fe024c36fa15e1005ede3e9e4787e23d09', 'HIMS'], // Hims and Hers Health
  ['0xc72b96e0e48ecd4dc75e1e45396e26300bc39681', 'INTC'], // Intel
  ['0xc0d6457c16cc70d6790dd43521c899c87ce02f35', 'META'], // Meta Platforms
  ['0x43b07d15ce533bec5476d70c22a78a1b2b662155', 'MRNA'], // Moderna
  ['0xe93237c50d904957cf27e7b1133b510c669c2e74', 'MSFT'], // Microsoft
  ['0xec262a75e413fafd0df80480274532c79d42da09', 'MSTR'], // Strategy
  ['0xff080c8ce2e5feadaca0da81314ae59d232d4afd', 'MU'], // Micron Technology
  ['0x116f00968269b7bfbad4109ce591d6e74c0601d4', 'NET'], // Cloudflare
  ['0xe0444ef8bf4ed74f74fd73686e2ddf4c1c5591e8', 'NFLX'], // Netflix
  ['0x408c14038a04f7bd235329e26d2bf569ee20e250', 'NU'], // Nu Holdings
  ['0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', 'NVDA'], // Nvidia
  ['0xb0992820e760d836549ba69bc7598b4af75dee03', 'ORCL'], // Oracle
  ['0x1cdad396db64bda184d5182a97dd9b3c62100b7d', 'P'], // Everpure
  ['0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a', 'PLTR'], // Palantir Technologies
  ['0xd5f3879160bc7c32ebb4dc785f8a4f505888de68', 'QQQ'], // Invesco QQQ
  ['0x59818904ab4ce163b3ce4ffb64f2d6ca02c434b4', 'QUBT'], // Quantum Computing
  ['0xf0c4bf4c582cb3836e98394b1d4e7b7281101be8', 'RBLX'], // Roblox
  ['0x05b37fb53a299a1b874a619e1c4c404d52c36f4c', 'RDDT'], // Reddit
  ['0x92fd66527192e3e61d4ddd13322aa222de86f9b5', 'SGOV'], // iShares 0-3 Month Treasury Bond ETF
  ['0x84cab63bc87912e71ad199ff14a0ba45de68fef8', 'SKHY'], // SK Hynix
  ['0x411efb0e7f985935daec3d4c3ebaea0d0ad7d89f', 'SLV'], // iShares Silver Trust
  ['0xb90a19ff0af67f7779aff50a882a9cff42446400', 'SNDK'], // SanDisk
  ['0xba0cab75495255d0cb58e22b648bfed4ecd1f47e', 'SNOW'], // Snowflake
  ['0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea', 'SPCX'], // SpaceX
  ['0x117cc2133c37b721f49de2a7a74833232b3b4c0c', 'SPY'], // SPDR S&P 500 ETF Trust
  ['0x322f0929c4625ed5bad873c95208d54e1c003b2d', 'TSLA'], // Tesla
  ['0x58ffe4a942d3885baa22d7520691f611ef09e7aa', 'TSM'], // Taiwan Semiconductor Manufacturing
  ['0x5e81213613b6b86eab4c6c50d718d34359459786', 'TTWO'], // Take-Two Interactive Software
  ['0xd917b029c761d264c6a312bbbcda868658ef86a6', 'USAR'], // USA Rare Earth
  ['0xa30fa36db767ad9ed3f7a60fc79526fb4d56d344', 'USO'], // United States Oil Fund
  ['0x9e7abd3c9139d14e4c86dce0e455aab7a0c2fb3e', 'WYFI'], // WhiteFiber
])

/** How many issued equities the allowlist covers. Shown on the stocks page. */
export const STOCK_TOKEN_COUNT = STOCK_TOKENS.size

/**
 * Whether a contract is one of the issued equities.
 *
 * Lowercased on the way in because Krystal reports addresses lowercased while Uniswap reports
 * them checksummed, and both feed this.
 */
export const isStockToken = (address: string): boolean =>
  STOCK_TOKENS.has(address.toLowerCase())

/** The ticker an issued equity trades under, or null when the contract is not one. */
export const stockTicker = (address: string): string | null =>
  STOCK_TOKENS.get(address.toLowerCase()) ?? null

/** Whether either side of a pool is an issued equity. */
export const isStockPool = (pool: { token0Address: string; token1Address: string }): boolean =>
  isStockToken(pool.token0Address) || isStockToken(pool.token1Address)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/domain/stockTokens.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/stockTokens.ts lib/domain/stockTokens.test.ts
git commit -m "Identify Robinhood tokenized equities by contract address"
```

---

### Task 2: Flag stock pools on PoolRow

**Files:**
- Modify: `lib/types.ts` (add `isStock` to `PoolRow`)
- Modify: `lib/domain/pools.ts:89-124` (set it when building the row)
- Test: `lib/domain/pools.stock.test.ts`

**Interfaces:**
- Consumes: `isStockPool` from Task 1
- Produces: `PoolRow.isStock: boolean`

- [ ] **Step 1: Write the failing test**

Create `lib/domain/pools.stock.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isStockPool } from './stockTokens'

// Guards the contract the table and the sampler both rely on: a PoolRow carries enough to be
// classified without re-reading the feed.
describe('PoolRow stock classification', () => {
  it('classifies from the row fields alone', () => {
    const row = {
      token0Address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
      token1Address: '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec',
    }

    expect(isStockPool(row)).toBe(true)
  })

  it('leaves a memecoin pool unflagged', () => {
    const row = {
      token0Address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
      token1Address: '0x7e86381a763f0ecca2bdf27c54eac403ddd48123',
    }

    expect(isStockPool(row)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/domain/pools.stock.test.ts`
Expected: PASS already (it only exercises Task 1). This file exists to pin the row-shape contract; the failing part comes next when `isStock` is referenced.

Add this case to the same file, which will fail:

```ts
import { buildStockFlag } from './pools'

describe('buildStockFlag', () => {
  it('reads both sides of the Krystal pool', () => {
    expect(
      buildStockFlag({
        token0: { address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73' },
        token1: { address: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c' },
      }),
    ).toBe(true)
  })
})
```

Run again. Expected: FAIL, `buildStockFlag` is not exported from `./pools`.

- [ ] **Step 3: Write the implementation**

In `lib/types.ts`, add to `PoolRow` immediately after the `tag` field:

```ts
  /** Whether either side is one of the tokenized equities Robinhood issued on this chain. */
  isStock: boolean
```

In `lib/domain/pools.ts`, add above the row builder:

```ts
/** Whether a feed pool holds an issued equity on either side. */
export const buildStockFlag = (pool: {
  token0: { address: string }
  token1: { address: string }
}): boolean => isStockPool({ token0Address: pool.token0.address, token1Address: pool.token1.address })
```

Import it at the top of `lib/domain/pools.ts`:

```ts
import { isStockPool } from './stockTokens'
```

And in the returned row object, directly after `tag: pool.tag ?? '',`:

```ts
    isStock: buildStockFlag(pool),
```

- [ ] **Step 4: Run tests and typecheck**

Run: `bun run test lib/domain/pools.stock.test.ts && bun run typecheck`
Expected: tests PASS. Typecheck will report every place constructing a `PoolRow` without `isStock`; fix each by adding the field. `components/PoolTable.projection.test.tsx` builds a row fixture and will need `isStock: false`.

- [ ] **Step 5: Run the full suite**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/domain/pools.ts lib/domain/pools.stock.test.ts components/PoolTable.projection.test.tsx
git commit -m "Flag stock pools on the table row"
```

---

### Task 3: Read pool swaps from the Uniswap feed

**Files:**
- Modify: `lib/clients/uniswap.ts` (add swap reader and seek token beside the existing activity code)
- Test: `lib/clients/uniswap.swaps.test.ts`

**Interfaces:**
- Consumes: `ActivityTarget`, `protocolVersionFor` (already exported from `lib/clients/uniswap.ts`)
- Produces: `type PoolSwap = { timestampMs: number; amountUsd: number; walletAddress: string }`, `seekPageToken(timestampMs: number, chainId: number): string`, `fetchPoolSwaps(target: ActivityTarget, options?: { pageSize?: number; pageToken?: string }): Promise<{ swaps: PoolSwap[]; nextPageToken: string | null }>`

- [ ] **Step 1: Write the failing test**

Create `lib/clients/uniswap.swaps.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPoolSwaps, seekPageToken } from './uniswap'

const target = { poolId: '0xAbC', protocol: 'uniswapv3', chainId: 4663 }

/** Replies with one ListTransactions body, capturing the request for assertions. */
const stubFetch = (body: unknown) => {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => vi.unstubAllGlobals())

describe('seekPageToken', () => {
  it('encodes the cursor the feed expects', () => {
    const decoded: unknown = JSON.parse(atob(seekPageToken(1_788_109_384_000, 4663)))

    expect(decoded).toMatchObject({ timestampMs: 1_788_109_384_000, chainId: 4663 })
  })
})

describe('fetchPoolSwaps', () => {
  it('keeps only swaps belonging to the requested pool', async () => {
    stubFetch({
      transactions: [
        { poolId: '0xabc', timestampMs: '1000', eventType: 'TRANSACTION_EVENT_TYPE_SWAP', amountUsd: 10, walletAddress: '0x1' },
        { poolId: '0xOTHER', timestampMs: '2000', eventType: 'TRANSACTION_EVENT_TYPE_SWAP', amountUsd: 99, walletAddress: '0x2' },
      ],
      page: {},
    })

    const { swaps } = await fetchPoolSwaps(target)

    expect(swaps).toEqual([{ timestampMs: 1000, amountUsd: 10, walletAddress: '0x1' }])
  })

  it('drops liquidity events, which are not volume', async () => {
    stubFetch({
      transactions: [
        { poolId: '0xabc', timestampMs: '1000', eventType: 'TRANSACTION_EVENT_TYPE_ADD', amountUsd: 500 },
      ],
      page: {},
    })

    const { swaps } = await fetchPoolSwaps(target)

    expect(swaps).toEqual([])
  })

  it('reads a negative amountUsd as its magnitude', async () => {
    stubFetch({
      transactions: [
        { poolId: '0xabc', timestampMs: '1000', eventType: 'TRANSACTION_EVENT_TYPE_SWAP', amountUsd: -42 },
      ],
      page: {},
    })

    const { swaps } = await fetchPoolSwaps(target)

    expect(swaps[0].amountUsd).toBe(42)
  })

  it('returns the continuation token when the feed gives one', async () => {
    stubFetch({ transactions: [], page: { nextPageToken: 'abc123' } })

    const { nextPageToken } = await fetchPoolSwaps(target)

    expect(nextPageToken).toBe('abc123')
  })

  it('sends the seek token when asked to start from a point in time', async () => {
    const spy = stubFetch({ transactions: [], page: {} })

    await fetchPoolSwaps(target, { pageToken: 'seek-me', pageSize: 50 })

    const body: unknown = JSON.parse(String(spy.mock.calls[0][1]?.body))
    expect(body).toMatchObject({ page: { pageSize: 50, pageToken: 'seek-me' } })
  })

  it('throws on a non-ok response so the caller can retry or skip', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 502 })))

    await expect(fetchPoolSwaps(target)).rejects.toThrow('502')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/clients/uniswap.swaps.test.ts`
Expected: FAIL, `fetchPoolSwaps` and `seekPageToken` are not exported.

- [ ] **Step 3: Write the implementation**

In `lib/clients/uniswap.ts`, add after the existing `fetchPoolTransactions`. Extract the request headers into a shared const first, since `fetchPoolTransactions` already inlines the same six headers and both readers need them:

```ts
/** Headers the Uniswap web app sends. The gateway rejects requests without them. */
const GATEWAY_HEADERS = {
  accept: '*/*',
  'content-type': 'application/json',
  'connect-protocol-version': '1',
  origin: 'https://app.uniswap.org',
  referer: 'https://app.uniswap.org/',
  'x-request-source': 'uniswap-web',
}

/** One swap as the volume history cares about it: when, how much, and by whom. */
export type PoolSwap = {
  timestampMs: number
  amountUsd: number
  walletAddress: string
}

/**
 * A page token that starts the feed at a point in time and reads backwards from it.
 *
 * The feed's own token is base64 JSON carrying a `(timestampMs, globalSequenceNumber)` cursor.
 * Supplying a maximal sequence number seeks to the requested instant, which is what makes a
 * backfill affordable: a pool running a hundred swaps every three minutes would otherwise need
 * thousands of sequential pages to reach yesterday.
 *
 * This relies on an undocumented encoding, so only the backfill uses it. Live sampling reads the
 * newest page and needs no cursor, and keeps working if this ever stops being accepted.
 */
export const seekPageToken = (timestampMs: number, chainId: number): string =>
  btoa(
    JSON.stringify({
      timestampMs,
      chainId,
      globalSequenceNumber: '999999999999999999999999999',
    }),
  )

/**
 * Reads one page of swaps for a pool.
 *
 * Liquidity adds and removes are dropped: the feed mixes all three event types and only swaps
 * are volume. Amounts are taken as magnitudes because the feed signs them by direction.
 *
 * The response is filtered back to the requested pool for the same reason
 * {@link fetchActivity} does it: the API accepts a pool filter and can still answer with the
 * chain wide firehose, so a response that looks right may describe twenty other pools.
 */
export const fetchPoolSwaps = async (
  { poolId, protocol, chainId }: ActivityTarget,
  options: { pageSize?: number; pageToken?: string } = {},
): Promise<{ swaps: PoolSwap[]; nextPageToken: string | null }> => {
  const { pageSize = 100, pageToken } = options

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: GATEWAY_HEADERS,
    body: JSON.stringify({
      chainIds: [chainId],
      filter: { protocolVersions: [protocolVersionFor(protocol)], poolId },
      page: { pageSize, ...(pageToken ? { pageToken } : {}) },
    }),
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(`Uniswap swap request failed: ${response.status}`)

  const parsed = swapPageSchema.parse(await response.json())
  const wanted = poolId.toLowerCase()

  const swaps = parsed.transactions
    .filter(
      (entry) =>
        entry.poolId.toLowerCase() === wanted &&
        entry.eventType === 'TRANSACTION_EVENT_TYPE_SWAP',
    )
    .map((entry) => ({
      timestampMs: Number(entry.timestampMs),
      amountUsd: Math.abs(entry.amountUsd ?? 0),
      walletAddress: entry.walletAddress ?? '',
    }))
    .filter((swap) => Number.isFinite(swap.timestampMs))

  return { swaps, nextPageToken: parsed.page?.nextPageToken ?? null }
}
```

Add the schema next to the existing `listTransactionsSchema`:

```ts
const swapPageSchema = z.object({
  transactions: z.array(transactionSchema).default([]),
  page: z.object({ nextPageToken: z.string().optional() }).optional(),
})
```

Then replace the inline headers object inside `fetchPoolTransactions` with `headers: GATEWAY_HEADERS,`.

- [ ] **Step 4: Run tests**

Run: `bun run test lib/clients/uniswap.swaps.test.ts lib/clients/uniswap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/clients/uniswap.ts lib/clients/uniswap.swaps.test.ts
git commit -m "Read pool swaps and seek the Uniswap feed by timestamp"
```

---

### Task 4: Hourly volume buckets

**Files:**
- Create: `lib/domain/volumeHistory.ts`
- Test: `lib/domain/volumeHistory.test.ts`

**Interfaces:**
- Consumes: `PoolSwap` from Task 3
- Produces: `type VolumeBucket = { hourEndMs: number; volumeUsd: number; swaps: number; spanMs: number }`, `HOUR_MS`, `BUCKET_LIMIT`, `alignHourEnd(ms: number): number`, `bucketFromSwaps(swaps: PoolSwap[], hourEndMs: number): VolumeBucket | null`, `rateUsdPerHour(bucket: VolumeBucket): number`, `mergeBucket(buckets: VolumeBucket[], next: VolumeBucket): VolumeBucket[]`, `hourlyReadings(buckets: VolumeBucket[]): VolumeBucket[]`, `medianRate(buckets: VolumeBucket[]): number`

- [ ] **Step 1: Write the failing test**

Create `lib/domain/volumeHistory.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  BUCKET_LIMIT,
  HOUR_MS,
  alignHourEnd,
  bucketFromSwaps,
  hourlyReadings,
  medianRate,
  mergeBucket,
  rateUsdPerHour,
} from './volumeHistory'

/** A bucket with the fields a test cares about, defaulting the rest. */
const bucket = (hourEndMs: number, volumeUsd: number, spanMs = HOUR_MS, swaps = 10) => ({
  hourEndMs,
  volumeUsd,
  spanMs,
  swaps,
})

describe('alignHourEnd', () => {
  it('rounds up to the next hour boundary', () => {
    expect(alignHourEnd(HOUR_MS + 1)).toBe(2 * HOUR_MS)
  })

  it('leaves an exact boundary alone', () => {
    expect(alignHourEnd(3 * HOUR_MS)).toBe(3 * HOUR_MS)
  })
})

describe('bucketFromSwaps', () => {
  it('sums the swaps and records the span they covered', () => {
    const result = bucketFromSwaps(
      [
        { timestampMs: 1_000_000, amountUsd: 100, walletAddress: '0x1' },
        { timestampMs: 1_600_000, amountUsd: 50, walletAddress: '0x2' },
      ],
      HOUR_MS,
    )

    expect(result).toEqual({ hourEndMs: HOUR_MS, volumeUsd: 150, swaps: 2, spanMs: 600_000 })
  })

  it('yields null for an empty page, which is not the same as a quiet hour', () => {
    expect(bucketFromSwaps([], HOUR_MS)).toBeNull()
  })

  it('yields null for a single swap, which spans no time and implies no rate', () => {
    expect(
      bucketFromSwaps([{ timestampMs: 1_000_000, amountUsd: 100, walletAddress: '0x1' }], HOUR_MS),
    ).toBeNull()
  })
})

describe('rateUsdPerHour', () => {
  it('scales the observed volume to an hour', () => {
    expect(rateUsdPerHour(bucket(HOUR_MS, 150, 600_000))).toBe(900)
  })

  it('returns the volume unchanged when the span is exactly an hour', () => {
    expect(rateUsdPerHour(bucket(HOUR_MS, 150, HOUR_MS))).toBe(150)
  })

  it('is zero for a bucket that spans nothing, rather than infinite', () => {
    expect(rateUsdPerHour(bucket(HOUR_MS, 150, 0))).toBe(0)
  })
})

describe('mergeBucket', () => {
  it('appends a newer hour', () => {
    const merged = mergeBucket([bucket(HOUR_MS, 10)], bucket(2 * HOUR_MS, 20))

    expect(merged.map((entry) => entry.hourEndMs)).toEqual([HOUR_MS, 2 * HOUR_MS])
  })

  it('replaces a bucket for an hour already recorded', () => {
    const merged = mergeBucket([bucket(HOUR_MS, 10)], bucket(HOUR_MS, 99))

    expect(merged).toHaveLength(1)
    expect(merged[0].volumeUsd).toBe(99)
  })

  it('keeps the newest buckets when the limit is passed', () => {
    const full = Array.from({ length: BUCKET_LIMIT }, (_, i) => bucket((i + 1) * HOUR_MS, i))
    const merged = mergeBucket(full, bucket((BUCKET_LIMIT + 1) * HOUR_MS, 999))

    expect(merged).toHaveLength(BUCKET_LIMIT)
    expect(merged[0].hourEndMs).toBe(2 * HOUR_MS)
    expect(merged[merged.length - 1].volumeUsd).toBe(999)
  })

  it('keeps the list ordered oldest first regardless of arrival order', () => {
    const merged = mergeBucket([bucket(2 * HOUR_MS, 20)], bucket(HOUR_MS, 10))

    expect(merged.map((entry) => entry.hourEndMs)).toEqual([HOUR_MS, 2 * HOUR_MS])
  })
})

describe('hourlyReadings', () => {
  it('drops buckets whose sample spanned more than an hour', () => {
    const kept = bucket(HOUR_MS, 10, HOUR_MS)
    const smeared = bucket(2 * HOUR_MS, 10, 6 * HOUR_MS)

    expect(hourlyReadings([kept, smeared])).toEqual([kept])
  })
})

describe('medianRate', () => {
  it('takes the middle rate, not the mean, so one spike cannot lift the baseline', () => {
    const buckets = [
      bucket(HOUR_MS, 100),
      bucket(2 * HOUR_MS, 100),
      bucket(3 * HOUR_MS, 100),
      bucket(4 * HOUR_MS, 10_000),
    ]

    expect(medianRate(buckets)).toBe(100)
  })

  it('is zero with nothing to measure', () => {
    expect(medianRate([])).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/domain/volumeHistory.test.ts`
Expected: FAIL, cannot resolve `./volumeHistory`.

- [ ] **Step 3: Write the implementation**

Create `lib/domain/volumeHistory.ts`:

```ts
import type { PoolSwap } from '../clients/uniswap'

export const HOUR_MS = 3_600_000

/**
 * How many hourly buckets a pool keeps.
 *
 * Two days: enough for the chart to show a pattern and for the spike baseline to have a
 * twenty-four bucket window behind it, with nothing spare.
 */
export const BUCKET_LIMIT = 48

/**
 * One hour of observed trading for a pool.
 *
 * `volumeUsd` is what the sample actually saw and `spanMs` is how long it took to see it, kept
 * separately rather than pre-divided. A page of a hundred swaps covers three minutes on a busy
 * pool and six hours on a quiet one, and a reader has to be able to tell those apart.
 */
export type VolumeBucket = {
  hourEndMs: number
  volumeUsd: number
  swaps: number
  spanMs: number
}

/** The hour boundary at or after `ms`, which is how a bucket is labelled. */
export const alignHourEnd = (ms: number): number => Math.ceil(ms / HOUR_MS) * HOUR_MS

/**
 * Turns a page of swaps into a bucket.
 *
 * Null for fewer than two swaps: one swap spans no time, so no rate can be read from it, and
 * recording it as zero volume would read as a quiet hour rather than an unmeasured one.
 */
export const bucketFromSwaps = (swaps: PoolSwap[], hourEndMs: number): VolumeBucket | null => {
  if (swaps.length < 2) return null

  const timestamps = swaps.map((swap) => swap.timestampMs)

  return {
    hourEndMs,
    volumeUsd: swaps.reduce((total, swap) => total + swap.amountUsd, 0),
    swaps: swaps.length,
    spanMs: Math.max(...timestamps) - Math.min(...timestamps),
  }
}

/** The bucket's volume scaled to a full hour. Zero when it spanned no time at all. */
export const rateUsdPerHour = (bucket: VolumeBucket): number =>
  bucket.spanMs > 0 ? (bucket.volumeUsd * HOUR_MS) / bucket.spanMs : 0

/**
 * Adds a bucket, replacing any existing one for the same hour and evicting the oldest.
 *
 * Sorted on the way out rather than assuming arrival order, since a backfill walks time
 * backwards while the live sampler walks it forwards and both write here.
 */
export const mergeBucket = (buckets: VolumeBucket[], next: VolumeBucket): VolumeBucket[] =>
  [...buckets.filter((entry) => entry.hourEndMs !== next.hourEndMs), next]
    .sort((a, b) => a.hourEndMs - b.hourEndMs)
    .slice(-BUCKET_LIMIT)

/**
 * The buckets fine enough to describe a single hour.
 *
 * A sample spanning longer than an hour cannot say which hour its volume belonged to, so it is
 * excluded from anything hourly. Quiet pools return these routinely.
 */
export const hourlyReadings = (buckets: VolumeBucket[]): VolumeBucket[] =>
  buckets.filter((bucket) => bucket.spanMs > 0 && bucket.spanMs <= HOUR_MS)

/**
 * The middle hourly rate across the buckets.
 *
 * A median rather than a mean because the baseline is compared against the very spike being
 * detected, and a mean would be dragged upward by it.
 */
export const medianRate = (buckets: VolumeBucket[]): number => {
  if (buckets.length === 0) return 0

  const rates = buckets.map(rateUsdPerHour).sort((a, b) => a - b)
  return rates[Math.floor(rates.length / 2)]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/domain/volumeHistory.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/volumeHistory.ts lib/domain/volumeHistory.test.ts
git commit -m "Bucket pool swaps into hourly volume readings"
```

---

### Task 5: Persist the volume history

**Files:**
- Create: `lib/domain/volumeStore.ts`
- Test: `lib/domain/volumeStore.test.ts`

**Interfaces:**
- Consumes: `VolumeBucket`, `BUCKET_LIMIT` from Task 4
- Produces: `type VolumeHistory = Record<string, VolumeBucket[]>`, `interpretVolumeHistory(record: unknown): VolumeHistory`, `readVolumeHistory(): VolumeHistory`, `writeVolumeHistory(history: VolumeHistory): void`

- [ ] **Step 1: Write the failing test**

Create `lib/domain/volumeStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HOUR_MS } from './volumeHistory'
import { interpretVolumeHistory } from './volumeStore'

const bucket = { hourEndMs: HOUR_MS, volumeUsd: 100, swaps: 5, spanMs: HOUR_MS }

describe('interpretVolumeHistory', () => {
  it('reads a well formed file', () => {
    expect(interpretVolumeHistory({ '0xabc': [bucket] })).toEqual({ '0xabc': [bucket] })
  })

  it('lowercases pool ids so the two feeds agree on the key', () => {
    const parsed = interpretVolumeHistory({ '0xABC': [bucket] })

    expect(Object.keys(parsed)).toEqual(['0xabc'])
  })

  it('yields an empty history for a missing or unreadable file', () => {
    expect(interpretVolumeHistory(null)).toEqual({})
    expect(interpretVolumeHistory('not an object')).toEqual({})
  })

  it('drops entries that are not arrays of buckets', () => {
    expect(interpretVolumeHistory({ '0xabc': 'nonsense', '0xdef': [bucket] })).toEqual({
      '0xdef': [bucket],
    })
  })

  it('drops malformed buckets rather than failing the whole read', () => {
    const parsed = interpretVolumeHistory({
      '0xabc': [bucket, { hourEndMs: 'not a number', volumeUsd: 1, swaps: 1, spanMs: 1 }],
    })

    expect(parsed['0xabc']).toEqual([bucket])
  })

  it('keeps only the newest buckets when a file holds too many', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ ...bucket, hourEndMs: (i + 1) * HOUR_MS }))
    const parsed = interpretVolumeHistory({ '0xabc': many })

    expect(parsed['0xabc']).toHaveLength(48)
    expect(parsed['0xabc'][47].hourEndMs).toBe(100 * HOUR_MS)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/domain/volumeStore.test.ts`
Expected: FAIL, cannot resolve `./volumeStore`.

- [ ] **Step 3: Write the implementation**

Create `lib/domain/volumeStore.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { BUCKET_LIMIT, type VolumeBucket } from './volumeHistory'

const HISTORY_FILE = '.volume-history.json'

/** Hourly buckets per pool, keyed by lowercased pool id. */
export type VolumeHistory = Record<string, VolumeBucket[]>

/** Whether a parsed value carries every bucket field as a finite number. */
const isBucket = (value: unknown): value is VolumeBucket => {
  if (typeof value !== 'object' || value === null) return false

  const candidate: Record<string, unknown> = { ...value }
  return (['hourEndMs', 'volumeUsd', 'swaps', 'spanMs'] as const).every(
    (key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]),
  )
}

/**
 * Interprets a parsed history file.
 *
 * Kept separate from reading the file so it can be tested without any filesystem access, matching
 * how {@link interpretAlertState} is split in `alertStore`. A malformed bucket is dropped rather
 * than failing the read: losing one hour of one pool costs a gap in a chart, while refusing the
 * whole file would silently reset every pool's baseline and mute alerting until it refilled.
 */
export const interpretVolumeHistory = (record: unknown): VolumeHistory => {
  if (typeof record !== 'object' || record === null) return {}

  const history: VolumeHistory = {}

  for (const [poolId, value] of Object.entries(record)) {
    if (!Array.isArray(value)) continue

    const buckets = value
      .filter(isBucket)
      .sort((a, b) => a.hourEndMs - b.hourEndMs)
      .slice(-BUCKET_LIMIT)

    if (buckets.length > 0) history[poolId.toLowerCase()] = buckets
  }

  return history
}

/** Reads the history, yielding an empty one rather than throwing on anything unreadable. */
export const readVolumeHistory = (): VolumeHistory => {
  try {
    return interpretVolumeHistory(JSON.parse(readFileSync(HISTORY_FILE, 'utf8')))
  } catch {
    return {}
  }
}

/**
 * Writes the history, ignoring failures.
 *
 * Persistence is a convenience here exactly as it is for alerts: a read-only disk costs the
 * chart its backfill on restart and nothing else.
 */
export const writeVolumeHistory = (history: VolumeHistory): void => {
  try {
    writeFileSync(HISTORY_FILE, JSON.stringify(history))
  } catch {
    // Nothing to recover. The sampler keeps working from memory.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/domain/volumeStore.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the file to gitignore**

Append to `.gitignore`:

```
.volume-history.json
```

- [ ] **Step 6: Commit**

```bash
git add lib/domain/volumeStore.ts lib/domain/volumeStore.test.ts .gitignore
git commit -m "Persist hourly volume history per pool"
```

---

### Task 6: Spike detection

**Files:**
- Create: `lib/domain/volumeSpike.ts`
- Test: `lib/domain/volumeSpike.test.ts`

**Interfaces:**
- Consumes: `VolumeBucket`, `hourlyReadings`, `medianRate`, `rateUsdPerHour` from Task 4
- Produces: `type SpikeSettings = { multiple: number; minVolumeUsd: number; cooldownMs: number }`, `type Spike = { poolId: string; rateUsdPerHour: number; baselineUsdPerHour: number; multiple: number; atMs: number }`, `BASELINE_WINDOW`, `MIN_HISTORY`, `detectSpike(poolId: string, buckets: VolumeBucket[], settings: SpikeSettings, lastAlertedAtMs: number | null): Spike | null`

- [ ] **Step 1: Write the failing test**

Create `lib/domain/volumeSpike.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HOUR_MS } from './volumeHistory'
import { MIN_HISTORY, detectSpike } from './volumeSpike'

const settings = { multiple: 5, minVolumeUsd: 100_000, cooldownMs: 2 * HOUR_MS }

/** A run of calm hours at `rate`, then one final hour at `finalRate`. */
const history = (rate: number, finalRate: number, hours = MIN_HISTORY + 1) =>
  Array.from({ length: hours }, (_, i) => ({
    hourEndMs: (i + 1) * HOUR_MS,
    volumeUsd: i === hours - 1 ? finalRate : rate,
    swaps: 20,
    spanMs: HOUR_MS,
  }))

describe('detectSpike', () => {
  it('fires when the newest hour clears the multiple and the floor', () => {
    const spike = detectSpike('0xabc', history(100_000, 900_000), settings, null)

    expect(spike).toMatchObject({
      poolId: '0xabc',
      rateUsdPerHour: 900_000,
      baselineUsdPerHour: 100_000,
      multiple: 9,
    })
  })

  it('stays quiet below the multiple', () => {
    expect(detectSpike('0xabc', history(100_000, 300_000), settings, null)).toBeNull()
  })

  it('stays quiet below the volume floor, however large the multiple', () => {
    // Twenty times its own baseline, but only $20k an hour: a thin pool growing, not an event.
    expect(detectSpike('0xabc', history(1_000, 20_000), settings, null)).toBeNull()
  })

  it('stays quiet without enough history to have a baseline', () => {
    const thin = history(100_000, 900_000, MIN_HISTORY - 1)

    expect(detectSpike('0xabc', thin, settings, null)).toBeNull()
  })

  it('stays quiet inside the cooldown', () => {
    const buckets = history(100_000, 900_000)
    const lastHour = buckets[buckets.length - 1].hourEndMs

    expect(detectSpike('0xabc', buckets, settings, lastHour - HOUR_MS)).toBeNull()
  })

  it('fires again once the cooldown has passed', () => {
    const buckets = history(100_000, 900_000)
    const lastHour = buckets[buckets.length - 1].hourEndMs

    expect(detectSpike('0xabc', buckets, settings, lastHour - 3 * HOUR_MS)).not.toBeNull()
  })

  it('ignores buckets whose sample smeared across more than an hour', () => {
    const buckets = history(100_000, 900_000)
    buckets[buckets.length - 1].spanMs = 6 * HOUR_MS

    expect(detectSpike('0xabc', buckets, settings, null)).toBeNull()
  })

  it('does not let one earlier spike raise the baseline enough to mask the next', () => {
    const buckets = history(100_000, 900_000)
    // A single enormous earlier hour would lift a mean baseline above the floor for the real one.
    buckets[2].volumeUsd = 50_000_000

    expect(detectSpike('0xabc', buckets, settings, null)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/domain/volumeSpike.test.ts`
Expected: FAIL, cannot resolve `./volumeSpike`.

- [ ] **Step 3: Write the implementation**

Create `lib/domain/volumeSpike.ts`:

```ts
import { hourlyReadings, medianRate, rateUsdPerHour, type VolumeBucket } from './volumeHistory'

/**
 * Hourly buckets the baseline is drawn from.
 *
 * A day, so the baseline tracks what the pool has been doing recently rather than what it was
 * doing last week. These pools are new and growing; a week-long baseline makes ordinary growth
 * register as a spike every hour.
 */
export const BASELINE_WINDOW = 24

/** Fewest hourly readings before a baseline is trusted enough to fire on. */
export const MIN_HISTORY = 12

export type SpikeSettings = {
  multiple: number
  minVolumeUsd: number
  cooldownMs: number
}

export type Spike = {
  poolId: string
  rateUsdPerHour: number
  baselineUsdPerHour: number
  multiple: number
  atMs: number
}

/**
 * Whether a pool's newest hour departs from its own recent behaviour.
 *
 * Three guards, each earning its place against the seven day sample this was calibrated on:
 *
 * - The multiple catches the departure itself, measured against a median so the spike cannot
 *   raise the bar it has to clear.
 * - The volume floor keeps thin pools quiet. Without it the small stock pools alert three to
 *   four times a day, because a pool whose median hourly volume grew from $795 to $63,000 in a
 *   fortnight clears any multiple on growth alone.
 * - The cooldown stops one event alerting on every poll for as long as it lasts.
 */
export const detectSpike = (
  poolId: string,
  buckets: VolumeBucket[],
  settings: SpikeSettings,
  lastAlertedAtMs: number | null,
): Spike | null => {
  const readings = hourlyReadings(buckets)
  if (readings.length < MIN_HISTORY) return null

  const newest = readings[readings.length - 1]
  const baselineBuckets = readings.slice(-1 - BASELINE_WINDOW, -1)
  if (baselineBuckets.length < MIN_HISTORY - 1) return null

  const baseline = medianRate(baselineBuckets)
  if (baseline <= 0) return null

  const rate = rateUsdPerHour(newest)
  if (rate < settings.minVolumeUsd) return null

  const multiple = rate / baseline
  if (multiple < settings.multiple) return null

  if (lastAlertedAtMs !== null && newest.hourEndMs - lastAlertedAtMs < settings.cooldownMs) {
    return null
  }

  return {
    poolId,
    rateUsdPerHour: rate,
    baselineUsdPerHour: baseline,
    multiple,
    atMs: newest.hourEndMs,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/domain/volumeSpike.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/domain/volumeSpike.ts lib/domain/volumeSpike.test.ts
git commit -m "Detect volume spikes against a pool's own trailing median"
```

---

### Task 7: Sample stock pool volume

**Files:**
- Create: `lib/domain/volumeSampler.ts`
- Modify: `lib/config.ts` (add sampler limits)
- Test: `lib/domain/volumeSampler.test.ts`

**Interfaces:**
- Consumes: `fetchPoolSwaps`, `seekPageToken` (Task 3), `alignHourEnd`, `bucketFromSwaps`, `mergeBucket`, `HOUR_MS` (Task 4), `readVolumeHistory`, `writeVolumeHistory`, `VolumeHistory` (Task 5), `PoolRow`
- Produces: `sampleStockVolume(rows: PoolRow[], now?: number): Promise<VolumeHistory>`, `backfillPool(target: ActivityTarget, hours: number, now?: number): Promise<VolumeBucket[]>`, `aggregateSeries(history: VolumeHistory): VolumeBucket[]`

- [ ] **Step 1: Write the failing test**

Create `lib/domain/volumeSampler.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HOUR_MS } from './volumeHistory'
import { aggregateSeries } from './volumeSampler'

describe('aggregateSeries', () => {
  it('sums each hour across pools', () => {
    const series = aggregateSeries({
      '0xa': [{ hourEndMs: HOUR_MS, volumeUsd: 100, swaps: 5, spanMs: HOUR_MS }],
      '0xb': [{ hourEndMs: HOUR_MS, volumeUsd: 50, swaps: 3, spanMs: HOUR_MS }],
    })

    expect(series).toEqual([{ hourEndMs: HOUR_MS, volumeUsd: 150, swaps: 8, spanMs: HOUR_MS }])
  })

  it('scales a partial sample to the hour before summing, so pools are comparable', () => {
    // Half an hour of $100 is $200/h, and belongs in the total as $200 rather than $100.
    const series = aggregateSeries({
      '0xa': [{ hourEndMs: HOUR_MS, volumeUsd: 100, swaps: 5, spanMs: HOUR_MS / 2 }],
    })

    expect(series[0].volumeUsd).toBe(200)
  })

  it('orders hours oldest first', () => {
    const series = aggregateSeries({
      '0xa': [
        { hourEndMs: 2 * HOUR_MS, volumeUsd: 10, swaps: 1, spanMs: HOUR_MS },
        { hourEndMs: HOUR_MS, volumeUsd: 20, swaps: 1, spanMs: HOUR_MS },
      ],
    })

    expect(series.map((entry) => entry.hourEndMs)).toEqual([HOUR_MS, 2 * HOUR_MS])
  })

  it('is empty for an empty history', () => {
    expect(aggregateSeries({})).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/domain/volumeSampler.test.ts`
Expected: FAIL, cannot resolve `./volumeSampler`.

- [ ] **Step 3: Add config constants**

Append to `lib/config.ts`:

```ts
/**
 * Stock pools sampled for volume history on each pass.
 *
 * The 214 stock pools are ordered by 24 hour volume and the top slice is sampled, because a pool
 * doing under a thousand dollars an hour cannot produce a spike that clears the alert floor and
 * charting it adds nothing.
 */
export const VOLUME_SAMPLE_POOL_LIMIT = 40

/** Swaps read per hourly sample. One page: enough to imply a rate, cheap enough to repeat. */
export const VOLUME_SAMPLE_PAGE_SIZE = 100

/** Hours of history fetched the first time a pool is seen. */
export const VOLUME_BACKFILL_HOURS = 48

/** Sampling requests in flight at once, well under the sweep's own concurrency. */
export const VOLUME_SAMPLE_CONCURRENCY = 6
```

- [ ] **Step 4: Write the implementation**

Create `lib/domain/volumeSampler.ts`:

```ts
import {
  VOLUME_BACKFILL_HOURS,
  VOLUME_SAMPLE_CONCURRENCY,
  VOLUME_SAMPLE_PAGE_SIZE,
  VOLUME_SAMPLE_POOL_LIMIT,
} from '../config'
import { fetchPoolSwaps, seekPageToken, type ActivityTarget } from '../clients/uniswap'
import { hasTransactionFeed } from '../chains'
import type { PoolRow } from '../types'
import {
  HOUR_MS,
  alignHourEnd,
  bucketFromSwaps,
  mergeBucket,
  rateUsdPerHour,
  type VolumeBucket,
} from './volumeHistory'
import { readVolumeHistory, writeVolumeHistory, type VolumeHistory } from './volumeStore'

/**
 * Total hourly volume across every pool in the history.
 *
 * Each pool's bucket is scaled to a full hour before being added. A pool sampled over three
 * minutes and one sampled over forty describe the same hour at different resolutions, and adding
 * their raw observations would weight the slow sampler higher for no reason.
 */
export const aggregateSeries = (history: VolumeHistory): VolumeBucket[] => {
  const byHour = new Map<number, VolumeBucket>()

  for (const buckets of Object.values(history))
    for (const bucket of buckets) {
      const existing = byHour.get(bucket.hourEndMs)
      const scaled = rateUsdPerHour(bucket)

      byHour.set(bucket.hourEndMs, {
        hourEndMs: bucket.hourEndMs,
        volumeUsd: (existing?.volumeUsd ?? 0) + scaled,
        swaps: (existing?.swaps ?? 0) + bucket.swaps,
        spanMs: HOUR_MS,
      })
    }

  return [...byHour.values()].sort((a, b) => a.hourEndMs - b.hourEndMs)
}

/** Reads one hour's worth of swaps ending at `hourEndMs`, as a bucket. */
const sampleHour = async (
  target: ActivityTarget,
  hourEndMs: number,
): Promise<VolumeBucket | null> => {
  try {
    const { swaps } = await fetchPoolSwaps(target, {
      pageSize: VOLUME_SAMPLE_PAGE_SIZE,
      pageToken: seekPageToken(hourEndMs, target.chainId),
    })

    return bucketFromSwaps(swaps, hourEndMs)
  } catch {
    // One unreadable hour is a gap in a chart, not a reason to abandon the pool.
    return null
  }
}

/**
 * Fetches `hours` of history for a pool, one sample per hour.
 *
 * Used only when a pool has no history yet. Every later pass samples the current hour alone.
 */
export const backfillPool = async (
  target: ActivityTarget,
  hours: number = VOLUME_BACKFILL_HOURS,
  now: number = Date.now(),
): Promise<VolumeBucket[]> => {
  const latest = alignHourEnd(now)
  const hourEnds = Array.from({ length: hours }, (_, i) => latest - i * HOUR_MS)
  const buckets: VolumeBucket[] = []

  for (let index = 0; index < hourEnds.length; index += VOLUME_SAMPLE_CONCURRENCY) {
    const slice = hourEnds.slice(index, index + VOLUME_SAMPLE_CONCURRENCY)
    const sampled = await Promise.all(slice.map((hourEnd) => sampleHour(target, hourEnd)))
    for (const bucket of sampled) if (bucket !== null) buckets.push(bucket)
  }

  return buckets.sort((a, b) => a.hourEndMs - b.hourEndMs)
}

/**
 * Samples the busiest stock pools and returns the updated history, having persisted it.
 *
 * A pool with no history is backfilled; one that already has history has only its current hour
 * re-read, which is a single request. Ordering by 24 hour volume and taking the top slice keeps
 * the pass affordable: a pool doing under a thousand dollars an hour cannot clear the alert floor
 * whatever multiple it hits.
 */
export const sampleStockVolume = async (
  rows: PoolRow[],
  now: number = Date.now(),
): Promise<VolumeHistory> => {
  const history = readVolumeHistory()

  const targets = rows
    .filter((row) => row.isStock && hasTransactionFeed(row.protocol))
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, VOLUME_SAMPLE_POOL_LIMIT)

  const currentHour = alignHourEnd(now)

  for (let index = 0; index < targets.length; index += VOLUME_SAMPLE_CONCURRENCY) {
    const slice = targets.slice(index, index + VOLUME_SAMPLE_CONCURRENCY)

    await Promise.all(
      slice.map(async (row) => {
        const key = row.poolId.toLowerCase()
        const target = { poolId: row.poolId, protocol: row.protocol, chainId: row.chainId }
        const existing = history[key]

        if (existing === undefined || existing.length === 0) {
          const backfilled = await backfillPool(target, VOLUME_BACKFILL_HOURS, now)
          if (backfilled.length > 0) history[key] = backfilled
          return
        }

        const bucket = await sampleHour(target, currentHour)
        if (bucket !== null) history[key] = mergeBucket(existing, bucket)
      }),
    )
  }

  writeVolumeHistory(history)
  return history
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `bun run test lib/domain/volumeSampler.test.ts && bun run typecheck`
Expected: PASS. If `ActivityTarget` is not exported as a type from `lib/clients/uniswap.ts`, it already is at line 24; confirm the import resolves.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/volumeSampler.ts lib/domain/volumeSampler.test.ts lib/config.ts
git commit -m "Sample hourly volume for the busiest stock pools"
```

---

### Task 8: Volume API route

**Files:**
- Create: `app/api/volume/route.ts`
- Test: `app/api/volume/route.test.ts`

**Interfaces:**
- Consumes: `aggregateSeries` (Task 7), `readVolumeHistory` (Task 5)
- Produces: `GET` returning `{ aggregate: VolumeBucket[]; byPool: VolumeHistory }`

- [ ] **Step 1: Write the failing test**

Create `app/api/volume/route.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

// The handler is a mapper, so the domain is mocked and only delegation and error mapping are
// asserted here. The bucketing itself is covered by the volumeHistory tests.
vi.mock('@/lib/domain/volumeStore', () => ({ readVolumeHistory: vi.fn() }))
vi.mock('@/lib/domain/volumeSampler', () => ({ aggregateSeries: vi.fn() }))

const { readVolumeHistory } = await import('@/lib/domain/volumeStore')
const { aggregateSeries } = await import('@/lib/domain/volumeSampler')
const { GET } = await import('./route')

afterEach(() => vi.clearAllMocks())

describe('GET /api/volume', () => {
  it('returns the aggregate series and the per pool history', async () => {
    const history = { '0xabc': [{ hourEndMs: 3_600_000, volumeUsd: 10, swaps: 2, spanMs: 3_600_000 }] }
    vi.mocked(readVolumeHistory).mockReturnValue(history)
    vi.mocked(aggregateSeries).mockReturnValue(history['0xabc'])

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ aggregate: history['0xabc'], byPool: history })
  })

  it('maps a domain failure to a 502 carrying its reason', async () => {
    vi.mocked(readVolumeHistory).mockImplementation(() => {
      throw new Error('disk on fire')
    })

    const response = await GET()

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'disk on fire' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test app/api/volume/route.test.ts`
Expected: FAIL, cannot resolve `./route`.

- [ ] **Step 3: Write the implementation**

Create `app/api/volume/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { aggregateSeries } from '@/lib/domain/volumeSampler'
import { readVolumeHistory } from '@/lib/domain/volumeStore'

export const dynamic = 'force-dynamic'

/** Returns the hourly volume history: one aggregate series, plus each pool's own. */
export const GET = async () => {
  try {
    const byPool = readVolumeHistory()
    return NextResponse.json({ aggregate: aggregateSeries(byPool), byPool })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test app/api/volume/route.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add app/api/volume/route.ts app/api/volume/route.test.ts
git commit -m "Serve the hourly volume history"
```

---

### Task 9: Volume chart

**Files:**
- Create: `components/StockVolumeChart.tsx`
- Test: `components/StockVolumeChart.test.tsx`

**Interfaces:**
- Consumes: `VolumeBucket` (Task 4)
- Produces: `<StockVolumeChart aggregate={VolumeBucket[]} selected={VolumeBucket[] | null} selectedLabel={string | null} />`, and `chartGeometry(buckets: VolumeBucket[], width: number, height: number): { points: string; max: number }`

Read `TYPHOGRAPHY.md` before writing any visible text in this component, per the repo workflow rule. Colours come from the existing CSS custom properties used across `components/` (`--accent`, `--line`, `--ink-muted`); do not introduce new palette values.

- [ ] **Step 1: Write the failing test**

Create `components/StockVolumeChart.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { chartGeometry } from './StockVolumeChart'

const HOUR = 3_600_000
const bucket = (hourEndMs: number, volumeUsd: number) => ({
  hourEndMs,
  volumeUsd,
  swaps: 10,
  spanMs: HOUR,
})

describe('chartGeometry', () => {
  it('scales the tallest bucket to the full height', () => {
    const { points, max } = chartGeometry([bucket(HOUR, 0), bucket(2 * HOUR, 100)], 100, 50)

    expect(max).toBe(100)
    // Highest volume sits at y=0, lowest at the baseline.
    expect(points).toBe('0,50 100,0')
  })

  it('draws a flat line rather than dividing by zero when nothing traded', () => {
    const { points } = chartGeometry([bucket(HOUR, 0), bucket(2 * HOUR, 0)], 100, 50)

    expect(points).toBe('0,50 100,50')
  })

  it('yields no points for an empty series', () => {
    expect(chartGeometry([], 100, 50)).toEqual({ points: '', max: 0 })
  })

  it('places a single bucket at the left edge', () => {
    const { points } = chartGeometry([bucket(HOUR, 42)], 100, 50)

    expect(points).toBe('0,0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test components/StockVolumeChart.test.tsx`
Expected: FAIL, cannot resolve `./StockVolumeChart`.

- [ ] **Step 3: Write the implementation**

Create `components/StockVolumeChart.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import type { VolumeBucket } from '@/lib/domain/volumeHistory'

const WIDTH = 960
const HEIGHT = 200

/**
 * Turns buckets into SVG polyline points.
 *
 * Exported so the scaling can be tested without rendering. The y axis is inverted because SVG
 * measures downward, so the busiest hour lands at zero.
 */
export const chartGeometry = (
  buckets: VolumeBucket[],
  width: number,
  height: number,
): { points: string; max: number } => {
  if (buckets.length === 0) return { points: '', max: 0 }

  const max = Math.max(...buckets.map((bucket) => bucket.volumeUsd))
  const step = buckets.length > 1 ? width / (buckets.length - 1) : 0

  const points = buckets
    .map((bucket, index) => {
      const y = max > 0 ? height - (bucket.volumeUsd / max) * height : height
      return `${Math.round(index * step)},${Math.round(y)}`
    })
    .join(' ')

  return { points, max }
}

/** Hour label in US Eastern, where the underlying equities trade. */
const easternHour = (ms: number) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).format(new Date(ms))

/** Whether an hour falls inside the US cash session, used only to shade the background. */
const inSession = (ms: number) => {
  const hour = Number(easternHour(ms))
  return hour >= 9 && hour < 16
}

const money = (value: number) =>
  value >= 1_000_000
    ? `$${(value / 1_000_000).toFixed(1)}M`
    : `$${Math.round(value / 1000).toLocaleString()}k`

type Props = {
  aggregate: VolumeBucket[]
  selected: VolumeBucket[] | null
  selectedLabel: string | null
}

/**
 * Hourly volume across stock pools, with the US cash session shaded.
 *
 * The shading is orientation for someone holding a tokenized equity, not an explanation. Measured
 * over seven days, stock pools put 41% of weekday volume inside the session against 52% for a
 * memecoin control, so the session does not account for when these pools trade.
 */
export const StockVolumeChart = ({ aggregate, selected, selectedLabel }: Props) => {
  const total = useMemo(() => chartGeometry(aggregate, WIDTH, HEIGHT), [aggregate])
  const overlay = useMemo(
    () => (selected ? chartGeometry(selected, WIDTH, HEIGHT) : null),
    [selected],
  )

  if (aggregate.length === 0) {
    return (
      <div className="rounded border border-line px-4 py-8 text-center text-xs text-ink-ghost">
        No volume history yet. It fills in as the watcher samples.
      </div>
    )
  }

  const sessions = aggregate
    .map((bucket, index) => ({ bucket, index }))
    .filter(({ bucket }) => inSession(bucket.hourEndMs))

  const step = aggregate.length > 1 ? WIDTH / (aggregate.length - 1) : 0

  return (
    <figure className="rounded border border-line bg-surface px-4 py-3">
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-3 text-[11px] uppercase tracking-[0.12em] text-ink-muted">
        <span className="text-ink">Stock pool volume per hour</span>
        <span>peak {money(total.max)}</span>
        {selectedLabel ? <span className="text-accent">{selectedLabel}</span> : null}
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-48 w-full"
        role="img"
        aria-label={`Hourly volume across stock pools, peaking at ${money(total.max)}`}
      >
        {sessions.map(({ index }) => (
          <rect
            key={index}
            x={Math.round(index * step - step / 2)}
            y={0}
            width={Math.max(Math.round(step), 1)}
            height={HEIGHT}
            fill="var(--accent)"
            opacity={0.06}
          />
        ))}

        <polyline points={total.points} fill="none" stroke="var(--ink-muted)" strokeWidth={1.5} />

        {overlay ? (
          <polyline points={overlay.points} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
        ) : null}
      </svg>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-ghost">
        Shaded columns mark the US cash session, 09:30 to 16:00 Eastern. Shown for orientation;
        these pools trade around the clock and the session does not explain their volume.
      </p>
    </figure>
  )
}
```

- [ ] **Step 4: Run test and typecheck**

Run: `bun run test components/StockVolumeChart.test.tsx && bun run typecheck`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add components/StockVolumeChart.tsx components/StockVolumeChart.test.tsx
git commit -m "Chart hourly stock pool volume"
```

---

### Task 10: The /stocks route

**Files:**
- Create: `app/stocks/page.tsx`
- Create: `app/stocks/StocksSection.tsx`
- Modify: `components/Navbar.tsx:7-11` (add the link)

**Interfaces:**
- Consumes: `getPoolsSnapshot` (`lib/domain/pools.ts`), `isStockPool` and `STOCK_TOKEN_COUNT` (Task 1), `StockVolumeChart` (Task 9), `PoolTable` (`components/PoolTable.tsx`)
- Produces: a route at `/stocks`

- [ ] **Step 1: Add the Navbar link**

In `components/Navbar.tsx`, change the `LINKS` array to:

```ts
const LINKS = [
  { href: '/', label: 'Pools' },
  { href: '/stocks', label: 'Stocks' },
  { href: '/safety', label: 'Safety check' },
  { href: '/deploy', label: 'Deploy hook' },
] as const
```

- [ ] **Step 2: Write the section**

Create `app/stocks/StocksSection.tsx`:

```tsx
import { PoolTable } from '@/components/PoolTable'
import { StockVolumeChart } from '@/components/StockVolumeChart'
import { getPoolsSnapshot } from '@/lib/domain/pools'
import { STOCK_TOKEN_COUNT } from '@/lib/domain/stockTokens'
import { aggregateSeries } from '@/lib/domain/volumeSampler'
import { readVolumeHistory } from '@/lib/domain/volumeStore'

/**
 * The stock pools and their volume history.
 *
 * Reuses the snapshot the pools page already builds rather than fetching the feed again; the
 * filtering is the only difference between the two pages.
 */
export const StocksSection = async () => {
  const { rows, fetchedAt } = await getPoolsSnapshot()
  const stockRows = rows.filter((row) => row.isStock)
  const aggregate = aggregateSeries(readVolumeHistory())

  const tvl = stockRows.reduce((total, row) => total + row.tvlUsd, 0)
  const volume = stockRows.reduce((total, row) => total + row.volume24hUsd, 0)

  return (
    <>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink0">
        {stockRows.length.toLocaleString()} pools holding one of the {STOCK_TOKEN_COUNT} equities
        and ETFs Robinhood has issued on this chain. ${Math.round(tvl).toLocaleString()} of TVL and
        ${Math.round(volume).toLocaleString()} traded in the last 24 hours.
      </p>
      <p className="mt-2 max-w-3xl text-xs leading-relaxed text-ink-ghost">
        Updated {new Date(fetchedAt).toLocaleTimeString()}. Pools are matched by token contract, not
        by ticker: several of these symbols also exist as unrelated memecoins here.
      </p>

      <div className="mt-6">
        <StockVolumeChart aggregate={aggregate} selected={null} selectedLabel={null} />
      </div>

      <div className="mt-6 sm:mt-8">
        <PoolTable initialRows={stockRows} />
      </div>
    </>
  )
}
```

- [ ] **Step 3: Write the page**

Create `app/stocks/page.tsx`:

```tsx
import { Suspense } from 'react'
import { StocksSection } from './StocksSection'

export const dynamic = 'force-dynamic'

const Page = () => (
  <main className="mx-auto max-w-[1560px] px-4 py-6 sm:px-6 sm:py-10">
    <header className="mb-6 sm:mb-8">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Stock pools</h1>
      {/* Needs the same snapshot the pools page measures, so it streams behind a boundary too. */}
      <Suspense
        fallback={
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
            Reading the pool feed…
          </p>
        }
      >
        <StocksSection />
      </Suspense>
    </header>
  </main>
)

export default Page
```

- [ ] **Step 4: Typecheck and run the suite**

Run: `bun run typecheck && bun run test`
Expected: PASS. If `PoolTable` requires props beyond `initialRows`, read its signature at `components/PoolTable.tsx:630` and supply them.

- [ ] **Step 5: Commit**

```bash
git add app/stocks components/Navbar.tsx
git commit -m "Add the stock pools route"
```

---

### Task 11: Spike alerts

**Files:**
- Modify: `lib/domain/newPools.ts:26-77` (three fields on `AlertFilters` and `DEFAULT_FILTERS`)
- Create: `lib/domain/spikeMessage.ts`
- Modify: `lib/domain/alertWatcher.ts:310-374` (call the spike reporter from `pollOnce`)
- Test: `lib/domain/spikeMessage.test.ts`

**Interfaces:**
- Consumes: `detectSpike`, `Spike` (Task 6), `sampleStockVolume` (Task 7), `sendTelegramMessage` (`lib/clients/telegram.ts`), `AlertFilters`
- Produces: `AlertFilters.spikeEnabled: boolean`, `AlertFilters.spikeMultiple: number`, `AlertFilters.spikeMinVolumeUsd: number`, `composeSpikeMessage(spikes: Spike[], labels: Record<string, string>, mentions: string[]): string`

- [ ] **Step 1: Write the failing test**

Create `lib/domain/spikeMessage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { composeSpikeMessage } from './spikeMessage'

const spike = {
  poolId: '0xabc',
  rateUsdPerHour: 900_000,
  baselineUsdPerHour: 100_000,
  multiple: 9,
  atMs: 1_788_109_384_000,
}

describe('composeSpikeMessage', () => {
  it('names the pair, the multiple and both rates', () => {
    const text = composeSpikeMessage([spike], { '0xabc': 'WETH/NVDA' }, [])

    expect(text).toContain('WETH/NVDA')
    expect(text).toContain('9.0x')
    expect(text).toContain('$900k/h')
    expect(text).toContain('$100k/h')
  })

  it('falls back to the pool id when no pair is known', () => {
    expect(composeSpikeMessage([spike], {}, [])).toContain('0xabc')
  })

  it('adds mentions so the message notifies rather than just arriving', () => {
    expect(composeSpikeMessage([spike], {}, ['alice'])).toContain('@alice')
  })

  it('escapes pair text, since it comes from chain data', () => {
    const text = composeSpikeMessage([spike], { '0xabc': '<b>/USDG' }, [])

    expect(text).toContain('&lt;b&gt;/USDG')
    expect(text).not.toContain('<b>/USDG')
  })

  it('lists every spike in one message rather than one message each', () => {
    const second = { ...spike, poolId: '0xdef', multiple: 6 }
    const text = composeSpikeMessage([spike, second], { '0xabc': 'A/B', '0xdef': 'C/D' }, [])

    expect(text).toContain('A/B')
    expect(text).toContain('C/D')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test lib/domain/spikeMessage.test.ts`
Expected: FAIL, cannot resolve `./spikeMessage`.

- [ ] **Step 3: Write the message composer**

Create `lib/domain/spikeMessage.ts`:

```ts
import type { Spike } from './volumeSpike'

/** Escapes the four characters Telegram's HTML mode treats as markup. */
const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Rate as a short label: thousands below a million, millions above. */
const rate = (value: number) =>
  value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M/h` : `$${Math.round(value / 1000)}k/h`

/**
 * One message covering every spike in this pass.
 *
 * Batched rather than one message per pool: several stock pools commonly move together, and a
 * burst of separate messages is the fastest way to have the alerts muted.
 */
export const composeSpikeMessage = (
  spikes: Spike[],
  labels: Record<string, string>,
  mentions: string[],
): string => {
  const lines = spikes.map((spike) => {
    const label = labels[spike.poolId.toLowerCase()] ?? spike.poolId
    return `• <b>${escape(label)}</b> ${spike.multiple.toFixed(1)}x · ${rate(spike.rateUsdPerHour)} against ${rate(spike.baselineUsdPerHour)} baseline`
  })

  const mentionLine = mentions.length > 0 ? `\n${mentions.map((name) => `@${name}`).join(' ')}` : ''

  return `<b>Volume spike</b>\n${lines.join('\n')}${mentionLine}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test lib/domain/spikeMessage.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Extend the filters**

In `lib/domain/newPools.ts`, add to the `AlertFilters` type after `minChangePercent`:

```ts
  /** Whether a pool departing from its own recent volume is worth a message. */
  spikeEnabled: boolean
  /**
   * How far above its trailing median an hour must run.
   *
   * Five, from replaying the rule over seven days of Uniswap data: every stock pool tested landed
   * between 0.9 and 2.4 alerts a day. Eight roughly halves that.
   */
  spikeMultiple: number
  /**
   * Smallest hourly volume worth alerting on, in USD.
   *
   * Without a floor the thin stock pools fire three to four times a day, because they are new
   * enough that ordinary growth clears any multiple against a trailing median.
   */
  spikeMinVolumeUsd: number
```

And to `DEFAULT_FILTERS`:

```ts
  spikeEnabled: false,
  spikeMultiple: 5,
  spikeMinVolumeUsd: 100_000,
```

- [ ] **Step 6: Wire the watcher**

In `lib/domain/alertWatcher.ts`, add these imports:

```ts
import { HOUR_MS } from './volumeHistory'
import { sampleStockVolume } from './volumeSampler'
import { detectSpike, type Spike } from './volumeSpike'
import { composeSpikeMessage } from './spikeMessage'
```

The existing types import at the bottom of the import block is `import type { Activity } from '../types'`. Widen it, because `reportSpikes` takes rows:

```ts
import type { Activity, PoolRow } from '../types'
```

Add to the `WatcherState` type, after `announcedInMessage`:

```ts
  /** When each pool last had a spike alerted, so one event does not alert on every poll. */
  spikeAlertedAt: Record<string, number>
```

Initialise it in `FRESH()` as `spikeAlertedAt: {},`.

The cooldown has to outlive a restart, so it is persisted alongside the rest of the alert state.
In `lib/domain/alertStore.ts`, add to the `AlertState` type after `announcedInMessage`:

```ts
  /**
   * When each pool last had a spike alerted.
   *
   * Persisted for the same reason `reported` is: losing it on restart re-fires every spike still
   * inside its cooldown window.
   */
  spikeAlertedAt: Record<string, number>
```

Add `spikeAlertedAt: {}` to the `EMPTY` constant, and to `interpretAlertState`'s returned object:

```ts
    spikeAlertedAt:
      typeof record.spikeAlertedAt === 'object' && record.spikeAlertedAt !== null
        ? Object.fromEntries(
            Object.entries(record.spikeAlertedAt).filter(
              ([, at]) => typeof at === 'number' && Number.isFinite(at),
            ),
          )
        : {},
```

Then in `alertWatcher.ts`'s `restore()`, after `state.announcedInMessage = saved.announcedInMessage`:

```ts
  state.spikeAlertedAt = saved.spikeAlertedAt
```

and in `persist()`, add `spikeAlertedAt: state.spikeAlertedAt,` to the `saveAlertState` object.

Add the reporter above `pollOnce`:

```ts
/**
 * Samples stock pool volume and sends one message for whatever spiked.
 *
 * Scoped to stock pools because that is what the volume history covers; sampling all 2,338 pools
 * hourly would cost an order of magnitude more requests against a gateway the sweep already has
 * to retry around. When `monitoredPoolIds` is set it narrows further, matching how change
 * reports already treat that list.
 */
const reportSpikes = async (rows: PoolRow[]): Promise<void> => {
  const { spikeEnabled, spikeMultiple, spikeMinVolumeUsd, monitoredPoolIds, mentions } =
    state.filters

  if (!spikeEnabled || !telegramConfigured()) return

  const history = await sampleStockVolume(rows)
  const watched = new Set(monitoredPoolIds.map((id) => id.toLowerCase()))

  const settings = {
    multiple: spikeMultiple,
    minVolumeUsd: spikeMinVolumeUsd,
    cooldownMs: 2 * HOUR_MS,
  }

  const spikes: Spike[] = []

  for (const [poolId, buckets] of Object.entries(history)) {
    if (watched.size > 0 && !watched.has(poolId)) continue

    const spike = detectSpike(poolId, buckets, settings, state.spikeAlertedAt[poolId] ?? null)
    if (spike !== null) spikes.push(spike)
  }

  if (spikes.length === 0) return

  const labels = Object.fromEntries(rows.map((row) => [row.poolId.toLowerCase(), row.pair]))

  try {
    await sendTelegramMessage(composeSpikeMessage(spikes, labels, mentions))
    for (const spike of spikes) state.spikeAlertedAt[spike.poolId] = spike.atMs
    persist()
  } catch (error) {
    log(`spike alert failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
```

In `pollOnce`, directly after `await reportChanges(candidates, rows)`:

```ts
    await reportSpikes(rows)
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `bun run test && bun run typecheck`
Expected: PASS. `lib/domain/newPools.test.ts` and `lib/domain/alertStore.test.ts` assert on `DEFAULT_FILTERS` and on the interpreted state; update their expected objects to include the three filter fields and `spikeAlertedAt`.

- [ ] **Step 8: Commit**

```bash
git add lib/domain/newPools.ts lib/domain/alertStore.ts lib/domain/spikeMessage.ts lib/domain/spikeMessage.test.ts lib/domain/alertWatcher.ts lib/domain/newPools.test.ts lib/domain/alertStore.test.ts
git commit -m "Alert on stock pool volume spikes"
```

---

### Task 12: Expose the spike settings in the UI

**Files:**
- Modify: `components/AlertSettings.tsx` (three controls beside the existing ones)

**Interfaces:**
- Consumes: `AlertFilters.spikeEnabled`, `spikeMultiple`, `spikeMinVolumeUsd` (Task 11)
- Produces: nothing new

- [ ] **Step 1: Add the control group**

In `components/AlertSettings.tsx`, insert a third `AlertGroup` directly after the `Watched pools`
group that closes at line 204, before the `Mention` block. It uses the same `AlertGroup`, `Field`
and `NumberField` components the two existing groups use:

```tsx
      <AlertGroup
        name="Volume spikes"
        enabled={filters.spikeEnabled}
        onToggle={(spikeEnabled) => onChange({ ...filters, spikeEnabled })}
        disabled={unavailable}
        note={
          'Watches the stock pools only, comparing each hour against that pool’s own trailing ' +
          'median. Five times over a $100k hourly floor sent roughly one to two messages per pool ' +
          'per day across a seven day sample; raising the multiple to eight roughly halves that.'
        }
      >
        <Field label="Spike multiple">
          <NumberField
            value={filters.spikeMultiple}
            onChange={(spikeMultiple) => onChange({ ...filters, spikeMultiple })}
            suffix="x"
            step={0.5}
          />
        </Field>
        <Field label="Ignore hours under">
          <NumberField
            value={filters.spikeMinVolumeUsd}
            onChange={(spikeMinVolumeUsd) => onChange({ ...filters, spikeMinVolumeUsd })}
            suffix="$/h"
            step={10_000}
          />
        </Field>
      </AlertGroup>
```

If `Field` does not accept two children in one group, check how the `Watched pools` group nests a
single `Field` and repeat the wrapper rather than changing `Field`.

- [ ] **Step 2: Typecheck and run the suite**

Run: `bun run typecheck && bun run test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/AlertSettings.tsx
git commit -m "Expose the spike alert settings"
```

---

---

### Task 13: Per-pool overlay

**Files:**
- Create: `components/StockVolumePanel.tsx`
- Modify: `app/stocks/StocksSection.tsx` (render the panel instead of the bare chart)
- Test: `components/StockVolumePanel.test.tsx`

**Interfaces:**
- Consumes: `StockVolumeChart` (Task 9), `VolumeHistory` (Task 5), `VolumeBucket` (Task 4)
- Produces: `<StockVolumePanel aggregate={VolumeBucket[]} byPool={VolumeHistory} pools={{ poolId: string; pair: string }[]} />`, and `overlayFor(byPool, poolId): VolumeBucket[] | null`

**Deviation from the spec, deliberate.** The spec says selecting a *table row* overlays that
pool's series. This uses a row of pool chips above the chart instead. Threading a selection
callback through `components/PoolTable.tsx`, which is over 1,500 lines and owns its own filter,
sort, sweep and pagination state, is a larger and riskier change than the overlay is worth. The
chosen behaviour, per-pool series on demand, is unchanged; only the affordance moves. Revisit if
the table ever grows a general row-selection mechanism.

- [ ] **Step 1: Write the failing test**

Create `components/StockVolumePanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { overlayFor } from './StockVolumePanel'

const HOUR = 3_600_000
const buckets = [{ hourEndMs: HOUR, volumeUsd: 100, swaps: 5, spanMs: HOUR }]

describe('overlayFor', () => {
  it('finds a pool by id regardless of casing', () => {
    expect(overlayFor({ '0xabc': buckets }, '0xABC')).toEqual(buckets)
  })

  it('yields null when nothing is selected', () => {
    expect(overlayFor({ '0xabc': buckets }, null)).toBeNull()
  })

  it('yields null for a pool with no history sampled yet', () => {
    expect(overlayFor({ '0xabc': buckets }, '0xdef')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test components/StockVolumePanel.test.tsx`
Expected: FAIL, cannot resolve `./StockVolumePanel`.

- [ ] **Step 3: Write the implementation**

Create `components/StockVolumePanel.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { StockVolumeChart } from './StockVolumeChart'
import type { VolumeBucket } from '@/lib/domain/volumeHistory'
import type { VolumeHistory } from '@/lib/domain/volumeStore'

/** One pool's series, or null when nothing is selected or the pool has not been sampled. */
export const overlayFor = (
  byPool: VolumeHistory,
  poolId: string | null,
): VolumeBucket[] | null => (poolId === null ? null : (byPool[poolId.toLowerCase()] ?? null))

type Props = {
  aggregate: VolumeBucket[]
  byPool: VolumeHistory
  pools: { poolId: string; pair: string }[]
}

/**
 * The volume chart plus the pools whose series can be laid over it.
 *
 * Only pools with sampled history are offered, since a chip that overlays nothing reads as a
 * broken control rather than an unsampled pool.
 */
export const StockVolumePanel = ({ aggregate, byPool, pools }: Props) => {
  const [selected, setSelected] = useState<string | null>(null)

  const selectable = pools.filter((pool) => byPool[pool.poolId.toLowerCase()] !== undefined)
  const active = selectable.find((pool) => pool.poolId === selected) ?? null

  return (
    <div>
      <StockVolumeChart
        aggregate={aggregate}
        selected={overlayFor(byPool, selected)}
        selectedLabel={active?.pair ?? null}
      />

      {selectable.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectable.map((pool) => {
            const on = pool.poolId === selected
            return (
              <button
                key={pool.poolId}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected(on ? null : pool.poolId)}
                className={`rounded border px-2 py-1 text-[11px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                  on
                    ? 'border-accent text-ink'
                    : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                {pool.pair}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Render it from the section**

In `app/stocks/StocksSection.tsx`, replace the `StockVolumeChart` import with `StockVolumePanel`,
read the history once, and swap the chart block:

```tsx
  const byPool = readVolumeHistory()
  const aggregate = aggregateSeries(byPool)
```

```tsx
      <div className="mt-6">
        <StockVolumePanel
          aggregate={aggregate}
          byPool={byPool}
          pools={stockRows.map(({ poolId, pair }) => ({ poolId, pair }))}
        />
      </div>
```

- [ ] **Step 5: Run tests and typecheck**

Run: `bun run test && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/StockVolumePanel.tsx components/StockVolumePanel.test.tsx app/stocks/StocksSection.tsx
git commit -m "Overlay one pool's volume series on the chart"
```

---

## Verification

After Task 13, confirm the whole feature:

- [ ] `bun run test` passes with no skipped tests.
- [ ] `bun run typecheck` is clean.
- [ ] `git status` shows no stray files beyond `.volume-history.json`, which is ignored.
- [ ] `grep -rn "as [A-Z]" lib/domain/volume* lib/domain/stockTokens.ts` returns nothing, confirming no type assertions were introduced.
- [ ] `grep -c "" docs/superpowers/plans/2026-08-31-stock-pools-volume.md` is non-zero and the plan's checkboxes are all ticked.
