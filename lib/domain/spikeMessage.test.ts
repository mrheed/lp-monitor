import { describe, expect, it } from 'vitest'
import { composeSpikeMessage } from './spikeMessage'

const spike = {
  poolId: '0xabc',
  rateUsdPerHour: 900_000,
  baselineUsdPerHour: 100_000,
  multiple: 9,
  atMs: 1_788_109_384_000,
}

describe('composeSpikeMessage', () => {
  it('names the pair, the multiple and both rates', () => {
    const text = composeSpikeMessage([spike], { '0xabc': 'WETH/NVDA' }, [])

    expect(text).toContain('WETH/NVDA')
    expect(text).toContain('9.0x')
    expect(text).toContain('$900k/h')
    expect(text).toContain('$100k/h')
  })

  it('falls back to the pool id when no pair is known', () => {
    expect(composeSpikeMessage([spike], {}, [])).toContain('0xabc')
  })

  it('adds mentions so the message notifies rather than just arriving', () => {
    expect(composeSpikeMessage([spike], {}, ['alice'])).toContain('@alice')
  })

  it('escapes pair text, since it comes from chain data', () => {
    const text = composeSpikeMessage([spike], { '0xabc': '<b>/USDG' }, [])

    expect(text).toContain('&lt;b&gt;/USDG')
    expect(text).not.toContain('<b>/USDG')
  })

  it('lists every spike in one message rather than one message each', () => {
    const second = { ...spike, poolId: '0xdef', multiple: 6 }
    const text = composeSpikeMessage([spike, second], { '0xabc': 'A/B', '0xdef': 'C/D' }, [])

    expect(text).toContain('A/B')
    expect(text).toContain('C/D')
  })
})
