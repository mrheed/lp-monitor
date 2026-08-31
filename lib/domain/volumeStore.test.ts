import { afterEach, describe, expect, it, vi } from 'vitest'
import { renameSync, rmSync, writeFileSync } from 'fs'
import { HOUR_MS } from './volumeHistory'
import { interpretVolumeStore, writeVolumeStore } from './volumeStore'

// The filesystem is mocked so the atomic write can be asserted by the calls it makes, without
// leaving a history file in the repo. The interpreter below touches no filesystem at all.
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}))

const bucket = { hourEndMs: HOUR_MS, volumeUsd: 100, swaps: 5, spanMs: HOUR_MS }

afterEach(() => vi.clearAllMocks())

describe('interpretVolumeStore', () => {
  it('reads a well formed file', () => {
    expect(interpretVolumeStore({ history: { '0xabc': [bucket] }, backfill: {} })).toEqual({
      history: { '0xabc': [bucket] },
      backfill: {},
    })
  })

  it('reads a file written before backfill attempts were recorded', () => {
    // The store used to be a bare map of pool id to buckets. An install holding one must keep its
    // history rather than have it discarded and re-fetched.
    expect(interpretVolumeStore({ '0xabc': [bucket] })).toEqual({
      history: { '0xabc': [bucket] },
      backfill: {},
    })
  })

  it('lowercases pool ids so the two feeds agree on the key', () => {
    const parsed = interpretVolumeStore({
      history: { '0xABC': [bucket] },
      backfill: { '0xDEF': { attempts: 1, lastAttemptMs: 5 } },
    })

    expect(Object.keys(parsed.history)).toEqual(['0xabc'])
    expect(Object.keys(parsed.backfill)).toEqual(['0xdef'])
  })

  it('yields an empty store for a missing or unreadable file', () => {
    expect(interpretVolumeStore(null)).toEqual({ history: {}, backfill: {} })
    expect(interpretVolumeStore('not an object')).toEqual({ history: {}, backfill: {} })
  })

  it('drops entries that are not arrays of buckets', () => {
    const parsed = interpretVolumeStore({ history: { '0xabc': 'nonsense', '0xdef': [bucket] } })

    expect(parsed.history).toEqual({ '0xdef': [bucket] })
  })

  it('drops malformed buckets rather than failing the whole read', () => {
    const parsed = interpretVolumeStore({
      history: { '0xabc': [bucket, { hourEndMs: 'not a number', volumeUsd: 1, swaps: 1, spanMs: 1 }] },
    })

    expect(parsed.history['0xabc']).toEqual([bucket])
  })

  it('drops malformed backfill attempts', () => {
    const parsed = interpretVolumeStore({
      history: {},
      backfill: { '0xabc': { attempts: 'many' }, '0xdef': { attempts: 2, lastAttemptMs: 9 } },
    })

    expect(parsed.backfill).toEqual({ '0xdef': { attempts: 2, lastAttemptMs: 9 } })
  })

  it('keeps only the newest buckets when a file holds too many', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ ...bucket, hourEndMs: (i + 1) * HOUR_MS }))
    const parsed = interpretVolumeStore({ history: { '0xabc': many } })

    expect(parsed.history['0xabc']).toHaveLength(48)
    expect(parsed.history['0xabc'][47].hourEndMs).toBe(100 * HOUR_MS)
  })
})

describe('writeVolumeStore', () => {
  const store = { history: { '0xabc': [bucket] }, backfill: {} }

  it('writes a temp file and renames it over the target, so no reader sees half a file', () => {
    writeVolumeStore(store)

    const [tempPath, contents] = vi.mocked(writeFileSync).mock.calls[0]
    expect(tempPath).toBe('.volume-history.json.tmp')
    expect(JSON.parse(String(contents))).toEqual(store)
    expect(renameSync).toHaveBeenCalledWith('.volume-history.json.tmp', '.volume-history.json')
  })

  it('removes the temp file when the rename fails, and reports nothing', () => {
    vi.mocked(renameSync).mockImplementation(() => {
      throw new Error('read only disk')
    })

    expect(() => writeVolumeStore(store)).not.toThrow()
    expect(rmSync).toHaveBeenCalledWith('.volume-history.json.tmp', { force: true })
  })
})
