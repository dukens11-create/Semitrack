# SemiTraX release and database recovery runbook

Status: preparation only. No recovery, export, resource creation, connection change, migration, deployment or credential rotation has been performed.

## Establish the release baseline
Record the deployed API commit, currently installed mobile APK hash, Prisma migration names/checksums and database instance identity. Keep credentials in the provider dashboard or approved secret store, never in this document or logs. Confirm the Render service is using the intended existing database; do not assume the former Neon database was migrated.

## Before a schema rollout
Run the complete migration chain and concurrency tests against a disposable database. Review backwards compatibility for older installed clients. The proposed profile revision and access-session changes require a coordinated rollout; do not activate the new mobile contract against an older API.

In the Render dashboard, inspect semitrax-db → Recovery. Verify the actual plan's recovery availability and retention, last backup time, and authorized operators. Paid Render Postgres supports point-in-time recovery; free compute does not. Recovery creates a separate instance that can be validated before a service cutover. See [Render recovery documentation](https://render.com/docs/postgresql-backups).

Define and approve recovery-point and recovery-time objectives. A successful backup export is not a restore test. Request explicit approval before creating a recovery database, downloading private data or changing any service connection.

## Restore drill
Use an approved isolated recovery target. Validate migrations, aggregate row counts, referential integrity and representative authorization tests without printing user records. Keep outgoing mail, billing and vendor writes disabled. Record elapsed recovery time and reconciliation findings. Do not run destructive restore commands against the existing production database.

## Incident handling
Preserve sanitized request IDs and provider status codes. Determine whether failure is API code, migration, database availability or external entitlement. Do not roll back a binary blindly across a breaking schema/client contract. Prefer a reviewed forward repair for additive migrations; assess old-server compatibility before any application rollback. Never use prisma migrate reset or development migration commands on production.

## Release acceptance
Require real authenticated truck routing and Mapbox route display, complete APK ELF/ZIP alignment validation, a production-like R8 build, reviewed release signing, and operational monitoring. Test the final package on a 16 KB environment; static checks alone are insufficient. See [Android page-size guidance](https://developer.android.com/guide/practices/page-sizes).

Keep CoPilot gated until mobile entitlement, maps, required truck restrictions, native readiness and actual device events are verified. No backup or deployment step establishes CoPilot readiness.
