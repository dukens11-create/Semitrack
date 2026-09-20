# SemiTraX

SemiTraX is a commercial-truck routing and driver application.

## Supported production source roots

The supported application stack is:

- **React Native mobile:** `apps/mobile-react-native`
- **API/backend:** `apps/api`
- **Admin portal:** `apps/admin`

The root-level Flutter application and older Flutter/HERE/TomTom scaffolding are **legacy reference code only**. They are not the supported SemiTraX release path and must not be used to build or deploy the current application.

Do not use root-level `flutter build`, legacy TomTom/HERE workflows, or old Flutter artifacts as release evidence for the current React Native application.

## Validation

The repository validation workflow is:

`.github/workflows/build_apk.yml`

Despite the historical filename, the workflow is now **SemiTraX Validation**. It validates the current API, React Native application, native wiring/tooling, Admin portal, Prisma schema/migrations, and guarded PostgreSQL integration tests.

A successful source-validation workflow is not by itself store or device acceptance. Release acceptance separately requires the exact Android/iOS artifacts and physical-device checks.

## React Native mobile

From `apps/mobile-react-native`:

```bash
npm ci
npm run check
```

`npm run check` runs TypeScript, lint, Jest, native-wiring checks, and page-size tooling tests.

Release configuration must be generated from approved environment values. Do not commit secret Mapbox download credentials, provider keys, CoPilot/AMS credentials, signing keys, or production tokens.

## API

From `apps/api`:

```bash
npm ci
npm run prisma:generate
npm run prisma:validate
npm run typecheck
npm test
```

Database integration tests require the repository's guarded disposable PostgreSQL test configuration. Never point those tests at production.

Truck routing remains **Trimble-only**. Do not add a passenger-car routing fallback or disable commercial restrictions to make a route succeed.

## Admin portal

From `apps/admin`:

```bash
npm ci
npm run typecheck
npm run build
```

## CoPilot

The pinned CoPilot React Native package remains fail-closed until all required native startup, licensing/provisioning, map entitlement, truck-profile parity, route transfer, guidance, and physical-device acceptance gates pass.

Do not bypass CoPilot licensing, patch vendor binaries beyond separately reviewed build fixes, or report guidance as available from source presence alone.

## Release safety

Before any release or production deployment:

1. Run the full current-tree validation.
2. Review the exact diff against the approved deployment parent.
3. Rehearse required migrations against an isolated PostgreSQL database.
4. Build and inspect the exact Android/iOS release artifact.
5. Verify truck routing and restrictions on a physical device.
6. Confirm provider, privacy, signing, store, and rollback requirements separately.

Production deploys, migrations, provider billing, and store submissions are deliberately separate from source reconciliation.
