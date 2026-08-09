import { describe, expect, it } from 'vitest'
import { shortenAddress, trackedWallets } from './config'

const WALLET_A = '0x1111111111111111111111111111111111111111'
const WALLET_B = '0x2222222222222222222222222222222222222222'

/** Runs the reader against a given LP_WALLETS value. */
const withEnv = (value: string | undefined) => {
  const previous = process.env.LP_WALLETS
  if (value === undefined) delete process.env.LP_WALLETS
  else process.env.LP_WALLETS = value
  try {
    return trackedWallets()
  } finally {
    if (previous === undefined) delete process.env.LP_WALLETS
    else process.env.LP_WALLETS = previous
  }
}

describe('shortenAddress', () => {
  it('keeps the leading and trailing hex', () => {
    expect(shortenAddress(WALLET_A)).toBe('0x1111…1111')
  })
})

describe('trackedWallets', () => {
  it('returns nothing when unset', () => {
    expect(withEnv(undefined)).toEqual([])
  })

  it('reads a single address and labels it by its short form', () => {
    expect(withEnv(WALLET_A)).toEqual([{ address: WALLET_A, label: '0x1111…1111' }])
  })

  it('reads a label given after an equals sign', () => {
    expect(withEnv(`${WALLET_A}=Main`)).toEqual([{ address: WALLET_A, label: 'Main' }])
  })

  it('reads several wallets, labelled and not', () => {
    expect(withEnv(`${WALLET_A}=Main, ${WALLET_B}`)).toEqual([
      { address: WALLET_A, label: 'Main' },
      { address: WALLET_B, label: '0x2222…2222' },
    ])
  })

  it('lowercases addresses so they join against the pool feed', () => {
    expect(withEnv(WALLET_A.toUpperCase().replace('0X', '0x'))[0].address).toBe(WALLET_A)
  })

  it('drops entries that are not addresses', () => {
    expect(withEnv(`not-an-address=Main, ${WALLET_A}`)).toEqual([
      { address: WALLET_A, label: '0x1111…1111' },
    ])
  })

  it('keeps an equals sign inside a label', () => {
    expect(withEnv(`${WALLET_A}=a=b`)[0].label).toBe('a=b')
  })
})
