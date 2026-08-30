import { describe, expect, it } from 'vitest'
import { HOUR_MS } from './volumeHistory'
import { MIN_HISTORY, detectSpike } from './volumeSpike'

const settings = { multiple: 5, minVolumeUsd: 100_000, cooldownMs: 2 * HOUR_MS }

/** A run of calm hours at `rate`, then one final hour at `finalRate`. */
const history = (rate: number, finalRate: number, hours = MIN_HISTORY + 1) =>
  Array.from({ length: hours }, (_, i) => ({
    hourEndMs: (i + 1) * HOUR_MS,
    volumeUsd: i === hours - 1 ? finalRate : rate,
    swaps: 20,
    spanMs: HOUR_MS,
  }))

describe('detectSpike', () => {
  it('fires when the newest hour clears the multiple and the floor', () => {
    const spike = detectSpike('0xabc', history(100_000, 900_000), settings, null)

    expect(spike).toMatchObject({
      poolId: '0xabc',
      rateUsdPerHour: 900_000,
      baselineUsdPerHour: 100_000,
      multiple: 9,
    })
  })

  it('stays quiet below the multiple', () => {
    expect(detectSpike('0xabc', history(100_000, 300_000), settings, null)).toBeNull()
  })

  it('stays quiet below the volume floor, however large the multiple', () => {
    // Twenty times its own baseline, but only $20k an hour: a thin pool growing, not an event.
    expect(detectSpike('0xabc', history(1_000, 20_000), settings, null)).toBeNull()
  })

  it('stays quiet without enough history to have a baseline', () => {
    const thin = history(100_000, 900_000, MIN_HISTORY - 1)

    expect(detectSpike('0xabc', thin, settings, null)).toBeNull()
  })

  it('stays quiet inside the cooldown', () => {
    const buckets = history(100_000, 900_000)
    const lastHour = buckets[buckets.length - 1].hourEndMs

    expect(detectSpike('0xabc', buckets, settings, lastHour - HOUR_MS)).toBeNull()
  })

  it('fires again once the cooldown has passed', () => {
    const buckets = history(100_000, 900_000)
    const lastHour = buckets[buckets.length - 1].hourEndMs

    expect(detectSpike('0xabc', buckets, settings, lastHour - 3 * HOUR_MS)).not.toBeNull()
  })

  it('ignores buckets whose sample smeared across more than an hour', () => {
    const buckets = history(100_000, 900_000)
    buckets[buckets.length - 1].spanMs = 6 * HOUR_MS

    expect(detectSpike('0xabc', buckets, settings, null)).toBeNull()
  })

  it('does not let one earlier spike raise the baseline enough to mask the next', () => {
    const buckets = history(100_000, 900_000)
    // A single enormous earlier hour would lift a mean baseline above the floor for the real one.
    buckets[2].volumeUsd = 50_000_000

    expect(detectSpike('0xabc', buckets, settings, null)).not.toBeNull()
  })
})
