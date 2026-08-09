import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAlertStatus, setAlertFilters, startAlertWatcher } from '@/lib/domain/alertWatcher'

export const dynamic = 'force-dynamic'

const filtersSchema = z.object({
  enabled: z.boolean(),
  minFeeTier: z.number().min(0).max(100),
  hooks: z.enum(['any', 'with', 'without']),
  dynamicFee: z.enum(['any', 'only', 'exclude']),
  tickers: z.array(z.string()).max(50),
  mentions: z.array(z.string()).max(20),
  reportChanges: z.boolean(),
  monitoredPoolIds: z.array(z.string()).max(200),
  minChangePercent: z.number().min(0).max(1000),
})

/**
 * Reports what the watcher is doing.
 *
 * Also starts it, so the loop begins with the first page load rather than needing a separate
 * boot hook. Starting twice is a no-op.
 */
export const GET = async () => {
  startAlertWatcher()
  return NextResponse.json(getAlertStatus())
}

/** Replaces the filters the watcher applies. Detection itself runs regardless of them. */
export const PUT = async (request: Request) => {
  const parsed = filtersSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected alert filters' }, { status: 400 })
  }

  startAlertWatcher()
  setAlertFilters(parsed.data)

  return NextResponse.json(getAlertStatus())
}
