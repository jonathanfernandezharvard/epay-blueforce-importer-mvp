# EPAY Blueforce Importer MVP (TypeScript/Node.js)

> Server-rendered Express app that lets authenticated users add “jobs” to an employee by generating a CSV and automating an **Imports From Web** upload in **EPAY Blueforce** using **Playwright for Node**.

## Features
- Microsoft Entra ID (Azure AD) SSO via OpenID Connect (`openid-client` + `express-session`)
- SQLite + Prisma persistence with migrations
- In‑process queue + background worker with periodic sweep
- Playwright importer with storage state reuse and auto re‑login
- Strong input validation (`zod`), idempotency, per-user rate limit, CSRF protection (`csurf`)
- Structured logging via `pino` (JSON to stdout)
- Dockerized on the official Playwright image
- Minimal EJS views (Pico.css via CDN), static read‑only screenshots

## Quickstart (Local Dev)
1. **Clone & install**
   ```bash
   npm i
   npx prisma generate
   npx prisma migrate dev --name init
   npm run dev
   ```

2. **Create `.env`** (see `.env.example`). Minimum required:
   ```ini
   NODE_ENV=development
   PORT=8080
   BASE_URL=http://localhost:8080
   SESSION_SECRET=replace_with_random
   AZURE_TENANT_ID=...
   AZURE_CLIENT_ID=...
   AZURE_CLIENT_SECRET=...
   IMPORT_FILE_DIR=./data/imports
   STORAGE_STATE_PATH=./data/state/storageState.json
   SCREENSHOTS_DIR=./data/screenshots
   ```

3. **Run**
   - Visit `http://localhost:8080/` → you will be redirected to Microsoft login.
   - In tests/dev you can bypass SSO by setting `TEST_BYPASS_AUTH=true`.

## Endpoints
- `GET /` – Form (auth required)
- `POST /submit` – CSRF protected; returns `{ batchId }`
- `GET /batches/:id` – HTML details page with polling
- `GET /api/batches/:id` – JSON for polling
- `GET /batches/:id/csv` – Streams original CSV
- `POST /admin/epay/setup` – CSRF protected; initializes/refreshed Playwright storage state
- `GET /health` – Public

## CSV Format (exact)
Header line is **exactly**:
```
Payroll ID,SITECODE
```
Then one row per job number. UTF‑8 **without BOM**; filename:
`SiteEmployeeDefaults_{UTC:yyyyMMdd_HHmmssSSS}_{sanitizedPayrollId}.csv`

## Authentication & Authorization
- OIDC Code Flow via `openid-client`; issuer is `https://login.microsoftonline.com/${AZURE_TENANT_ID}/v2.0`.
- Sessions via `express-session`; cookies are secure/HTTP‑only in production.
- If `ALLOWED_GROUP_OBJECT_ID` is set, the `groups` claim must include it (403 otherwise).
- For integration tests or local dev, you can bypass auth with `TEST_BYPASS_AUTH=true`.

## Background Worker
- Simple in-process queue; batches are enqueued on submission.
- Worker marks `Batch.Running`, invokes importer, then updates statuses to `Done/Imported` or `Error`.
- A sweep runs every 30s to re-enqueue `Queued` batches.

## EPAY Blueforce Import (Playwright)
- Reuses Playwright `storageState` to avoid repeated logins.
- Automatically re-logs in if session appears expired and persists the new state.
- Navigation path (best effort):
  - **DECCONFIG** → **Imports** → **Imports From Web**
  - Select template `Site Employee Defaults` in `--Select An Import--`
  - Upload the generated CSV via `input[type=file]` (fallback to `filechooser`)
  - Click **Upload** once; wait for `/import completed|uploaded|success/i`
- On any exception, a full-page screenshot is saved under `SCREENSHOTS_DIR` and paths are logged.

## Security Notes
- Secrets are read only from environment variables or `.env`. No secrets are hardcoded.
- CSRF protection is enabled for form posts.
- Per-user rate limit (1 submission / 10 seconds) keyed by UPN.
- Helmet is enabled with a permissive CSP (adjust per your org).

## Docker
Build and run:
```bash
docker build -t epay-importer .
docker run --rm -p 8080:8080 \
  -e NODE_ENV=production \  -e BASE_URL=http://localhost:8080 \  -e SESSION_SECRET=$(openssl rand -hex 32) \  -e AZURE_TENANT_ID=... -e AZURE_CLIENT_ID=... -e AZURE_CLIENT_SECRET=... \  -e EPAY_CORP_ID=... -e EPAY_LOGIN_ID=... -e EPAY_PASSWORD=... \  -v $PWD/data/imports:/data/imports \  -v $PWD/data/screenshots:/data/screenshots \  -v $PWD/data/state:/data/state \  epay-importer
```
Volumes:
- `/data/imports` – CSV files
- `/data/screenshots` – error screenshots
- `/data/state` – Playwright storage state

> The container runs as the non-root `pwuser` user.

## Testing
- Unit: `npm test` (Vitest). Includes CSV builder tests (header, UTF‑8 no BOM, row count).
- Integration: posts `/submit` using a fake auth session with CSRF token extraction.
- Optional Playwright smoke: set `RUN_EPAY_SMOKE=true` with real credentials to exercise the login/import path.

## Troubleshooting
- If you see 403 after login, ensure the `groups` claim includes `ALLOWED_GROUP_OBJECT_ID` or unset it.
- When selectors change in EPAY UI, update the robust role/text fallbacks in `src/services/epayImporter.ts`.
- If CSV header doesn’t match exactly, fix the constants in `csvBuilder.ts`. The test will catch it.

## Project Structure
```
src/
  server.ts
  auth/
    oidc.ts
  routes/
    index.ts
    submit.ts
    batches.ts
    admin.ts
  services/
    csvBuilder.ts
    epayImporter.ts
    queue.ts
    worker.ts
    idempotency.ts
    rateLimiter.ts
    logger.ts
  views/
    index.ejs
    batch-details.ejs
  public/js/
    batchPoller.js
prisma/
  schema.prisma
  migrations/0001_init/migration.sql
tests/
  csvBuilder.test.ts
  submission.int.test.ts
  playwright.smoke.test.ts (optional)
```
