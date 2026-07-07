import pg from 'pg'
import 'dotenv/config'

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
})

export async function withClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}
