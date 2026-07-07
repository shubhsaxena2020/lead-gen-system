import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { pool } from '../../src/db/pool.js'
import { migrate } from '../../src/db/migrate.js'
import { isDuplicate, markSeen } from '../../src/pipeline/dedup.js'

describe('dedup', () => {
  beforeAll(async () => {
    await migrate()
  })

  beforeEach(async () => {
    await pool.query('TRUNCATE leads_seen RESTART IDENTITY')
  })

  afterAll(async () => {
    await pool.end()
  })

  it('reports not a duplicate for a new business', async () => {
    expect(await isDuplicate('Iron Fist Gym', '123 Main St')).toBe(false)
  })

  it('reports a duplicate after marking it seen', async () => {
    await markSeen('Iron Fist Gym', '123 Main St')
    expect(await isDuplicate('Iron Fist Gym', '123 Main St')).toBe(true)
  })

  it('treats different addresses for the same name as distinct', async () => {
    await markSeen('Iron Fist Gym', '123 Main St')
    expect(await isDuplicate('Iron Fist Gym', '999 Other Ave')).toBe(false)
  })
})
