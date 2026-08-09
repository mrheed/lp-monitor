import { NextResponse } from 'next/server'
import { z } from 'zod'
import { loadActivityFor } from '@/lib/domain/pools'
import { ceilingSecondsFor } from '@/lib/config'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  targets: z
    .array(
      z.object({ poolId: z.string().min(1), protocol: z.string().min(1) }),
    )
    .max(200),
  // How far back a measurement may reach. Anything unrecognised resolves to the default rather
  // than rejecting the batch, so an older client keeps working.
  window: z.string().optional(),
})

/** Returns trade activity for a batch of pools, keyed by lowercased pool id. */
export const POST = async (request: Request) => {
  const parsed = requestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { targets: [{poolId, protocol}] }' }, { status: 400 })
  }

  try {
    return NextResponse.json({ activity: await loadActivityFor(
        parsed.data.targets,
        ceilingSecondsFor(parsed.data.window),
      ) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
