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
