# Deploy the existing SemiTraX API to Render

This prepares the existing Express/TypeScript/Prisma service in apps/api. It does not deploy a replacement API, enable billing, or change mobile/navigation code. Service name: semitrax-api. PostgreSQL resource: semitrax-db.

## Before using the dashboard

The local checkout contains important pre-existing uncommitted and untracked work. Render can only build a revision present in the connected Git repository. Use the reviewed backend-only branch codex/prepare-semitrax-api-render. Review its complete apps/api source, all eight migrations, and render.yaml before selecting the deployment revision. Do not deploy the old main branch assuming it includes this work. Do not publish .env files or credentials.

The Blueprint declares paid resources: API 0.5 CPU/512 MB, PostgreSQL 0.1 CPU/256 MB, Oregon region, PostgreSQL 16. These are initial deployment settings, not a capacity guarantee. Review the dashboard's actual price and capacity before applying; no billing action has been performed. Keep both resources in the same region. The paid API plan supports a pre-deploy command. Automatic code deploys are disabled; Blueprint application itself still provisions/deploys resources when you approve it.

## Runtime and commands

- Root directory: apps/api (not the repository root package.json or a legacy server scaffold).
- Node: 24.16.0 via NODE_VERSION, matching the tested local executable. No dependency or Node upgrade was performed.
- Install/build: npm ci --include=dev && npm run prisma:generate && npm run build
- Pre-deploy: npm run prisma:deploy (prisma migrate deploy)
- Start: npm start (node dist/server.js)
- Health check: /health
- PORT: use the value Render supplies; the existing server listens on all interfaces. The local fallback remains 4000.

The include=dev flag is intentional: TypeScript and the pinned Prisma CLI are development dependencies needed to build and run pre-deploy migrations. Prisma client generation must occur on Render's Linux build instance; never upload Windows node_modules or dist as the deployment source. The lockfile and dependency versions remain unchanged. tsconfig builds src/server.ts and its dependency graph; older unconnected server/storage/Stripe scaffolds are not alternative deployment entry points.

## Configuration

Public/non-secret settings:

| Variable | Setting |
| --- | --- |
| NODE_VERSION | 24.16.0 |
| NODE_ENV | production (required on Render) |
| ACCESS_TOKEN_MINUTES | 15 |
| REFRESH_TOKEN_DAYS | 30 |
| PUBLIC_API_URL | Exact intended HTTPS API origin, no trailing slash/path/query |
| CORS_ORIGINS | Comma-separated exact approved HTTPS browser origins, no wildcard or trailing slash |
| BILLING_MODE | disabled |
| ROUTING_PROVIDER | trimble |
| ROUTING_COMPARE_ENABLED | false |

Secret settings:

- DATABASE_URL: the Blueprint uses fromDatabase.connectionString to obtain the internal connection string for semitrax-db. Never copy it into source or logs. For manually created resources, set the API variable to that database's Internal Database URL. Use a direct connection for migrations, not a transaction-pooler URL.
- JWT_SECRET: generateValue generates a random secret in Render. The application rejects missing, short, whitespace-padded, and known example values. Preserve the secret across redeployments; rotation invalidates existing access tokens.
- TRIMBLE_API_KEY: supply the approved server-side credential privately when the Blueprint prompts. Do not paste it into Git or chat. Missing routing provisioning must remain fail-closed; a healthy database is not proof of licensed truck-routing functionality.
- Other existing feature credentials (ELD, HERE services, Mapbox server-side traffic, billing, storage) remain optional/feature-specific and unmodified. Do not enable unprovisioned integrations or substitute credentials. CoPilot device credentials are not backend JWT secrets.

Access tokens retain the existing JWT implementation. Refresh tokens are random opaque values; only hashes and expiry/revocation state are stored in PostgreSQL. No separate refresh JWT signing secret is used. Production startup validates required settings before listening. Database connectivity is checked by /health; the process may listen while the database is unavailable, but Render must not route it as healthy.

