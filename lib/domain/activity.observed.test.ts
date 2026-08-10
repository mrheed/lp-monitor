import { describe, expect, it } from 'vitest'
import { computeActivity, type ActivitySample } from './activity'

const SWAP = 'TRANSACTION_EVENT_TYPE_SWAP'
const NOW = 1_786_300_000_000

const at = (secondsAgo: number, amountUsd: number, eventType = SWAP): ActivitySample => ({
  timestampMs: String(NOW - secondsAgo * 1000),
  eventType,
  walletAddress: `0x${secondsAgo}`,
  amountUsd,
})

/*
 * The transaction feed reports individual trades. Counting them and summing their amounts is
 * arithmetic on what the API returned; dividing by the span to project an hourly figure is an
 * extrapolation from a sample that often covers under two minutes. Both are kept, but only the
 * observed pair is shown, so nothing on screen claims more than was actually seen.
 */
describe('observed activity', () => {
  it('counts the trades that were actually returned', () => {
    const activity = computeActivity([at(0, 100), at(300, 250), at(525, 50)])

    expect(activity.sampleSize).toBe(3)
  })

  it('sums the volume that was actually traded', () => {
    const activity = computeActivity([at(0, 100), at(300, 250), at(525, 50)])

    expect(activity.volumeUsd).toBe(400)
  })

  it('reports the span those trades actually covered', () => {
    const activity = computeActivity([at(0, 100), at(525, 50)])

    expect(activity.windowSeconds).toBe(525)
  })

  it('keeps the observed volume independent of the projected rate', () => {
    // 400 dollars over 525 seconds is what happened. The hourly figure is a projection from it
    // and must not overwrite the total the projection was derived from.
    const activity = computeActivity([at(0, 100), at(300, 250), at(525, 50)])

    expect(activity.volumeUsd).toBe(400)
    expect(activity.volumeUsdPerHour).toBeCloseTo(400 / (525 / 3600))
  })

  it('reports zero volume for a window with no trades', () => {
    expect(computeActivity([]).volumeUsd).toBe(0)
  })
})
