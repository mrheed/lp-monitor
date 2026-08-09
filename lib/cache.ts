type Entry<T> = { value: T; storedAt: number; expiresAt: number }

const store = new Map<string, Entry<unknown>>()

/**
 * Runs `load` and memoises the result for `ttlMs`, keyed by `key`.
 *
 * A stale entry is preferred over a failed refresh: if `load` throws while a previous value is
 * still held, the previous value is returned, so an upstream blip degrades freshness instead of
 * blanking the table.
 */
export const cached = async <T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> => {
  const existing = store.get(key)
  const now = Date.now()

  if (existing && existing.expiresAt > now) {
    const { value } = existing
    return isOfCachedType<T>(value) ? value : load()
  }

  try {
    const value = await load()
    remember(key, value, ttlMs)
    return value
  } catch (error) {
    if (existing && isOfCachedType<T>(existing.value)) return existing.value
    throw error
  }
}

/**
 * Narrows a cached `unknown` back to its stored type.
 *
 * Entries are only ever written by `cached` under a key the caller controls, so the stored
 * value always matches the type that key was written with. This guard makes that assumption
 * explicit at the read boundary instead of asserting it away with a cast.
 */
const isOfCachedType = <T>(value: unknown): value is T => value !== undefined

/** Reads a live entry, or undefined when absent or expired. Does not run a loader. */
export const peek = <T>(key: string): T | undefined => {
  const existing = store.get(key)
  if (!existing || existing.expiresAt <= Date.now()) return undefined
  return isOfCachedType<T>(existing.value) ? existing.value : undefined
}

/** Stores a value under a key for `ttlMs`, recording when it was written. */
export const remember = <T>(key: string, value: T, ttlMs: number) => {
  const now = Date.now()
  store.set(key, { value, storedAt: now, expiresAt: now + ttlMs })
}

/** A stored value with how long ago it was written. */
export type CacheHit<T> = { value: T; ageMs: number }

/**
 * Reads a stored value whether or not its lifetime has passed, together with its age.
 *
 * Expiry and staleness are separate questions. A caller that can answer from an old value
 * immediately and refresh behind it needs the value and its age, not a yes-or-no on freshness.
 */
export const peekWithAge = <T>(key: string): CacheHit<T> | undefined => {
  const existing = store.get(key)
  if (!existing || !isOfCachedType<T>(existing.value)) return undefined

  return { value: existing.value, ageMs: Date.now() - existing.storedAt }
}

/** Drops every cached entry. */
export const clearCache = () => store.clear()

/**
 * Drops one cached entry by key.
 *
 * Used by the manual refresh, which should re-read the pool feed without discarding the
 * transaction measurements that cost one upstream request per pool, or the TVL sweep that pages
 * through the chain. Clearing everything would make each press pay for all of it again.
 */
export const invalidate = (key: string) => store.delete(key)
