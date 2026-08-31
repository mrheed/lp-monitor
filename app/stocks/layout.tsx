import type { ReactNode } from 'react'
import { Instrument_Serif } from 'next/font/google'

/**
 * The display voice for this route.
 *
 * Declared in a nested layout so the face is requested only when the stocks page is, rather than
 * loading on every route for one heading. A high contrast serif, per the editorial system; a
 * platform serif would read as a fallback rather than a choice.
 */
const editorialSerif = Instrument_Serif({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-editorial-serif',
  fallback: ['Georgia', 'Times New Roman', 'serif'],
})

/**
 * Wraps the route in the editorial colour scope.
 *
 * Every Tailwind colour role resolves to a CSS variable, so the class swaps the whole page's
 * palette from the dark trading surface to warm paper without any component knowing.
 */
const StocksLayout = ({ children }: { children: ReactNode }) => (
  <div className={`editorial ${editorialSerif.variable} min-h-screen`}>{children}</div>
)

export default StocksLayout
