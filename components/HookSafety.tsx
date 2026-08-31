'use client'

import { useState, type ReactNode } from 'react'
import { V4_NETWORKS } from '@/lib/hook/networks'
import type { Inspection } from '@/lib/domain/hookInspector'

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; result: Inspection }

const input =
  'db-input text-sm'
const primaryBtn = 'db-pill db-pill--primary text-sm font-medium'

/** Compact human price for range bounds. */
const fmtPrice = (p: number): string => {
  if (!Number.isFinite(p) || p <= 0) return '—'
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (p >= 1) return p.toLocaleString(undefined, { maximumSignificantDigits: 4 })
  return p.toPrecision(3)
}

/** Krystal deep-link to one position; the path needs the PositionManager and the tokenId. */
const krystalPosition = (chainId: number, owner: string | null, tokenId: string): string => {
  const pm = POSITION_MANAGERS[chainId] ?? ''
  return owner
    ? `https://defi.krystal.app/account/${owner}/positions/${pm}-${tokenId}?chainId=${chainId}`
    : `https://defi.krystal.app/pools?chainId=${chainId}`
}

const POSITION_MANAGERS: Record<number, string> = Object.fromEntries(
  V4_NETWORKS.map((n) => [n.chainId, n.positionManager]),
)

const VERDICT: Record<string, { label: string; blurb: string; className: string }> = {
  safe: {
    label: 'SAFE',
    blurb: 'This hook cannot block or tax your deposits or withdrawals.',
    className: 'border-[var(--db-signal-line)] bg-[var(--db-signal-soft)] text-[var(--db-signal)]',
  },
  caution: {
    label: 'CAUTION',
    blurb: 'Your capital can still leave, but the operator holds powers worth understanding.',
    className: 'border-[color-mix(in_srgb,var(--db-alert)_35%,transparent)] text-[var(--db-ink)]',
  },
  critical: {
    label: 'CRITICAL',
    blurb: 'This hook can interfere with getting your money out.',
    className: 'db-alertbox',
  },
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 border-t border-[var(--db-line)] py-2">
    <span className="db-kicker shrink-0">{label}</span>
    <span className="text-right text-[13px] text-[var(--db-ink)]">{children}</span>
  </div>
)

/**
 * Pastes-in a v4 pool id or hook address and reports what the hook can do to a liquidity
 * provider: the immutable permission bits, the admin surface, and live simulations of the
 * deposit and withdrawal paths on the selected chain.
 */
