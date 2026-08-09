'use client'

import type { ReactNode } from 'react'
import type { AlertStatus } from '@/lib/domain/alertWatcher'
import { DEFAULT_FILTERS, type AlertFilters } from '@/lib/domain/newPools'

const CONTROL =
  'rounded border border-neutral-800 bg-neutral-900 px-2.5 py-2 outline-none focus-visible:border-neutral-600 focus-visible:ring-1 focus-visible:ring-neutral-500 sm:py-1'

/**
 * One alerting feature: the switch that names it, the controls that qualify it, and what it is
 * currently doing.
 *
 * The name carries the on/off state in its own weight, so which features are live reads from the
 * labels alone rather than from a row of identical checkboxes. Qualifying controls recede while
 * the feature is off, because a filter that changes nothing should not look active.
 */
const AlertGroup = ({
  name,
  enabled,
  onToggle,
  disabled,
  children,
  note,
}: {
  name: string
  enabled: boolean
  onToggle: (next: boolean) => void
  disabled: boolean
  children: ReactNode
  note: ReactNode
}) => (
  <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
    <label className="flex w-full shrink-0 cursor-pointer select-none items-center gap-2 sm:w-36">
      <input
        type="checkbox"
        checked={enabled}
        disabled={disabled}
        onChange={(event) => onToggle(event.target.checked)}
        className="accent-neutral-300"
      />
      <span className={`text-sm ${enabled ? 'font-medium text-neutral-100' : 'text-neutral-500'}`}>
        {name}
      </span>
    </label>

    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-sm transition-opacity ${
        enabled ? 'text-neutral-400' : 'text-neutral-600 opacity-60'
      }`}
    >
      {children}
    </div>

    <p className="min-w-52 flex-1 text-[11px] leading-relaxed text-neutral-600">{note}</p>
  </div>
)

/** A control and its label, kept tight so the pair reads as one unit. */
const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex items-center gap-1.5">
    <span className="whitespace-nowrap text-neutral-500">{label}</span>
    {children}
  </label>
)

/** A number input carrying its unit inside the field rather than beside it. */
const NumberField = ({
  value,
  onChange,
  suffix,
  step = 1,
}: {
  value: number
  onChange: (next: number) => void
  suffix: string
  step?: number
}) => (
  <span className="relative">
    <input
      type="number"
      min={0}
      step={step}
      value={value}
      onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
      className={`w-20 pr-6 ${CONTROL} tabular-nums`}
    />
    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-600">
      {suffix}
    </span>
  </span>
)

/**
 * Controls for both alerting features.
 *
 * Two named rows rather than one bank of controls: the panel previously ran eight inputs at equal
 * weight across two wrapped lines, so which feature each belonged to had to be inferred from
 * position. Mention now sits beneath both, because it applies to both, which its earlier
 * placement inside the first group quietly contradicted.
 */
export const AlertSettings = ({
  status,
  onChange,
}: {
  status: AlertStatus | null
  onChange: (next: AlertFilters) => void
}) => {
  const filters = status?.filters ?? DEFAULT_FILTERS
  const unavailable = status !== null && !status.configured
  const watching = filters.monitoredPoolIds.length

  return (
    <section className="space-y-3 rounded border border-neutral-800 bg-neutral-900/40 px-3 py-3.5 sm:px-4">
      <AlertGroup
        name="New pools"
        enabled={filters.enabled}
        onToggle={(enabled) => onChange({ ...filters, enabled })}
        disabled={unavailable}
        note={
          status === null
            ? 'Contacting the alert watcher…'
            : unavailable
              ? 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local. The token stays on the server.'
              : filters.enabled
                ? `Announcing pools that appear from now on, ${status.knownPools.toLocaleString()} so far.`
                : 'Off. The queue still builds, so switching on sends what appeared meanwhile.'
        }
      >
        <Field label="Fee at least">
          <NumberField
            value={filters.minFeeTier}
            onChange={(minFeeTier) => onChange({ ...filters, minFeeTier })}
            suffix="%"
            step={0.05}
          />
        </Field>
        <Field label="Hooks">
          <select
            value={filters.hooks}
            onChange={(event) => onChange({ ...filters, hooks: hooksFrom(event.target.value) })}
            className={CONTROL}
          >
            <option value="any">Either</option>
            <option value="with">With</option>
            <option value="without">Without</option>
          </select>
        </Field>
        <Field label="Fee">
          <select
            value={filters.dynamicFee}
            onChange={(event) =>
              onChange({ ...filters, dynamicFee: dynamicFeeFrom(event.target.value) })
            }
            className={CONTROL}
          >
            <option value="any">Either</option>
            <option value="only">Dynamic</option>
            <option value="exclude">Fixed</option>
          </select>
        </Field>
        <Field label="Tickers">
          <input
            value={filters.tickers.join(', ')}
            onChange={(event) =>
              onChange({
                ...filters,
                tickers: event.target.value
                  .split(',')
                  .map((ticker) => ticker.trim())
                  .filter(Boolean),
              })
            }
            placeholder="any"
            className={`w-full ${CONTROL} placeholder:text-neutral-700 sm:w-36`}
          />
        </Field>
      </AlertGroup>

      <AlertGroup
        name="Watched pools"
        enabled={filters.reportChanges}
        onToggle={(reportChanges) => onChange({ ...filters, reportChanges })}
        disabled={unavailable}
        note={
          watching === 0
            ? 'Nothing watched. Tick a row in the Watch column to follow its fees, trades and volume.'
            : `Comparing ${watching.toLocaleString()} pool${watching === 1 ? '' : 's'} every minute, sent only when one moves past the threshold.${
                status?.lastReportAt
                  ? ` Last change ${new Date(status.lastReportAt).toLocaleTimeString()}.`
                  : ''
              }`
        }
      >
        <Field label="Ignore moves under">
          <NumberField
            value={filters.minChangePercent}
            onChange={(minChangePercent) => onChange({ ...filters, minChangePercent })}
            suffix="%"
            step={5}
          />
        </Field>
      </AlertGroup>

      {/* Mention drives both features, so it sits under both rather than inside either. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-neutral-800 pt-3 text-sm">
        <span className="w-full shrink-0 text-neutral-500 sm:w-36">Mention</span>
        <input
          value={filters.mentions.join(', ')}
          onChange={(event) =>
            onChange({
              ...filters,
              mentions: event.target.value.split(',').map((handle) => handle.trim()),
            })
          }
          placeholder="@handle, @another"
          className={`w-full ${CONTROL} placeholder:text-neutral-700 sm:w-64`}
        />
        {status?.lastError ? (
          <span className="text-[11px] text-neutral-400">
            Last attempt failed: {status.lastError}
          </span>
        ) : null}
      </div>

      <AlertHistory records={status?.history ?? []} />
    </section>
  )
}

/**
 * Recent announcement attempts.
 *
 * Kept on the server, so it survives a reload and shows sends that happened while no tab was
 * open. Failures are listed alongside successes: a silent absence of alerts and a bot that has
 * been failing for an hour look identical without them.
 */
const AlertHistory = ({ records }: { records: AlertStatus['history'] }) => {
  if (records.length === 0) return null

  return (
    <details className="group border-t border-neutral-800 pt-3">
      <summary className="cursor-pointer list-none text-[11px] text-neutral-500 hover:text-neutral-300">
        <span className="underline decoration-neutral-800 underline-offset-2">
          {records.length} recent alert{records.length === 1 ? '' : 's'}
        </span>
        <span className="ml-1 text-neutral-700 group-open:hidden">show</span>
        <span className="ml-1 hidden text-neutral-700 group-open:inline">hide</span>
      </summary>

      <ul className="mt-2.5 space-y-1.5 border-l border-neutral-800 pl-3 text-[11px]">
        {records.map((entry) => (
          <li key={`${entry.at}-${entry.status}`} className="flex flex-wrap items-baseline gap-x-2">
            <span className="tabular-nums text-neutral-600">
              {new Date(entry.at).toLocaleString()}
            </span>
            <span
              className={
                entry.status === 'sent'
                  ? 'text-neutral-400'
                  : 'rounded-sm border border-neutral-700 px-1 uppercase tracking-wide text-neutral-500'
              }
            >
              {entry.status === 'sent'
                ? `${entry.poolCount} pool${entry.poolCount === 1 ? '' : 's'}`
                : 'failed'}
            </span>
            <span className="text-neutral-700">
              {entry.kind === 'change' ? 'change' : 'new'}
            </span>
            <span className="text-neutral-500">{entry.pairs.join(', ')}</span>
            {entry.poolCount > entry.pairs.length ? (
              <span className="text-neutral-700">+{entry.poolCount - entry.pairs.length} more</span>
            ) : null}
            {entry.mentions.length > 0 ? (
              <span className="text-neutral-700">{entry.mentions.join(' ')}</span>
            ) : null}
            {entry.error ? <span className="text-neutral-600">{entry.error}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Narrows a select value back to the hooks filter without asserting the type away. */
const hooksFrom = (value: string): AlertFilters['hooks'] =>
  value === 'with' || value === 'without' ? value : DEFAULT_FILTERS.hooks

/** Narrows a select value back to the fee-type filter. */
const dynamicFeeFrom = (value: string): AlertFilters['dynamicFee'] =>
  value === 'only' || value === 'exclude' ? value : DEFAULT_FILTERS.dynamicFee
