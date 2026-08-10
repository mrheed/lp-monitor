import {
  deleteTelegramMessage,
  sendTelegramMessage,
  telegramConfigured,
  TelegramError,
} from '../clients/telegram'
import {
  ALERT_MAX_BACKOFF_MS,
  ALERT_MIN_SEND_INTERVAL_MS,
  ALERT_POLL_INTERVAL_MS,
  TX_SAMPLE_SIZE_WATCHED,
} from '../config'
import {
  BASELINE,
  HISTORY_LIMIT,
  loadAlertState,
  loadSightings,
  saveAlertState,
  saveSightings,
  toRecord,
  type AlertRecord,
} from './alertStore'
import {
  DEFAULT_FILTERS,
  detectNewPools,
  NAMED_LIMIT,
  formatAlert,
  matchesFilters,
  type AlertCandidate,
  type AlertFilters,
} from './newPools'
import {
  buildChangeReport,
  formatChangeReport,
  hasMaterialChange,
  reportSignature,
  type ChangeRow,
  type PoolMetrics,
} from './poolChanges'
import { getPoolsSnapshot, loadActivityFor } from './pools'
import type { Activity } from '../types'

/** What the UI can see about the watcher without being able to drive it. */
export type AlertStatus = {
  configured: boolean
  running: boolean
  filters: AlertFilters
  knownPools: number
  lastPollAt: number | null
  lastSentAt: number | null
  lastSentCount: number
  /** New pools matched but not yet announced, because a send failed or was throttled. */
  queued: number
  lastError: string | null
  /** Recent announcement attempts, newest first, successes and failures alike. */
  history: AlertRecord[]
  /** How many pools the change report covers, and when it last went out. */
  monitored: number
  lastReportAt: number | null
}

/**
 * Pools that have been announced.
 *
 * Membership means one thing only: an alert naming this pool was delivered. Pools present when
 * watching began are not members, so they queue like any other; marking them silently would
 * record them as told without telling anyone.
 */
type WatcherState = {
  /** Pools an alert has been delivered for. Nothing else ever joins this set. */
  announced: Set<string>
  firstSeen: Map<string, number>
  pending: AlertCandidate[]
  filters: AlertFilters
  history: AlertRecord[]
  timer: ReturnType<typeof setInterval> | null
  restored: boolean
  polling: boolean
  lastPollAt: number | null
  lastSentAt: number | null
  lastSentCount: number
  lastError: string | null
  /** Earliest time another send may be attempted, covering both success and failure. */
  nextAttemptAt: number
  consecutiveFailures: number
  /** State each monitored pool was in when the last change report went out. */
  reported: Map<string, PoolMetrics>
  lastReportAt: number | null
  /** What the last report rendered, so an unchanged one is never sent again. */
  reportedSignature: string | null
  /** The one message each alert keeps, edited rather than replaced. */
  messageIds: { newPool: number | null; change: number | null }
  /** Pools announced since the new-pool message was first posted, for its running total. */
  announcedInMessage: number
}

const FRESH: () => WatcherState = () => ({
  announced: new Set(),
  firstSeen: new Map(),
  pending: [],
  filters: DEFAULT_FILTERS,
  history: [],
  timer: null,
  restored: false,
  polling: false,
  lastPollAt: null,
  lastSentAt: null,
  lastSentCount: 0,
  lastError: null,
  nextAttemptAt: 0,
  consecutiveFailures: 0,
  reported: new Map(),
  lastReportAt: null,
  reportedSignature: null,
  messageIds: { newPool: null, change: null },
  announcedInMessage: 0,
})

/**
 * The watcher's state, held on `globalThis` rather than in module scope.
 *
 * A dev server re-evaluates a changed module without discarding the old one, so module-level
 * state produced a second watcher on every edit: each had its own empty `known` set, its own
 * interval, and announced the same pool again. Anchoring to the global object means a reload
 * reuses the running watcher instead of starting a rival to it.
 */
/**
 * One line per event worth knowing about, prefixed so it is greppable in a server log.
 *
 * Deliberately not per poll: a minute-by-minute heartbeat is 1,400 lines a day that nobody
 * reads. Only starting, sending and failing are reported, which is what tells you whether
 * alerting is alive without burying the answer.
 */
const log = (message: string) => console.log(`[alerts] ${message}`)

const globalKey = Symbol.for('lp-tracker.alertWatcher')
const globals = globalThis as unknown as Record<symbol, WatcherState | undefined>
const state: WatcherState = globals[globalKey] ?? (globals[globalKey] = FRESH())

