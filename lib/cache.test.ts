import { describe, expect, it } from 'vitest'
import { cached, clearCache, invalidate } from './cache'

/** Returns a loader that counts how many times it actually ran. */
const counter = <T>(value: T) => {
  let calls = 0
  return {
    load: async () => {
      calls += 1
      return value
    },
    get calls() {
      return calls
    },
  }
}

describe('cached', () => {
  it('runs the loader once within the lifetime', async () => {
    clearCache()
    const source = counter('a')

    await cached('k', 60_000, source.load)
    await cached('k', 60_000, source.load)

    expect(source.calls).toBe(1)
  })

  it('runs the loader again once the entry has expired', async () => {
    clearCache()
    const source = counter('a')

    await cached('k', 0, source.load)
    await cached('k', 0, source.load)

    expect(source.calls).toBe(2)
  })

  it('keeps separate entries per key', async () => {
    clearCache()

    expect(await cached('one', 60_000, async () => 1)).toBe(1)
    expect(await cached('two', 60_000, async () => 2)).toBe(2)
  })

  it('serves the previous value when a refresh throws', async () => {
    clearCache()
    await cached('k', 0, async () => 'first')

    const value = await cached('k', 0, async () => {
      throw new Error('upstream down')
    })

    expect(value).toBe('first')
  })

  it('propagates the error when nothing was cached', async () => {
    clearCache()

    await expect(
      cached('k', 60_000, async () => {
        throw new Error('upstream down')
      }),
    ).rejects.toThrow('upstream down')
  })
})

describe('invalidate', () => {
  it('forces one key to reload', async () => {
    clearCache()
    const source = counter('a')

    await cached('k', 60_000, source.load)
    invalidate('k')
    await cached('k', 60_000, source.load)

    expect(source.calls).toBe(2)
  })

  it('leaves other keys cached, so a refresh does not discard expensive work', async () => {
    clearCache()
    const pools = counter('pools')
    const sweep = counter('sweep')

    await cached('pools', 60_000, pools.load)
    await cached('activity', 60_000, sweep.load)

    invalidate('pools')

    await cached('pools', 60_000, pools.load)
    await cached('activity', 60_000, sweep.load)

    expect(pools.calls).toBe(2)
    expect(sweep.calls).toBe(1)
  })

  it('is harmless for a key that was never cached', () => {
    clearCache()

    expect(() => invalidate('missing')).not.toThrow()
  })
})
