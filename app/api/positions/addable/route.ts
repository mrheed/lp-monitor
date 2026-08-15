import { NextResponse } from 'next/server'
import { z } from 'zod'
import { fetchAddablePositions } from '@/lib/clients/krystal'
import { trackedWallets } from '@/lib/config'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({ poolId: z.string().min(1) })

/**
 * Returns the tracked wallets' open positions in one pool, with what an increase needs.
 *
 * Read only: this route never sees a private key and never sends a transaction. It exists so
 * the browser can show which positions can be added to and build calldata for them; signing
 * happens in the operator's own wallet.
 */
export const POST = async (request: Request) => {
  const parsed = requestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json({ error: 'Expected { poolId }' }, { status: 400 })
  }

  try {
    const perWallet = await Promise.all(
      trackedWallets().map((wallet) => fetchAddablePositions(wallet.address, parsed.data.poolId)),
    )
    const labels = new Map(trackedWallets().map((wallet) => [wallet.address, wallet.label]))

    return NextResponse.json({
      positions: perWallet.flat().map((position) => ({
        ...position,
        walletLabel: labels.get(position.wallet) ?? position.wallet,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
