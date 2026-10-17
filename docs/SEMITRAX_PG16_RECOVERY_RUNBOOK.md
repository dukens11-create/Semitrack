# SemiTraX PostgreSQL 16 recovery runbook

Scope: isolated local rehearsals. Production recovery requires separately approved credentials, outage plan, backup destination, target database and compatible application release. Never use destructive tests against production.

## Prerequisites and identity

- Use the reconciled backend candidate based on a57d5f3f2dfe1cef081e298e936952954d685e0d, including all reviewed uncommitted repairs.
- Use PostgreSQL 16 pg_dump/pg_restore/psql, and confirm both client and server versions. A PostgreSQL 17 rehearsal is not PG16 evidence.
- Record Git status, candidate file hashes and migration hashes. The current candidate has ten migrations; the prior checkpoint has nine.
- Use a new isolated cluster bound to 127.0.0.1 on a non-default port. Do not register a Windows service or alter PostgreSQL 17.
- Keep billing disabled and external provider configuration absent in the test API. Do not load a production environment file.

## Create a logical backup

1. Confirm the source database identity with SELECT current_database(), version(), inet_server_addr(), inet_server_port(). For rehearsals require loopback, a non-default port, and the exact disposable database name.
2. Ensure the backup directory is outside Git, within the approved local workspace.
3. Run PostgreSQL 16 pg_dump with explicit host/port/user/database, --format=custom --no-owner --no-acl --file <backup-file>. Use an interactive password prompt or secret injected into the child process environment; never put a password in a command line or report.
4. Require exit code 0. Record server/client versions, file size, SHA-256, source candidate identity and migration checksums. Verify pg_restore --list can read the archive.
5. A logical dump does not include cluster roles, Windows service settings, production secrets, other databases or external uploaded files. Inventory those separately before any real disaster recovery.

## Restore to a new database

1. Create a distinct empty PG16 database. Never overwrite the original database.
2. Run pg_restore against that explicit target with --exit-on-error --single-transaction --no-owner --no-acl <backup-file>. Do not use --clean against an existing production database.
3. Require exit code 0. Compare table row counts, fixture IDs, owner/truck/fleet relationships, verification revisions, ordered JSON stops and migration history.
4. Compare columns/defaults, all indexes and PostgreSQL constraints against the source catalog; check convalidated and invalid indexes. Do not rely solely on Prisma schema introspection, which does not model every custom CHECK constraint.
5. For a production restore, roles/ownership/grants require a separately reviewed least-privilege plan. The local no-owner/no-acl flags do not establish correct production grants.

## Point a test API to the restored database

- Launch a separate API process with only the restored loopback database URL and synthetic test JWT secret. Set NODE_ENV=test and BILLING_MODE=disabled, and use a separate non-default HTTP port.
- Test health, unauthenticated denial, fixture login/current user, truck list and matching verification revisions, trip/stops, documents, capabilities, and administrator audit access.
- Never print passwords, session tokens or database URLs containing passwords.
- Stop the test API and temporary PostgreSQL server after validation. Retain the backup, logs, catalogs and report for review.

## Migration failure recovery

- Capture the exact failed migration, error, database version and _prisma_migrations state. Stop automatic retries until the failure is understood.
- The tenth workflow migration has an explicit transaction and bounded lock/statement timeouts. Earlier migrations do not all have explicit transaction wrappers. Do not assume a failed migration left zero partial changes.
- Do not edit a previously applied migration, delete history rows, mark a failed migration applied without proof, or run Prisma migrate reset on valuable data.
- Rehearse recovery from the verified backup into a new database and validate it. If forward repair is chosen, author a separately reviewed migration that accounts for the observed partial state.
- Prisma migrate resolve is a deliberate recovery bookkeeping step, not a substitute for verifying actual schema/data.

## Rollback and compatibility warning

Application rollback is not schema rollback. Enum additions, catalog data updates, backfilled entitlements and newly written workflow records may not be understood by an earlier application. No automatic down migrations are supplied. Before switching application versions, verify their exact expected schema, data meanings, verification semantics and session behavior in a disposable restored database.

Do not infer zero-downtime deployment, production recovery time, or point-in-time recovery from this synthetic logical-backup rehearsal. Measure and approve those separately.
