# Auto Lead-Gen System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dashboard-driven, unattended "campaign" system that finds businesses with no website via OpenStreetMap, cleans and deduplicates the data, periodically batch-reviews it with MiMo, and writes results to a two-tab Google Sheet — deployed as a Docker service on the user's Oracle VPS.

**Architecture:** A single Node.js/TypeScript service with three parts sharing one Postgres database: (1) an Express API + static dashboard for creating/starting/stopping campaigns, (2) a background worker loop that processes one queued state at a time through the search → filter → normalize → dedup → stage pipeline, and (3) a batch-review step that calls MiMo (via OpenCode) every 500 staged leads to flag likely errors before promoting rows from the sheet's "Pending Review" tab to "Master." Everything runs in one Docker container on the VPS, following the existing `/opt/apps/<name>/` convention.

**Tech Stack:** Node.js 22 + TypeScript, Express, `pg` (raw SQL, no ORM), `googleapis` (Sheets API), built-in `fetch` (Overpass API), Vitest for tests, Docker.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/types.ts`
- Test: `tests/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "lead-gen-system",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/server/app.ts",
    "build": "tsc",
    "start": "node dist/server/app.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "express": "^4.21.0",
    "pg": "^8.13.0",
    "googleapis": "^144.0.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/pg": "^8.11.10",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd "F:\Shubh Active_projects\lead-gen-system" && npm install`
Expected: installs cleanly, creates `package-lock.json`.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 5: Create `.env.example`**

```
DATABASE_URL=postgres://leadgen:leadgen@localhost:5432/leadgen
GOOGLE_SERVICE_ACCOUNT_JSON_PATH=./service-account.json
GOOGLE_SHEET_ID=
OPENCODE_AGENT_NAME=leadgen-reviewer
PORT=3000
DASHBOARD_BASIC_AUTH_USER=shubh
DASHBOARD_BASIC_AUTH_PASSWORD=change-me
REVIEW_BATCH_SIZE=500
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
dist/
.env
service-account.json
*.log
```

- [ ] **Step 7: Create `src/types.ts`**

```typescript
export type CampaignStatus = 'running' | 'stopped' | 'completed'
export type StateQueueStatus = 'pending' | 'in_progress' | 'done'

export interface Campaign {
  id: number
  businessType: string
  country: string
  status: CampaignStatus
  createdAt: Date
}

export interface StateQueueItem {
  id: number
  campaignId: number
  stateName: string
  status: StateQueueStatus
}

export interface RawBusiness {
  name: string
  street: string | null
  city: string | null
  phone: string | null
  email: string | null
  facebook: string | null
  instagram: string | null
  hasWebsite: boolean
}

export interface LeadRow {
  businessName: string
  country: string
  state: string
  city: string
  phone: string
  email: string
  socialLink: string
  websiteStatus: 'none'
  dateFound: string
}
```

- [ ] **Step 8: Write the smoke test**

```typescript
// tests/smoke.test.ts
import { describe, it, expect } from 'vitest'

