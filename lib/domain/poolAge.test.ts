import { describe, expect, it } from 'vitest'
import { activitySpanMs, estimatePoolAge, formatAge } from './poolAge'

/** Builds cumulative volume windows. */
const volume = (hour: number, day: number, week: number, month: number) => ({
  hour,
  day,
  week,
  month,
})

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

describe('formatAge', () => {
  it('marks an inferred duration as a lower bound', () => {
    expect(formatAge(5 * HOUR, false)).toBe('>5h')
    expect(formatAge(5 * HOUR, true)).toBe('5h')
  })

  it('reports anything inside the hour as under an hour', () => {
    expect(formatAge(0)).toBe('under 1h')
    expect(formatAge(HOUR - 1)).toBe('under 1h')
  })

  it('reports hours up to a day', () => {
    expect(formatAge(HOUR)).toBe('1h')
    expect(formatAge(23 * HOUR)).toBe('23h')
  })

  it('reports days up to a week', () => {
    expect(formatAge(DAY)).toBe('1d')
    expect(formatAge(6 * DAY)).toBe('6d')
  })

  it('reports weeks up to a month', () => {
    expect(formatAge(7 * DAY)).toBe('1w')
    expect(formatAge(29 * DAY)).toBe('4w')
  })

  it('reports months beyond that', () => {
    expect(formatAge(30 * DAY)).toBe('1m')
    expect(formatAge(95 * DAY)).toBe('3m')
  })

  it('rounds down, so the age is never overstated', () => {
    expect(formatAge(2.9 * HOUR)).toBe('2h')
  })
})

describe('activitySpanMs', () => {
  it('returns a week when volume grows past the weekly window', () => {
    expect(activitySpanMs(volume(10, 100, 1_000, 9_000))).toBe(7 * DAY)
  })

  it('returns a day when volume stops growing after a week', () => {
    expect(activitySpanMs(volume(10, 100, 1_000, 1_000))).toBe(DAY)
  })

  it('returns an hour when volume stops growing after a day', () => {
    expect(activitySpanMs(volume(10, 100, 100, 100))).toBe(HOUR)
  })

  it('returns nothing when all volume sits inside the hour', () => {
    expect(activitySpanMs(volume(100, 100, 100, 100))).toBe(0)
  })

  it('returns nothing for a pool with no recorded volume', () => {
    expect(activitySpanMs(volume(0, 0, 0, 0))).toBe(0)
  })

  it('ignores disagreement between independently computed windows', () => {
    // Real ETH/USDG figures for a pool created that morning: the 30 day total exceeds the 7 day
    // total while the 7 day total sits below the 24 hour one, a spread of about 0.06%.
    expect(activitySpanMs(volume(588_043, 10_041_778, 10_035_821, 10_041_538))).toBe(HOUR)
  })

  it('compares against the widest narrower window, not the neighbouring one', () => {
    expect(activitySpanMs(volume(10, 1_000, 900, 1_005))).toBe(HOUR)
  })

  it('still detects genuine growth, which dwarfs the noise threshold', () => {
    expect(activitySpanMs(volume(10, 1_000, 900, 5_000))).toBe(7 * DAY)
  })
})

describe('estimatePoolAge', () => {
  it('labels a pool trading only in the last hour', () => {
    expect(estimatePoolAge(volume(5_000, 5_000, 5_000, 5_000))).toBe('under 1h')
  })

  it('marks an inferred age as a lower bound', () => {
    // The windows place a pool in one of four buckets, so a pool created eight hours ago and one
    // created two hours ago both land here. Without the marker both would read as exactly `1h`.
    expect(estimatePoolAge(volume(10, 100, 100, 100))).toBe('>1h')
  })

  it('labels a pool whose activity reaches back a week as at least that', () => {
    expect(estimatePoolAge(volume(10, 100, 1_000, 9_000))).toBe('>1w')
  })

  it('never claims more than the widest window can evidence', () => {
    // 30 days is the widest figure available, so a week is the largest defensible lower bound.
    expect(estimatePoolAge(volume(1, 10, 100, 1_000_000))).toBe('>1w')
  })

  it('gives an exact age for a pool the watcher saw appear', () => {
    const fiveHoursAgo = Date.now() - 5 * 60 * 60_000

    // No marker: this is measured, not inferred.
    expect(estimatePoolAge(volume(10, 100, 100, 100), fiveHoursAgo)).toBe('5h')
  })

  it('prefers the sighting over the window estimate when both exist', () => {
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60_000

    expect(estimatePoolAge(volume(10, 100, 100, 100), threeDaysAgo)).toBe('3d')
  })
})

describe('estimatePoolAge baseline handling', () => {
  it('falls back to the window estimate for a pool present at baseline', () => {
    // 0 is the baseline marker, not "first seen at the epoch". Treating it as a timestamp would
    // age every pre-existing pool from 1970.
    expect(estimatePoolAge(volume(10, 100, 100, 100), 0)).toBe('>1h')
  })

  it('still uses a real sighting when there is one', () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60_000

    expect(estimatePoolAge(volume(10, 100, 100, 100), twoHoursAgo)).toBe('2h')
  })
})
