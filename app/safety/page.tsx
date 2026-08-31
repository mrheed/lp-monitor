import { HookSafety } from '@/components/HookSafety'

export const metadata = { title: 'v4 hook safety checker' }

const SafetyPage = () => (
  <main className="deploy-world min-h-[calc(100vh-57px)]">
    <div className="mx-auto max-w-[900px] px-5 py-12 sm:px-8 sm:py-16">
      <header className="mb-10 max-w-2xl">
        <span className="db-kicker flex items-center gap-2.5">
          <span aria-hidden className="h-px w-6 bg-[var(--db-signal)]" />
          Uniswap v4 · liquidity provider risk
        </span>
        <h1 className="db-display mt-6 text-[clamp(34px,5.5vw,60px)]">Can this pool trap you?</h1>
        <p className="mt-6 max-w-[54ch] text-[15px] leading-relaxed text-[var(--db-muted)]">
          A v4 hook runs on the same transaction that moves your liquidity, so it can refuse a deposit, block a
          withdrawal, or take a cut of either. Its powers are fixed in the low bits of its address, which stays readable
          even when the contract is not verified. Paste a pool and see what it is allowed to do, and what it does today.
        </p>
      </header>
      <HookSafety />
    </div>
  </main>
)

export default SafetyPage
