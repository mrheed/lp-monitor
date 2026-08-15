import { hasTransactionFeed } from '../chains'

/** The little a sweep needs to know about a row to decide whether to measure it. */
type Measurable = { protocol: string }

/**
 * The pools a sweep will actually attempt, in rank order.
 *
 * One definition, shared by the sweep and by the progress counter that reports it. They
 * previously disagreed: the sweep skipped protocols Uniswap's transaction feed does not index
 * while the counter still expected them, so progress stopped at 3,516 of 4,336 and read as a
 * stall when the sweep had in fact finished everything it could.
 *
 * Ranked prefix first, then filtered, so the cohort is the same set the score is computed
 * against rather than shifting with how many unindexed pools happen to rank highly.
 */
export const sweepTargets = <T extends Measurable>(rows: T[], limit: number): T[] =>
  rows.slice(0, limit).filter((row) => hasTransactionFeed(row.protocol))

/** How many pools a sweep will attempt, which is what its progress counts towards. */
export const sweepTargetCount = (rows: Measurable[], limit: number): number =>
  sweepTargets(rows, limit).length
