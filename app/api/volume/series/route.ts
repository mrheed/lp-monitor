import { NextResponse } from 'next/server'
import { z } from 'zod'
import { loadVolumeSeries } from '@/lib/domain/volumeSeries'
import { isVolumeRange } from '@/lib/domain/volumeRanges'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  pools: z
    .array(
      z.object({
        poolId: z.string().min(1),
        protocol: z.string().min(1),
        chainId: z.number(),
      }),
    )
    .min(1)
    .max(400),
  // Narrowed by the domain's own guard below rather than a zod enum built from the same list,
  // which loses the literal types and would need a cast to put back.
  range: z.string(),
})

/** Returns volume history for a set of pools over one range, with their total. */
export const POST = async (request: Request) => {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { pools: [...], range }' }, { status: 400 })
  }

  const { pools, range } = parsed.data

  if (!isVolumeRange(range)) {
    return NextResponse.json({ error: `Unknown range: ${range}` }, { status: 400 })
  }

  try {
    return NextResponse.json(await loadVolumeSeries(pools, range))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
