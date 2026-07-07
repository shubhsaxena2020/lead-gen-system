import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreateCampaign, mockStopCampaign, mockProcessCampaign } = vi.hoisted(() => ({
  mockCreateCampaign: vi.fn(),
  mockStopCampaign: vi.fn(),
  mockProcessCampaign: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/campaign/queue.js', () => ({
  createCampaign: mockCreateCampaign,
  stopCampaign: mockStopCampaign,
}))
vi.mock('../../src/campaign/worker.js', () => ({ processCampaign: mockProcessCampaign }))

import { handleStartCampaign, handleStopCampaign } from '../../src/server/routes.js'

function mockReqRes(body: unknown, params: Record<string, string> = {}) {
  const req = { body, params } as any
  const json = vi.fn()
  const status = vi.fn().mockReturnValue({ json })
  const res = { json, status } as any
  return { req, res, json, status }
}

describe('dashboard route handlers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('handleStartCampaign creates a campaign and starts the worker without awaiting it', async () => {
    mockCreateCampaign.mockResolvedValue({ id: 1, businessType: 'gyms', country: 'United States', status: 'running', createdAt: new Date() })

    const { req, res, json } = mockReqRes({ businessType: 'gyms', country: 'United States', states: ['Texas', 'Ohio'] })
    await handleStartCampaign(req, res)

    expect(mockCreateCampaign).toHaveBeenCalledWith('gyms', 'United States', ['Texas', 'Ohio'])
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('handleStopCampaign stops the campaign by id', async () => {
    const { req, res, json } = mockReqRes({}, { id: '5' })
    await handleStopCampaign(req, res)

    expect(mockStopCampaign).toHaveBeenCalledWith(5)
    expect(json).toHaveBeenCalledWith({ stopped: true })
  })
})
