# Auto Lead-Gen System — Design Spec

Date: 2026-07-08
Status: Approved by user, pending implementation plan

## Purpose

An automated lead-finding system, running 24/7 on the user's Oracle VPS, that finds
local businesses (starting with independent gyms — see business context below) with
**no website**, enriches them with contact info where possible, and writes results
directly to a Google Sheet — so the user can build large cold-email/cold-call lead
lists without manual searching.

## Business context (why this exists)

The user runs an international web-dev agency targeting independent gyms and similar
fitness businesses (CrossFit, boxing, powerlifting, martial arts, yoga/pilates,
personal trainers with locations — avoiding large franchises). Sales motion is
website-first, then upsell a Gym Management SaaS. Target markets, in priority order:
US, Canada, UK, Australia, New Zealand, then Ireland, Singapore, UAE, Europe. There's
also a local/India-Kanpur segment the user cold-calls directly. See memory:
`user_business_context`.

The existing manual lead-gen process (documented in the same memory) sources from
Google Maps, public directories, LinkedIn company pages, and Chamber of Commerce
listings, explicitly avoiding ToS-violating scraping. This system automates that same
sourcing philosophy — it does not introduce new compliance risk, it removes manual
labor from a process the user already does by hand.

## Hard constraints

- **Zero budget.** No paid APIs, no service that could accidentally incur a charge
  (this rules out Google Places API, which requires a billing account on file even
  for "free tier" usage).
- **No ToS-violating scraping.** Google Maps must not be scraped directly (with or
  without an API key) — Google's terms prohibit automated extraction from Maps/Search
  regardless of the access method used. This constraint was explicitly discussed and
  confirmed with the user on 2026-07-08.
