'use client'

/** Compact, human-friendly price format: a few significant figures, grouped. */
const fmt = (price: number): string => {
  if (!Number.isFinite(price) || price <= 0) return '—'
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (price >= 1) return price.toLocaleString(undefined, { maximumSignificantDigits: 4 })
  return price.toPrecision(3)
}

/**
 * A price-range picture for the add-liquidity form: a horizontal band on a log price axis showing
 * the selected low–high range, the current (or initial) price marker, and whether that price sits
 * inside the range (earning) or outside it (single-sided). Prices, not tick numbers, so the reader
 * sees what the position actually means.
 */
export const RangeViz = ({
  current,
  lower,
  upper,
  fullRange,
  unit,
}: {
  current: number | null
  lower: number | null
  upper: number | null
  fullRange: boolean
  unit: string
}) => {
  const hasRange = fullRange || (lower !== null && upper !== null && lower < upper && lower > 0)

  // Log-scaled x so a geometric price range reads evenly. Domain pads around the range and price.
  const lo = fullRange ? null : lower
  const hi = fullRange ? null : upper
  const anchorLo = lo ?? (current ?? 1)
  const anchorHi = hi ?? (current ?? 1)
  const domainMin = Math.min(anchorLo, current ?? anchorLo) / 1.7
  const domainMax = Math.max(anchorHi, current ?? anchorHi) * 1.7
  const span = Math.log(domainMax) - Math.log(domainMin)
  const x = (price: number): number => {
    if (span <= 0) return 50
    return Math.min(100, Math.max(0, ((Math.log(price) - Math.log(domainMin)) / span) * 100))
  }

  const bandLeft = fullRange ? 0 : lo !== null ? x(lo) : 0
  const bandWidth = fullRange ? 100 : lo !== null && hi !== null ? x(hi) - x(lo) : 0
  const currentX = current !== null && current > 0 ? x(current) : null
  const inRange = fullRange
    ? current !== null
    : current !== null && lower !== null && upper !== null && current >= lower && current <= upper

  if (!hasRange) {
    return (
      <div className="flex h-24 items-center justify-center rounded border border-[var(--db-line)] bg-[var(--db-bg)] text-[13px] text-[var(--db-muted)]">
        Enter a low and high price to preview the range.
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="db-kicker">Price range · {unit}</span>
        {current !== null ? (
          <span className={`text-[12px] ${inRange ? 'text-[var(--db-signal)]' : 'text-[var(--db-muted)]'}`}>
            {inRange ? 'In range · earning fees' : 'Out of range · one token only'}
          </span>
        ) : null}
      </div>

      <div className="relative h-20 rounded border border-[var(--db-line)] bg-[var(--db-bg)]">
        {/* The active band. */}
        <div
          className="absolute inset-y-0 border-x border-[var(--db-signal-line)] bg-[rgba(183,216,205,0.12)]"
          style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
        />
        {/* Current / initial price marker. */}
        {currentX !== null ? (
          <div className="absolute inset-y-0" style={{ left: `${currentX}%` }}>
            <div className="absolute inset-y-0 w-px -translate-x-1/2 bg-[var(--db-ink)]" />
            <div className="absolute left-0 top-1 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[var(--db-ink)]" />
          </div>
        ) : null}
      </div>

      {/* Edge and current labels. */}
      <div className="mt-2 flex items-center justify-between text-[12px] text-[var(--db-muted)]">
        <span>{fullRange ? '0' : lo !== null ? fmt(lo) : '—'}</span>
        {current !== null ? (
          <span className="text-[var(--db-ink)]">now {fmt(current)}</span>
        ) : (
          <span className="text-[var(--db-muted)]">price set on first add</span>
        )}
        <span>{fullRange ? '∞' : hi !== null ? fmt(hi) : '—'}</span>
      </div>
    </div>
  )
}
