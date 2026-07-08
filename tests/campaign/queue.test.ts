import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { pool } from '../../src/db/pool.js'
import { migrate } from '../../src/db/migrate.js'
import {
  createCampaign,
  getNextPendingState,
  markStateDone,
  isCampaignStopped,
  stopCampaign,
  resetStaleInProgressStates,
  getRunningCampaigns,
} from '../../src/campaign/queue.js'

describe('campaign queue', () => {
  beforeAll(async () => {
    await migrate()
  })

  beforeEach(async () => {
    await pool.query('TRUNCATE campaigns, state_queue RESTART IDENTITY CASCADE')
  })

  afterAll(async () => {
    await pool.end()
  })

  it('creates a campaign with a queue of states', async () => {
    const campaign = await createCampaign('gyms', 'United States', ['Texas', 'Ohio'])
    const queued = await pool.query(
      'SELECT state_name FROM state_queue WHERE campaign_id = $1 ORDER BY id',
      [campaign.id]
    )
    expect(queued.rows.map((r) => r.state_name)).toEqual(['Texas', 'Ohio'])
  })

  it('returns states in order and marks them in_progress', async () => {
    const campaign = await createCampaign('gyms', 'United States', ['Texas', 'Ohio'])
    const first = await getNextPendingState(campaign.id)
    expect(first?.stateName).toBe('Texas')

    const status = await pool.query('SELECT status FROM state_queue WHERE id = $1', [first!.id])
    expect(status.rows[0].status).toBe('in_progress')
  })

  it('moves to the next state once the current one is marked done', async () => {
    const campaign = await createCampaign('gyms', 'United States', ['Texas', 'Ohio'])
    const first = await getNextPendingState(campaign.id)
    await markStateDone(first!.id)
    const second = await getNextPendingState(campaign.id)
    expect(second?.stateName).toBe('Ohio')
  })

  it('returns null once all states are done', async () => {
    const campaign = await createCampaign('gyms', 'United States', ['Texas'])
    const only = await getNextPendingState(campaign.id)
    await markStateDone(only!.id)
    const next = await getNextPendingState(campaign.id)
    expect(next).toBeNull()
  })

  it('reports stop status correctly', async () => {
    const campaign = await createCampaign('gyms', 'United States', ['Texas'])
    expect(await isCampaignStopped(campaign.id)).toBe(false)
    await stopCampaign(campaign.id)
    expect(await isCampaignStopped(campaign.id)).toBe(true)
  })

  it('resets stale in_progress states back to pending (crash recovery)', async () => {
    const campaign = await createCampaign('gyms', 'United States', ['Texas', 'Ohio'])
    await getNextPendingState(campaign.id) // marks Texas in_progress, simulating a crash right after

    await resetStaleInProgressStates()

    const rows = await pool.query(
      `SELECT state_name, status FROM state_queue WHERE campaign_id = $1 ORDER BY id`,
      [campaign.id]
    )
    expect(rows.rows).toEqual([
      { state_name: 'Texas', status: 'pending' },
      { state_name: 'Ohio', status: 'pending' },
    ])
  })

  it('returns only running campaigns, so they can be resumed after a restart', async () => {
    const running = await createCampaign('gyms', 'United States', ['Texas'])
    const stopped = await createCampaign('gyms', 'Canada', ['Ontario'])
    await stopCampaign(stopped.id)

    const result = await getRunningCampaigns()

    expect(result.map((c) => c.id)).toEqual([running.id])
    expect(result[0]).toMatchObject({ businessType: 'gyms', country: 'United States' })
  })
})
