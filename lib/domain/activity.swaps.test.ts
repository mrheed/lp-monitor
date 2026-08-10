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
  it('ignores liquidity events, which are not trades', () => {
    // The transaction feed mixes adds and removes in with the swaps. They move USD through the
    // pool but are deposits, not trading, so counting them overstates how much a pool trades.
    const activity = computeActivity([at(0, 100), at(60, 100), at(30, 5_000, ADD)])

    expect(activity.volumeUsdPerHour).toBe(200 / (60 / 3600))
  })

  it('counts a liquidity event neither as a trade nor as a trader', () => {
    const activity = computeActivity([at(0, 100), at(60, 100), at(30, 5_000, ADD)])

    expect(activity.sampleSize).toBe(2)
    expect(activity.uniqueTraders).toBe(2)
  })

  it('keeps measuring a pool whose sample is entirely liquidity events', () => {
    // Nothing traded, so the rate is genuinely zero rather than missing.
    const activity = computeActivity([at(0, 5_000, ADD), at(60, 5_000, ADD)])

    expect(activity.sampleSize).toBe(0)
    expect(activity.volumeUsdPerHour).toBe(0)
  })

  it('keeps a row that reports no event type', () => {
    // The field is only absent on a feed that does not report it. Dropping every such row would
    // silently zero the whole measurement rather than degrade it.
    const activity = computeActivity([
      { timestampMs: String(NOW), amountUsd: 100 },
      { timestampMs: String(NOW - 60_000), amountUsd: 100 },
    ])

    expect(activity.sampleSize).toBe(2)
  })
})
