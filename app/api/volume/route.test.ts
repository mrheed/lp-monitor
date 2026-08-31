import { afterEach, describe, expect, it, vi } from 'vitest'

// The handler is a mapper, so the domain is mocked and only delegation and error mapping are
// asserted here. The bucketing itself is covered by the volumeHistory tests.
vi.mock('@/lib/domain/volumeStore', () => ({ readVolumeHistory: vi.fn() }))
vi.mock('@/lib/domain/volumeSampler', () => ({ aggregateSeries: vi.fn() }))

const { readVolumeHistory } = await import('@/lib/domain/volumeStore')
const { aggregateSeries } = await import('@/lib/domain/volumeSampler')
const { GET } = await import('./route')

afterEach(() => vi.clearAllMocks())

describe('GET /api/volume', () => {
  it('returns the aggregate series and the per pool history', async () => {
    const history = { '0xabc': [{ hourEndMs: 3_600_000, volumeUsd: 10, swaps: 2, spanMs: 3_600_000 }] }
    vi.mocked(readVolumeHistory).mockReturnValue(history)
    vi.mocked(aggregateSeries).mockReturnValue(history['0xabc'])

    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ aggregate: history['0xabc'], byPool: history })
  })

  it('maps a domain failure to a 502 carrying its reason', async () => {
    vi.mocked(readVolumeHistory).mockImplementation(() => {
      throw new Error('disk on fire')
    })

    const response = await GET()

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'disk on fire' })
  })
})
