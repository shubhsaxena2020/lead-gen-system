import { pool } from '../db/pool.js'

export async function isDuplicate(businessName: string, address: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM leads_seen WHERE business_name = $1 AND address = $2`,
    [businessName, address]
  )
  return (result.rowCount ?? 0) > 0
}

export async function markSeen(businessName: string, address: string): Promise<void> {
  await pool.query(
    `INSERT INTO leads_seen (business_name, address) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [businessName, address]
  )
}
