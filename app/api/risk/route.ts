import { NextResponse } from 'next/server'
import { z } from 'zod'
import { loadRiskFor } from '@/lib/domain/pools'

export const dynamic = 'force-dynamic'

/**
 * An address, matched against the shape one actually has.
 *
 * The value ends up in a CLI argument vector, where anything starting with a dash is read as a
 * flag rather than a value. The client refuses those too; rejecting them here as well means a
 * malformed request fails as a 400 instead of silently returning "unchecked" for every pool.
 */
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Expected a 20 byte hex address')

const requestSchema = z.object({
  targets: z
    .array(
      z.object({
        poolId: z.string().min(1),
        chainId: z.number().int().positive(),
        token0Address: addressSchema,
        token1Address: addressSchema,
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