/**
 * Restores filters, history and the known set from disk, once per process.
 *
 * Restoring the known set is what stops a restart from re-seeding and losing the record of what
 * had already been announced.
 */
const restore = () => {
  if (state.restored) return
  state.restored = true

  const saved = loadAlertState()
  state.filters = saved.filters
  state.history = saved.history
  for (const id of saved.announced) state.announced.add(id)
  for (const [id, metrics] of Object.entries(saved.reported)) state.reported.set(id, metrics)
  state.reportedSignature = saved.reportedSignature
  state.lastReportAt = saved.lastReportAt
  state.messageIds = saved.messageIds
  state.announcedInMessage = saved.announcedInMessage

  // Sightings are a separate file because they are a cache of what the chain looked like, not a
  // record of anything sent. Losing them costs age precision and nothing else.
  for (const [id, at] of Object.entries(loadSightings().firstSeen)) state.firstSeen.set(id, at)
}

/** Writes the parts worth surviving a restart. */
const persist = () => {
  saveAlertState({
    filters: state.filters,
    history: state.history,
    announced: [...state.announced],
    reported: Object.fromEntries(state.reported),
    reportedSignature: state.reportedSignature,
    lastReportAt: state.lastReportAt,
    messageIds: state.messageIds,
    announcedInMessage: state.announcedInMessage,
  })
  saveSightings({ firstSeen: Object.fromEntries(state.firstSeen) })
}

/**
 * When each pool was first observed appearing.
 *
 * Empty for pools that predate the watcher, which is the honest answer: it never saw them
 * arrive, so it cannot say how old they are.
 */
export const getFirstSeen = (): ReadonlyMap<string, number> => {
  restore()
  return state.firstSeen
}

export const getAlertFilters = (): AlertFilters => {
  restore()
  return state.filters
}

/** Replaces the filters the watcher applies to pools it has not yet announced. */
export const setAlertFilters = (next: AlertFilters) => {
  restore()
  state.filters = next

  // A tightened filter should not leave already-queued pools waiting forever, and a loosened one
  // should not retroactively announce pools seen while it was narrow.
  state.pending = state.pending.filter((pool) => matchesFilters(pool, next))
  persist()
}

export const getAlertStatus = (): AlertStatus => {
  restore()
  return {
    configured: telegramConfigured(),
    running: state.timer !== null,
    filters: state.filters,
    knownPools: state.announced.size,
    lastPollAt: state.lastPollAt,
    lastSentAt: state.lastSentAt,
    lastSentCount: state.lastSentCount,
    queued: state.pending.length,
    lastError: state.lastError,
    history: state.history,
    monitored: state.reported.size,
    lastReportAt: state.lastReportAt,
  }
}

/** Adds one attempt to the history, newest first, and persists it. */
const record = (entry: AlertRecord) => {
  state.history = [entry, ...state.history].slice(0, HISTORY_LIMIT)
}

/**
 * Replaces an alert's single message: post the new one, then remove the old.
 *
 * Each alert still leaves exactly one message in the chat, so a chain minting pools all day does
 * not produce a wall. Editing in place was the first approach and it fails the actual job:
 * Telegram sends no notification for an edit, so an updated alert sat silently in place and was
 * never seen. Reposting notifies and carries a current timestamp, which is what an alert is for.
 *
 * The new message goes out before the old one is removed, so a failure at either step leaves an
 * alert in the chat rather than none.
 */
const replaceMessage = async (kind: 'newPool' | 'change', text: string): Promise<void> => {
  const previous = state.messageIds[kind]

  state.messageIds[kind] = await sendTelegramMessage(text)
  if (previous !== null) await deleteTelegramMessage(previous)
}

/**
 * Announces one batch, and records the pools only if Telegram accepted it.
 *
 * At most one message leaves per poll, and never sooner than the minimum interval. A chain that
 * mints pools continuously would otherwise produce a burst of messages that Telegram rate limits
 * and nobody reads; carrying the overflow to the next poll costs a minute of delay instead.
 */
