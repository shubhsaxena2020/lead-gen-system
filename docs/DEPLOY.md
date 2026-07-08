# Deploying to the VPS

1. On the VPS, clone this repo into `/opt/apps/leadgen` (matching the existing
   `/opt/apps/<name>/` convention used by the other services).
2. Copy `service-account.json` (the Google Cloud service account key) into
   `/opt/apps/leadgen/` — do not commit this file.
3. Create `/opt/apps/leadgen/.env` with real values for `LEADGEN_DB_PASSWORD` (the
   password for the dedicated `leadgen` Postgres role/database, provisioned separately
   from the shared superuser — see the DB provisioning note below), `GOOGLE_SHEET_ID`,
   `DASHBOARD_BASIC_AUTH_USER`, and `DASHBOARD_BASIC_AUTH_PASSWORD`.

   **DB provisioning (one-time, before first deploy):** create an isolated role and
   database on the existing shared Postgres container rather than reusing its
   superuser credentials:
   ```bash
   docker exec -u postgres postgres psql \
     -c "CREATE ROLE leadgen WITH LOGIN PASSWORD '<generated password>';" \
     -c "CREATE DATABASE leadgen OWNER leadgen;"
   ```
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