describe('smoke test', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 9: Run tests to verify setup works**

Run: `npm test`
Expected: PASS, 1 test passed.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example .gitignore src/types.ts tests/smoke.test.ts
git commit -m "Scaffold project: package.json, tsconfig, vitest, shared types"
```

---

## Task 2: Postgres Schema and Connection Pool

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/pool.ts`
- Create: `src/db/migrate.ts`
- Test: `tests/db/pool.test.ts`

- [ ] **Step 1: Write the schema**

```sql
-- src/db/schema.sql
CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  business_type TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'stopped', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS state_queue (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  state_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done')),
  UNIQUE (campaign_id, state_name)
);

CREATE TABLE IF NOT EXISTS leads_seen (
  id SERIAL PRIMARY KEY,
  business_name TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_name, address)
);

CREATE TABLE IF NOT EXISTS pending_review_count (
  campaign_id INTEGER PRIMARY KEY REFERENCES campaigns(id),
  count INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 2: Write the connection pool module**

```typescript
// src/db/pool.ts
import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

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
```

- [ ] **Step 3: Write the migration runner**

```typescript
// src/db/migrate.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pool } from './pool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function migrate(): Promise<void> {
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
  await pool.query(schema)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => {
      console.log('Migration complete')
      process.exit(0)
    })
    .catch((err) => {
      console.error('Migration failed', err)
      process.exit(1)
    })
}
```

- [ ] **Step 4: Write a failing test for the pool (requires a real local Postgres for this test — see note below)**

```typescript
// tests/db/pool.test.ts
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
```

**Note:** this test needs `DATABASE_URL` pointing at a real Postgres (local Docker
Postgres for dev — see Task 12 for the docker-compose that provides one). Start a
local one for development with:
`docker run --rm -d --name leadgen-pg -e POSTGRES_USER=leadgen -e POSTGRES_PASSWORD=leadgen -e POSTGRES_DB=leadgen -p 5432:5432 postgres:16-alpine`

- [ ] **Step 5: Run test to verify it fails (before local Postgres is running)**

Run: `npm test -- tests/db/pool.test.ts`
Expected: FAIL with a connection error (`ECONNREFUSED`) if no local Postgres is running yet.

- [ ] **Step 6: Start local Postgres, then run test to verify it passes**

Run: `docker run --rm -d --name leadgen-pg -e POSTGRES_USER=leadgen -e POSTGRES_PASSWORD=leadgen -e POSTGRES_DB=leadgen -p 5432:5432 postgres:16-alpine`
Then: `npm test -- tests/db/pool.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/db tests/db
git commit -m "Add Postgres schema, connection pool, and migration runner"
```

---

## Task 3: Campaign Queue Operations

**Files:**
- Create: `src/campaign/queue.ts`
- Test: `tests/campaign/queue.test.ts`

- [ ] **Step 1: Write failing tests for queue operations**

```typescript
// tests/campaign/queue.test.ts
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/campaign/queue.test.ts`
Expected: FAIL — `queue.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/campaign/queue.ts`**

```typescript
// src/campaign/queue.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/campaign/queue.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/campaign/queue.ts tests/campaign/queue.test.ts
git commit -m "Add campaign queue: create, pull next state, mark done, stop flag, crash recovery"
```

---

## Task 4: Overpass Search Module

**Files:**
- Create: `src/pipeline/overpass.ts`
- Create: `src/pipeline/businessTypes.ts`
- Test: `tests/pipeline/overpass.test.ts`

- [ ] **Step 1: Define the business-type-to-OSM-tag mapping**

```typescript
// src/pipeline/businessTypes.ts
export const BUSINESS_TYPE_TAGS: Record<string, string[]> = {
  gyms: [
    'leisure=fitness_centre',
    'sport=fitness',
    'sport=crossfit',
    'sport=martial_arts',
    'sport=yoga',
    'sport=boxing',
  ],
}

export function getTagsForBusinessType(businessType: string): string[] {
  const tags = BUSINESS_TYPE_TAGS[businessType]
  if (!tags) {
    throw new Error(`Unknown business type: ${businessType}. Known types: ${Object.keys(BUSINESS_TYPE_TAGS).join(', ')}`)
  }
  return tags
}
```

- [ ] **Step 2: Write failing tests for the Overpass module**

```typescript
// tests/pipeline/overpass.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { searchBusinesses } from '../../src/pipeline/overpass.js'

const mockOverpassResponse = {
  elements: [
    {
      type: 'node',
      tags: {
        name: 'Iron Fist Gym',
        'addr:street': '123 Main St',
        'addr:city': 'Austin',
        phone: '+1-512-555-0100',
      },
    },
    {
      type: 'node',
      tags: {
        name: 'Big Chain Fitness',
        'addr:street': '456 Corporate Blvd',
        'addr:city': 'Austin',
        website: 'https://bigchainfitness.com',
      },
    },
  ],
}