export const HookSafety = () => {
  const [chainId, setChainId] = useState<number>(8453)
  const [target, setTarget] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })

  const run = async () => {
    if (!target.trim()) return
    setState({ kind: 'loading' })
    try {
      const res = await fetch(`/api/hook/inspect?chainId=${chainId}&target=${encodeURIComponent(target.trim())}`)
      const body: unknown = await res.json()
      if (!res.ok) {
        const message =
          typeof body === 'object' && body !== null && 'error' in body ? String(body.error) : `Request failed (${res.status})`
        throw new Error(message)
      }
      setState({ kind: 'done', result: body as Inspection })
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Inspection failed' })
    }
  }

  const r = state.kind === 'done' ? state.result : null
  const verdict = r ? VERDICT[r.assessment.level] : null

  return (
    <div className="space-y-5">
      <div className="db-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="db-kicker">Network</span>
          <select className={`${input} w-auto`} value={chainId} onChange={(e) => setChainId(Number(e.target.value))}>
            {V4_NETWORKS.map((n) => (
              <option key={n.chainId} value={n.chainId}>
                {n.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            className={`${input} flex-1`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void run()}
            placeholder="pool id (0x… 64 hex) or hook address (0x… 40 hex)"
            spellCheck={false}
          />
          <button className={primaryBtn} onClick={() => void run()} disabled={!target.trim() || state.kind === 'loading'}>
            {state.kind === 'loading' ? 'Checking…' : 'Check safety'}
          </button>
        </div>
        <p className="mt-3 text-[12px] text-[var(--db-muted)]">
          A pool id gives the full report, including live deposit and withdrawal simulations. A bare hook address grades
          its permissions only.
        </p>
      </div>

      {state.kind === 'error' ? <p className="db-alertbox px-4 py-3 text-[13px]">{state.message}</p> : null}

      {r && verdict ? (
        <div className="space-y-5">
          <div className={`rise-in rounded border p-5 sm:p-6 ${verdict.className}`}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-xl font-medium">{verdict.label}</span>
              <span className="text-[13px]">{verdict.blurb}</span>
            </div>
            <p className="db-code mt-2 break-all text-[12px] text-[var(--db-muted)]">
              hook {r.hook} · {r.network.name} · bits 0x{r.assessment.bits.toString(16)}
            </p>
          </div>

          <section className="db-node p-5 sm:p-6">
            <p className="db-kicker mb-2">What this hook can do to an LP</p>
            {r.assessment.findings.length === 0 ? (
              <p className="text-[13px] text-[var(--db-signal)]">
                No liquidity powers at all — the hook is never consulted on deposits or withdrawals.
              </p>
            ) : (
              <ul className="space-y-3">
                {r.assessment.findings.map((f) => (
                  <li key={f.id}>
                    <span
                      className={`text-[13px] font-medium ${
                        f.severity === 'critical'
                          ? 'text-[var(--db-alert)]'
                          : f.severity === 'warning'
                            ? 'text-[var(--db-ink)]'
                            : 'text-[var(--db-muted)]'
                      }`}
                    >
                      {f.title}
                    </span>
                    <p className="mt-0.5 max-w-prose text-[12px] leading-relaxed text-[var(--db-muted)]">{f.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {r.probes.length > 0 ? (
            <section className="db-node p-5 sm:p-6">
              <p className="db-kicker mb-1">What it is doing right now</p>
              <p className="mb-3 text-[12px] text-[var(--db-muted)]">Simulated on-chain against the live contract.</p>
              {r.probes.map((p) => (
                <Row key={p.name} label={p.name}>
                  <span className={p.outcome === 'open' ? 'text-[var(--db-signal)]' : 'text-[var(--db-alert)]'}>
                    {p.outcome === 'open' ? 'open' : 'blocked'}
                  </span>
                  <span className="ml-2 text-[12px] text-[var(--db-muted)]">{p.detail}</span>
                </Row>
              ))}
            </section>
          ) : null}

          {r.pool ? (
            <section className="db-node p-5 sm:p-6">
              <p className="db-kicker mb-2">Pool</p>
              <Row label="Pair">
                {r.pool.symbol0} / {r.pool.symbol1}
              </Row>
              <Row label="Fee mode">{r.pool.dynamicFee ? 'dynamic (hook sets it per swap)' : `static ${r.pool.fee / 10000}%`}</Row>
              <Row label="Fee right now">{(r.pool.lpFee / 10000).toFixed(4)}%</Row>
              <Row label="Tick spacing">{r.pool.tickSpacing}</Row>
              <Row label="Liquidity">{r.pool.liquidity === '0' ? 'none' : r.pool.liquidity}</Row>
              <Row label="LPs ever paid">
                <span className={r.pool.lpFeesAccrue ? 'text-[var(--db-signal)]' : 'text-[var(--db-alert)]'}>
                  {r.pool.lpFeesAccrue ? 'yes' : 'no — fee growth is zero'}
                </span>
              </Row>
            </section>
          ) : null}

          {r.activity ? (
            <section className="db-node p-5 sm:p-6">
              <p className="db-kicker mb-1">Trading</p>
              <p className="mb-3 text-[12px] text-[var(--db-muted)]">
                Last {r.activity.windowBlocks.toLocaleString()} blocks, read from PoolManager logs.
              </p>
              <Row label="Swaps">{r.activity.swaps.toLocaleString()}</Row>
              <Row label="Swap rate">{r.activity.swapsPerHour.toFixed(1)} / hour</Row>
              <Row label="Routers">{r.activity.routers}</Row>
              {r.activity.tiers.length > 0 ? (
                <div className="border-t border-[var(--db-line)] pt-3">
                  <p className="db-kicker mb-2">Fee tiers actually charged</p>
                  {r.activity.tiers.slice(0, 6).map((t) => (
                    <div key={t.feeHundredthsOfBip} className="flex items-center gap-3 py-1">
                      <span
                        className={`w-16 text-[13px] ${
                          t.feeHundredthsOfBip === 0 ? 'text-[var(--db-alert)]' : 'text-[var(--db-ink)]'
                        }`}
                      >
                        {t.percent}
                      </span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--db-line)]">
                        <span
                          className="block h-full bg-[var(--db-signal)]"
                          style={{ width: `${Math.max(2, t.share * 100)}%` }}
                        />
                      </span>
                      <span className="w-24 text-right text-[12px] text-[var(--db-muted)]">
                        {t.swaps} ({(t.share * 100).toFixed(0)}%)
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-[var(--db-muted)]">No swaps in the window.</p>
              )}
            </section>
          ) : null}

          {r.holders.length > 0 && r.pool ? (
            <section className="db-node p-5 sm:p-6">
              <p className="db-kicker mb-1">Top positions</p>
              <p className="mb-3 text-[12px] text-[var(--db-muted)]">
                Largest live positions by deployed value, rebuilt from liquidity events. Value in {r.quoteSymbol};
                range in {r.pool.symbol1} per {r.pool.symbol0}.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-[12px]">
                  <thead>
                    <tr className="text-left text-[var(--db-muted)]">
                      <th className="py-1.5 pr-3 font-normal">#</th>
                      <th className="py-1.5 pr-3 font-normal">Position</th>
                      <th className="py-1.5 pr-3 font-normal">Value</th>
                      <th className="py-1.5 pr-3 font-normal">Range</th>
                      <th className="py-1.5 pr-3 font-normal">Width</th>
                      <th className="py-1.5 pr-3 font-normal">Status</th>
                      <th className="py-1.5 font-normal">Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.holders.map((h, i) => (
                      <tr key={h.tokenId} className="border-t border-[var(--db-line)]">
                        <td className="py-2 pr-3 text-[var(--db-muted)]">{i + 1}</td>
                        <td className="py-2 pr-3">
                          <a
                            className="db-code text-[var(--db-signal)] underline underline-offset-2"
                            href={krystalPosition(r.network.chainId, h.owner, h.tokenId)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            #{h.tokenId}
                          </a>
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-[var(--db-ink)]">
                          {fmtPrice(h.valueToken1)} {r.quoteSymbol}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-[var(--db-muted)]">
                          {fmtPrice(h.lowerPrice)} – {fmtPrice(h.upperPrice)}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-[var(--db-muted)]">
                          {h.widthPercent < 1000 ? `${h.widthPercent.toFixed(1)}%` : 'full'}
                        </td>
                        <td className="py-2 pr-3">
                          <span className={h.inRange ? 'text-[var(--db-signal)]' : 'text-[var(--db-muted)]'}>
                            {h.inRange ? 'in range' : 'out'}
                          </span>
                        </td>
                        <td className="py-2">
                          {h.owner ? (
                            <a
                              className="db-code text-[var(--db-muted)] underline underline-offset-2 hover:text-[var(--db-ink)]"
                              href={`https://defi.krystal.app/account/${h.owner}/positions?chainId=${r.network.chainId}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {h.owner.slice(0, 6)}…{h.owner.slice(-4)}
                            </a>
                          ) : (
                            <span className="text-[var(--db-muted)]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {r.admin.length > 0 ? (
            <section className="db-node p-5 sm:p-6">
              <p className="db-kicker mb-2">Admin surface</p>
              {r.admin.map((a) => (
                <Row key={a.key} label={a.key}>
                  <span className="db-code break-all text-[12px]">{a.value}</span>
                </Row>
              ))}
            </section>
          ) : null}

          {r.notes.length > 0 ? (
            <section className="db-node p-5 sm:p-6">
              <p className="db-kicker mb-2">Notes</p>
              <ul className="space-y-1.5">
                {r.notes.map((n) => (
                  <li key={n} className="text-[13px] text-[var(--db-muted)]">
                    {n}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
