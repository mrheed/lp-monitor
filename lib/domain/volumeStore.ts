// Imported bare rather than as `node:fs`, matching alertStore and the rest of this codebase.
// next.config stubs `fs` to false for the client and edge builds, and that fallback matches the
// bare specifier only: webpack treats `node:fs` as a URI scheme and fails the build over it.
// Reached from those builds because instrumentation.ts imports the alert watcher, which imports
// the sampler, which imports this; the NEXT_RUNTIME guard is a runtime check and the bundler
// still resolves the whole graph.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { BUCKET_LIMIT, isVolumeBucket, type VolumeBucket, type VolumeHistory } from './volumeHistory'

const HISTORY_FILE = '.volume-history.json'

/** The temp file sits beside the target, so the rename onto it stays on one filesystem. */
const TEMP_FILE = `${HISTORY_FILE}.tmp`

// Re-exported so server-side callers can keep importing it from here alongside the readers and
// writers they use it with. It is declared in volumeHistory because client code needs it too.
export type { VolumeHistory } from './volumeHistory'

/** How many consecutive backfills for a pool returned nothing, and when the last one ran. */
export type BackfillAttempt = { attempts: number; lastAttemptMs: number }

/** Failed backfills per pool, keyed the same way as the history. */
export type BackfillLog = Record<string, BackfillAttempt>

/** Everything the file holds: the series every reader wants, and the pacing only the sampler does. */
export type VolumeStore = { history: VolumeHistory; backfill: BackfillLog }

/** Whether a parsed value is a plain object that can be walked by key. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Whether a parsed value carries both attempt fields as finite numbers. */
const isAttempt = (value: unknown): value is BackfillAttempt => {
  if (!isRecord(value)) return false

  return (['attempts', 'lastAttemptMs'] as const).every(
    (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
  )
}

/** The buckets of every pool in a parsed record, sorted and capped. */
const interpretHistory = (record: unknown): VolumeHistory => {
  if (!isRecord(record)) return {}

  const history: VolumeHistory = {}

  for (const [poolId, value] of Object.entries(record)) {
    if (!Array.isArray(value)) continue

    const buckets = value
      .filter(isVolumeBucket)
      .sort((a, b) => a.hourEndMs - b.hourEndMs)
      .slice(-BUCKET_LIMIT)

    if (buckets.length > 0) history[poolId.toLowerCase()] = buckets
  }

  return history
}

/** The backfill markers in a parsed record, dropping anything that is not one. */
const interpretBackfill = (record: unknown): BackfillLog => {
  if (!isRecord(record)) return {}

  const backfill: BackfillLog = {}

  for (const [poolId, value] of Object.entries(record))
    if (isAttempt(value)) backfill[poolId.toLowerCase()] = value

  return backfill
}

/**
 * Interprets a parsed history file, in either shape one has been written in.
 *
 * Kept separate from reading the file so it can be tested without any filesystem access, matching
 * how interpretAlertState is split in alertStore. A malformed bucket is dropped rather
 * than failing the read: losing one hour of one pool costs a gap in a chart, while refusing the
 * whole file would silently reset every pool's baseline and mute alerting until it refilled.
 *
 * The file used to be a bare map of pool id to buckets, and installs still hold that shape, so a
 * record without a `history` key is read as one. The two cannot be confused: a pool id is a hex
 * address and can never be the word `history`.
 */
export const interpretVolumeStore = (record: unknown): VolumeStore => {
  if (!isRecord(record)) return { history: {}, backfill: {} }

  const legacy = !isRecord(record.history)

  return {
    history: interpretHistory(legacy ? record : record.history),
    backfill: legacy ? {} : interpretBackfill(record.backfill),
  }
}

/** Reads the store, yielding an empty one rather than throwing on anything unreadable. */
export const readVolumeStore = (): VolumeStore => {
  try {
    return interpretVolumeStore(JSON.parse(readFileSync(HISTORY_FILE, 'utf8')))
  } catch {
    return { history: {}, backfill: {} }
  }
}

/** The series alone, for the readers with no interest in how backfill is paced. */
export const readVolumeHistory = (): VolumeHistory => readVolumeStore().history

/**
 * Writes the store, ignoring failures.
 *
 * Persistence is a convenience here exactly as it is for alerts: a read-only disk costs the
 * chart its backfill on restart and nothing else.
 *
 * Written to a temp file and renamed over the target rather than rewritten in place, because the
 * stocks page reads this path on every request while the watcher rewrites roughly 700KB of it
 * every minute. A read landing mid-write parsed as truncated JSON and the page rendered as
 * though no history existed. A rename within one directory is atomic, so a reader gets the whole
 * old file or the whole new one.
 */
export const writeVolumeStore = (store: VolumeStore): void => {
  try {
    writeFileSync(TEMP_FILE, JSON.stringify(store))
    renameSync(TEMP_FILE, HISTORY_FILE)
  } catch {
    try {
      // A failed rename leaves the temp file behind. Drop it so a later run cannot mistake a
      // half written copy for the store.
      rmSync(TEMP_FILE, { force: true })
    } catch {
      // The disk is unwritable either way. The sampler keeps working from memory.
    }
  }
}
