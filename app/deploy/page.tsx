import { DeployHook } from '@/components/DeployHook'

export const metadata = { title: 'Deploy v4 hook' }

const DeployPage = () => (
  <main className="deploy-world min-h-[calc(100vh-57px)]">
    <div className="mx-auto max-w-[1100px] px-5 py-12 sm:px-8 sm:py-16">
      <header className="mb-10 max-w-2xl">
        <span className="db-kicker flex items-center gap-2.5">
          <span aria-hidden className="h-px w-6 bg-[var(--db-signal)]" />
          Uniswap v4 · hook deployment
        </span>
        <h1 className="db-display mt-6 text-[clamp(38px,6vw,68px)]">Deploy a volume-tier hook.</h1>
        <p className="mt-6 max-w-[52ch] text-[15px] leading-relaxed text-[var(--db-muted)]">
          The hook whitelists liquidity providers and charges a volume-tiered dynamic fee. Pick a
          network, deploy it, gate the providers, and point it at a pool. Every step waits for your
          wallet; nothing is sent without a simulation first.
        </p>
      </header>
      <DeployHook />
    </div>
  </main>
)

export default DeployPage
