/**
 * Chart ranges, and the Uniswap history duration each maps to.
 *
 * The durations are not free choices: each one fixes its own step, measured against the live API.
 * `DAY` returns hourly points, `MONTH` returns daily ones. A range therefore decides both how far
 * back the chart reaches and how finely it resolves, and the two cannot be picked separately.
 */
export const VOLUME_RANGES = [
  { id: '1d', label: '1D', duration: 'DAY', stepMs: 3_600_000 },
  { id: '1w', label: '1W', duration: 'WEEK', stepMs: 6 * 3_600_000 },
  { id: '1m', label: '1M', duration: 'MONTH', stepMs: 24 * 3_600_000 },
  { id: '1y', label: '1Y', duration: 'YEAR', stepMs: 7 * 24 * 3_600_000 },
] as const

export type VolumeRange = (typeof VOLUME_RANGES)[number]['id']
export type HistoryDuration = (typeof VOLUME_RANGES)[number]['duration']

/** The range a chart opens on. A day of hourly points is the closest to what the feed shows now. */
export const DEFAULT_RANGE: VolumeRange = '1d'

/** Whether a string names a range, so a request body can be narrowed without a cast. */
export const isVolumeRange = (value: unknown): value is VolumeRange =>
  typeof value === 'string' && VOLUME_RANGES.some((range) => range.id === value)

/** The definition behind a range id. */
export const rangeSpec = (range: VolumeRange) => {
  const spec = VOLUME_RANGES.find((entry) => entry.id === range)
  // Unreachable through isVolumeRange, but a lookup that can return undefined would push the
  // check onto every caller.
  if (spec === undefined) throw new Error(`Unknown volume range: ${range}`)
  return spec
}

/**
 * How a range's points should be labelled on a time axis.
 *
 * A day of hourly points wants clock times; a month of daily ones wants dates. Reading a date off
 * every hourly bar, or a clock time off every daily bar, is noise either way.
 */
export const rangeAxisFormat = (range: VolumeRange): Intl.DateTimeFormatOptions =>
  range === '1d'
    ? { hour: '2-digit', hour12: false }
    : range === '1w'
      ? { weekday: 'short' }
      : { day: 'numeric', month: 'short' }
