/**
 * One token's security fields, as GMGN reports them.
 *
 * Nullable where GMGN itself returns null, which means "not checked" rather than "passed". The
 * distinction is the whole point of this module: this tracker has twice ranked a drain-capable
 * token at the top of its table because every field it read looked ordinary.
 */
export type TokenSecurity = {
  address: string
  isHoneypot: boolean | null
  showsAlert: boolean | null
  isOpenSource: boolean | null
  isBlacklisted: boolean | null
  buyTaxPercent: number | null
  sellTaxPercent: number | null
  topTenHolderRate: number | null
}

/** How much the reader should worry, worst first. */
export type RiskLevel = 'critical' | 'caution' | 'clear' | 'unknown'

export type Risk = {
  level: RiskLevel
  /** Every finding, each naming the field it came from. Empty when clear. */
  reasons: string[]
}

/** A tax high enough to matter against a pool's own fee, rather than an ordinary transfer fee. */
const TAX_LIMIT_PERCENT = 5

/** Concentration at which a handful of wallets can end the market for everyone else. */
const CONCENTRATION_LIMIT = 0.6

/**
 * Turns one token's security fields into a verdict.
 *
 * A honeypot reading is critical on its own and outranks everything: both tokens that drained
 * holders on this chain reported zero tax, verified source and renounced ownership, and were
 * flagged by this field alone.
 *
 * Absent data never clears a check. A token GMGN has no reading for is `unknown`, which the UI
 * shows as unchecked rather than safe.
 */
export const assessToken = (security: TokenSecurity | null): Risk => {
  if (security === null) {
    return { level: 'unknown', reasons: ['No security data for this token'] }
  }

  const reasons: string[] = []

  if (security.isHoneypot === true) {
    reasons.push('Flagged as a honeypot: buyers may be unable to sell')
  }
  if (security.isOpenSource === false) {
    reasons.push('Contract is not verified, so its behaviour cannot be read')
  }
  if (security.isBlacklisted === true) {
    reasons.push('Contract can blacklist an address, which freezes that holder')
  }
  if (security.showsAlert === true) {
    reasons.push('Feed raises its own alert on this token')
  }

  const tax = Math.max(security.buyTaxPercent ?? 0, security.sellTaxPercent ?? 0)
  if (tax > TAX_LIMIT_PERCENT) {
    reasons.push(`Transfer tax of ${tax}% on a trade`)
  }

  const concentration = security.topTenHolderRate
  if (concentration !== null && concentration > CONCENTRATION_LIMIT) {
    reasons.push(`Top ten wallets hold ${Math.round(concentration * 100)}% of supply`)
  }

  if (security.isHoneypot === true) return { level: 'critical', reasons }
  if (reasons.length > 0) return { level: 'caution', reasons }
  return { level: 'clear', reasons: [] }
}

const RANK: Record<RiskLevel, number> = { critical: 3, caution: 2, unknown: 1, clear: 0 }

/**
 * A pool's risk is the worse of the two tokens it holds.
 *
 * Depositing into a pair means holding both sides, so a pool is exactly as safe as its weaker
 * token. Reasons carry the token address that produced them, since a pair names two contracts
 * and the reader needs to know which one is the problem.
 */
export const poolRisk = (
  token0: TokenSecurity | null,
  token1: TokenSecurity | null,
): Risk => {
  const each = [token0, token1].map((token) => ({ token, risk: assessToken(token) }))
  const worst = each.reduce((carry, entry) =>
    RANK[entry.risk.level] > RANK[carry.risk.level] ? entry : carry,
  )

  const reasons = each.flatMap(({ token, risk }) =>
    risk.level === 'clear'
      ? []
      : risk.reasons.map((reason) => (token ? `${token.address}: ${reason}` : reason)),
  )

  return { level: worst.risk.level, reasons }
}
