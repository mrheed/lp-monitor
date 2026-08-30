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
