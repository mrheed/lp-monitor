import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  detectNewPools,
  formatAlert,
  matchesFilters,
  NAMED_LIMIT,
  matchesTickers,
  normaliseHandle,
  type AlertCandidate,
} from './newPools'

/** Builds a pool the filters can judge. */
const pool = (
  poolId: string,
  {
    feeTier = 1,
    dynamicFee = false,
    hasHook = false,
    tvlUsd = 5_000,
    recentFeesPerHourUsd = 120,
    totalFeesUsd = 9_400,
    recentFeeWindow = '1h',
    txPerHour = 340,
    volumeUsdPerHour = 5_000,
    krystalUrl = 'https://defi.krystal.app/pools/detail?chainId=4663&poolAddress=0xabc&protocol=uniswapv4',
    uniswapUrl = 'https://app.uniswap.org/explore/pools/robinhood/0xabc',
    openHolders = [],
  }: Partial<Omit<AlertCandidate, 'poolId' | 'pair'>> = {},
): AlertCandidate => ({
  poolId,
  pair: 'ETH/USDG',
  feeTier,
  dynamicFee,
  hasHook,
  tvlUsd,
  recentFeesPerHourUsd,
  totalFeesUsd,
  recentFeeWindow,
  txPerHour,
  volumeUsdPerHour,
  krystalUrl,
  uniswapUrl,
  openHolders,
})

const on = { ...DEFAULT_FILTERS, enabled: true }

describe('matchesFilters', () => {
  it('passes a pool at or above the fee floor', () => {
    expect(matchesFilters(pool('a', { feeTier: 1 }), { ...on, minFeeTier: 1 })).toBe(true)
  })

  it('rejects a pool below the fee floor', () => {
    expect(matchesFilters(pool('a', { feeTier: 0.3 }), { ...on, minFeeTier: 1 })).toBe(false)
  })

  it('passes a dynamic fee pool at any floor, since it has no fixed tier', () => {
    // Its feeTier reads 0, which means "not applicable" rather than "free".
    const dynamic = pool('a', { feeTier: 0, dynamicFee: true })

    expect(matchesFilters(dynamic, { ...on, minFeeTier: 5 })).toBe(true)
  })

  it('requires a hook when asked for one', () => {
    expect(matchesFilters(pool('a', { hasHook: false }), { ...on, hooks: 'with' })).toBe(false)
    expect(matchesFilters(pool('a', { hasHook: true }), { ...on, hooks: 'with' })).toBe(true)
  })

  it('excludes hooked pools when asked for none', () => {
    expect(matchesFilters(pool('a', { hasHook: true }), { ...on, hooks: 'without' })).toBe(false)
    expect(matchesFilters(pool('a', { hasHook: false }), { ...on, hooks: 'without' })).toBe(true)
  })

  it('accepts either when hooks are not filtered', () => {
    expect(matchesFilters(pool('a', { hasHook: true }), on)).toBe(true)
    expect(matchesFilters(pool('a', { hasHook: false }), on)).toBe(true)
  })
})

describe('detectNewPools', () => {
  it('reports nothing when nothing has been seen yet', () => {
    const { fresh, seen } = detectNewPools(null, [pool('a'), pool('b')], on)

    expect(fresh).toEqual([])
    expect(seen).toEqual(new Set(['a', 'b']))
  })

  it('reports a pool that was not in the previous set', () => {
    const { fresh } = detectNewPools(new Set(['a']), [pool('a'), pool('b')], on)

    expect(fresh.map((p) => p.poolId)).toEqual(['b'])
  })

  it('reports nothing when no pool is new', () => {
    expect(detectNewPools(new Set(['a', 'b']), [pool('a'), pool('b')], on).fresh).toEqual([])
  })

  it('compares ids case insensitively', () => {
    const { fresh } = detectNewPools(new Set(['0xabc']), [pool('0xABC')], on)

    expect(fresh).toEqual([])
  })

  it('applies the filters to new pools', () => {
    const { fresh } = detectNewPools(
      new Set(['a']),
      [pool('b', { feeTier: 0.3 }), pool('c', { feeTier: 5 })],
      { ...on, minFeeTier: 1 },
    )

    expect(fresh.map((p) => p.poolId)).toEqual(['c'])
  })

  it('reports nothing while disabled, but still tracks what it saw', () => {
    const { fresh, seen } = detectNewPools(new Set(['a']), [pool('a'), pool('b')], DEFAULT_FILTERS)

    expect(fresh).toEqual([])
    expect(seen.has('b')).toBe(true)
  })

  it('is off by default, so connecting a bot never starts sending on its own', () => {
    expect(DEFAULT_FILTERS.enabled).toBe(false)
  })
})

