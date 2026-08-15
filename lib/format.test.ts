import { describe, expect, it } from 'vitest'
import { count } from './format'

describe('hydration-safe counting', () => {
  it('groups thousands the same way regardless of runtime locale', () => {
    // The server's Node and the reader's browser can disagree on grouping (4,336 vs 4.336),
    // and any disagreement in SSR-rendered text is a hydration failure. Pinned, not inherited.
    expect(count(4_336)).toBe('4,336')
    expect(count(1_000_000)).toBe('1,000,000')
  })

  it('leaves small numbers alone', () => {
    expect(count(42)).toBe('42')
  })
})