const announce = async () => {
  if (state.pending.length === 0) return
  if (Date.now() < state.nextAttemptAt) return

  // Only as many as the message can name. The rest stay queued and go out next time, so the
  // queue drains at a readable pace rather than one message claiming hundreds of pools.
  const batch = state.pending.slice(0, NAMED_LIMIT)
  try {
    // The running total keeps the edit honest: without it, replacing the text would quietly
    // discard the fact that earlier pools were announced at all.
    const total = state.announcedInMessage + batch.length
    await replaceMessage('newPool', formatAlert(batch, state.filters.mentions, total))
    state.announcedInMessage = total

    for (const pool of batch) state.announced.add(pool.poolId.toLowerCase())
    state.pending = state.pending.filter((pool) => !state.announced.has(pool.poolId.toLowerCase()))

    state.lastSentAt = Date.now()
    state.lastSentCount = batch.length
    state.lastError = null
    state.consecutiveFailures = 0
    state.nextAttemptAt = Date.now() + ALERT_MIN_SEND_INTERVAL_MS
    log(`sent ${batch.length} new pool${batch.length === 1 ? '' : 's'}, ${state.pending.length} queued`)
    record(toRecord(batch, state.filters.mentions, { status: 'sent' }))
  } catch (error) {
    // Left in `pending` and out of `known`, so the same pools are tried again later.
    state.lastError = error instanceof Error ? error.message : 'Unknown error'
    state.consecutiveFailures += 1

    // The throttle previously counted successes only, so a rejected send was retried on the very
    // next poll and kept earning the same rejection. A 429 states how long to wait, which is
    // authoritative; otherwise back off geometrically to a ceiling.
    const requested =
      error instanceof TelegramError && error.retryAfterSeconds !== null
        ? error.retryAfterSeconds * 1_000
        : 0
    const backoff = Math.min(
      ALERT_MIN_SEND_INTERVAL_MS * 2 ** (state.consecutiveFailures - 1),
      ALERT_MAX_BACKOFF_MS,
    )

    state.nextAttemptAt = Date.now() + Math.max(requested, backoff)
    log(`new pool alert failed: ${state.lastError}`)
    record(toRecord(batch, state.filters.mentions, { status: 'failed', error: state.lastError }))
  }

  persist()
}

/**
 * One watch cycle: read the pools, queue what matches and has not been announced, then announce.
 *
 * Nothing is written off silently. Every matching pool is queued and stays queued until a
 * message naming it is delivered, which is what makes the queue depth an honest number.
 */
export const pollOnce = async (): Promise<void> => {
  restore()
  if (state.polling) return
  state.polling = true

  try {
    const { rows } = await getPoolsSnapshot()
    state.lastPollAt = Date.now()

    const candidates: AlertCandidate[] = rows.map((row) => ({
      poolId: row.poolId,
      pair: row.pair,
      feeTier: row.feeTier,
      dynamicFee: row.dynamicFee,
      hasHook: row.hasHook,
      tvlUsd: row.tvlUsd,
      recentFeesPerHourUsd: row.recentFeesPerHourUsd,
      totalFeesUsd: row.totalFeesUsd,
      recentFeeWindow: row.recentFeeWindow,
      // An empty sample means no reading yet, not a pool nobody trades. A brand new pool is
      // usually not in the transaction feed at all, and 0/h would read as dead on arrival.
      txCount: row.activity && row.activity.sampleSize > 0 ? row.activity.sampleSize : null,
      volumeUsd: row.activity && row.activity.sampleSize > 0 ? row.activity.volumeUsd : null,
      windowSeconds:
        row.activity && row.activity.sampleSize > 0 ? row.activity.windowSeconds : null,
      krystalUrl: row.krystalUrl,
      uniswapUrl: row.uniswapUrl,
      openHolders: row.positionHolders
        .filter((holder) => holder.state === 'open')
        .map((holder) => holder.label),
    }))

    // The first poll with no sightings records every pool as baseline: present, age unknown.
    // Every later poll stamps only ids absent from that map, which are genuinely new arrivals.
    //
    // The baseline is decided by the sightings map alone. Deciding it from the announced set as
    // well meant that losing one file while keeping the other stamped the whole chain with the
    // moment of that poll, and every pool then read as minutes old.
    const establishingBaseline = state.firstSeen.size === 0
    const sightedAt = establishingBaseline ? BASELINE : Date.now()

    for (const pool of candidates) {
      const id = pool.poolId.toLowerCase()
      if (!state.firstSeen.has(id)) state.firstSeen.set(id, sightedAt)
    }

    // A pool that does not match stays out of `known`, so loosening a filter later brings it
    // back into scope rather than having silently written it off.
    const { fresh } = detectNewPools(state.announced, candidates, { ...state.filters, enabled: true })

    const queuedIds = new Set(state.pending.map((pool) => pool.poolId.toLowerCase()))
    const added = fresh.filter((pool) => !queuedIds.has(pool.poolId.toLowerCase()))

    // A pool that has just appeared has not been swept yet, so the trade rate the message wants
    // would be blank exactly when it fires. Measuring the few fresh ones costs one request each.
    state.pending = [...state.pending, ...(await withActivity(added, rows))]

    if (state.filters.enabled && telegramConfigured()) await announce()
    await reportChanges(candidates, rows)
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : 'Unknown error'
    log(`poll failed: ${state.lastError}`)
  } finally {
    state.polling = false
  }
}

