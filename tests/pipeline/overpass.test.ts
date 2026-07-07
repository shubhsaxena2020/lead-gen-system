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

  it('throws a descriptive error when Overpass returns a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch

    await expect(searchBusinesses('gyms', 'Texas')).rejects.toThrow('Overpass request failed with status 429')
  })
})