CORS is a browser origin allowlist, not API authentication. Native Android requests normally have no Origin header and continue through the existing authentication rules. The existing server allows requests without Origin; unapproved browser origins receive no CORS allow header. Do not add wildcard CORS to fix mobile connectivity.

## Migration review

All eight existing SQL files were reviewed and left byte-for-byte unchanged:

| Migration | Effect and review notes |
| --- | --- |
| 20260820000000_production_core | Creates 14 core tables, seven enums, indexes and foreign keys; assumes a new empty schema or a correctly baselined database. |
| 20260821000000_safety_live_data | Adds 10 safety/provider tables, 10 enums and user trust-score data; existing rows get the declared trust-score default. |
| 20260822000000_admin_rbac_audit | Adds administrator audit table and restrictive actor foreign key. |
| 20260823000000_admin_analytics | Adds six analytics/payment/support tables and nullable user/trip/subscription fields. |
| 20260824000000_subscription_plan_catalog | Adds the catalog and seeds its initial rows; preserves existing codes with ON CONFLICT DO NOTHING. |
| 20260831000000_subscription_foundation | Adds six subscription-status enum values, eight tables, constraints and indexes. Replaces the global subscription-ID unique index with a provider-scoped unique index. Seeds pilot/catalog entries and intentionally updates monthly/annual catalog values and versions. These data changes require review for an existing database. |
| 20260831010000_subscription_entitlement_backfill | Inserts entitlement sources for recognized legacy subscription providers only, with conflict handling. Unknown provider labels are intentionally skipped for manual review. No subscription rows are deleted. |
| 20260901000000_approved_billing_policies | Adds four fleet/refund tables, enums, constraints, indexes and nullable subscription fields. Does not activate billing or call providers. |

The 44 Prisma models all have corresponding CREATE TABLE statements. This static check is not a substitute for applying the migrations and comparing the resulting schema on a disposable staging database. The added migration_lock.toml records the existing PostgreSQL provider; no historical SQL was edited.

prisma migrate deploy is appropriate for this ordered production migration history. It applies pending migrations without using the destructive development/reset workflow. Never run prisma migrate dev, migrate reset, or db push against production. Do not wrap the entire history in one hand-written transaction: the backfill deliberately follows the enum additions in a later migration. Existing databases require a backup, inspection of _prisma_migrations/history, and a reviewed baseline if created outside Prisma. Stop on a failed/mismatched migration; do not blindly mark it resolved or rerun hand-edited SQL. The index replacement and catalog updates deserve particular attention on an existing deployment.

No database was reset or migrated in this task. The production migration command is reserved for Render's pre-deploy phase after you select the correct database. Keep backups/restore procedures in place. A code rollback does not undo migrations.

## Render dashboard steps (Blueprint path; creates both resources)

