/** Volume totals per window, as the pool feed reports them. */
export type VolumeWindows = {
  hour: number
  day: number
  week: number
  month: number
}

/**
 * Relative growth a wider window must show before it counts as older activity.
 *
 * The windows are computed independently and disagree slightly: one pool reports a 30 day
 * volume above its 7 day figure while its 7 day figure sits below its 24 hour figure, a spread
 * of about 0.06%. One percent clears that noise while still catching real growth, which is
 * always orders of magnitude larger on a pool that genuinely traded in an earlier window.
 */
const GROWTH_THRESHOLD = 1.01

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY

/**
 * Lower bound, in milliseconds, on how far back a pool's activity extends.
 *
 * The windows only say which of them contain activity, so this is the start of the widest one
 * that grew: a pool whose volume grows past the weekly figure has traded for at least a week.
 * `0` means everything happened inside the last hour.
 */
export const activitySpanMs = (volume: VolumeWindows): number => {
  const { hour, day, week, month } = volume

  if (Math.max(hour, day, week, month) <= 0) return 0

  const grewBeyond = (wider: number, narrower: number) => wider > narrower * GROWTH_THRESHOLD

  if (grewBeyond(month, Math.max(hour, day, week))) return WEEK
  if (grewBeyond(week, Math.max(hour, day))) return DAY
  if (grewBeyond(day, hour)) return HOUR
  return 0
}

/**
 * Formats a duration as a single unit: `under 1h`, then hours, days, weeks, months.
 *
 * `exact` distinguishes a measured age from an inferred one. The volume windows can only place a
 * pool in one of four buckets, so an inferred age is prefixed with `>` to say "at least this":
 * without it a pool created eight hours ago reads as `1h`, which looks like it just appeared.
 */
export const formatAge = (spanMs: number, exact = true): string => {
  const prefix = exact ? '' : '>'

  if (spanMs < HOUR) return exact ? 'under 1h' : 'under 1h'
  if (spanMs < DAY) return `${prefix}${Math.floor(spanMs / HOUR)}h`
  if (spanMs < WEEK) return `${prefix}${Math.floor(spanMs / DAY)}d`
  if (spanMs < MONTH) return `${prefix}${Math.floor(spanMs / WEEK)}w`
  return `${prefix}${Math.floor(spanMs / MONTH)}m`
}

/**
 * How old a pool is, as a label.
 *
 * `firstSeenAt` is used when the watcher actually saw the pool appear, which gives a real age to
 * the minute. Everything else falls back to the volume windows, which can only say which of four
 * buckets the activity reaches into, so those read as `>1h` rather than `1h`.
 *
 * Neither upstream feed exposes a creation time and the transaction API ignores every ordering
 * parameter, so the first ever trade cannot be reached without paginating a pool's whole history.
 * Watching for the pool to appear is the only way to learn its age exactly, and it only works
 * for pools that appear after watching began.
 */
export const estimatePoolAge = (volume: VolumeWindows, firstSeenAt?: number): string =>
  // A falsy timestamp is the baseline marker: the pool was already there when watching began, so
  // the sighting says it exists and nothing about when it started.
  firstSeenAt
    ? formatAge(Date.now() - firstSeenAt, true)
    : formatAge(activitySpanMs(volume), false)