describe('normaliseHandle', () => {
  it('adds the sigil when missing', () => {
    expect(normaliseHandle('someone_here')).toBe('@someone_here')
  })

  it('keeps a handle that already has one, and trims', () => {
    expect(normaliseHandle('  @someone_here ')).toBe('@someone_here')
  })

  it('rejects something that is not a handle', () => {
    expect(normaliseHandle('no spaces allowed')).toBe(null)
    expect(normaliseHandle('tiny')).toBe(null)
    expect(normaliseHandle('')).toBe(null)
  })
})

describe('formatAlert', () => {
  it('names a single pool with its fee and depth', () => {
    const message = formatAlert([pool('a', { feeTier: 5.095, tvlUsd: 1234 })])

    expect(message).toContain('New pool on Robinhood Chain')
    expect(message).toContain('ETH/USDG')
    expect(message).toContain('5.095% fee')
    // Compact throughout, so the message and the table read the same.
    expect(message).toContain('$1.2k TVL')
  })

  it('reports the recent fee rate with the window it came from', () => {
    const message = formatAlert([
      pool('a', { recentFeesPerHourUsd: 3_400, recentFeeWindow: '1h' }),
    ])

    expect(message).toContain('$3.4k/h 1h')
  })

  it('reports accumulated fees alongside the rate', () => {
    expect(formatAlert([pool('a', { totalFeesUsd: 77_800 })])).toContain('$77.8k total')
  })

  it('reports the trade rate', () => {
    expect(formatAlert([pool('a', { txPerHour: 1_700 })])).toContain('1.7k/h trades')
  })

  it('says a pool is unmeasured rather than showing it as idle', () => {
    // A pool that just appeared has no reading yet, and zero would read as "nobody trades it".
    const message = formatAlert([pool('a', { txPerHour: null })])

    expect(message).toContain('not yet measured')
    expect(message).not.toContain('0/h trades')
  })

  it('falls back to a daily figure when an hourly rate would round to nothing', () => {
    expect(formatAlert([pool('a', { txPerHour: 0.25 })])).toContain('6.0/d trades')
  })

  it('omits the window when there is none to report', () => {
    const message = formatAlert([pool('a', { recentFeeWindow: 'none' })])

    expect(message).not.toContain('(none)')
    expect(message).not.toContain('/h none')
  })

  it('counts a batch in the heading rather than sending one message each', () => {
    expect(formatAlert([pool('a'), pool('b')])).toContain('2 new pools')
  })

  it('summarises beyond the first few so a burst stays readable', () => {
    const many = Array.from({ length: 12 }, (_, i) => pool(String(i)))

    expect(formatAlert(many)).toContain('…and 4 more')
  })

  it('marks a hooked pool', () => {
    expect(formatAlert([pool('a', { hasHook: true })])).toContain('hook')
  })

  it('leads with the mentions so the people named see why they were pinged', () => {
    const message = formatAlert([pool('a')], ['someone_here', '@other_person'])

    expect(message.split('\n')[0]).toBe('@someone_here @other_person')
  })

  it('omits the mention line when there is nobody to name', () => {
    expect(formatAlert([pool('a')]).startsWith('@')).toBe(false)
  })

  it('drops handles that would notify nobody', () => {
    expect(formatAlert([pool('a')], ['not a handle'])).not.toContain('not a handle')
  })
})

describe('formatAlert resilience', () => {
  /** A pool queued before a field existed, which a reload can produce. */
  const partial = {
    poolId: 'a',
    pair: 'ETH/USDG',
    feeTier: 0.05,
    dynamicFee: false,
    hasHook: true,
    tvlUsd: 14_630,
  } as unknown as AlertCandidate

  it('never renders a missing figure as NaN', () => {
    const message = formatAlert([partial])

    expect(message).not.toContain('NaN')
    expect(message).toContain('ETH/USDG')
    expect(message).toContain('$14.6k TVL')
  })
})

