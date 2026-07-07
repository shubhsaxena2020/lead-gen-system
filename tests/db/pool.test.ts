import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../src/db/pool.js'
import { migrate } from '../../src/db/migrate.js'

describe('database pool', () => {
  beforeAll(async () => {
    await migrate()
  })

  afterAll(async () => {
    await pool.end()
  })

  it('connects and can insert/read a campaign', async () => {
    const insert = await pool.query(
      `INSERT INTO campaigns (business_type, country) VALUES ($1, $2) RETURNING id`,
      ['gyms', 'United States']
    )
    const id = insert.rows[0].id
    const read = await pool.query(`SELECT * FROM campaigns WHERE id = $1`, [id])
    expect(read.rows[0].business_type).toBe('gyms')
  })
})
