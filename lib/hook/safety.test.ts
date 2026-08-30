import { describe, expect, it } from 'vitest'
import { HOOK_FLAGS, assessHook, decodePermissions, type HookPermissions } from './safety'

/** A hook address whose low 14 bits carry the given permission mask. */
const hookWith = (bits: number): `0x${string}` => {
  const high = BigInt('0x4d7bc684cc263abe62e2463eade031047325') << 14n
  return `0x${((high | BigInt(bits)) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`
}

describe('decodePermissions', () => {
  it('reads every flag from the low 14 bits of the address', () => {
    const all = decodePermissions(hookWith(0x3fff))
    const enabled = Object.values(all).every(Boolean)
    expect(enabled).toBe(true)
  })

  it('reports no permissions for a hookless pool', () => {
    const none = decodePermissions('0x0000000000000000000000000000000000000000')
    expect(Object.values(none).some(Boolean)).toBe(false)
  })

  it('decodes the swap-only volume-tier shape', () => {
    const p = decodePermissions(hookWith(HOOK_FLAGS.beforeSwap | HOOK_FLAGS.beforeAddLiquidity))
    expect(p.beforeSwap).toBe(true)
    expect(p.beforeAddLiquidity).toBe(true)
    expect(p.afterRemoveLiquidity).toBe(false)
  })
})

describe('assessHook', () => {
  it('clears a hookless pool as the safest case', () => {
    const r = assessHook('0x0000000000000000000000000000000000000000')
    expect(r.level).toBe('safe')
    expect(r.findings).toHaveLength(0)
  })

  it('clears a swap-fee-only hook: it can price swaps but never touch liquidity', () => {
    const r = assessHook(hookWith(HOOK_FLAGS.beforeSwap))
    expect(r.level).toBe('safe')
    expect(r.canBlockDeposit).toBe(false)
    expect(r.canBlockWithdrawal).toBe(false)
    expect(r.canSkimWithdrawal).toBe(false)
  })

  it('flags a deposit gate as caution, since funds can still be withdrawn', () => {
    const r = assessHook(hookWith(HOOK_FLAGS.beforeSwap | HOOK_FLAGS.beforeAddLiquidity))
    expect(r.canBlockDeposit).toBe(true)
    expect(r.canBlockWithdrawal).toBe(false)
    expect(r.level).toBe('caution')
  })

  it('treats any withdrawal callback as critical, because exit is what protects capital', () => {
    const r = assessHook(hookWith(HOOK_FLAGS.beforeRemoveLiquidity))
    expect(r.canBlockWithdrawal).toBe(true)
    expect(r.level).toBe('critical')
  })

  it('treats a withdrawal skim as critical', () => {
    const r = assessHook(
      hookWith(HOOK_FLAGS.afterRemoveLiquidity | HOOK_FLAGS.afterRemoveLiquidityReturnDelta),
    )
    expect(r.canSkimWithdrawal).toBe(true)
    expect(r.level).toBe('critical')
  })

  it('flags swap skimming, which makes the quoted price hide the real fee', () => {
    const r = assessHook(hookWith(HOOK_FLAGS.afterSwap | HOOK_FLAGS.afterSwapReturnDelta))
    expect(r.canSkimSwap).toBe(true)
    expect(r.findings.some((f) => f.id === 'skim-swap')).toBe(true)
  })

  it('rates the real-world NVDAc hook critical on every liquidity axis', () => {
    // 0x…25c7: beforeInitialize, afterAdd, afterRemove, beforeSwap, afterSwap + all 3 deltas.
    const r = assessHook('0x4d7bc684cc263abe62e2463eade03104732525c7')
    expect(r.level).toBe('critical')
    expect(r.canSkimWithdrawal).toBe(true)
    expect(r.canSkimDeposit).toBe(true)
    expect(r.canSkimSwap).toBe(true)
  })

  it('rates the real-world ownerless ETH/USDG hook safe', () => {
    // 0x…8080: beforeSwap only.
    const r = assessHook('0x84df0302a9be7e18fc508c323847a9dbb2948080')
    expect(r.level).toBe('safe')
  })

  it('orders findings worst-first so the headline risk reads first', () => {
    const r = assessHook('0x4d7bc684cc263abe62e2463eade03104732525c7')
    const rank = { critical: 0, warning: 1, info: 2 } as const
    const ranks = r.findings.map((f) => rank[f.severity])
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })
})
