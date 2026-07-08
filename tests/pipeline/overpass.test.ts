import { describe, it, expect, vi, afterEach } from 'vitest'
import { searchBusinesses } from '../../src/pipeline/overpass.js'

const mockOverpassResponse = {
  elements: [
    {
      type: 'node',
      tags: {
        name: 'Iron Fist Gym',
        'addr:street': '123 Main St',
        'addr:city': 'Austin',
        phone: '+1-512-555-0100',
      },
    },
    {
      type: 'node',
      tags: {
        name: 'Big Chain Fitness',
        'addr:street': '456 Corporate Blvd',
        'addr:city': 'Austin',
        website: 'https://bigchainfitness.com',
      },
    },
  ],
}

describe('searchBusinesses', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('queries Overpass and returns parsed businesses with hasWebsite flags', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOverpassResponse,
    }) as unknown as typeof fetch

    const results = await searchBusinesses('gyms', 'Texas')

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ name: 'Iron Fist Gym', hasWebsite: false })
    expect(results[1]).toMatchObject({ name: 'Big Chain Fitness', hasWebsite: true })
  })

  it('sends a descriptive User-Agent header (Overpass blocks generic/missing ones)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOverpassResponse,
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await searchBusinesses('gyms', 'Texas')

    const [, requestInit] = fetchMock.mock.calls[0]
    expect(requestInit.headers['User-Agent']).toBeTruthy()
  })

  it('retries on failure and succeeds once Overpass responds OK', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 406 })
      .mockResolvedValueOnce({ ok: true, json: async () => mockOverpassResponse })
    global.fetch = fetchMock as unknown as typeof fetch

    const results = await searchBusinesses('gyms', 'Texas')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(results).toHaveLength(2)
  })

  it('throws a descriptive error after exhausting retries on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch

    await expect(searchBusinesses('gyms', 'Texas')).rejects.toThrow('Overpass request failed with status 429')
  })
})
