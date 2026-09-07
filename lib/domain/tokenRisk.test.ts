import { describe, expect, it } from 'vitest'
import { assessToken, poolRisk, type TokenSecurity } from './tokenRisk'

/** GMGN's reading of a token that passes every check. */
const clean: TokenSecurity = {
  address: '0xd5f1',
  isHoneypot: false,
  showsAlert: false,
  isOpenSource: true,
  isBlacklisted: false,
  buyTaxPercent: 0,
  sellTaxPercent: 0,
  topTenHolderRate: 0.17,
}

describe('reading one token', () => {
  it('calls a honeypot critical, whatever else looks fine', () => {
    // Both tokens that drained this operator's holders read honeypot true while showing zero
    // tax, open source and renounced ownership. Every other field said "safe".
    const risk = assessToken({ ...clean, isHoneypot: true })

    expect(risk.level).toBe('critical')
    expect(risk.reasons.join(' ')).toMatch(/honeypot/i)
  })

  it('clears a token that passes every check', () => {
    expect(assessToken(clean).level).toBe('clear')
  })

  it('is unknown when there is no reading, never clear', () => {
    // The lesson from every trap this tracker has ranked: an absent check is not a passed one.
    const risk = assessToken(null)

    expect(risk.level).toBe('unknown')
    expect(risk.reasons.join(' ')).toMatch(/no security data/i)
  })

  it('cautions on an unverified contract, since nothing about it can be read', () => {
    const risk = assessToken({ ...clean, isOpenSource: false })

    expect(risk.level).toBe('caution')
    expect(risk.reasons.join(' ')).toMatch(/not verified|unverified/i)
  })

  it('cautions when the feed raises its own alert', () => {
    expect(assessToken({ ...clean, showsAlert: true }).level).toBe('caution')
  })

  it('cautions on a blacklist function, which can freeze a holder', () => {
    expect(assessToken({ ...clean, isBlacklisted: true }).level).toBe('caution')
  })

  it('cautions on a tax high enough to eat a position', () => {
    const risk = assessToken({ ...clean, sellTaxPercent: 12 })

    expect(risk.level).toBe('caution')
    expect(risk.reasons.join(' ')).toMatch(/12/)
  })

  it('ignores a tax small enough to be an ordinary fee', () => {
    expect(assessToken({ ...clean, buyTaxPercent: 1 }).level).toBe('clear')
  })

  it('cautions when a handful of wallets hold most of the supply', () => {
    const risk = assessToken({ ...clean, topTenHolderRate: 0.85 })

    expect(risk.level).toBe('caution')
    expect(risk.reasons.join(' ')).toMatch(/85/)
  })

  it('names every reason it found, not just the first', () => {
    const risk = assessToken({ ...clean, isOpenSource: false, sellTaxPercent: 20 })

    expect(risk.reasons).toHaveLength(2)
  })

  it('keeps a null field out of the reasons rather than guessing', () => {
    // GMGN returns null for checks it could not run. Reporting those as passed would repeat
    // the mistake this whole layer exists to prevent.
    const risk = assessToken({ ...clean, isBlacklisted: null })

    expect(risk.level).toBe('clear')
    expect(risk.reasons.join(' ')).not.toMatch(/blacklist/i)
  })
})

describe('a pool takes the worse of its two tokens', () => {
  const honeypot: TokenSecurity = { ...clean, address: '0xe7e5', isHoneypot: true }
  const unverified: TokenSecurity = { ...clean, address: '0xbad', isOpenSource: false }

  it('is critical when either side is a honeypot', () => {
    expect(poolRisk(clean, honeypot).level).toBe('critical')
    expect(poolRisk(honeypot, clean).level).toBe('critical')
  })

  it('is caution when one side merely warns', () => {
    expect(poolRisk(clean, unverified).level).toBe('caution')
  })

  it('is clear only when both sides are', () => {
    expect(poolRisk(clean, clean).level).toBe('clear')
  })

  it('is unknown when either side was never read', () => {
    // A pair is only as checked as its least-checked half.
    expect(poolRisk(clean, null).level).toBe('unknown')
  })

  it('prefers a real risk over an unread token, since the risk is the actionable half', () => {
    expect(poolRisk(honeypot, null).level).toBe('critical')
  })

  it('names which token each reason came from', () => {
    const risk = poolRisk(clean, honeypot)

    expect(risk.reasons.join(' ')).toMatch(/0xe7e5/)
  })
})
