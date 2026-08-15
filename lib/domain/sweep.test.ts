import { describe, expect, it } from 'vitest'
import { sweepTargets, sweepTargetCount } from './sweep'

const pool = (protocol: string) => ({ protocol })

const mixed = [
  pool('uniswapv4'),
  pool('aerodromecl'),
  pool('uniswapv3'),
  pool('pancakev3'),
  pool('sushiv3'),
  pool('uniswapv2'),
]

describe('what a sweep will attempt', () => {
  it('keeps only the pools the transaction feed indexes', () => {
    expect(sweepTargets(mixed, 100).map((row) => row.protocol)).toEqual([
      'uniswapv4',
      'uniswapv3',
      'uniswapv2',
    ])
  })

  it('counts what it will attempt, not what exists', () => {
    // The bug this exists to prevent: the counter expected every pool while the sweep skipped
    // the ones it could never measure, so progress stopped at 3,516 of 4,336 and looked stalled
    // when the sweep had finished everything available to it.
    expect(sweepTargetCount(mixed, 100)).toBe(3)
  })

  it('applies the rank limit before filtering, so the cohort stays the ranked prefix', () => {
    // Filtering first would pull lower ranked Uniswap pools up into the measured set and change
    // which cohort a score is computed against.
    expect(sweepTargetCount(mixed, 2)).toBe(1)
  })

  it('reaches its target when every pool is indexed', () => {
    const all = [pool('uniswapv3'), pool('uniswapv4')]

    expect(sweepTargetCount(all, 100)).toBe(all.length)
  })

  it('targets nothing when no pool can be measured', () => {
    // A chain of Aerodrome pools alone should read as complete rather than as permanently stuck at zero.
    expect(sweepTargetCount([pool('aerodromecl'), pool('sushiv2')], 100)).toBe(0)
  })

  it('handles an empty list', () => {
    expect(sweepTargetCount([], 100)).toBe(0)
  })
})
