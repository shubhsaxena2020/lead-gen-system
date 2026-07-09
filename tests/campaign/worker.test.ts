import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockGetNextPendingState,
  mockMarkStateDone,
  mockIsCampaignStopped,
  mockCompleteCampaign,
  mockSearchBusinesses,
  mockIsDuplicate,
  mockMarkSeen,
  mockAppendToPendingReview,
  mockGetPendingReviewRows,
  mockClearPendingReview,
  mockPromoteRowsToMaster,
  mockReviewBatch,
} = vi.hoisted(() => ({
  mockGetNextPendingState: vi.fn(),
  mockMarkStateDone: vi.fn(),
  mockIsCampaignStopped: vi.fn().mockResolvedValue(false),
  mockCompleteCampaign: vi.fn(),
  mockSearchBusinesses: vi.fn(),
  mockIsDuplicate: vi.fn().mockResolvedValue(false),
  mockMarkSeen: vi.fn(),
  mockAppendToPendingReview: vi.fn(),
  mockGetPendingReviewRows: vi.fn().mockResolvedValue([]),
  mockClearPendingReview: vi.fn(),
  mockPromoteRowsToMaster: vi.fn(),
  mockReviewBatch: vi.fn(),
}))

vi.mock('../../src/campaign/queue.js', () => ({
  getNextPendingState: mockGetNextPendingState,
  markStateDone: mockMarkStateDone,
  isCampaignStopped: mockIsCampaignStopped,
  completeCampaign: mockCompleteCampaign,
}))
vi.mock('../../src/pipeline/overpass.js', () => ({ searchBusinesses: mockSearchBusinesses }))
vi.mock('../../src/pipeline/dedup.js', () => ({ isDuplicate: mockIsDuplicate, markSeen: mockMarkSeen }))
vi.mock('../../src/pipeline/sheets.js', () => ({
  appendToPendingReview: mockAppendToPendingReview,
  getPendingReviewRows: mockGetPendingReviewRows,
  clearPendingReview: mockClearPendingReview,
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

  it('flushes Pending Review to Master and completes the campaign when stopped mid-run, instead of stranding already-written leads', async () => {
    mockGetNextPendingState.mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'Texas', status: 'in_progress' })
    mockIsCampaignStopped
      .mockResolvedValueOnce(false) // Gym A: not stopped yet — gets written
      .mockResolvedValueOnce(true) // Gym B: stop flag now set — loop breaks here
    mockSearchBusinesses.mockResolvedValueOnce([
      { name: 'Gym A', street: '1 Main St', city: 'Austin', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false },
      { name: 'Gym B', street: '2 Main St', city: 'Austin', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false },
    ])
    mockGetPendingReviewRows.mockResolvedValue([['x', 'US', 'TX', 'Austin', 'p', 'e', 's', 'none', '2026-07-08']])
    mockReviewBatch.mockResolvedValue({ clean: [{}], flagged: [] })

    await processCampaign(1, 'gyms', 'United States', { writePaceMs: 0 })

    expect(mockAppendToPendingReview).toHaveBeenCalledTimes(1) // only Gym A, written before the stop
    expect(mockReviewBatch).toHaveBeenCalledTimes(1) // final flush still ran despite the stop
    expect(mockPromoteRowsToMaster).toHaveBeenCalled() // leads reached Master, not stranded in Pending Review
    expect(mockCompleteCampaign).toHaveBeenCalledWith(1)
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

  it('triggers a review batch once the pending count reaches the threshold, clears Pending Review, and puts flagged rows back', async () => {
    mockGetNextPendingState
      .mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'Texas', status: 'in_progress' })
      .mockResolvedValueOnce(null)

    const manyBusinesses = Array.from({ length: 2 }, (_, i) => ({
      name: `Gym ${i}`, street: `${i} Main St`, city: 'Austin',
      phone: null, email: null, facebook: null, instagram: null, hasWebsite: false,
    }))
    mockSearchBusinesses.mockResolvedValueOnce(manyBusinesses)
    mockGetPendingReviewRows.mockResolvedValue(new Array(2).fill(['x', 'US', 'TX', 'Austin', 'p', 'e', 's', 'none', '2026-07-08']))
    const flaggedLead = { businessName: 'Sketchy Gym', country: 'US', state: 'TX', city: 'Austin', phone: 'p', email: 'e', socialLink: 's', websiteStatus: 'none', dateFound: '2026-07-08' }
    mockReviewBatch.mockResolvedValue({ clean: [{}], flagged: [flaggedLead] })

    await processCampaign(1, 'gyms', 'United States', { reviewBatchSize: 2, writePaceMs: 0 })

    expect(mockReviewBatch).toHaveBeenCalled()
    expect(mockClearPendingReview).toHaveBeenCalled()
    expect(mockPromoteRowsToMaster).toHaveBeenCalled()
    // Flagged rows go back into Pending Review so the user can still eyeball them,
    // instead of being silently dropped or re-reviewed forever.
    expect(mockAppendToPendingReview).toHaveBeenCalledWith(flaggedLead)
  })

  it('does not re-trigger a review batch for leads already processed in a prior batch', async () => {
    mockGetNextPendingState
      .mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'Texas', status: 'in_progress' })
      .mockResolvedValueOnce({ id: 2, campaignId: 1, stateName: 'Ohio', status: 'in_progress' })
      .mockResolvedValueOnce(null)

    mockSearchBusinesses
      .mockResolvedValueOnce([{ name: 'Gym A', street: '1 Main St', city: 'Austin', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false }])
      .mockResolvedValueOnce([{ name: 'Gym B', street: '1 Main St', city: 'Columbus', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false }])

    // Once cleared, Pending Review reports empty again for the second business.
    mockGetPendingReviewRows
      .mockResolvedValueOnce([['x']]) // triggers the batch (reviewBatchSize: 1)
      .mockResolvedValueOnce([]) // cleared — second business shouldn't re-trigger
    mockReviewBatch.mockResolvedValue({ clean: [{}], flagged: [] })

    await processCampaign(1, 'gyms', 'United States', { reviewBatchSize: 1, writePaceMs: 0 })

    expect(mockReviewBatch).toHaveBeenCalledTimes(1)
  })
})