- **Gemini/9router is off-limits for this system.** The user's Gemini-via-9router
  bridge (see memory: `nine-router-resolved`) is reserved for their Claude Code
  fallback in VS Code and has usage limits. This system uses **MiMo** (via OpenCode,
  matching the existing pattern from the user's `brain-hands-pipeline` memory) for
  any AI-assisted normalization/extraction work, since it's free and doesn't need
  heavy reasoning for this task.
- Must run entirely on the Oracle VPS (see memory: `oracle-vps-state`) — 4 vCPU,
  24GB RAM, Ubuntu 24.04, already running Docker, Postgres, Caddy. No dependency on
  the user's laptop being on.

## Non-goals

- Not building a CRM — the user already has a CRM status flow (Not Contacted → ...)
  documented in `user_business_context`; this system only *populates* a Google Sheet
  of raw leads, it doesn't manage outreach state.
- Not attempting 100% email coverage. Free, compliant sources will not find an email
  for every website-less business — this is an accepted, inherent limitation, not a
  bug to engineer around. Phone-only leads are still valid output.
- Not scraping Facebook/Instagram in bulk. The enrichment layer uses a free
  search-engine API to find and read *public search result snippets* that reference
  a business's social presence — it does not log into or directly crawl
  facebook.com/instagram.com.

## Architecture

### Campaign model

The core unit of work is a **campaign**, not a single search:

1. User opens the dashboard (new page, e.g. `leads.shubhbuilds.com`, Caddy
   basic-auth protected like the VPS's other services) and configures:
   - Business type (default/first: gyms & fitness businesses; kept as a field, not
     hardcoded, so it can extend to other niches later)
   - Country
   - A list of states/regions within that country to cover
2. Clicking **Start** creates a campaign row in Postgres with a queue: one entry per
   state, status `pending`.
3. A background worker process continuously pulls the next `pending` state from the
   *active* campaign, marks it `in_progress`, fully processes it (see pipeline
   below), marks it `done`, and moves to the next — looping until the queue is empty
   or the campaign's status is flipped to `stopped`.
4. The dashboard's **Stop** button flips campaign status to `stopped`. The worker
   checks this flag between individual businesses (not just between states), so it
   halts within seconds rather than finishing an entire state first.
5. The dashboard polls campaign status (simple interval poll, no need for
   websockets) and shows: current state being processed, states completed/remaining,
   running lead count, and a link to the Google Sheet.

### Per-state pipeline

For each state pulled off the queue:

1. **Search:** Query OpenStreetMap's Overpass API for the configured business type
   (e.g. `leisure=fitness_centre` and related tags) within that state's boundary.
   Overpass is free, requires no API key or billing account, and its usage policy
   explicitly permits this kind of query.
2. **Filter:** Keep only results with no `website` tag and no `contact:website` tag.
   This is the "no website" signal — cheap and reliable directly from OSM data.
3. **Enrich:** For each website-less business, query a free-tier search-engine API
   (exact provider TBD in implementation — candidates: Bing Web Search API free
   tier, or an equivalent that doesn't require a billing account) with something
   like `"<business name>" <city> <state> facebook OR instagram`. Read whatever
   contact info (email, additional phone) appears in the public result
   title/snippet. This does not crawl Facebook/Instagram directly — it only reads
   what a search engine has already publicly indexed.
4. **Normalize:** Pass the raw OSM fields + enrichment snippet text to MiMo (via
   OpenCode) to extract/clean into a consistent row shape: business name, address,
   phone, email (or "not found"), social link (or "not found"), and a short
   confidence note if the match seems uncertain (e.g. multiple businesses with
   similar names in the search results).
5. **Deduplicate:** Before writing, check the row's business name + address against
   what's already in the Google Sheet (across all past campaigns, not just this
   one) — skip if already present.
6. **Write:** Append the finished row directly to the Google Sheet via the Sheets
   API (free, no billing account required, generous quota) — immediately, not
   batched at the end of the state or campaign. This is what makes leads visible
   while a multi-hour run is still in progress.
7. **Pace:** Space out requests to stay within Overpass's and the search API's
   fair-use/rate limits. This naturally makes a full state take real time — which
   fits the user's stated use case (start it before sleeping, stop it whenever
   there's enough for that batch) rather than being a problem to route around.

### Data storage

- **Postgres** (already running on the VPS): campaign metadata, state queue and
  status, and a lightweight record of leads already written (for cross-campaign
  deduplication) — this is the source of truth for "is this campaign still running,
  what's left to do."
- **Google Sheets**: the user-facing output. One running master sheet (not
  fragmented per campaign/run), columns: Business Name, Country, State, City, Phone,
  Email, Social Link, Website Status (always "none" — that's the filter condition),
  Date Found. Auth via a Google Cloud service account (free to create, Sheets API
  itself has no billing requirement).

### Resilience

- Campaign/queue state lives in Postgres, not worker memory. If the worker process
  or the VPS restarts mid-campaign, it resumes from the last incomplete state
  instead of starting the whole campaign over.
- Overpass or search-API errors/rate-limit responses trigger backoff-and-retry on
  that single business/query, not a crash of the whole campaign.

## Testing / success criteria

Before considering this done:
1. Run one small, well-known state end-to-end.
2. Spot-check a handful of found businesses manually — confirm they genuinely have
   no real website (not a false negative from a missing OSM tag).
3. Confirm at least some fraction of website-less businesses come back with a real
   email via the enrichment layer (not expected to be 100% — see Non-goals).
4. Confirm the Google Sheet updates progressively during the run, not just at the
   end.
5. Confirm the Stop button halts the worker within a few seconds.
6. Kill the worker process mid-campaign and confirm restarting it resumes from the
   correct state rather than restarting the campaign or losing progress.
7. Run the same state a second time and confirm no duplicate rows are added for
   businesses already in the sheet.

## Open implementation details (for the planning phase, not blocking this spec)

- Exact free search-engine API to use for the enrichment layer.
- Exact OSM tag set to query for "gyms and fitness businesses" (may need more than
  one tag to get good coverage — `leisure=fitness_centre`, `sport=fitness`, etc.).
- Where the dashboard + worker are deployed on the VPS (own Docker container(s),
  following the existing `/opt/apps/<name>/docker-compose.yml` + git-tracked
  convention already used for the VPS's other services).
- Exact mechanics of invoking MiMo via OpenCode for this task (reuse or adapt the
  pattern from the user's existing `brain-hands-pipeline`).
