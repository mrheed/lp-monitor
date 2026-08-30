/**
 * Static safety analysis of a Uniswap v4 hook, from its address alone.
 *
 * A hook's powers are encoded in the low 14 bits of its address and are fixed at deployment: the
 * PoolManager reads them to decide which callbacks to invoke, and CREATE2 makes them immutable.
 * That makes the address a trustworthy source even when the contract is unverified — which the
 * predatory ones invariably are.
 */

/** Permission bit positions, per v4-core `Hooks.sol`. */
export const HOOK_FLAGS = {
  beforeInitialize: 1 << 13,
  afterInitialize: 1 << 12,
  beforeAddLiquidity: 1 << 11,
  afterAddLiquidity: 1 << 10,
  beforeRemoveLiquidity: 1 << 9,
  afterRemoveLiquidity: 1 << 8,
  beforeSwap: 1 << 7,
  afterSwap: 1 << 6,
  beforeDonate: 1 << 5,
  afterDonate: 1 << 4,
  beforeSwapReturnDelta: 1 << 3,
  afterSwapReturnDelta: 1 << 2,
  afterAddLiquidityReturnDelta: 1 << 1,
  afterRemoveLiquidityReturnDelta: 1 << 0,
} as const

export type HookPermission = keyof typeof HOOK_FLAGS
export type HookPermissions = Record<HookPermission, boolean>

/** The mask covering every permission bit (`Hooks.ALL_HOOK_MASK`). */
export const ALL_HOOK_MASK = 0x3fff

export type Severity = 'critical' | 'warning' | 'info'
export type RiskLevel = 'safe' | 'caution' | 'critical'

export type Finding = {
  id: string
  severity: Severity
  title: string
  detail: string
}

export type HookAssessment = {
  permissions: HookPermissions
  bits: number
  /** True when the hook runs on deposits and can therefore reject them. */
  canBlockDeposit: boolean
  /** True when the hook runs on withdrawals and can therefore reject them. */
  canBlockWithdrawal: boolean
  canSkimDeposit: boolean
  canSkimWithdrawal: boolean
  canSkimSwap: boolean
  setsSwapFee: boolean
  level: RiskLevel
  findings: Finding[]
}

/** Reads the permission bits encoded in a hook address. */
export const decodePermissions = (hook: string): HookPermissions => {
  const bits = Number(BigInt(hook) & BigInt(ALL_HOOK_MASK))
  const entries = Object.entries(HOOK_FLAGS) as [HookPermission, number][]
  return Object.fromEntries(entries.map(([name, bit])=> [name, (bits & bit) !== 0])) as HookPermissions
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

/**
 * Grades a hook's powers from the LP's point of view.
 *
 * The ordering principle is that being able to leave matters more than anything else: a hook that
 * runs on withdrawal can refuse or tax the exit, which puts deposited capital at its mercy, so any
 * withdrawal callback is critical. A deposit gate is uncomfortable but recoverable, because funds
 * already in the pool can still come out.
 */
export const assessHook = (hook: string): HookAssessment => {
  const permissions = decodePermissions(hook)
  const bits = Number(BigInt(hook) & BigInt(ALL_HOOK_MASK))
  const findings: Finding[] = []

  const canBlockWithdrawal = permissions.beforeRemoveLiquidity || permissions.afterRemoveLiquidity
  const canSkimWithdrawal =
    permissions.afterRemoveLiquidity && permissions.afterRemoveLiquidityReturnDelta
  const canBlockDeposit = permissions.beforeAddLiquidity || permissions.afterAddLiquidity
  const canSkimDeposit = permissions.afterAddLiquidity && permissions.afterAddLiquidityReturnDelta
  const canSkimSwap =
    (permissions.afterSwap && permissions.afterSwapReturnDelta) || permissions.beforeSwapReturnDelta
  const setsSwapFee = permissions.beforeSwap

  if (canSkimWithdrawal) {
    findings.push({
      id: 'skim-withdrawal',
      severity: 'critical',
      title: 'Can take a cut of your withdrawal',
      detail:
        'The hook runs on removal and is authorised to claim value from it, so it can tax the amount you take out.',
    })
  }
  if (canBlockWithdrawal) {
    findings.push({
      id: 'block-withdrawal',
      severity: 'critical',
      title: 'Can block your withdrawal',
      detail:
        'Removal calls into the hook, so it can revert and trap deposited capital in the pool.',
    })
  }
  if (canSkimDeposit) {
    findings.push({
      id: 'skim-deposit',
      severity: 'critical',
      title: 'Can take a cut of your deposit',
      detail: 'The hook runs on adds and can claim value from the amount you put in.',
    })
  }
  if (canBlockDeposit) {
    findings.push({
      id: 'block-deposit',
      severity: 'warning',
      title: 'Can refuse your deposit',
      detail:
        'Adding liquidity calls the hook, so the operator can whitelist LPs or disable deposits. Existing funds can still be withdrawn.',
    })
  }
  if (canSkimSwap) {
    findings.push({
      id: 'skim-swap',
      severity: 'warning',
      title: 'Takes a cut of every swap',
      detail:
        'The hook claims a swap delta, a fee the pool fee field never reports, so quoted prices hide it and LPs do not receive it.',
    })
  }
  if (setsSwapFee) {
    findings.push({
      id: 'dynamic-fee',
      severity: 'info',
      title: 'Sets the swap fee per trade',
      detail:
        'Legitimate for volatility pricing, but also how a pool runs at 0% and spikes on demand. Check the live fee, not the default.',
    })
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  const level: RiskLevel = findings.some((f) => f.severity === 'critical')
    ? 'critical'
    : findings.some((f) => f.severity === 'warning')
      ? 'caution'
      : 'safe'

  return {
    permissions,
    bits,
    canBlockDeposit,
    canBlockWithdrawal,
    canSkimDeposit,
    canSkimWithdrawal,
    canSkimSwap,
    setsSwapFee,
    level,
    findings,
  }
}
