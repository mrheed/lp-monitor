import { NextResponse } from 'next/server'
import { trackedWallets } from '@/lib/config'

export const dynamic = 'force-dynamic'

/**
 * The tracked wallets, so the client can name a connected account.
 *
 * The table already shows these labels against pools and the addresses appear in position
 * tooltips, so this exposes nothing the dashboard does not already display.
 */
export const GET = async () => NextResponse.json({ wallets: trackedWallets() })
