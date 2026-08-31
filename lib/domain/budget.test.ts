import { describe, expect, it } from 'vitest'
import { withBudget } from './budget'

const after = <T,>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

describe('withBudget', () => {
  it('returns the work when it finishes inside the budget', async () => {
    expect(await withBudget(after(5, 'done'), 200, 'fallback')).toBe('done')
  })

  it('returns the fallback when the work overruns, without waiting for it', async () => {
    const started = Date.now()
    expect(await withBudget(after(5_000, 'late'), 30, 'fallback')).toBe('fallback')
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('returns the fallback when the work rejects, so a failure never propagates', async () => {
    expect(await withBudget(Promise.reject(new Error('upstream down')), 200, 'fallback')).toBe(
      'fallback',
    )
  })

  it('does not leave an unhandled rejection behind after falling back', async () => {
    const rejects = new Promise<string>((_, reject) => setTimeout(() => reject(new Error('late')), 20))
    expect(await withBudget(rejects, 5, 'fallback')).toBe('fallback')
    await after(40, null)
  })
})
