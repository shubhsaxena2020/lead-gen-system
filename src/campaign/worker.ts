import { getNextPendingState, markStateDone, isCampaignStopped } from './queue.js'
import { searchBusinesses } from '../pipeline/overpass.js'
import { normalizeLead } from '../pipeline/normalize.js'
import { isDuplicate, markSeen } from '../pipeline/dedup.js'
import { appendToPendingReview, getPendingReviewRows, promoteRowsToMaster } from '../pipeline/sheets.js'
import { reviewBatch } from '../pipeline/reviewBatch.js'
import type { LeadRow } from '../types.js'

interface ProcessOptions {
  reviewBatchSize?: number
}

async function maybeRunReviewBatch(options: ProcessOptions): Promise<void> {
  const threshold = options.reviewBatchSize ?? Number(process.env.REVIEW_BATCH_SIZE ?? 500)
  const pendingRows = await getPendingReviewRows()
  if (pendingRows.length < threshold) return

  const leads: LeadRow[] = pendingRows.map((row) => ({
    businessName: row[0], country: row[1], state: row[2], city: row[3],
    phone: row[4], email: row[5], socialLink: row[6],
    websiteStatus: 'none', dateFound: row[8],
  }))

  const { clean } = await reviewBatch(leads)
  await promoteRowsToMaster(clean.map((lead) => [
    lead.businessName, lead.country, lead.state, lead.city,
    lead.phone, lead.email, lead.socialLink, lead.websiteStatus, lead.dateFound,
  ]))
}

export async function processCampaign(
  campaignId: number,
  businessType: string,
  country: string,
  options: ProcessOptions = {}
): Promise<void> {
  let state = await getNextPendingState(campaignId)

  while (state) {
    const businesses = await searchBusinesses(businessType, state.stateName)

    for (const business of businesses) {
      if (await isCampaignStopped(campaignId)) {
        return
      }
      if (business.hasWebsite) continue

      const address = `${business.street ?? ''}, ${business.city ?? ''}`
      if (await isDuplicate(business.name, address)) continue

      const lead = normalizeLead(business, country, state.stateName)
      await appendToPendingReview(lead)
      await markSeen(business.name, address)
      await maybeRunReviewBatch(options)
    }

    await markStateDone(state.id)
    state = await getNextPendingState(campaignId)
  }

  // Final partial-batch flush once the queue is empty
  await maybeRunReviewBatch({ ...options, reviewBatchSize: 1 })
}
