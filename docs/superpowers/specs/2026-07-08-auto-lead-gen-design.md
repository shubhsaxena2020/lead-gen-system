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
  fallback in VS Code and has usage limits.
- **MiMo/OpenCode ToS note (accepted risk).** The user's MiMo token plan is
  "interactive agent-tool use only, NOT unattended automation" (see memory:
  `brain-hands-pipeline`) — this is a term of the token plan itself, not specific to
  any one project that uses it. This system calls MiMo automatically, unattended,
  in periodic batches (see "AI review batching" below), which does fall under that
  same restriction. The user was presented this tradeoff explicitly on 2026-07-08 and
  chose to accept the risk (same category of decision as the Gemini/9router ToS
  risk) rather than restrict MiMo calls to only when they're actively present. Not an
  open question — don't re-raise unless usage patterns change dramatically.
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
4. **Normalize (plain code, no AI):** Clean/format the raw OSM fields + enrichment
   snippet into a consistent row shape: business name, address, phone, email (or
   "not found"), social link (or "not found"). This is ordinary field-mapping and
   text cleanup — it doesn't need an AI model, and keeping it as plain code means the
   unattended collection loop has no AI calls in it at all.
5. **Deduplicate:** Before staging, check the row's business name + address against
   what's already in the Google Sheet (across all past campaigns, not just this
   one) — skip if already present.
6. **Stage:** Append the finished row to the **"Pending Review"** sheet tab
   immediately (via the Sheets API) — this is what makes leads visible while a
   multi-hour run is still in progress, without waiting for AI review.
7. **Pace:** Space out requests to stay within Overpass's and the search API's
   fair-use/rate limits. This naturally makes a full state take real time — which
   fits the user's stated use case (start it before sleeping, stop it whenever
   there's enough for that batch) rather than being a problem to route around.

### AI review batching (MiMo, periodic — not per-lead)

Rather than calling MiMo per business (expensive and doesn't need per-item
reasoning) or not at all (loses a useful quality check), MiMo is called in batches:

- Every time 500 rows have accumulated in "Pending Review" since the last review
  batch, the worker automatically sends that batch of 500 to MiMo (via OpenCode) in
  one call, asking it to flag likely errors (garbled fields, obvious duplicates the
  name/address dedup missed, mismatched contact info) — not to redo the normalization,
  just to review it.
- Rows MiMo doesn't flag move from "Pending Review" to the **"Master"** sheet tab
  (the one the user actually works leads from). Flagged rows stay in "Pending
  Review" with a note, for the user to eyeball themselves.
- **Partial-batch flush:** if the campaign is stopped (or the state queue empties)
  before reaching 500 pending rows, that partial batch is still sent through one
  final review call rather than left stranded in "Pending Review" indefinitely.
- This bounds MiMo token usage to roughly one batch call per 500 leads, regardless
  of how many hours the campaign runs — addressing the user's stated concern about
  not wanting a large token allocation exhausted in a single overnight run.

### Data storage

- **Postgres** (already running on the VPS): campaign metadata, state queue and
  status, and a lightweight record of leads already written (for cross-campaign
  deduplication) — this is the source of truth for "is this campaign still running,
  what's left to do."
- **Google Sheets**: the user-facing output, two tabs in one spreadsheet (not
  fragmented per campaign/run):
  - **Pending Review** — rows land here immediately as found, before AI review.
  - **Master** — rows MiMo's batch review didn't flag; this is what the user
    actually works leads from.
  Both tabs share columns: Business Name, Country, State, City, Phone, Email, Social
  Link, Website Status (always "none" — that's the filter condition), Date Found.
  Auth via a Google Cloud service account (free to create, Sheets API itself has no
  billing requirement).

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
8. Confirm rows land in "Pending Review" immediately, and move to "Master" only
   after a batch review call (test with a small batch threshold, not the real 500,
   to make this practical to verify).
9. Stop a campaign with a partial batch (fewer than the threshold) pending, and
   confirm that partial batch still gets flushed through one final review call
   rather than staying stuck in "Pending Review."

## Open implementation details (for the planning phase, not blocking this spec)

- Exact free search-engine API to use for the enrichment layer.
- Exact OSM tag set to query for "gyms and fitness businesses" (may need more than
  one tag to get good coverage — `leisure=fitness_centre`, `sport=fitness`, etc.).
- Where the dashboard + worker are deployed on the VPS (own Docker container(s),
  following the existing `/opt/apps/<name>/docker-compose.yml` + git-tracked
  convention already used for the VPS's other services).
- Exact mechanics of invoking MiMo via OpenCode for the batch-review step — this is
  a new, standalone invocation for this project, not a reuse of the FBC-specific
  `fbc-builder` agent config from `brain-hands-pipeline` (that agent is scoped to
  the fbc-arena project only).
