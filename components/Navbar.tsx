'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { WalletChip } from './WalletChip'

const LINKS = [
  { href: '/', label: 'Pools' },
  { href: '/stocks', label: 'Stocks' },
  { href: '/safety', label: 'Safety check' },
  { href: '/deploy', label: 'Deploy hook' },
] as const

/**
 * Global top bar: a ringed-dot brand mark, uppercase page links, and the wallet connect button.
 *
 * Opaque rather than translucent with a blur. The blur was decoration, not a specific effect, and
 * a half-transparent bar over a scrolling table smears the figures underneath it.
 */
export const Navbar = () => {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <nav className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <span
            aria-hidden
            className="h-3 w-3 rounded-full border border-line-strong"
            style={{ boxShadow: 'inset 0 0 0 3px var(--surface), inset 0 0 0 5px var(--accent)' }}
          />
          LP Pool Tracker
        </Link>

        <div className="flex items-center gap-5">
          {LINKS.map((link) => {
            const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`border-b py-0.5 text-[11px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                  active
                    ? 'border-accent text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink'
                }`}
              >
                {link.label}
              </Link>
            )
          })}
        </div>

        <div className="ml-auto">
          <WalletChip />
        </div>
      </nav>
    </header>
  )
}