/**
 * Measures pools that have no reading yet, so an alert can describe what the pool is doing.
 *
 * Only the newly matched pools are measured, which is a handful even on a busy chain. A failure
 * leaves the rate null and the message says so rather than implying the pool is idle.
 */
const withActivity = async (
  pools: AlertCandidate[],
  rows: Awaited<ReturnType<typeof getPoolsSnapshot>>['rows'],
  { remeasure = false } = {},
): Promise<AlertCandidate[]> => {
  // Announcements only need a reading where none exists. A report needs every pool measured the
  // same way: the snapshot pre-measures its top ranked pools with the smaller sweep sample, so
  // leaving those alone put one pool's three minute window beside another's hour in the same
  // table, and the two counts underneath were not comparable.
  const unmeasured = remeasure ? pools : pools.filter((pool) => pool.txCount === null)
  if (unmeasured.length === 0) return pools

  const protocolOf = new Map(rows.map((row) => [row.poolId.toLowerCase(), row.protocol]))

  try {
    const measured = await loadActivityFor(
      unmeasured.map((pool) => ({
        poolId: pool.poolId,
        protocol: protocolOf.get(pool.poolId.toLowerCase()) ?? '',
      })),
      TX_SAMPLE_SIZE_WATCHED,
    )

    return pools.map((pool) => {
      const activity = measured[pool.poolId.toLowerCase()]
      return activity === undefined
        ? pool
        : {
            ...pool,
            txCount: activity.sampleSize,
            volumeUsd: activity.volumeUsd,
            windowSeconds: activity.windowSeconds,
          }
    })
  } catch {
    // Announcing without a rate beats not announcing at all.
    return pools
  }
}

/**
 * Sends the periodic comparison of every monitored pool against its last reported state.
 *
 * Separate from the new-pool alert: one answers "what appeared", the other "what are the pools I
 * checked doing now". Only the pools on the watchlist are covered, because a report spanning
 * every pool on the chain is noise and choosing what to watch is a decision, not a query.
 *
 * The first run establishes the baseline without sending, since a comparison against nothing is
 * just a list.
 */
const reportChanges = async (
  candidates: AlertCandidate[],
  poolRows: Awaited<ReturnType<typeof getPoolsSnapshot>>['rows'],
) => {
  const filters = state.filters
  if (!filters.reportChanges || !telegramConfigured()) return

  const watched = new Set(filters.monitoredPoolIds.map((id) => id.toLowerCase()))
  if (watched.size === 0) return

  const unmeasured = candidates.filter((pool) => watched.has(pool.poolId.toLowerCase()))
  if (unmeasured.length === 0) return

  // Measured here rather than taken from the snapshot, which only pre-measures its highest
  // ranked pools. A watched pool below that cut arrived with no trade figures at all, so six of
  // seven monitored pools reported a dash where their trades should have been. Watching a pool
  // is the reason to measure it, whatever it ranks.
  const monitored = await withActivity(unmeasured, poolRows, { remeasure: true })

  const current = monitored.map((pool) => ({
    poolId: pool.poolId,
    pair: pool.pair,
    metrics: {
      tvlUsd: pool.tvlUsd,
      feesPerHourUsd: pool.recentFeesPerHourUsd,
      txCount: pool.txCount,
      volumeUsd: pool.volumeUsd,
      windowSeconds: pool.windowSeconds,
    },
    openHolders: pool.openHolders,
    krystalUrl: pool.krystalUrl,
  }))

  // Checked every poll, sent only when the rendered figures differ from what was last sent.
  // Comparing raw numbers here would fire every minute on a rounding difference nobody can see.
  const signature = reportSignature(current)
  if (signature === state.reportedSignature) return

  const establishing = state.reportedSignature === null

  if (establishing) {
    // Nothing to compare against yet, so this pass only records the starting state.
    for (const pool of current) state.reported.set(pool.poolId.toLowerCase(), pool.metrics)
    state.reportedSignature = signature
    state.lastReportAt = Date.now()
    persist()
    return
  }

  const rows = buildChangeReport(state.reported, current)

  // Nothing here moved enough to be worth a message. The baseline is deliberately left where it
  // is, so a pool drifting a little each minute still crosses the threshold in time.
  if (!hasMaterialChange(rows, filters.minChangePercent / 100)) return

  try {
    await replaceMessage('change', formatChangeReport(rows, filters.mentions))

    for (const pool of current) state.reported.set(pool.poolId.toLowerCase(), pool.metrics)
    state.reportedSignature = signature
    state.lastReportAt = Date.now()
    state.lastError = null
    log(`sent a change report for ${rows.length} watched pool${rows.length === 1 ? '' : 's'}`)
    record(toRecord(rows.map((row) => ({ pair: row.pair, poolId: row.poolId })), filters.mentions, { status: 'sent' }, 'change'))
    persist()
  } catch (error) {
    // Baseline and signature are left untouched, so the next poll retries the same comparison
    // rather than silently accepting the new state as reported.
    state.lastError = error instanceof Error ? error.message : 'Unknown error'
    log(`change report failed: ${state.lastError}`)
    record(
      toRecord(
        rows.map((row) => ({ pair: row.pair, poolId: row.poolId })),
        filters.mentions,
        { status: 'failed', error: state.lastError },
        'change',
      ),
    )
    persist()
  }
}

