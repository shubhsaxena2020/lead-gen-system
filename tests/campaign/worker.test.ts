import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockGetNextPendingState,
  mockMarkStateDone,
  mockIsCampaignStopped,
  mockSearchBusinesses,
  mockIsDuplicate,
  mockMarkSeen,
  mockAppendToPendingReview,
  mockGetPendingReviewRows,
  mockPromoteRowsToMaster,
  mockReviewBatch,
} = vi.hoisted(() => ({
  mockGetNextPendingState: vi.fn(),
  mockMarkStateDone: vi.fn(),
  mockIsCampaignStopped: vi.fn().mockResolvedValue(false),
  mockSearchBusinesses: vi.fn(),
  mockIsDuplicate: vi.fn().mockResolvedValue(false),
  mockMarkSeen: vi.fn(),
  mockAppendToPendingReview: vi.fn(),
  mockGetPendingReviewRows: vi.fn().mockResolvedValue([]),
  mockPromoteRowsToMaster: vi.fn(),
  mockReviewBatch: vi.fn(),
}))

vi.mock('../../src/campaign/queue.js', () => ({
  getNextPendingState: mockGetNextPendingState,
  markStateDone: mockMarkStateDone,
  isCampaignStopped: mockIsCampaignStopped,
}))
vi.mock('../../src/pipeline/overpass.js', () => ({ searchBusinesses: mockSearchBusinesses }))
vi.mock('../../src/pipeline/dedup.js', () => ({ isDuplicate: mockIsDuplicate, markSeen: mockMarkSeen }))
vi.mock('../../src/pipeline/sheets.js', () => ({
  appendToPendingReview: mockAppendToPendingReview,
  getPendingReviewRows: mockGetPendingReviewRows,
  promoteRowsToMaster: mockPromoteRowsToMaster,
}))
vi.mock('../../src/pipeline/reviewBatch.js', () => ({ reviewBatch: mockReviewBatch }))

import { processCampaign } from '../../src/campaign/worker.js'

describe('processCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCampaignStopped.mockResolvedValue(false)
    mockGetPendingReviewRows.mockResolvedValue([])
  })

  it('processes each state until the queue is empty, skipping businesses that already have a website', async () => {
    mockGetNextPendingState
      .mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'Texas', status: 'in_progress' })
      .mockResolvedValueOnce(null)

    mockSearchBusinesses.mockResolvedValueOnce([
      { name: 'Gym A', street: '1 Main St', city: 'Austin', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false },
      { name: 'Big Chain', street: '2 Corp Blvd', city: 'Austin', phone: null, email: null, facebook: null, instagram: null, hasWebsite: true },
    ])

    await processCampaign(1, 'gyms', 'United States', { writePaceMs: 0 })

    expect(mockAppendToPendingReview).toHaveBeenCalledTimes(1)
    expect(mockMarkStateDone).toHaveBeenCalledWith(1)
  })

  it('stops processing immediately when the campaign is flagged as stopped', async () => {
    mockGetNextPendingState.mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'Texas', status: 'in_progress' })
    mockIsCampaignStopped.mockResolvedValue(true)
    mockSearchBusinesses.mockResolvedValueOnce([
      { name: 'Gym A', street: '1 Main St', city: 'Austin', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false },
    ])

    await processCampaign(1, 'gyms', 'United States', { writePaceMs: 0 })

    expect(mockAppendToPendingReview).not.toHaveBeenCalled()
  })

  it('does not crash the whole campaign when a state\'s search fails — skips it and continues', async () => {
    mockGetNextPendingState
      .mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'Texas', status: 'in_progress' })
      .mockResolvedValueOnce({ id: 2, campaignId: 1, stateName: 'Ohio', status: 'in_progress' })
      .mockResolvedValueOnce(null)

    mockSearchBusinesses
      .mockRejectedValueOnce(new Error('Overpass request failed with status 406'))
      .mockResolvedValueOnce([
        { name: 'Gym A', street: '1 Main St', city: 'Columbus', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false },
      ])

    await expect(processCampaign(1, 'gyms', 'United States', { writePaceMs: 0 })).resolves.toBeUndefined()

    expect(mockMarkStateDone).toHaveBeenCalledWith(1)
    expect(mockMarkStateDone).toHaveBeenCalledWith(2)
    expect(mockAppendToPendingReview).toHaveBeenCalledTimes(1)
  })

  it('does not crash when writing a single business fails (e.g. Sheets rate limit) — skips it and continues', async () => {
    mockGetNextPendingState
      .mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'California', status: 'in_progress' })
      .mockResolvedValueOnce(null)

    mockSearchBusinesses.mockResolvedValueOnce([
      { name: 'Gym A', street: '1 Main St', city: 'LA', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false },
      { name: 'Gym B', street: '2 Main St', city: 'LA', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false },
    ])
    mockAppendToPendingReview
      .mockRejectedValueOnce(new Error('Quota exceeded for quota metric \'Write requests\''))
      .mockResolvedValueOnce(undefined)

    await expect(processCampaign(1, 'gyms', 'United States', { writePaceMs: 0 })).resolves.toBeUndefined()

    expect(mockAppendToPendingReview).toHaveBeenCalledTimes(2)
    expect(mockMarkSeen).toHaveBeenCalledTimes(1)
    expect(mockMarkStateDone).toHaveBeenCalledWith(1)
  })

  it('paces writes to stay under the Sheets API rate limit', async () => {
    mockGetNextPendingState
      .mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'Texas', status: 'in_progress' })
      .mockResolvedValueOnce(null)
    mockSearchBusinesses.mockResolvedValueOnce([
      { name: 'Gym A', street: '1 Main St', city: 'Austin', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false },
    ])

    const start = Date.now()
    await processCampaign(1, 'gyms', 'United States', { writePaceMs: 200 })
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(190)
  })

  it('triggers a review batch once the pending count reaches the threshold', async () => {
    mockGetNextPendingState
      .mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'Texas', status: 'in_progress' })
      .mockResolvedValueOnce(null)

    const manyBusinesses = Array.from({ length: 2 }, (_, i) => ({
      name: `Gym ${i}`, street: `${i} Main St`, city: 'Austin',
      phone: null, email: null, facebook: null, instagram: null, hasWebsite: false,
    }))
    mockSearchBusinesses.mockResolvedValueOnce(manyBusinesses)
    mockGetPendingReviewRows.mockResolvedValue(new Array(2).fill(['x']))
    mockReviewBatch.mockResolvedValue({ clean: [{}, {}], flagged: [] })

    await processCampaign(1, 'gyms', 'United States', { reviewBatchSize: 2, writePaceMs: 0 })

    expect(mockReviewBatch).toHaveBeenCalled()
    expect(mockPromoteRowsToMaster).toHaveBeenCalled()
  })
})
