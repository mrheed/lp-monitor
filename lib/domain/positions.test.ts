import { describe, expect, it } from 'vitest'
import {
  buildPositionIndex,
  holdersFor,
  positionStateFor,
  positionViaFor,
  type DirectPosition,
  type PoolIdentity,
} from './positions'

const WALLET_A = '0xaaa1'
const WALLET_B = '0xbbb2'

const V4_POOL_ID = '0xffaaf25d8bc4fee335f6767df01ae2452ee011ef9031e140421fd8ffa9bfb975'
const V3_POOL_ADDRESS = '0x5d25149b5710f4df0a485F075668e1649c4bb2f9'

/** Builds a pool a position can resolve against. */
const pool = (poolId: string): PoolIdentity => ({ poolId })

/** Builds a direct position. */
const direct = (poolId: string, status = 'IN_RANGE', wallet = WALLET_A): DirectPosition => ({
  wallet,
  poolId,
  status,
})

/** Builds a vault-held position. */
const vault = (id: string, exited: boolean, wallet = WALLET_A) => ({ wallet, id, exited })

describe('buildPositionIndex', () => {
  it('matches a v4 position on its 32 byte pool id', () => {
    const { byPool } = buildPositionIndex([direct(V4_POOL_ID)], [], [pool(V4_POOL_ID)])

    expect(positionStateFor(byPool, V4_POOL_ID)).toBe('open')
    expect(positionViaFor(byPool, V4_POOL_ID)).toBe('direct')
  })

  it('matches a v3 position on its 20 byte pool address', () => {
    const { byPool } = buildPositionIndex(
      [direct(V3_POOL_ADDRESS)],
      [],
      [pool(V3_POOL_ADDRESS)],
    )

    expect(positionStateFor(byPool, V3_POOL_ADDRESS)).toBe('open')
  })

  it('joins across the hex casing mismatch between the two endpoints', () => {
    const { byPool } = buildPositionIndex(
      [direct(V3_POOL_ADDRESS.toUpperCase())],
      [],
      [pool(V3_POOL_ADDRESS.toLowerCase())],
    )

    expect(positionStateFor(byPool, V3_POOL_ADDRESS)).toBe('open')
  })

  it('distinguishes two pools that share a token pair', () => {
    // ETH/USDG spans sixteen v4 pools on this chain. Identifying them by pool id is the whole
    // reason this feed is used: a token pair cannot tell them apart.
    const first = '0x205e1ed5'
    const second = '0xa53aed8e'
    const { byPool } = buildPositionIndex(
      [direct(first)],
      [],
      [pool(first), pool(second)],
    )

    expect(positionStateFor(byPool, first)).toBe('open')
    expect(positionStateFor(byPool, second)).toBe('none')
  })

  it('marks a closed position as closed', () => {
    const { byPool } = buildPositionIndex(
      [direct(V4_POOL_ID, 'CLOSED')],
      [],
      [pool(V4_POOL_ID)],
    )

    expect(positionStateFor(byPool, V4_POOL_ID)).toBe('closed')
  })

  it('treats an out-of-range position as still open, since capital remains deployed', () => {
    const { byPool } = buildPositionIndex(
      [direct(V4_POOL_ID, 'OUT_RANGE')],
      [],
      [pool(V4_POOL_ID)],
    )

    expect(positionStateFor(byPool, V4_POOL_ID)).toBe('open')
  })

  it('counts a position whose pool is absent from the feed as unmatched', () => {
    const { byPool, unmatched } = buildPositionIndex([direct('0xdead')], [], [pool(V4_POOL_ID)])

    expect(unmatched).toBe(1)
    expect(byPool.size).toBe(0)
  })

  it('treats a pool held inside a vault as an open position', () => {
    const { byPool } = buildPositionIndex([], [vault(V4_POOL_ID, false)], [])

    expect(positionStateFor(byPool, V4_POOL_ID)).toBe('open')
    expect(positionViaFor(byPool, V4_POOL_ID)).toBe('vault')
  })

  it('treats a closed vault position as historical', () => {
    const { byPool } = buildPositionIndex([], [vault(V4_POOL_ID, true)], [])

    expect(positionStateFor(byPool, V4_POOL_ID)).toBe('closed')
  })

  it('prefers an open holding over a closed one for the same wallet', () => {
    const { byPool } = buildPositionIndex(
      [],
      [vault(V4_POOL_ID, true), vault(V4_POOL_ID, false)],
      [],
    )

    expect(positionStateFor(byPool, V4_POOL_ID)).toBe('open')
  })

  it('still prefers open when the closed record arrives second', () => {
    const { byPool } = buildPositionIndex(
      [],
      [vault(V4_POOL_ID, false), vault(V4_POOL_ID, true)],
      [],
    )

    expect(positionStateFor(byPool, V4_POOL_ID)).toBe('open')
  })

  it('reports none for a pool nobody touched', () => {
    const { byPool } = buildPositionIndex([], [vault(V4_POOL_ID, false)], [])

    expect(positionStateFor(byPool, '0xsomethingelse')).toBe('none')
    expect(positionViaFor(byPool, '0xsomethingelse')).toBe(null)
  })

  it('records which wallet holds the pool', () => {
    const { byPool } = buildPositionIndex(
      [direct(V4_POOL_ID, 'IN_RANGE', WALLET_B)],
      [],
      [pool(V4_POOL_ID)],
    )

    expect(holdersFor(byPool, V4_POOL_ID)).toEqual([
      { wallet: WALLET_B, state: 'open', via: 'direct' },
    ])
  })

  it('records every wallet in the same pool, whatever route each took', () => {
    // The reported defect: one wallet held this pool through a vault and another held it
    // directly, and only the vault holder was shown.
    const { byPool } = buildPositionIndex(
      [direct(V4_POOL_ID, 'IN_RANGE', WALLET_B)],
      [vault(V4_POOL_ID, false, WALLET_A)],
      [pool(V4_POOL_ID)],
    )

    expect(holdersFor(byPool, V4_POOL_ID)).toEqual([
      { wallet: WALLET_A, state: 'open', via: 'vault' },
      { wallet: WALLET_B, state: 'open', via: 'direct' },
    ])
  })

  it('reports the pool as open when any wallet still holds it', () => {
    const { byPool } = buildPositionIndex(
      [],
      [vault(V4_POOL_ID, true, WALLET_A), vault(V4_POOL_ID, false, WALLET_B)],
      [],
    )

    expect(positionStateFor(byPool, V4_POOL_ID)).toBe('open')
  })

  it('orders open holders before closed ones', () => {
    const { byPool } = buildPositionIndex(
      [],
      [vault(V4_POOL_ID, true, WALLET_A), vault(V4_POOL_ID, false, WALLET_B)],
      [],
    )

    expect(holdersFor(byPool, V4_POOL_ID)[0].state).toBe('open')
  })

  it('keeps one entry per wallet when a wallet appears twice', () => {
    const { byPool } = buildPositionIndex(
      [],
      [vault(V4_POOL_ID, true, WALLET_A), vault(V4_POOL_ID, false, WALLET_A)],
      [],
    )

    expect(holdersFor(byPool, V4_POOL_ID)).toHaveLength(1)
    expect(holdersFor(byPool, V4_POOL_ID)[0].state).toBe('open')
  })

  it('lists no holders for a pool nobody touched', () => {
    const { byPool } = buildPositionIndex([], [], [])

    expect(holdersFor(byPool, V4_POOL_ID)).toEqual([])
  })
})
