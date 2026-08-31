import { NextResponse } from 'next/server'
import { inspectHook } from '@/lib/domain/hookInspector'

export const dynamic = 'force-dynamic'
/** Live chain reads plus several eth_calls; allow room before the platform times out. */
export const maxDuration = 60

/** Grades one v4 hook (and optionally its pool) for the risks an LP actually carries. */
export const GET = async (request: Request) => {
  const params = new URL(request.url).searchParams
  const chainId = Number(params.get('chainId'))
  const target = params.get('target')?.trim()

  if (!Number.isFinite(chainId) || !target) {
    return NextResponse.json({ error: 'chainId and target are required' }, { status: 400 })
  }

  try {
    return NextResponse.json(await inspectHook(chainId, target))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Inspection failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
