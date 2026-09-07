import { NextResponse } from 'next/server'
import { z } from 'zod'
import { loadRiskFor } from '@/lib/domain/pools'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  targets: z
    .array(
      z.object({
        poolId: z.string().min(1),
        chainId: z.number(),
        token0Address: z.string().min(1),
        token1Address: z.string().min(1),
      }),
    )
    .max(60),
})

/**
 * Returns a security verdict per pool, keyed by lowercased pool id.
 *
 * Server side because the security feed is reached through a CLI holding the operator's API
 * key; the browser never sees the key and never runs a process.
 */
export const POST = async (request: Request) => {
  const parsed = requestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected { targets: [{poolId, chainId, token0Address, token1Address}] }' },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json({ risk: await loadRiskFor(parsed.data.targets) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
