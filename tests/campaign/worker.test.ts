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

    await processCampaign(1, 'gyms', 'United States')

    expect(mockAppendToPendingReview).toHaveBeenCalledTimes(1)
    expect(mockMarkStateDone).toHaveBeenCalledWith(1)
  })

  it('stops processing immediately when the campaign is flagged as stopped', async () => {
    mockGetNextPendingState.mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'Texas', status: 'in_progress' })
    mockIsCampaignStopped.mockResolvedValue(true)
    mockSearchBusinesses.mockResolvedValueOnce([
      { name: 'Gym A', street: '1 Main St', city: 'Austin', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false },
    ])

    await processCampaign(1, 'gyms', 'United States')

    expect(mockAppendToPendingReview).not.toHaveBeenCalled()
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

    await processCampaign(1, 'gyms', 'United States', { reviewBatchSize: 2 })

    expect(mockReviewBatch).toHaveBeenCalled()
    expect(mockPromoteRowsToMaster).toHaveBeenCalled()
  })
})
