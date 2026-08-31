import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTERS } from '@/lib/domain/newPools'

// The handler is a mapper, so the watcher is mocked and only the input shape and delegation are
// asserted here. What the watcher does with the filters is covered by its own tests.
vi.mock('@/lib/domain/alertWatcher', () => ({
  getAlertStatus: vi.fn(() => ({ ok: true })),
  setAlertFilters: vi.fn(),
  startAlertWatcher: vi.fn(),
}))

const { setAlertFilters } = await import('@/lib/domain/alertWatcher')
const { PUT } = await import('./route')

afterEach(() => vi.clearAllMocks())

/** A filters request carrying one override. */
const put = (filters: Record<string, unknown>) =>
  PUT(
    new Request('http://localhost/api/alerts', {
      method: 'PUT',
      body: JSON.stringify({ ...DEFAULT_FILTERS, ...filters }),
    }),
  )

describe('PUT /api/alerts', () => {
  it('passes accepted filters to the watcher', async () => {
    const response = await put({ spikeMultiple: 8, spikeMinVolumeUsd: 250_000 })

    expect(response.status).toBe(200)
    expect(setAlertFilters).toHaveBeenCalledWith(
      expect.objectContaining({ spikeMultiple: 8, spikeMinVolumeUsd: 250_000 }),
    )
  })

  it('rejects a spike multiple past its bound, as the sibling fields already do', async () => {
    const response = await put({ spikeMultiple: 100_000 })

    expect(response.status).toBe(400)
    expect(setAlertFilters).not.toHaveBeenCalled()
  })

  it('rejects a volume floor past its bound', async () => {
    const response = await put({ spikeMinVolumeUsd: 5e12 })

    expect(response.status).toBe(400)
    expect(setAlertFilters).not.toHaveBeenCalled()
  })
})