1. Complete the repository review/publication prerequisite above. Sign in to the correct Render workspace and connect GitHub access to dukens11-create/semitrack.
2. Select New + > Blueprint. Select the repository and the reviewed branch that actually contains the prepared backend and root render.yaml. Use render.yaml as the Blueprint path.
3. Review the resource preview: exactly semitrax-api (Node web service) and semitrax-db (PostgreSQL), both Oregon. Review the paid plans before proceeding. Do not create a second database separately when using this Blueprint.
4. Supply the prompted PUBLIC_API_URL and CORS_ORIGINS. For the user's intended production deployment, PUBLIC_API_URL may declare https://api.semitrax.com as the intended backend origin; this is NOT a claim that DNS/TLS already work and must NOT be copied into Android. For a staging deployment, use only its actual assigned/approved HTTPS origin, never a guessed onrender hostname. For CORS, include only your approved browser client origins; https://www.semitrax.com is the existing website origin if that is the client you intend to authorize. Do not add an invented admin hostname. Supply the approved TRIMBLE_API_KEY privately. JWT_SECRET is generated and DATABASE_URL is wired automatically.
5. Apply/Create the Blueprint only after confirming the settings and costs. Wait for PostgreSQL to become available. In the database's access settings, confirm external access is disabled (ipAllowList is empty); the API uses the internal URL. Do not weaken TLS verification or publish database credentials.
6. Check the API Events/Logs: dependency install, Prisma generation, TypeScript build, and pre-deploy migration must succeed. If a migration fails, stop and inspect the failure; do not reset the database. The start command must run dist/server.js. Confirm Settings > Health Checks contains /health and auto-deploy is off.
7. Copy the API's actual assigned HTTPS onrender URL from the Render dashboard. Request its /health endpoint. Require HTTP 200 with status=ok and database=ok; a 503 is a blocker. This confirms basic readiness, not routing, billing, authentication end-to-end, or every schema/data invariant.
8. In semitrax-api > Settings > Custom Domains, add api.semitrax.com. In the authoritative DNS dashboard, configure the api CNAME using the exact target displayed by Render. Resolve conflicts only for that API record; leave unrelated website/email records alone. Return to Render and verify the domain; wait for the TLS certificate to be issued.
9. Verify https://api.semitrax.com/health using normal certificate verification. Require HTTP 200 with status=ok and database=ok. Ensure PUBLIC_API_URL matches that verified origin; save/redeploy the API if it was using a staging origin. Never use curl -k or another certificate bypass to count this check as passed.
10. Validate the migration history and database-backed features on a separate staging/test database. Run the two existing integration tests only with SUBSCRIPTION_TEST_DATABASE_URL pointing to that test database after applying its migrations. Do not point these tests at the production database.
11. Stop. Do not change SEMITRAX_API_URL, rebuild the APK, install on the phone, or start navigation until the deployed endpoint is verified and Android work is resumed explicitly.

If creating resources individually instead of using the Blueprint, choose New + > PostgreSQL with the same database settings first, then New + > Web Service with the same root/commands/runtime/health settings. Copy the Internal Database URL only into Render's DATABASE_URL secret field, generate a strong JWT_SECRET privately, and configure all public variables above. Do not combine both creation paths or let two Blueprints manage the same resources.

A safe public health check in Windows PowerShell, using the actual URL copied from Render:

```powershell
$apiOrigin = (Read-Host 'Paste the actual HTTPS API origin from Render').TrimEnd('/')
if (([uri]$apiOrigin).Scheme -ne 'https') { throw 'HTTPS is required' }
$health = Invoke-RestMethod -Uri ($apiOrigin + '/health') -TimeoutSec 15
if ($health.status -ne 'ok' -or $health.database -ne 'ok') { throw 'API is not ready' }
$health | Select-Object status,database
```

## Validation completed locally

- Baseline: 82 tests passed; two database integration tests skipped.
- Full original working tree: 87 passed, zero failed; two database integration tests skipped.
- Isolated publication contents: 82 passed, zero failed; two database integration tests skipped. Five tests belong to separate, uncommitted Trimble-provider work and are intentionally excluded along with that implementation.
- TypeScript --noEmit: passed.
- Production npm run build with NODE_ENV=production: passed.
- Prisma 5.22.0 validate and generate: passed. Validation used an inert non-production connection value solely to validate the schema; no real database was contacted.
- Startup smoke test: missing production JWT_SECRET exits before serving.
- Readiness smoke test with unavailable test database: /health returns 503 and generic database=unavailable, with no database credentials/errors disclosed.
- CORS smoke test: configured website origin allowed; unrelated origin receives no CORS allow header.
- Blueprint YAML parses without errors/warnings; commands, environment references, root directory, health path and database linkage checked locally against current Render documentation. Authenticated Render validation/provisioning and Linux build are still dashboard checks, not locally proven.
- Migration SQL checksums unchanged. No external Render deployment, DNS, billing, database creation, or Android action. Publication is limited to the backend deployment files and required environment-loader integration.

## Official references

- https://render.com/docs/blueprint-spec
- https://render.com/docs/node-version
- https://render.com/docs/deploys
- https://render.com/docs/health-checks
- https://render.com/docs/postgresql-creating-connecting
- https://render.com/docs/custom-domains
- https://docs.prisma.io/docs/cli/migrate
