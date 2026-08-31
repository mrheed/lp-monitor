import { NextResponse } from 'next/server'
import { getHookSource } from '@/lib/domain/hookSource'

export const dynamic = 'force-dynamic'

/** Serves the hook's Solidity source files for read-only display in the deploy UI. */
export const GET = async () => {
  try {
    return NextResponse.json(await getHookSource())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
