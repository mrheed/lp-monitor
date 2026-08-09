import { NextResponse } from 'next/server'
import { invalidate } from '@/lib/cache'
import { getPoolsSnapshot } from '@/lib/domain/pools'

export const dynamic = 'force-dynamic'

/**
 * Returns the ranked pool table. Pass ?refresh=1 to re-read the pool feed.
 *
 * Only the pool snapshot is dropped. Measurements and the TVL sweep are left in place because
 * each costs many upstream requests, and a manual refresh means "show me current prices and
 * fees", not "pay for everything again".
 */
export const GET = async (request: Request) => {
  if (new URL(request.url).searchParams.get('refresh') === '1') invalidate('pools')

  try {
    return NextResponse.json(await getPoolsSnapshot())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