describe('searchBusinesses', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('queries Overpass and returns parsed businesses with hasWebsite flags', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOverpassResponse,
    }) as unknown as typeof fetch

    const results = await searchBusinesses('gyms', 'Texas')

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ name: 'Iron Fist Gym', hasWebsite: false })
    expect(results[1]).toMatchObject({ name: 'Big Chain Fitness', hasWebsite: true })
  })

  it('throws a descriptive error when Overpass returns a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch

    await expect(searchBusinesses('gyms', 'Texas')).rejects.toThrow('Overpass request failed with status 429')
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/pipeline/overpass.test.ts`
Expected: FAIL — `overpass.ts` doesn't exist yet.

- [ ] **Step 4: Implement `src/pipeline/overpass.ts`**

```typescript
// src/pipeline/overpass.ts
import { getTagsForBusinessType } from './businessTypes.js'
import type { RawBusiness } from '../types.js'

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter'

function buildQuery(tags: string[], stateName: string): string {
  const tagClauses = tags
    .map((tag) => {
      const [key, value] = tag.split('=')
      return `node["${key}"="${value}"](area.searchArea);`
    })
    .join('\n  ')

  return `
[out:json][timeout:60];
area["name"="${stateName}"]->.searchArea;
(
  ${tagClauses}
);
out tags;
`.trim()
}

export async function searchBusinesses(businessType: string, stateName: string): Promise<RawBusiness[]> {
  const tags = getTagsForBusinessType(businessType)
  const query = buildQuery(tags, stateName)

  const response = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  if (!response.ok) {
    throw new Error(`Overpass request failed with status ${response.status}`)
  }

  const data = (await response.json()) as { elements: Array<{ tags?: Record<string, string> }> }

  return data.elements
    .filter((el) => el.tags?.name)
    .map((el) => {
      const tags = el.tags!
      return {
        name: tags.name,
        street: tags['addr:street'] ?? null,
        city: tags['addr:city'] ?? null,
        phone: tags.phone ?? tags['contact:phone'] ?? null,
        email: tags.email ?? tags['contact:email'] ?? null,
        facebook: tags['contact:facebook'] ?? null,
        instagram: tags['contact:instagram'] ?? null,
        hasWebsite: Boolean(tags.website ?? tags['contact:website']),
      }
    })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/pipeline/overpass.test.ts`
Expected: PASS, both tests.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/overpass.ts src/pipeline/businessTypes.ts tests/pipeline/overpass.test.ts
git commit -m "Add Overpass search module with business-type tag mapping"
```

---

## Task 5: Normalize Module (Plain Code, No AI)

**Files:**
- Create: `src/pipeline/normalize.ts`
- Test: `tests/pipeline/normalize.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/normalize.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeLead } from '../../src/pipeline/normalize.js'
import type { RawBusiness } from '../../src/types.js'

describe('normalizeLead', () => {
  it('fills in all fields when present', () => {
    const raw: RawBusiness = {
      name: '  iron fist gym  ',
      street: '123 Main St',
      city: 'Austin',
      phone: '512-555-0100',
      email: 'info@ironfist.example',
      facebook: 'https://facebook.com/ironfistgym',
      instagram: null,
      hasWebsite: false,
    }

    const result = normalizeLead(raw, 'United States', 'Texas')

    expect(result).toEqual({
      businessName: 'Iron Fist Gym',
      country: 'United States',
      state: 'Texas',
      city: 'Austin',
      phone: '512-555-0100',
      email: 'info@ironfist.example',
      socialLink: 'https://facebook.com/ironfistgym',
      websiteStatus: 'none',
      dateFound: expect.any(String),
    })
  })

  it('uses "not found" for missing email, phone, and social link', () => {
    const raw: RawBusiness = {
      name: 'Small Town Gym',
      street: null,
      city: null,
      phone: null,
      email: null,
      facebook: null,
      instagram: null,
      hasWebsite: false,
    }

    const result = normalizeLead(raw, 'United States', 'Ohio')

    expect(result.phone).toBe('not found')
    expect(result.email).toBe('not found')
    expect(result.socialLink).toBe('not found')
    expect(result.city).toBe('not found')
  })

  it('prefers facebook over instagram when both are present', () => {
    const raw: RawBusiness = {
      name: 'Test Gym',
      street: null,
      city: null,
      phone: null,
      email: null,
      facebook: 'https://facebook.com/testgym',
      instagram: 'https://instagram.com/testgym',
      hasWebsite: false,
    }

    const result = normalizeLead(raw, 'United States', 'Ohio')
    expect(result.socialLink).toBe('https://facebook.com/testgym')
  })

  it('title-cases business names that are all lowercase or all uppercase', () => {
    const raw: RawBusiness = {
      name: 'IRON FIST GYM',
      street: null, city: null, phone: null, email: null, facebook: null, instagram: null, hasWebsite: false,
    }
    expect(normalizeLead(raw, 'US', 'Texas').businessName).toBe('Iron Fist Gym')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/pipeline/normalize.test.ts`
Expected: FAIL — `normalize.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/pipeline/normalize.ts`**

```typescript
// src/pipeline/normalize.ts
import type { RawBusiness, LeadRow } from '../types.js'

function titleCase(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function isAllOneCase(input: string): boolean {
  const trimmed = input.trim()
  return trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase()
}

export function normalizeLead(raw: RawBusiness, country: string, state: string): LeadRow {
  const businessName = isAllOneCase(raw.name) ? titleCase(raw.name) : raw.name.trim()

  return {
    businessName,
    country,
    state,
    city: raw.city ?? 'not found',
    phone: raw.phone ?? 'not found',
    email: raw.email ?? 'not found',
    socialLink: raw.facebook ?? raw.instagram ?? 'not found',
    websiteStatus: 'none',
    dateFound: new Date().toISOString().slice(0, 10),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/pipeline/normalize.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/normalize.ts tests/pipeline/normalize.test.ts
git commit -m "Add plain-code lead normalization (no AI in the hot path)"
```

---

## Task 6: Deduplication Module

**Files:**
- Create: `src/pipeline/dedup.ts`
- Test: `tests/pipeline/dedup.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/pipeline/dedup.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/pipeline/dedup.test.ts`
Expected: FAIL — `dedup.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/pipeline/dedup.ts`**

```typescript
// src/pipeline/dedup.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/pipeline/dedup.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/dedup.ts tests/pipeline/dedup.test.ts
git commit -m "Add deduplication against leads_seen table"
```

---

## Task 7: Google Sheets Client

**Files:**
- Create: `src/pipeline/sheets.ts`
- Test: `tests/pipeline/sheets.test.ts`

- [ ] **Step 1: Write failing tests (mocking the googleapis client)**

```typescript
// tests/pipeline/sheets.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const appendMock = vi.fn().mockResolvedValue({})
const getMock = vi.fn()
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
        },
        batchUpdate: batchUpdateMock,
      },
    })),
  },
}))

import { appendToPendingReview, getPendingReviewRows, promoteRowsToMaster } from '../../src/pipeline/sheets.js'
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/pipeline/sheets.test.ts`
Expected: FAIL — `sheets.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/pipeline/sheets.ts`**

```typescript
// src/pipeline/sheets.ts
import { google } from 'googleapis'
import 'dotenv/config'
import type { LeadRow } from '../types.js'

const PENDING_TAB = 'Pending Review'
const MASTER_TAB = 'Master'

const HEADER_ORDER: (keyof LeadRow)[] = [
  'businessName', 'country', 'state', 'city', 'phone', 'email', 'socialLink', 'websiteStatus', 'dateFound',
]

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const client = await auth.getClient()
  return google.sheets({ version: 'v4', auth: client as never })
}

function leadToRow(lead: LeadRow): string[] {
  return HEADER_ORDER.map((key) => String(lead[key]))
}

export async function appendToPendingReview(lead: LeadRow): Promise<void> {
  const sheets = await getSheetsClient()
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${PENDING_TAB}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [leadToRow(lead)] },
  })
}

export async function getPendingReviewRows(): Promise<string[][]> {
  const sheets = await getSheetsClient()
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${PENDING_TAB}!A2:I`,
  })
  return result.data.values ?? []
}

