import { describe, expect, it } from 'vitest'
import { protocolVersionFor } from './uniswap'

describe('protocolVersionFor', () => {
  it('maps a v3 pool to the v3 protocol version', () => {
    expect(protocolVersionFor('uniswapv3')).toBe('PROTOCOL_VERSION_V3')
  })

  it('maps a v4 pool to the v4 protocol version', () => {
    expect(protocolVersionFor('uniswapv4')).toBe('PROTOCOL_VERSION_V4')
  })

  it('ignores casing, since the feed is not consistent about it', () => {
    expect(protocolVersionFor('UniswapV3')).toBe('PROTOCOL_VERSION_V3')
  })

  it('defaults an unrecognised protocol to v4 rather than throwing', () => {
    expect(protocolVersionFor('')).toBe('PROTOCOL_VERSION_V4')
  })
})
