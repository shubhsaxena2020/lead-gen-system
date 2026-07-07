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