describe('formatAlert links', () => {
  it('links each pool to both explorers behind short labels', () => {
    const message = formatAlert([pool('a')])

    expect(message).toContain('>Krystal</a>')
    expect(message).toContain('>Uniswap</a>')
    expect(message).toContain('href="https://defi.krystal.app/pools/detail')
  })

  it('omits a link that has no url rather than emitting an empty anchor', () => {
    const message = formatAlert([pool('a', { uniswapUrl: '' })])

    expect(message).toContain('>Krystal</a>')
    expect(message).not.toContain('>Uniswap</a>')
  })

  it('escapes a pair name so a token symbol cannot break the message', () => {
    // Token symbols are chosen by whoever deployed them. An unescaped angle bracket makes
    // Telegram reject the whole message with a 400, losing the alert entirely.
    const hostile = { ...pool('a'), pair: '<b>PWN</b>/USDG & co' }
    const message = formatAlert([hostile])

    expect(message).toContain('&lt;b&gt;PWN&lt;/b&gt;/USDG &amp; co')
    expect(message).not.toContain('<b>PWN</b>')
  })

  it('escapes a url before putting it in an attribute', () => {
    const message = formatAlert([pool('a', { krystalUrl: 'https://x.test/?a=1&b=2' })])

    expect(message).toContain('href="https://x.test/?a=1&amp;b=2"')
  })
})

describe('send batching', () => {
  it('names every pool a message can mark as announced', () => {
    // The batch size and the naming limit are the same number on purpose: a pool summarised as
    // "and N more" would be recorded as told without having been named to anyone.
    const batch = Array.from({ length: NAMED_LIMIT }, (_, i) => pool(String(i)))
    const message = formatAlert(batch)

    expect(message).not.toContain('more')
    for (let i = 0; i < NAMED_LIMIT; i += 1) expect(message).toContain(`P${i}`.slice(0, 0) + 'ETH/USDG')
  })
})

describe('matchesTickers', () => {
  it('matches every pool when nothing is listed', () => {
    expect(matchesTickers('ETH/USDG', [])).toBe(true)
  })

  it('matches either side of the pair', () => {
    expect(matchesTickers('ETH/USDG', ['USDG'])).toBe(true)
    expect(matchesTickers('ETH/USDG', ['ETH'])).toBe(true)
  })

  it('ignores case and surrounding space', () => {
    expect(matchesTickers('ETH/USDG', [' usdg '])).toBe(true)
  })

  it('compares whole symbols, not substrings', () => {
    // A substring test would make ETH match WETH, quietly widening every filter that names it.
    expect(matchesTickers('CASHCAT/WETH', ['ETH'])).toBe(false)
  })

  it('rejects a pool naming none of the listed tickers', () => {
    expect(matchesTickers('ETH/USDG', ['PONS'])).toBe(false)
  })
})

describe('fee type filter', () => {
  it('keeps only dynamic fee pools when asked', () => {
    const filters = { ...on, dynamicFee: 'only' as const }

    expect(matchesFilters(pool('a', { dynamicFee: true }), filters)).toBe(true)
    expect(matchesFilters(pool('a', { dynamicFee: false }), filters)).toBe(false)
  })

  it('excludes dynamic fee pools when asked', () => {
    const filters = { ...on, dynamicFee: 'exclude' as const }

    expect(matchesFilters(pool('a', { dynamicFee: true }), filters)).toBe(false)
    expect(matchesFilters(pool('a', { dynamicFee: false }), filters)).toBe(true)
  })

  it('accepts either by default', () => {
    expect(matchesFilters(pool('a', { dynamicFee: true }), on)).toBe(true)
    expect(matchesFilters(pool('a', { dynamicFee: false }), on)).toBe(true)
  })
})

describe('formatAlert as a single edited message', () => {
  it('says how many were announced before the ones it lists', () => {
    // The message is edited in place, so without this the earlier pools would vanish silently.
    const message = formatAlert([pool('a'), pool('b')], [], 30)

    expect(message).toContain('plus 28 announced earlier')
  })

  it('says nothing extra when it covers everything so far', () => {
    expect(formatAlert([pool('a'), pool('b')], [], 2)).not.toContain('announced earlier')
  })

  it('says nothing extra on the first send, before a total exists', () => {
    expect(formatAlert([pool('a')])).not.toContain('announced earlier')
  })

  it('never reports a negative earlier count', () => {
    expect(formatAlert([pool('a'), pool('b'), pool('c')], [], 1)).not.toContain('earlier')
  })
})