export async function promoteRowsToMaster(rows: string[][]): Promise<void> {
  if (rows.length === 0) return
  const sheets = await getSheetsClient()
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${MASTER_TAB}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/pipeline/sheets.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/sheets.ts tests/pipeline/sheets.test.ts
git commit -m "Add Google Sheets client: append to Pending Review, promote to Master"
```

**Manual setup note (not a code step, needed before this works for real):** create a
Google Cloud project (free), enable the Sheets API, create a service account, download
its JSON key to `service-account.json` in the project root, share the target Google
Sheet with the service account's email (Editor access), and set `GOOGLE_SHEET_ID` in
`.env` to the sheet's ID from its URL. Create the "Pending Review" and "Master" tabs
manually with the header row: Business Name, Country, State, City, Phone, Email,
Social Link, Website Status, Date Found.

---

## Task 8: MiMo Batch Review Module

**Files:**
- Create: `src/pipeline/reviewBatch.ts`
- Test: `tests/pipeline/reviewBatch.test.ts`

- [ ] **Step 1: Write failing tests (mocking the OpenCode CLI invocation)**

```typescript
// tests/pipeline/reviewBatch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const execMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, stdout: string) => void
    execMock(...args)
    cb(null, JSON.stringify({ flaggedIndexes: [1] }))
  },
}))

import { reviewBatch } from '../../src/pipeline/reviewBatch.js'
import type { LeadRow } from '../../src/types.js'

function makeLead(name: string): LeadRow {
  return {
    businessName: name, country: 'US', state: 'Texas', city: 'Austin',
    phone: 'not found', email: 'not found', socialLink: 'not found',
    websiteStatus: 'none', dateFound: '2026-07-08',
  }
}

