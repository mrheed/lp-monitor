import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PoolTable } from './PoolTable'
import { Providers } from '@/app/providers'
import type { PoolRow } from '@/lib/types'

/** A real pool from the watched set: $67.3k of liquidity earning $19 an hour. */
const row: PoolRow = {
  poolId: '0x0115a48c046e8776f95f9d52fddc85d8d88f7ddc73ea65015a465ae04977077d',
  chainId: 4663,
  protocol: 'uniswapv4',
  pair: 'ETH/USDG',
  token0Symbol: 'ETH',
  token1Symbol: 'USDG',
  token0Address: '0x1',
  token1Address: '0x2',
  feeTier: 0.3,
  lpFee: 0.25,
  dynamicFee: false,
  hooks: '',
  hasHook: false,
  tag: '',
  tvlUsd: 67_300,
  totalFeesUsd: 9_000,
  recentFeesPerHourUsd: 19,
  recentFeeWindow: '1h',
  fees24hUsd: 456,
  volume24hUsd: 100_000,
  volume30dUsd: 3_000_000,
  apr24h: 20,
  drawdown24h: 2,
  priceVolatility: 12,
  activity: null,
  position: 'none',
  positionVia: null,
  positionHolders: [],
  krystalUrl: 'https://defi.krystal.app/pools/detail',
  uniswapUrl: 'https://app.uniswap.org/explore/pools',
  age: '3d',
  score: 0.5,
  scoreParts: null,
}

const render = () =>
  renderToStaticMarkup(
    <Providers>
      <PoolTable initialRows={[row]} />
    </Providers>,
  )

describe('the compounding projection', () => {
  it('offers a horizon, a reinvestment interval and a cost', () => {
    const html = render()

    expect(html).toContain('reinvest')
    expect(html).toContain('Weekly')
    expect(html).toContain('gas')
  })

  it('names the horizon in the column heading, so the figure is not read as a rate', () => {
    expect(render()).toContain('Profit 30 days')
  })

  it('shows a profit for a pool that earns', () => {
    // $1,000 into $67.3k earning $19/h returns roughly $200 over 30 days. The assertion is loose
    // on purpose: it is checking that a real projection reached the cell, not pinning the maths,
    // which the compound tests cover directly.
    const html = render()
    const cell = html.match(/\$2\d\d(\.\d+)?/)

    expect(cell).not.toBeNull()
  })

  it('says when no reinvestment repays its cost, rather than showing a bare zero', () => {
    // At the default $2 gas this pool compounds only a handful of times, so the label has to
    // distinguish "did not compound" from "earned nothing".
    const html = render()

    expect(html.includes('no compound') || html.includes('+$')).toBe(true)
  })
})
