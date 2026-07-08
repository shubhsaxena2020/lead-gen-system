import { pool } from '../db/pool.js'
import type { Campaign, StateQueueItem } from '../types.js'

export async function createCampaign(
  businessType: string,
  country: string,
  states: string[]
): Promise<Campaign> {
  const result = await pool.query(
    `INSERT INTO campaigns (business_type, country) VALUES ($1, $2) RETURNING id, business_type, country, status, created_at`,
    [businessType, country]
  )
  const row = result.rows[0]

  for (const stateName of states) {
    await pool.query(
      `INSERT INTO state_queue (campaign_id, state_name) VALUES ($1, $2)`,
      [row.id, stateName]
    )
  }

  return {
    id: row.id,
    businessType: row.business_type,
    country: row.country,
    status: row.status,
    createdAt: row.created_at,
  }
}

export async function getNextPendingState(campaignId: number): Promise<StateQueueItem | null> {
  const result = await pool.query(
    `UPDATE state_queue
     SET status = 'in_progress'
     WHERE id = (
       SELECT id FROM state_queue
       WHERE campaign_id = $1 AND status = 'pending'
       ORDER BY id
       LIMIT 1
     )
     RETURNING id, campaign_id, state_name, status`,
    [campaignId]
  )
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  return {
    id: row.id,
    campaignId: row.campaign_id,
    stateName: row.state_name,
    status: row.status,
  }
}

export async function markStateDone(stateQueueId: number): Promise<void> {
  await pool.query(`UPDATE state_queue SET status = 'done' WHERE id = $1`, [stateQueueId])
}

export async function stopCampaign(campaignId: number): Promise<void> {
  await pool.query(`UPDATE campaigns SET status = 'stopped' WHERE id = $1`, [campaignId])
}

export async function isCampaignStopped(campaignId: number): Promise<boolean> {
  const result = await pool.query(`SELECT status FROM campaigns WHERE id = $1`, [campaignId])
  return result.rows[0]?.status === 'stopped'
}

/**
 * Call once at process startup, before picking up any campaign. If the worker
 * crashed or the VPS restarted mid-state, that state was left `in_progress`
 * forever — reset it to `pending` so it gets picked up again instead of being
 * silently skipped.
 */
export async function resetStaleInProgressStates(): Promise<void> {
  await pool.query(`UPDATE state_queue SET status = 'pending' WHERE status = 'in_progress'`)
}

/**
 * Campaigns still marked `running` when the process starts were mid-campaign
 * when it last stopped (crash or restart) — nothing else resumes their worker
 * loop, so the caller must re-invoke processCampaign for each of these.
 */
export async function getRunningCampaigns(): Promise<Campaign[]> {
  const result = await pool.query(
    `SELECT id, business_type, country, status, created_at FROM campaigns WHERE status = 'running'`
  )
  return result.rows.map((row) => ({
    id: row.id,
    businessType: row.business_type,
    country: row.country,
    status: row.status,
    createdAt: row.created_at,
  }))
}