describe('reviewBatch', () => {
  beforeEach(() => execMock.mockClear())

  it('splits leads into clean and flagged based on OpenCode/MiMo output', async () => {
    const leads = [makeLead('Gym A'), makeLead('Gym A'), makeLead('Gym B')]
    const result = await reviewBatch(leads)

    expect(result.clean).toHaveLength(2)
    expect(result.flagged).toHaveLength(1)
    expect(result.flagged[0].businessName).toBe('Gym A')
  })

  it('invokes the opencode CLI with the configured agent name', async () => {
    await reviewBatch([makeLead('Gym A')])
    expect(execMock).toHaveBeenCalledWith(
      'opencode',
      expect.arrayContaining(['run', '--agent', expect.any(String)]),
      expect.any(Object),
      expect.any(Function)
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/pipeline/reviewBatch.test.ts`
Expected: FAIL — `reviewBatch.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/pipeline/reviewBatch.ts`**

```typescript
// src/pipeline/reviewBatch.ts
import { execFile } from 'node:child_process'
import 'dotenv/config'
import type { LeadRow } from '../types.js'

interface ReviewResult {
  clean: LeadRow[]
  flagged: LeadRow[]
}

function runOpenCode(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'opencode',
      ['run', '--agent', process.env.OPENCODE_AGENT_NAME ?? 'leadgen-reviewer', prompt],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err)
        resolve(stdout)
      }
    )
  })
}

export async function reviewBatch(leads: LeadRow[]): Promise<ReviewResult> {
  const prompt = [
    'Review this batch of business leads for likely errors: garbled fields,',
    'obvious duplicate entries, or mismatched contact info.',
    'Respond with ONLY JSON: {"flaggedIndexes": [<0-based indexes of bad rows>]}.',
    '',
    JSON.stringify(leads, null, 2),
  ].join('\n')

  const stdout = await runOpenCode(prompt)
  const parsed = JSON.parse(stdout) as { flaggedIndexes: number[] }
  const flaggedSet = new Set(parsed.flaggedIndexes)

  const clean: LeadRow[] = []
  const flagged: LeadRow[] = []

  leads.forEach((lead, index) => {
    if (flaggedSet.has(index)) {
      flagged.push(lead)
    } else {
      clean.push(lead)
    }
  })

  return { clean, flagged }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/pipeline/reviewBatch.test.ts`
Expected: PASS, both tests.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/reviewBatch.ts tests/pipeline/reviewBatch.test.ts
git commit -m "Add MiMo batch-review module (via OpenCode CLI, threshold-triggered)"
```

**Manual setup note:** create a new OpenCode agent config (separate from the existing
`fbc-builder` agent, which is scoped to the fbc-arena project only) named
`leadgen-reviewer`, pointed at the same `mimo/mimo-v2.5-pro` provider already
configured in `~/.config/opencode/opencode.json` per the user's existing
`brain-hands-pipeline` setup. This agent only needs to read a JSON prompt and return
JSON — no filesystem/build tool access required, so its permissions should be more
restrictive than `fbc-builder`'s.

---

## Task 9: The Worker Loop

**Files:**
- Create: `src/campaign/worker.ts`
- Test: `tests/campaign/worker.test.ts`

- [ ] **Step 1: Write failing tests using mocked pipeline modules**

```typescript
// tests/campaign/worker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetNextPendingState = vi.fn()
const mockMarkStateDone = vi.fn()
const mockIsCampaignStopped = vi.fn().mockResolvedValue(false)
const mockSearchBusinesses = vi.fn()
const mockIsDuplicate = vi.fn().mockResolvedValue(false)
const mockMarkSeen = vi.fn()
const mockAppendToPendingReview = vi.fn()
const mockGetPendingReviewRows = vi.fn().mockResolvedValue([])
const mockPromoteRowsToMaster = vi.fn()
const mockReviewBatch = vi.fn()

vi.mock('../../src/campaign/queue.js', () => ({
  getNextPendingState: mockGetNextPendingState,
  markStateDone: mockMarkStateDone,
  isCampaignStopped: mockIsCampaignStopped,
}))
vi.mock('../../src/pipeline/overpass.js', () => ({ searchBusinesses: mockSearchBusinesses }))
vi.mock('../../src/pipeline/dedup.js', () => ({ isDuplicate: mockIsDuplicate, markSeen: mockMarkSeen }))
vi.mock('../../src/pipeline/sheets.js', () => ({
  appendToPendingReview: mockAppendToPendingReview,
  getPendingReviewRows: mockGetPendingReviewRows,
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

    await processCampaign(1, 'gyms', 'United States')

    expect(mockAppendToPendingReview).toHaveBeenCalledTimes(1)
    expect(mockMarkStateDone).toHaveBeenCalledWith(1)
  })

  it('stops processing immediately when the campaign is flagged as stopped', async () => {
    mockGetNextPendingState.mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'Texas', status: 'in_progress' })
    mockIsCampaignStopped.mockResolvedValue(true)
    mockSearchBusinesses.mockResolvedValueOnce([
      { name: 'Gym A', street: '1 Main St', city: 'Austin', phone: null, email: null, facebook: null, instagram: null, hasWebsite: false },
    ])

    await processCampaign(1, 'gyms', 'United States')

    expect(mockAppendToPendingReview).not.toHaveBeenCalled()
  })

  it('triggers a review batch once the pending count reaches the threshold', async () => {
    mockGetNextPendingState
      .mockResolvedValueOnce({ id: 1, campaignId: 1, stateName: 'Texas', status: 'in_progress' })
      .mockResolvedValueOnce(null)

    const manyBusinesses = Array.from({ length: 2 }, (_, i) => ({
      name: `Gym ${i}`, street: `${i} Main St`, city: 'Austin',
      phone: null, email: null, facebook: null, instagram: null, hasWebsite: false,
    }))
    mockSearchBusinesses.mockResolvedValueOnce(manyBusinesses)
    mockGetPendingReviewRows.mockResolvedValue(new Array(2).fill(['x']))
    mockReviewBatch.mockResolvedValue({ clean: [{}, {}], flagged: [] })

    await processCampaign(1, 'gyms', 'United States', { reviewBatchSize: 2 })

    expect(mockReviewBatch).toHaveBeenCalled()
    expect(mockPromoteRowsToMaster).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/campaign/worker.test.ts`
Expected: FAIL — `worker.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/campaign/worker.ts`**

```typescript
// src/campaign/worker.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/campaign/worker.test.ts`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/campaign/worker.ts tests/campaign/worker.test.ts
git commit -m "Add worker loop: per-state pipeline, stop-flag checks, batch-review triggering"
```

---

## Task 10: Dashboard API

**Files:**
- Create: `src/server/app.ts`
- Test: `tests/server/app.test.ts`

- [ ] **Step 1: Write failing tests using supertest-style raw HTTP calls**

```typescript
// tests/server/app.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreateCampaign = vi.fn()
const mockStopCampaign = vi.fn()
const mockProcessCampaign = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/campaign/queue.js', () => ({
  createCampaign: mockCreateCampaign,
  stopCampaign: mockStopCampaign,
}))
vi.mock('../../src/campaign/worker.js', () => ({ processCampaign: mockProcessCampaign }))

