import { NextResponse } from 'next/server'
import { z } from 'zod'
import { loadActivityFor } from '@/lib/domain/pools'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  targets: z
    .array(
      z.object({
        poolId: z.string().min(1),
        protocol: z.string().min(1),
        chainId: z.number(),
      }),
    )
    .max(200),
})

/** Returns trade activity for a batch of pools, keyed by lowercased pool id. */
export const POST = async (request: Request) => {
  const parsed = requestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { targets: [{poolId, protocol}] }' }, { status: 400 })
  }

  try {
    return NextResponse.json({ activity: await loadActivityFor(parsed.data.targets) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
