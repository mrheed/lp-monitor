import { describe, expect, it } from 'vitest'
import { computeActivity, type ActivitySample } from './activity'

const SWAP = 'TRANSACTION_EVENT_TYPE_SWAP'
const ADD = 'TRANSACTION_EVENT_TYPE_ADD'

const NOW = 1_786_300_000_000

/** A transaction that many seconds before the reference time. */
const at = (secondsAgo: number, amountUsd: number, eventType = SWAP): ActivitySample => ({
  timestampMs: String(NOW - secondsAgo * 1000),
  eventType,
  walletAddress: `0x${secondsAgo}`,
  amountUsd,
})

describe('trade volume', () => {
  it('ignores liquidity events, which pay no fees', () => {
    // The feed mixes adds and removes into the same stream. They move USD but generate no
    // swap fee, so counting them inflates both the volume rate and anything derived from it.
    const activity = computeActivity([at(0, 100), at(60, 100), at(30, 5_000, ADD)])

    expect(activity.volumeUsdPerHour).toBe(200 / (60 / 3600))
  })

  it('counts a liquidity event neither as a trade nor as a trader', () => {
    const activity = computeActivity([at(0, 100), at(60, 100), at(30, 5_000, ADD)])

    expect(activity.sampleSize).toBe(2)
    expect(activity.uniqueTraders).toBe(2)
  })

  it('adds a negative amount as volume rather than cancelling it out', () => {
    // The feed reports every amount as positive today and encodes direction elsewhere, so this
    // guards a change rather than a case seen in the wild: were sells ever to arrive signed,
    // summing them raw would net a busy two-way pool towards zero volume and zero fees.
    const activity = computeActivity([at(0, 100), at(60, -100)])

    expect(activity.volumeUsdPerHour).toBe(200 / (60 / 3600))
  })
})

describe('a window ceiling', () => {
  it('drops transactions older than the ceiling', () => {
    const sample = [at(0, 100), at(300, 100), at(3_000, 999_999)]

    const activity = computeActivity(sample, { ceilingSeconds: 900, now: NOW })

    expect(activity.sampleSize).toBe(2)
  })

  it('measures against the span that survived, not the ceiling', () => {
    // The rate must reflect the window actually observed. Dividing by a 15 minute ceiling when
    // the surviving trades span 5 minutes would understate the pool by a factor of three.
    const activity = computeActivity([at(0, 100), at(300, 100)], {
      ceilingSeconds: 900,
      now: NOW,
    })

    expect(activity.windowSeconds).toBe(300)
    expect(activity.volumeUsdPerHour).toBeCloseTo(200 / (300 / 3600))
  })

  it('keeps a sample that is entirely fresher than the ceiling', () => {
    // The common case on a busy pool: a hundred swaps inside ninety seconds. Nothing to clip,
    // and the resulting window is far shorter than the ceiling asked for.
    const activity = computeActivity([at(0, 100), at(90, 100)], {
      ceilingSeconds: 900,
      now: NOW,
    })

    expect(activity.sampleSize).toBe(2)
    expect(activity.windowSeconds).toBe(90)
  })

  it('reports nothing when every trade predates the ceiling', () => {
    // A pool whose last trade was hours ago has no recent rate. Reporting its stale trades as
    // current would rank a dead pool alongside a live one.
    const activity = computeActivity([at(7_200, 100), at(7_400, 100)], {
      ceilingSeconds: 900,
      now: NOW,
    })

    expect(activity.sampleSize).toBe(0)
    expect(activity.volumeUsdPerHour).toBe(0)
  })

  it('leaves the sample alone when no ceiling is given', () => {
    const activity = computeActivity([at(0, 100), at(7_200, 100)])

    expect(activity.sampleSize).toBe(2)
  })
})