import { createApp } from '../../src/server/app.js'

describe('dashboard API', () => {
  beforeEach(() => vi.clearAllMocks())

  it('POST /campaigns creates a campaign and kicks off processing', async () => {
    mockCreateCampaign.mockResolvedValue({ id: 1, businessType: 'gyms', country: 'United States', status: 'running', createdAt: new Date() })

    const app = createApp()
    const response = await fetch('http://localhost:0') // placeholder, replaced below by supertest-free approach
  })
})
```

**Note:** rather than introduce `supertest` as a new dependency for one test file,
this task tests the route handlers directly as plain functions. Rewrite the test
file as follows instead:

```typescript
// tests/server/app.test.ts (replacing the draft above)
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreateCampaign = vi.fn()
const mockStopCampaign = vi.fn()
const mockProcessCampaign = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/campaign/queue.js', () => ({
  createCampaign: mockCreateCampaign,
  stopCampaign: mockStopCampaign,
}))
vi.mock('../../src/campaign/worker.js', () => ({ processCampaign: mockProcessCampaign }))

import { handleStartCampaign, handleStopCampaign } from '../../src/server/routes.js'

function mockReqRes(body: unknown, params: Record<string, string> = {}) {
  const req = { body, params } as any
  const json = vi.fn()
  const status = vi.fn().mockReturnValue({ json })
  const res = { json, status } as any
  return { req, res, json, status }
}

