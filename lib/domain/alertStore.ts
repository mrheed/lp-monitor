// Imported as `fs` rather than `node:fs`: the bundler compiles this module for every runtime,
// including the edge one that has no filesystem, and refuses to resolve the `node:` scheme there.
import { readFileSync, writeFileSync } from 'fs'
import { DEFAULT_FILTERS, type AlertFilters } from './newPools'

/** One announcement attempt, kept so the UI can show what was sent and when. */
export type AlertRecord = {
  at: number
  /** Which alert produced this, so the history distinguishes the two. */
  kind: 'new-pool' | 'change'
  /** Pairs named in the message, capped so the record stays small. */
  pairs: string[]
  /** Ids of the pools named, so what was announced survives a format change. */
  poolIds: string[]
  poolCount: number
  mentions: string[]
  status: 'sent' | 'failed'
  error?: string
}

/**
 * What the alert file holds: the settings, the record of what was sent, and the pools that were
 * announced.
 *
 * Nothing else belongs here. Pool observations are a cache of what the chain looks like and live
 * separately, so this file stays small and every id in it means "an alert named this pool".
 */
export type AlertState = {
  filters: AlertFilters
  history: AlertRecord[]
  /** Pool ids an alert has actually been delivered for. */
  announced: string[]
  /**
   * The state each watched pool was in when the last change report went out.
   *
   * Persisted because it is the thing a comparison is made against: losing it on restart resets
   * the watcher to "establishing a baseline" and silently skips a report.
   */
  reported: Record<
    string,
    { tvlUsd: number; feesPerHourUsd: number; txPerHour: number | null; volumeUsdPerHour: number | null }
  >
  reportedSignature: string | null
  lastReportAt: number | null
  /**
   * The one message each alert keeps.
   *
   * Persisted because a restart that forgot them would post a second message and defeat the
   * whole point of editing one in place.
   */
  messageIds: { newPool: number | null; change: number | null }
  announcedInMessage: number
}

/**
 * Pool sightings, kept apart because they are a cache rather than a record of anything sent.
 *
 * A value of {@link BASELINE} means the pool was already there when watching began: its
 * existence is recorded, its age is not. Only a pool the watcher saw arrive carries a real
 * timestamp, and only those can be aged exactly.
 */
export type SightingState = {
  firstSeen: Record<string, number>
}

/** Marks a pool as present at baseline, with an age nobody can know. */
export const BASELINE = 0

const STATE_FILE = '.alerts.json'
const SIGHTINGS_FILE = '.pool-sightings.json'

/** How many announcements are kept. Enough to see a pattern, small enough to write cheaply. */
export const HISTORY_LIMIT = 50

/** Pairs named per record, matching what a message itself lists. */
const PAIRS_PER_RECORD = 8

const EMPTY: AlertState = {
  filters: DEFAULT_FILTERS,
  history: [],
  announced: [],
  reported: {},
  reportedSignature: null,
  lastReportAt: null,
  messageIds: { newPool: null, change: null },
  announcedInMessage: 0,
}

/** Reads a JSON file, yielding null rather than throwing on anything unreadable. */
const readJson = (file: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? { ...parsed } : null
  } catch {
    return null
  }
}

/** Writes JSON, ignoring failures so a read-only disk cannot break alerting. */
const writeJson = (file: string, value: unknown) => {
  try {
    writeFileSync(file, JSON.stringify(value, null, 2))
  } catch {
    // Persistence is a convenience; the watcher keeps working from memory without it.
  }
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

/**
 * Interprets a parsed alert file.
 *
 * Kept separate from reading the file so it can be tested without any filesystem access at all.
 *
 * An older file kept a `known` list seeded from whatever existed when watching began, so its
 * entries were never announced. That key is deliberately not read: treating it as an
 * announcement record would mark hundreds of pools as told without anyone having been told.
 */
export const interpretAlertState = (record: Record<string, unknown> | null): AlertState => {
  if (record === null) return EMPTY

  const filters = record.filters

  return {
    filters:
      typeof filters === 'object' && filters !== null
        ? { ...DEFAULT_FILTERS, ...filters }
        : DEFAULT_FILTERS,
    history: Array.isArray(record.history) ? record.history.slice(0, HISTORY_LIMIT) : [],
    announced: stringList(record.announced),
    reported:
      typeof record.reported === 'object' && record.reported !== null
        ? (record.reported as AlertState['reported'])
        : {},
    reportedSignature:
      typeof record.reportedSignature === 'string' ? record.reportedSignature : null,
    lastReportAt: typeof record.lastReportAt === 'number' ? record.lastReportAt : null,
    messageIds: {
      newPool: readId(record.messageIds, 'newPool'),
      change: readId(record.messageIds, 'change'),
    },
    announcedInMessage:
      typeof record.announcedInMessage === 'number' ? record.announcedInMessage : 0,
  }
}

/** Reads one stored message id, treating anything unexpected as absent. */
const readId = (value: unknown, key: 'newPool' | 'change'): number | null => {
  if (typeof value !== 'object' || value === null) return null

  const id = (value as Record<string, unknown>)[key]
  return typeof id === 'number' ? id : null
}

/** Reads persisted alert state, falling back to defaults. */
export const loadAlertState = (): AlertState => interpretAlertState(readJson(STATE_FILE))

export const saveAlertState = (state: AlertState) => {
  writeJson(STATE_FILE, { ...state, history: state.history.slice(0, HISTORY_LIMIT) })
}

/** Reads pool sightings, which are only ever an optimisation for the age column. */
export const loadSightings = (): SightingState => {
  const record = readJson(SIGHTINGS_FILE)
  const firstSeen = record?.firstSeen

  if (typeof firstSeen !== 'object' || firstSeen === null) return { firstSeen: {} }

  return {
    firstSeen: Object.fromEntries(
      Object.entries(firstSeen).filter(([, at]) => typeof at === 'number'),
    ),
  }
}

export const saveSightings = (state: SightingState) => writeJson(SIGHTINGS_FILE, state)

/** Builds a record of one announcement attempt. */
export const toRecord = (
  pools: { pair: string; poolId: string }[],
  mentions: string[],
  outcome: { status: 'sent' } | { status: 'failed'; error: string },
  kind: AlertRecord['kind'] = 'new-pool',
): AlertRecord => ({
  at: Date.now(),
  kind,
  pairs: pools.slice(0, PAIRS_PER_RECORD).map((pool) => pool.pair),
  poolIds: pools.map((pool) => pool.poolId.toLowerCase()),
  poolCount: pools.length,
  mentions,
  ...outcome,
})
