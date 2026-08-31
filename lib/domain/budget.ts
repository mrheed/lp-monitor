/**
 * Resolves with `work`, or with `fallback` if it has not finished within `ms`.
 *
 * Used where a slow upstream should degrade the page rather than hold it: the caller gets a
 * usable answer on a deadline, and the work is left to finish into whatever cache it writes, so
 * the next request benefits from it. A rejection is swallowed into the fallback for the same
 * reason, including one that arrives after the deadline has already passed.
 */
export const withBudget = <T>(work: Promise<T>, ms: number, fallback: T): Promise<T> => {
  // Attached before the race so a late rejection is never an unhandled one.
  const guarded = work.catch(() => fallback)
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    void guarded.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}
