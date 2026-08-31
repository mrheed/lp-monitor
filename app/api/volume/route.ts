import { NextResponse } from 'next/server'
import { aggregateSeries } from '@/lib/domain/volumeSampler'
import { readVolumeHistory } from '@/lib/domain/volumeStore'

export const dynamic = 'force-dynamic'

/** Returns the hourly volume history: one aggregate series, plus each pool's own. */
export const GET = async () => {
  try {
    const byPool = readVolumeHistory()
    return NextResponse.json({ aggregate: aggregateSeries(byPool), byPool })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
