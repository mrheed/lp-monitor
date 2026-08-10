import { expect, it } from 'vitest'
import { getPoolsSnapshot } from './pools'

// End to end check against the live APIs. Excluded from the default run by vitest.config.ts;
// invoke with `npm run test:live`. Uses a known active LP wallet unless LP_WALLETS is set,
// so the position join is exercised against data that actually exists.
it('builds a ranked snapshot from live upstream data', async () => {
  // Read from the environment rather than hard coded: a real address in a public repo
  // links an identity to its on-chain positions. Without it, position assertions are skipped.
  const wallets = process.env.LP_WALLETS ?? ''

  const snapshot = await getPoolsSnapshot()
  const top = snapshot.rows.slice(0, 8)

  console.log('total pools:', snapshot.totalPools)
  console.log('activity covered:', snapshot.activityCovered)
  console.log('warnings:', snapshot.warnings)
  console.log('held:', snapshot.rows.filter((row) => row.position !== 'none').map((row) => `${row.pair}=${row.position}`))
  console.table(
    top.map((row) => ({
      score: row.score === null ? null : Math.round(row.score * 100),
      pair: row.pair,
      fees: Math.round(row.totalFeesUsd),
      tvl: Math.round(row.tvlUsd),
      txCount: row.activity ? Math.round(row.activity.transactionsPerHour) : null,
      volPerHour: row.activity ? Math.round(row.activity.volumeUsd) : null,
      traders: row.activity?.uniqueTraders ?? null,
      held: row.position,
    })),
  )
  console.log('sample link:', top[0]?.krystalUrl)

  expect(snapshot.rows.length).toBeGreaterThan(100)
  expect(snapshot.activityCovered).toBeGreaterThan(0)

  if (wallets !== '') {
    expect(snapshot.rows.filter((row) => row.position !== 'none').length).toBeGreaterThan(0)
  }
}, 180_000)
