import { readFileSync, writeFileSync } from 'node:fs'
import { BUCKET_LIMIT, type VolumeBucket } from './volumeHistory'

const HISTORY_FILE = '.volume-history.json'

/** Hourly buckets per pool, keyed by lowercased pool id. */
export type VolumeHistory = Record<string, VolumeBucket[]>

/** Whether a parsed value carries every bucket field as a finite number. */
const isBucket = (value: unknown): value is VolumeBucket => {
  if (typeof value !== 'object' || value === null) return false

  const candidate: Record<string, unknown> = { ...value }
  return (['hourEndMs', 'volumeUsd', 'swaps', 'spanMs'] as const).every(
    (key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]),
  )
}

/**
 * Interprets a parsed history file.
 *
 * Kept separate from reading the file so it can be tested without any filesystem access, matching
 * how interpretAlertState is split in alertStore. A malformed bucket is dropped rather
 * than failing the read: losing one hour of one pool costs a gap in a chart, while refusing the
 * whole file would silently reset every pool's baseline and mute alerting until it refilled.
 */
export const interpretVolumeHistory = (record: unknown): VolumeHistory => {
  if (typeof record !== 'object' || record === null) return {}

  const history: VolumeHistory = {}

  for (const [poolId, value] of Object.entries(record)) {
    if (!Array.isArray(value)) continue

    const buckets = value
      .filter(isBucket)
      .sort((a, b) => a.hourEndMs - b.hourEndMs)
      .slice(-BUCKET_LIMIT)

    if (buckets.length > 0) history[poolId.toLowerCase()] = buckets
  }

  return history
}

/** Reads the history, yielding an empty one rather than throwing on anything unreadable. */
export const readVolumeHistory = (): VolumeHistory => {
  try {
    return interpretVolumeHistory(JSON.parse(readFileSync(HISTORY_FILE, 'utf8')))
  } catch {
    return {}
  }
}

/**
 * Writes the history, ignoring failures.
 *
 * Persistence is a convenience here exactly as it is for alerts: a read-only disk costs the
 * chart its backfill on restart and nothing else.
 */
export const writeVolumeHistory = (history: VolumeHistory): void => {
  try {
    writeFileSync(HISTORY_FILE, JSON.stringify(history))
  } catch {
    // Nothing to recover. The sampler keeps working from memory.
  }
}
