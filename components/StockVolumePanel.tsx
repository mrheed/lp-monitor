'use client'

import { useState } from 'react'
import { StockVolumeChart } from './StockVolumeChart'
import type { VolumeBucket } from '@/lib/domain/volumeHistory'
import type { VolumeHistory } from '@/lib/domain/volumeStore'

/** One pool's series, or null when nothing is selected or the pool has not been sampled. */
export const overlayFor = (
  byPool: VolumeHistory,
  poolId: string | null,
): VolumeBucket[] | null => (poolId === null ? null : (byPool[poolId.toLowerCase()] ?? null))

type Props = {
  aggregate: VolumeBucket[]
  byPool: VolumeHistory
  pools: { poolId: string; pair: string }[]
}

/**
 * The volume chart plus the pools whose series can be laid over it.
 *
 * Only pools with sampled history are offered, since a chip that overlays nothing reads as a
 * broken control rather than an unsampled pool.
 */
export const StockVolumePanel = ({ aggregate, byPool, pools }: Props) => {
  const [selected, setSelected] = useState<string | null>(null)

  const selectable = pools.filter((pool) => byPool[pool.poolId.toLowerCase()] !== undefined)
  const active = selectable.find((pool) => pool.poolId === selected) ?? null

  return (
    <div>
      <StockVolumeChart
        aggregate={aggregate}
        selected={overlayFor(byPool, selected)}
        selectedLabel={active?.pair ?? null}
      />

      {selectable.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectable.map((pool) => {
            const on = pool.poolId === selected
            return (
              <button
                key={pool.poolId}
                type="button"
                aria-pressed={on}
                onClick={() => setSelected(on ? null : pool.poolId)}
                className={`rounded border px-2 py-1 text-[11px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                  on
                    ? 'border-accent text-ink'
                    : 'border-line text-ink-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                {pool.pair}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
