'use client'

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value))

/** Compact human price. */
const fmt = (price: number): string => {
  if (!Number.isFinite(price) || price <= 0) return '—'
  if (price >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (price >= 1) return price.toLocaleString(undefined, { maximumSignificantDigits: 4 })
  return price.toPrecision(3)
}

/** Percentage of a bound away from the current price, e.g. "+12%". */
const pctVsCurrent = (price: number, current: number): string => {
  const delta = (price / current - 1) * 100
  const digits = Math.abs(delta) >= 10 ? 0 : 1
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(digits)}%`
}

/**
 * A dual-handle price-range slider for the add-liquidity form. The axis is log-scaled around the
 * current price so a geometric range reads evenly; the handles set the low and high bounds, the
 * band between them is the active range, and a marker shows the current price. Optional `snap`
 * rounds a dragged price to the nearest valid tick so the handles land on real positions.
 */
export const RangeSlider = ({
  current,
  lower,
  upper,
  onChange,
  unit,
  snap,
}: {
  current: number
  lower: number | null
  upper: number | null
  onChange: (lower: number, upper: number) => void
  unit: string
  snap?: (price: number) => number
}) => {
  const trackRef = useRef<HTMLDivElement>(null)

  // Fixed zoom window around the current price; presets/inputs cover wider ranges.
  const zoom = 8
  const lnMin = Math.log(current / zoom)
  const lnSpan = Math.log(current * zoom) - lnMin
  const toFrac = (price: number): number => clamp((Math.log(price) - lnMin) / lnSpan, 0, 1)
  const toPrice = (frac: number): number => Math.exp(lnMin + clamp(frac, 0, 1) * lnSpan)

  const lo = lower !== null && lower > 0 ? lower : current / 2
  const hi = upper !== null && upper > 0 ? upper : current * 2
  const inRange = current >= lo && current <= hi

  const startDrag = (which: 'lo' | 'hi') => (event: ReactPointerEvent) => {
    event.preventDefault()
    const move = (ev: PointerEvent) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return
      const frac = (ev.clientX - rect.left) / rect.width
      let price = toPrice(frac)
      if (snap) price = snap(price)
      if (which === 'lo') onChange(Math.min(price, hi / 1.0001), hi)
      else onChange(lo, Math.max(price, lo * 1.0001))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const xLo = toFrac(lo) * 100
  const xHi = toFrac(hi) * 100
  const xCur = toFrac(current) * 100

  const handle = (which: 'lo' | 'hi', x: number, label: string) => (
    <button
      type="button"
      aria-label={label}
      onPointerDown={startDrag(which)}
      className="absolute top-1/2 h-9 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-[2px] border border-[var(--db-signal-line)] bg-[var(--db-panel)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--db-signal)]"
      style={{ left: `${x}%` }}
    />
  )

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="db-kicker">Price range · {unit}</span>
        <span className={`text-[12px] ${inRange ? 'text-[var(--db-signal)]' : 'text-[var(--db-muted)]'}`}>
          {inRange ? 'In range · earning fees' : 'Out of range · one token only'}
        </span>
      </div>

      <div
        ref={trackRef}
        className="relative h-16 touch-none select-none rounded border border-[var(--db-line)] bg-[var(--db-bg)]"
      >
        <div
          className="absolute inset-y-0 border-x border-[var(--db-signal-line)] bg-[rgba(183,216,205,0.12)]"
          style={{ left: `${xLo}%`, width: `${Math.max(0, xHi - xLo)}%` }}
        />
        <div className="absolute inset-y-0 w-px -translate-x-1/2 bg-[var(--db-ink)]" style={{ left: `${xCur}%` }} />
        {handle('lo', xLo, 'Low price bound')}
        {handle('hi', xHi, 'High price bound')}
      </div>

      <div className="mt-2 flex items-center justify-between text-[12px] text-[var(--db-muted)]">
        <span>
          {fmt(lo)} <span className="text-[var(--db-ink)]">({pctVsCurrent(lo, current)})</span>
        </span>
        <span className="text-[var(--db-ink)]">now {fmt(current)}</span>
        <span>
          {fmt(hi)} <span className="text-[var(--db-ink)]">({pctVsCurrent(hi, current)})</span>
        </span>
      </div>
    </div>
  )
}
