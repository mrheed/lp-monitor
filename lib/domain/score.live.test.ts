import { expect, it } from 'vitest'
import { getPoolsSnapshot } from './pools'

// Diagnostic: prints the component breakdown behind two specific pools' scores.
it('explains the score for two pools', async () => {
  // Read from the environment rather than hard coded: a real address in a public repo
  // links an identity to its on-chain positions. Without it, the wallet columns are skipped.
  const wallets = process.env.LP_WALLETS ?? ''

  const { rows } = await getPoolsSnapshot()
  const wanted = ['0xd42a4910', '0xa53aed8e']
  const picked = rows.filter((row) => wanted.some((p) => row.poolId.toLowerCase().startsWith(p)))

  console.table(
    picked.map((row) => ({
      pair: row.pair,
      id: row.poolId.slice(0, 10),
      score: row.score === null ? null : Math.round(row.score * 100),
      feeRatePerH: Math.round(row.recentFeesPerHourUsd),
      tvl: Math.round(row.tvlUsd),
      txPerH: row.activity ? Math.round(row.activity.transactionsPerHour) : null,
      traders: row.activity?.uniqueTraders ?? null,
      pFees: row.scoreParts ? Number(row.scoreParts.fees.toFixed(3)) : null,
      pThin: row.scoreParts ? Number(row.scoreParts.tvl.toFixed(3)) : null,
      pRate: row.scoreParts ? Number(row.scoreParts.rate.toFixed(3)) : null,
      pTraders: row.scoreParts ? Number(row.scoreParts.traders.toFixed(3)) : null,
    })),
  )

  const measured = rows.filter((row) => row.activity !== null)
  const traders = measured.map((r) => r.activity?.uniqueTraders ?? 0).sort((a, b) => a - b)
  const rates = measured.map((r) => r.recentFeesPerHourUsd).sort((a, b) => a - b)
  const tvls = measured.map((r) => r.tvlUsd).sort((a, b) => a - b)
  const q = (a: number[], f: number) => a[Math.floor(a.length * f)]

  console.log('cohort size:', measured.length)
  console.log('traders  p10/p50/p90:', q(traders, 0.1), q(traders, 0.5), q(traders, 0.9))
  console.log('feeRate  p10/p50/p90:', q(rates, 0.1).toFixed(0), q(rates, 0.5).toFixed(0), q(rates, 0.9).toFixed(0))
  console.log('tvl      p10/p50/p90:', q(tvls, 0.1).toFixed(0), q(tvls, 0.5).toFixed(0), q(tvls, 0.9).toFixed(0))

  expect(picked.length).toBeGreaterThan(0)
}, 180_000)
