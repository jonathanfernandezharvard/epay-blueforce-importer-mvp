<!-- .github/copilot-instructions.md - Guidance for AI coding agents -->

This repo is an Express + TypeScript MVP that queues CSV imports and automates an "Imports From Web" upload to EPAY Blueforce using Playwright. Use the snippets and file references below to make targeted, low-risk changes.

Keep suggestions concise and specific to this codebase. Prefer changes in TypeScript under `src/` and avoid altering Playwright flows unless necessary (see `src/services/epayImporter.ts`).

- Big picture
  - Server-rendered Express app: entry `src/server.ts` (OIDC setup, static assets, routes, worker startup).
  - Routes: `src/routes/*` — `index.ts` (UI), `submit.ts` (form submission, validation, idempotency), `batches.ts` (polling/json) and `admin.ts` (Playwright setup endpoint).
  - Services: `src/services/*` — `csvBuilder.ts` (CSV format is exact; header must be `Payroll ID,SITECODE`), `epayImporter.ts` (Playwright automation), `queue.ts`/`worker.ts` (in-process queue and background worker), `idempotency.ts`, `rateLimiter.ts`, `logger.ts`.
  - Persistence: Prisma + SQLite. Schema at `prisma/schema.prisma` and migrations at `prisma/migrations/`.

- Project-specific conventions and gotchas
  - Strict CSV header and filename format enforced by `csvBuilder.ts` and covered by `tests/csvBuilder.test.ts`. Don't change the header string unless updating tests.
  - Idempotency: computed hash in `src/services/idempotency.ts` and checked in `src/routes/submit.ts` with a 15-minute window — preserve this behavior when modifying submit logic.
  - Rate limiting: `PerUserTTLRateLimiter` (default 10s) keyed by UPN; used in `submit.ts`. Keep user-keyed rate limits when altering submission flow.
  - Auth: OIDC via `src/auth/oidc.ts`. For local dev/tests, `TEST_BYPASS_AUTH=true` bypasses SSO (documented in `README.md`).
  - Playwright storage state: `STORAGE_STATE_PATH` and `SCREENSHOTS_DIR` env vars are used by `epayImporter.ts` to reuse sessions and store screenshots on failures.

- Developer workflows (commands)
  - Install & dev: `npm i && npx prisma generate && npx prisma migrate dev --name init && npm run dev` (see `README.md`).
  - Build: `npm run build` (tsc). Start production: `npm start` (runs `dist/server.js`).
  - Tests: `npm test` (Vitest). Playwright smoke test is optional: set `RUN_EPAY_SMOKE=true` and real credentials; install browser with `npm run playwright:install`.
  - Docker: see `Dockerfile` and `README.md` docker run example (volumes for `/data/imports`, `/data/screenshots`, `/data/state`).

- Integration points & environment
  - Azure OIDC: env vars AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET; `ALLOWED_GROUP_OBJECT_ID` optionally restricts access.
  - EPAY credentials: EPAY_CORP_ID, EPAY_LOGIN_ID, EPAY_PASSWORD. EPAY navigation is brittle; `epayImporter.ts` uses multiple role/text fallbacks — update tests or add robust fallbacks if selectors change.

- When editing code, follow these concrete rules
  - Tests first: small unit tests live in `tests/`. When you change CSV behavior or validation, update/add tests and run `npm test` locally.
  - Minimize Playwright changes: only modify `epayImporter.ts` when reproducing a real UI change; prefer adding more resilient fallbacks instead of hard-coded selectors.
  - Keep logging structured via `src/services/logger.ts` (pino). New logs should be JSON-friendly objects (not raw strings) to integrate with existing log lines.
  - Preserve environment-driven behavior: many behaviors depend on env vars (see `src/server.ts` and `epayImporter.ts`). Prefer adding new env vars with sensible defaults.

- Useful file examples to reference in PRs
  - CSV builder: `src/services/csvBuilder.ts` (header, filename, UTF-8 without BOM)
  - Submit flow: `src/routes/submit.ts` (validation with zod, idempotency, rate limiting, db writes, enqueue)
  - Playwright import: `src/services/epayImporter.ts` (login heuristics, retries, screenshot on error)
  - Worker & queue: `src/services/queue.ts`, `src/services/worker.ts` (how batches are dequeued and processed)
  - Auth wiring: `src/auth/oidc.ts` and its use in `src/server.ts` and routes (requireAuth(), currentUpn())

- Quick checks for PR reviewers (what to watch for)
  - Did you preserve the exact CSV header and filename format? (check `csvBuilder.ts` and tests)
  - Are idempotency and rate-limiter behavior unchanged for submit flow? (check `submit.ts` + `idempotency.ts`)
  - For Playwright changes: do screenshots still get saved on failures and paths logged? (check `epayImporter.ts`)
  - Are new environment variables documented in `README.md` and given defaults in code where appropriate?

If anything is unclear or you need access to test creds or environment values to reproduce EPAY behavior, ask the repository owner. Reply with any missing specifics and I'll iterate on these instructions.