/**
 * Builds the change report as it stands right now, without sending it.
 *
 * Reads the same baseline the watcher would compare against, so what this shows is what a
 * message would say. Nothing is recorded and no baseline advances, which is what makes it safe
 * to run repeatedly.
 */
export const previewChangeReport = async (): Promise<{
  rows: ChangeRow[]
  material: boolean
  minChangePercent: number
  lastReportAt: number | null
}> => {
  restore()

  const watched = new Set(state.filters.monitoredPoolIds.map((id) => id.toLowerCase()))
  if (watched.size === 0) {
    return { rows: [], material: false, minChangePercent: state.filters.minChangePercent, lastReportAt: state.lastReportAt }
  }

  const { rows: poolRows } = await getPoolsSnapshot()
  const watchedRows = poolRows.filter((row) => watched.has(row.poolId.toLowerCase()))

  // Measured for the same reason the live report measures: the snapshot only pre-measures its
  // highest ranked pools, so a watched pool below that cut would preview as unmeasured and the
  // preview would not match the message it is meant to predict.
  const measured = await loadActivityFor(
    watchedRows.map(({ poolId, protocol }) => ({ poolId, protocol })),
    TX_SAMPLE_SIZE_WATCHED,
  ).catch(() => ({}) as Record<string, Activity>)

  const current = watchedRows.map((row) => {
    const activity = measured[row.poolId.toLowerCase()] ?? row.activity ?? null
    const seen = activity !== null && activity.sampleSize > 0

    return {
      poolId: row.poolId,
      pair: row.pair,
      metrics: {
        tvlUsd: row.tvlUsd,
        feesPerHourUsd: row.recentFeesPerHourUsd,
        txCount: seen ? activity.sampleSize : null,
        volumeUsd: seen ? activity.volumeUsd : null,
        windowSeconds: seen ? activity.windowSeconds : null,
      },
      openHolders: row.positionHolders
        .filter((holder) => holder.state === 'open')
        .map((holder) => holder.label),
      krystalUrl: row.krystalUrl,
    }
  })

  const rows = buildChangeReport(state.reported, current)

  return {
    rows,
    material: hasMaterialChange(rows, state.filters.minChangePercent / 100),
    minChangePercent: state.filters.minChangePercent,
    lastReportAt: state.lastReportAt,
  }
}

/**
 * Starts the polling loop, once per process.
 *
 * Polling runs whether or not alerts are switched on, so the queue builds while they are off and
 * drains once they are on. It also keeps the pool snapshot warm, so a browser asking for it
 * rarely waits on the upstream.
 */
export const startAlertWatcher = () => {
  restore()
  if (state.timer !== null) return

  const seconds = Math.round(ALERT_POLL_INTERVAL_MS / 1000)
  const configured = telegramConfigured()
  const { enabled, reportChanges, monitoredPoolIds } = state.filters

  log(
    `watching every ${seconds}s · telegram ${configured ? 'configured' : 'NOT configured'} · ` +
      `new pools ${enabled ? 'on' : 'off'} · ` +
      `changes ${reportChanges ? `on, ${monitoredPoolIds.length} watched` : 'off'}`,
  )

  if (!configured) {
    log('set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.local to send anything')
  }

  const timer = setInterval(() => {
    void pollOnce()
  }, ALERT_POLL_INTERVAL_MS)

  // `unref` keeps the interval from holding the process open on its own.
  if (typeof timer === 'object' && 'unref' in timer) timer.unref()
  state.timer = timer

  void pollOnce()
}

/** Stops the loop and forgets everything. Used by tests. */
export const resetAlertWatcher = () => {
  if (state.timer !== null) clearInterval(state.timer)
  Object.assign(state, FRESH())
}
