import { NextResponse } from 'next/server'
import { z } from 'zod'
import { recentTrades } from '@/lib/domain/poolTrades'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  poolId: z.string().min(1),
  protocol: z.string().min(1),
  chainId: z.number(),
  /** Which side of the pair holds the equity, so direction is read off the right leg. */
  stockIsToken0: z.boolean(),
})

/** Returns the most recent trades for one pool, newest first. */
export const POST = async (request: Request) => {
  const parsed = requestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Expected { poolId, protocol, chainId, stockIsToken0 }' },
      { status: 400 },
    )
  }

  const { poolId, protocol, chainId, stockIsToken0 } = parsed.data

  try {
    const trades = await recentTrades({ poolId, protocol, chainId }, stockIsToken0)
    return NextResponse.json({ trades })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