describe('dashboard route handlers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('handleStartCampaign creates a campaign and starts the worker without awaiting it', async () => {
    mockCreateCampaign.mockResolvedValue({ id: 1, businessType: 'gyms', country: 'United States', status: 'running', createdAt: new Date() })

    const { req, res, json } = mockReqRes({ businessType: 'gyms', country: 'United States', states: ['Texas', 'Ohio'] })
    await handleStartCampaign(req, res)

    expect(mockCreateCampaign).toHaveBeenCalledWith('gyms', 'United States', ['Texas', 'Ohio'])
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('handleStopCampaign stops the campaign by id', async () => {
    const { req, res, json } = mockReqRes({}, { id: '5' })
    await handleStopCampaign(req, res)

    expect(mockStopCampaign).toHaveBeenCalledWith(5)
    expect(json).toHaveBeenCalledWith({ stopped: true })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/server/app.test.ts`
Expected: FAIL — `src/server/routes.ts` doesn't exist yet.

- [ ] **Step 3: Implement `src/server/routes.ts`**

```typescript
// src/server/routes.ts
import type { Request, Response } from 'express'
import { createCampaign, stopCampaign } from '../campaign/queue.js'
import { processCampaign } from '../campaign/worker.js'

export async function handleStartCampaign(req: Request, res: Response): Promise<void> {
  const { businessType, country, states } = req.body as {
    businessType: string
    country: string
    states: string[]
  }

  const campaign = await createCampaign(businessType, country, states)

  // Fire-and-forget: the worker runs in the background, the HTTP response
  // doesn't wait for the whole campaign to finish.
  void processCampaign(campaign.id, businessType, country)

  res.json(campaign)
}

export async function handleStopCampaign(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id)
  await stopCampaign(id)
  res.json({ stopped: true })
}
```

- [ ] **Step 4: Implement `src/server/app.ts`**

```typescript
// src/server/app.ts
import express from 'express'
import 'dotenv/config'
import { handleStartCampaign, handleStopCampaign } from './routes.js'

export function createApp() {
  const app = express()
  app.use(express.json())
  app.use(express.static('public'))

  app.post('/campaigns', handleStartCampaign)
  app.post('/campaigns/:id/stop', handleStopCampaign)

  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { resetStaleInProgressStates } = await import('../campaign/queue.js')
  await resetStaleInProgressStates()

  const app = createApp()
  const port = Number(process.env.PORT ?? 3000)
  app.listen(port, () => console.log(`Lead-gen dashboard listening on port ${port}`))
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/server/app.test.ts`
Expected: PASS, both tests.

- [ ] **Step 6: Delete the placeholder draft test content, keeping only the working file**

Ensure `tests/server/app.test.ts` contains only the working version from Step 1's
second code block (the `handleStartCampaign`/`handleStopCampaign` tests) — remove
the earlier non-functional `fetch('http://localhost:0')` draft entirely.

- [ ] **Step 7: Commit**

```bash
git add src/server tests/server
git commit -m "Add dashboard API: start/stop campaign routes"
```

---

## Task 11: Dashboard Frontend

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`

- [ ] **Step 1: Create the dashboard HTML**

```html
<!-- public/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Lead Gen Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; }
    label { display: block; margin-top: 16px; font-weight: 600; }
    input, textarea { width: 100%; padding: 8px; margin-top: 4px; box-sizing: border-box; }
    button { margin-top: 20px; padding: 10px 20px; font-size: 16px; cursor: pointer; }
    #status { margin-top: 24px; padding: 16px; background: #f4f4f4; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Lead Gen Campaign</h1>

  <label for="businessType">Business type</label>
  <input id="businessType" value="gyms" />

  <label for="country">Country</label>
  <input id="country" placeholder="United States" />

  <label for="states">States (comma-separated)</label>
  <textarea id="states" rows="3" placeholder="Texas, Ohio, California"></textarea>

  <button id="startBtn">Start Campaign</button>
  <button id="stopBtn" disabled>Stop Campaign</button>

  <div id="status">No campaign running.</div>

  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the dashboard client script**

```javascript
// public/app.js
let currentCampaignId = null

document.getElementById('startBtn').addEventListener('click', async () => {
  const businessType = document.getElementById('businessType').value
  const country = document.getElementById('country').value
  const states = document.getElementById('states').value.split(',').map((s) => s.trim()).filter(Boolean)

  const response = await fetch('/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessType, country, states }),
  })
  const campaign = await response.json()
  currentCampaignId = campaign.id

  document.getElementById('startBtn').disabled = true
  document.getElementById('stopBtn').disabled = false
  document.getElementById('status').textContent = `Campaign #${campaign.id} running: ${states.join(', ')}`
})

document.getElementById('stopBtn').addEventListener('click', async () => {
  if (!currentCampaignId) return
  await fetch(`/campaigns/${currentCampaignId}/stop`, { method: 'POST' })
  document.getElementById('status').textContent = `Campaign #${currentCampaignId} stopped.`
  document.getElementById('startBtn').disabled = false
  document.getElementById('stopBtn').disabled = true
})
```

- [ ] **Step 3: Manually verify in a browser**

Run: `npm run dev`, open `http://localhost:3000`, fill the form, click Start, confirm
the status text updates and a campaign row appears in Postgres
(`SELECT * FROM campaigns;`).

- [ ] **Step 4: Commit**

```bash
git add public
git commit -m "Add dashboard frontend: campaign form, start/stop buttons"
```

---

## Task 12: Docker Packaging and VPS Deployment

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `docs/DEPLOY.md`

- [ ] **Step 1: Create the Dockerfile**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache npm
RUN npm install -g opencode-ai
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
EXPOSE 3000
CMD ["node", "dist/server/app.js"]
```

- [ ] **Step 2: Create the docker-compose.yml for VPS deployment**

```yaml
services:
  leadgen:
    build: .
    container_name: leadgen
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@postgres:5432/leadgen
      GOOGLE_SERVICE_ACCOUNT_JSON_PATH: /app/service-account.json
      GOOGLE_SHEET_ID: ${GOOGLE_SHEET_ID}
      OPENCODE_AGENT_NAME: leadgen-reviewer
      REVIEW_BATCH_SIZE: 500
      DASHBOARD_BASIC_AUTH_USER: ${DASHBOARD_BASIC_AUTH_USER}
      DASHBOARD_BASIC_AUTH_PASSWORD: ${DASHBOARD_BASIC_AUTH_PASSWORD}
    volumes:
      - ./service-account.json:/app/service-account.json:ro
      - ~/.config/opencode:/root/.config/opencode:ro
    expose:
      - 3000
    networks:
      - proxy

networks:
  proxy:
    external: true
```

**Note:** this connects to the VPS's existing shared Postgres container (see memory:
`oracle-vps-state` — Postgres is already running there, currently unused) rather than
spinning up a second Postgres instance. Run the migration once after deploy with
`docker exec leadgen node dist/db/migrate.js`.

- [ ] **Step 3: Write the deployment doc**

```markdown
<!-- docs/DEPLOY.md -->
# Deploying to the VPS

1. On the VPS, clone this repo into `/opt/apps/leadgen` (matching the existing
   `/opt/apps/<name>/` convention used by the other services).
2. Copy `service-account.json` (the Google Cloud service account key) into
   `/opt/apps/leadgen/` — do not commit this file.
3. Create `/opt/apps/leadgen/.env` with real values for `POSTGRES_PASSWORD` (matching
   the existing shared Postgres container's password), `GOOGLE_SHEET_ID`,
   `DASHBOARD_BASIC_AUTH_USER`, and `DASHBOARD_BASIC_AUTH_PASSWORD`.
4. Add a new block to `/opt/caddy/Caddyfile` (following the same pattern as the
   `9router`/`portainer`/`monitor` blocks):

   ```
   leads.shubhbuilds.com {
       basic_auth {
           shubh <bcrypt-hash>
       }
       reverse_proxy leadgen:3000
       encode gzip zstd
   }
   ```

   Generate the hash with `docker exec caddy caddy hash-password --plaintext <password>`,
   then `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.
5. `docker compose up -d --build` from `/opt/apps/leadgen`.
6. Run the migration once: `docker exec leadgen node dist/db/migrate.js`.
7. Visit `https://leads.shubhbuilds.com`, confirm the dashboard loads behind the
   basic-auth prompt.
```

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml docs/DEPLOY.md
git commit -m "Add Docker packaging and VPS deployment docs"
```

---

## Plan Self-Review Notes

- **Spec coverage:** campaign model (Task 3, 9), per-state pipeline search/filter
  (Task 4), plain-code normalize (Task 5), dedup (Task 6), Pending Review staging +
  Master promotion (Task 7, 9), periodic MiMo batch review + partial-batch flush at
  queue exhaustion (Task 8, 9), dashboard trigger + Stop button (Task 10, 11),
  Postgres-backed resilience (Task 2, 3), VPS deployment matching existing
  `/opt/apps/` convention (Task 12) — all covered.
- **Not yet covered, deliberately deferred (matches spec's "Open implementation
  details," Phase 2):** the secondary free search-API enrichment layer for
  Facebook/Instagram-sourced contact info. Task 4's Overpass module already extracts
  `contact:email`/`contact:facebook`/`contact:instagram` tags when OSM has them
  directly — v1 ships on that alone. Adding the secondary search-API lookup is a
  follow-up plan once a genuinely free, no-billing-account-required provider is
  confirmed.
- **Resume-after-restart:** covered by Task 3's `resetStaleInProgressStates` (resets
  any state left `in_progress` by a crash back to `pending`) called at server startup
  in Task 10 — found this gap during self-review and fixed it inline rather than
  shipping it as a known hole, per spec success criterion #6.
