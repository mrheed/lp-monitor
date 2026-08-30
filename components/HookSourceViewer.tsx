'use client'

import { useCallback, useEffect, useState } from 'react'

/** One Solidity source file as the `/api/hook/source` route reports it. */
type SourceFile = { name: string; content: string }

/** Where the fetch currently stands, modeled explicitly rather than as separate booleans. */
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; files: SourceFile[] }

/** Type guard: true when an unknown value already has the `SourceFile` shape. */
const isSourceFile = (value: unknown): value is SourceFile => {
  if (typeof value !== 'object' || value === null) return false
  if (!('name' in value) || !('content' in value)) return false
  return typeof value.name === 'string' && typeof value.content === 'string'
}

/** Narrows an unknown JSON value to the `SourceFile[]` shape the route promises. */
const parseFiles = (value: unknown): SourceFile[] => {
  if (!Array.isArray(value)) throw new Error('Unexpected response shape')
  return value.map((entry) => {
    if (!isSourceFile(entry)) throw new Error('Unexpected file entry')
    return { name: entry.name, content: entry.content }
  })
}

/**
 * Read-only, collapsible viewer for the hook's Solidity source, shown as reference
 * in the deploy console. Fetches `/api/hook/source` once on mount and renders a
 * segmented file switcher with a scrollable, monospace code panel and a copy action.
 */
export const HookSourceViewer = () => {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [activeIndex, setActiveIndex] = useState(0)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/hook/source')
        if (!response.ok) throw new Error(`Request failed (${response.status})`)
        const files = parseFiles(await response.json())
        if (!cancelled) setState({ kind: 'loaded', files })
      } catch (error) {
        if (!cancelled) {
          setState({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to load source' })
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const copyActive = useCallback(async (content: string) => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }, [])

  const subtitle =
    state.kind === 'loaded'
      ? `${state.files.length} file${state.files.length === 1 ? '' : 's'}`
      : state.kind === 'error'
        ? 'unavailable'
        : 'loading…'

  const active = state.kind === 'loaded' ? (state.files[activeIndex] ?? state.files[0]) : null

  return (
    <section className="db-node overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-6 py-4 text-left"
      >
        <svg
          viewBox="0 0 16 16"
          className={`h-3.5 w-3.5 shrink-0 text-[var(--db-muted)] transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="db-kicker">Contract source</span>
        <span className="text-[13px] text-[var(--db-muted)]">· {subtitle}</span>
        <span className="ml-auto text-[13px] text-[var(--db-muted)]">{open ? 'Hide' : 'View'}</span>
      </button>

      {open && active ? (
        <div className="rise-in border-t border-[var(--db-line)] p-6 pt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="db-seg">
              {state.kind === 'loaded'
                ? state.files.map((file, index) => (
                    <button
                      key={file.name}
                      type="button"
                      data-on={index === activeIndex}
                      onClick={() => setActiveIndex(index)}
                    >
                      {file.name}
                    </button>
                  ))
                : null}
            </div>
            <button type="button" onClick={() => copyActive(active.content)} className="db-pill ml-auto text-[13px] text-[var(--db-muted)]">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="db-code max-h-[28rem] overflow-auto border border-[var(--db-line)] bg-[var(--db-bg)] p-4 text-[0.78rem] leading-relaxed text-[var(--db-muted)] whitespace-pre">
            <code>{active.content}</code>
          </pre>
        </div>
      ) : null}

      {open && state.kind === 'loading' ? (
        <p className="border-t border-[var(--db-line)] px-6 py-4 text-[13px] text-[var(--db-muted)]">Loading hook source…</p>
      ) : null}
      {open && state.kind === 'error' ? (
        <p className="border-t border-[var(--db-line)] px-6 py-4 text-[13px] text-[var(--db-muted)]">Could not load hook source: {state.message}</p>
      ) : null}
    </section>
  )
}
