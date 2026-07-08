import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => {
    spawnMock(...args)
    const child: any = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    process.nextTick(() => {
      child.stdout.emit('data', JSON.stringify({ flaggedIndexes: [1] }))
      child.emit('close', 0)
    })
    return child
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
  beforeEach(() => spawnMock.mockClear())

  it('splits leads into clean and flagged based on OpenCode/MiMo output', async () => {
    const leads = [makeLead('Gym A'), makeLead('Gym A'), makeLead('Gym B')]
    const result = await reviewBatch(leads)

    expect(result.clean).toHaveLength(2)
    expect(result.flagged).toHaveLength(1)
    expect(result.flagged[0].businessName).toBe('Gym A')
  })

  it('invokes the opencode CLI with the configured agent name', async () => {
    await reviewBatch([makeLead('Gym A')])
    expect(spawnMock).toHaveBeenCalledWith(
      'opencode',
      expect.arrayContaining(['run', '--agent', expect.any(String)]),
      expect.any(Object)
    )
  })

  it('closes the child process stdin instead of leaving it as an open pipe', async () => {
    // A plain open stdin pipe (execFile's default) makes opencode wait
    // forever for piped input that never arrives - reproduced live against
    // a real deployed container, where every review-batch call hung
    // indefinitely instead of ever returning.
    await reviewBatch([makeLead('Gym A')])
    const [, , options] = spawnMock.mock.calls[0]
    expect((options as { stdio: string[] }).stdio[0]).toBe('ignore')
  })
})
