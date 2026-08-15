/**
 * Number formatting pinned to one locale, for text that hydrates.
 *
 * `toLocaleString()` formats in whatever locale the runtime has: the server's Node grouped
 * 4336 as "4,336" while a browser in another locale grouped it "4.336", and the first client
 * render disagreed with the server HTML, which React reports as a hydration failure and answers
 * by re-rendering the whole tree.
 *
 * Client components must format through this instead. Server components may keep the runtime
 * locale, since their output is never hydrated.
 */
const grouped = new Intl.NumberFormat('en-US')

/** An integer with fixed thousands grouping, identical on server and client. */
export const count = (value: number): string => grouped.format(value)
