import { describe, it, expect, vi, beforeEach } from 'vitest'

const appendMock = vi.fn().mockResolvedValue({})
const getMock = vi.fn()
const clearMock = vi.fn().mockResolvedValue({})
const batchUpdateMock = vi.fn().mockResolvedValue({})

vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn().mockImplementation(() => ({
        getClient: vi.fn().mockResolvedValue({}),
      })),
    },
    sheets: vi.fn().mockImplementation(() => ({
      spreadsheets: {
        values: {
          append: appendMock,
          get: getMock,
          clear: clearMock,
        },
        batchUpdate: batchUpdateMock,
      },
    })),
  },
}))

import { appendToPendingReview, getPendingReviewRows, promoteRowsToMaster, clearPendingReview } from '../../src/pipeline/sheets.js'
import type { LeadRow } from '../../src/types.js'

const sampleLead: LeadRow = {
  businessName: 'Iron Fist Gym',
  country: 'United States',
  state: 'Texas',
  city: 'Austin',
  phone: 'not found',
  email: 'not found',
  socialLink: 'not found',
  websiteStatus: 'none',
  dateFound: '2026-07-08',
}

describe('sheets client', () => {
  beforeEach(() => {
    appendMock.mockClear()
    getMock.mockClear()
    clearMock.mockClear()
    batchUpdateMock.mockClear()
  })

  it('appends a lead row to the Pending Review tab', async () => {
    await appendToPendingReview(sampleLead)
    expect(appendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        range: expect.stringContaining('Pending Review'),
      })
    )
  })

  it('reads rows from Pending Review', async () => {
    getMock.mockResolvedValue({ data: { values: [['Iron Fist Gym', 'United States']] } })
    const rows = await getPendingReviewRows()
    expect(rows).toHaveLength(1)
  })

  it('clears the Pending Review data rows after a batch has been processed', async () => {
    await clearPendingReview()
    expect(clearMock).toHaveBeenCalledWith(
      expect.objectContaining({
        range: expect.stringContaining('Pending Review'),
      })
    )
  })
})
