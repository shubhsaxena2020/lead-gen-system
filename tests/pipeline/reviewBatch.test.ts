import { describe, it, expect, vi, beforeEach } from 'vitest'

const execMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, stdout: string) => void
    execMock(...args)
    cb(null, JSON.stringify({ flaggedIndexes: [1] }))
  },
}))

import { reviewBatch } from '../../src/pipeline/reviewBatch.js'
import type { LeadRow } from '../../src/types.js'

function makeLead(name: string): LeadRow {
  return {
    businessName: name, country: 'US', state: 'Texas', city: 'Austin',
    phone: 'not found', email: 'not found', socialLink: 'not found',
    websiteStatus: 'none', dateFound: '2026-07-08',
  }
}

describe('reviewBatch', () => {
  beforeEach(() => execMock.mockClear())

  it('splits leads into clean and flagged based on OpenCode/MiMo output', async () => {
    const leads = [makeLead('Gym A'), makeLead('Gym A'), makeLead('Gym B')]
    const result = await reviewBatch(leads)

    expect(result.clean).toHaveLength(2)
    expect(result.flagged).toHaveLength(1)
    expect(result.flagged[0].businessName).toBe('Gym A')
  })

  it('invokes the opencode CLI with the configured agent name', async () => {
    await reviewBatch([makeLead('Gym A')])
    expect(execMock).toHaveBeenCalledWith(
      'opencode',
      expect.arrayContaining(['run', '--agent', expect.any(String)]),
      expect.any(Object),
      expect.any(Function)
    )
  })
})
