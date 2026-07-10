import { getNextPendingState, markStateDone, isCampaignStopped, completeCampaign } from './queue.js'
import { searchBusinesses } from '../pipeline/overpass.js'
import { normalizeLead } from '../pipeline/normalize.js'
import { isDuplicate, markSeen } from '../pipeline/dedup.js'
import { appendToPendingReview, getPendingReviewRows, clearPendingReview, promoteRowsToMaster } from '../pipeline/sheets.js'
import { reviewBatch } from '../pipeline/reviewBatch.js'
import type { LeadRow } from '../types.js'

interface ProcessOptions {
  reviewBatchSize?: number
  writePaceMs?: number
}

// Stay under Google Sheets' default ~60 write-requests-per-minute-per-user quota.
const DEFAULT_WRITE_PACE_MS = 1100

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

  const { clean, flagged } = await reviewBatch(leads)

  // Clear the whole batch we just reviewed — otherwise Pending Review keeps
  // growing forever, the threshold check never resets, and MiMo ends up
  // re-reviewing the entire accumulated history on every subsequent lead.
  await clearPendingReview()

  await promoteRowsToMaster(clean.map((lead) => [
    lead.businessName, lead.country, lead.state, lead.city,
    lead.phone, lead.email, lead.socialLink, lead.websiteStatus, lead.dateFound,
  ]))

  // Flagged rows go back into Pending Review so the user can still eyeball
  // them, rather than being silently dropped by the clear above.
  for (const lead of flagged) {
    await appendToPendingReview(lead)
  }
}

export async function processCampaign(
  campaignId: number,
  businessType: string,
  country: string,
  options: ProcessOptions = {}
): Promise<void> {
  let state = await getNextPendingState(campaignId)

  stateLoop:
  while (state) {
    let businesses: Awaited<ReturnType<typeof searchBusinesses>>
    try {
      businesses = await searchBusinesses(businessType, state.stateName)
    } catch (err) {
      console.error(`Skipping state "${state.stateName}" — search failed:`, err)
      await markStateDone(state.id)
      state = await getNextPendingState(campaignId)
      continue
    }

    const writePaceMs = options.writePaceMs ?? DEFAULT_WRITE_PACE_MS

    for (const business of businesses) {
      if (await isCampaignStopped(campaignId)) {
        break stateLoop
      }
      if (business.hasWebsite) continue

      const address = `${business.street ?? ''}, ${business.city ?? ''}`
      if (await isDuplicate(business.name, address)) continue

      try {
        const lead = normalizeLead(business, country, state.stateName)
        await appendToPendingReview(lead)
        await markSeen(business.name, address)
        await maybeRunReviewBatch(options)
      } catch (err) {
        console.error(`Skipping business "${business.name}" in "${state.stateName}" — write failed:`, err)
      } finally {
        if (writePaceMs > 0) await sleep(writePaceMs)
      }
    }

    await markStateDone(state.id)
    state = await getNextPendingState(campaignId)
  }

  // Final partial-batch flush -- runs both when the queue empties out
  // naturally AND when a Stop broke out of the loop above, so leads already
  // written to Pending Review still reach Master (and the email scraper)
  // instead of being stranded. Unlike the in-loop call above, this one
  // wasn't wrapped in a try/catch -- a review failure here (e.g. the model
  // not returning valid JSON) crashed the whole process instead of just
  // leaving the rows in Pending Review for the next attempt.
  try {
    await maybeRunReviewBatch({ ...options, reviewBatchSize: 1 })
  } catch (err) {
    console.error(`Final review batch failed for campaign ${campaignId} — leaving rows in Pending Review:`, err)
  }

  // No-op for a stopped campaign (guarded on status='running' inside),
  // so this is safe to call unconditionally regardless of why we got here.
  await completeCampaign(campaignId)
}
