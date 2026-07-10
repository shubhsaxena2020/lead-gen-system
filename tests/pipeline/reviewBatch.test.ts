import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const { spawnMock, lastChild } = vi.hoisted(() => ({ spawnMock: vi.fn(), lastChild: { current: null as any } }))

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => {
    spawnMock(...args)
    const child: any = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { write: vi.fn(), end: vi.fn() }
    lastChild.current = child
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

  it('writes the prompt to stdin and closes it, instead of passing it as a CLI argument', async () => {
    // The prompt used to be passed as a CLI arg, but a large review batch
    // serializes to more bytes than the OS allows in one process's argv -
    // reproduced live against a real deployed container, which crash-looped
    // with `spawn E2BIG` once enough leads had accumulated. Piping over
    // stdin removes that ceiling; explicitly ending the stream (rather than
    // execFile's default of leaving it open with nothing written) avoids
    // the separate hang bug this code already guards against.
    const leads = [makeLead('Gym A')]
    await reviewBatch(leads)

    const [, args, options] = spawnMock.mock.calls[0]
    expect(args).toEqual(['run', '--agent', expect.any(String)])
    expect((options as { stdio: string[] }).stdio[0]).toBe('pipe')

    expect(lastChild.current.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining(leads[0].businessName)
    )
    expect(lastChild.current.stdin.end).toHaveBeenCalled()
  })
})
