# SemiTraX P0 — local contract reconciliation

Completed 2026-09-15. LOCAL REVIEW CANDIDATE ONLY. No commit, push, deployment, production migration, billing enablement or Samsung installation.

## Request matrix

Baselines: production a57d5f3f2dfe1cef081e298e936952954d685e0d; mobile 44ef97b22d58c0883b07199b68a0cdf37d904cae. The original comparison column records the pre-repair audit; the final columns record the repaired local source. Both repair roots are detached at these exact commits; original checkouts are unchanged.

Requests send Accept: application/json; bodies add Content-Type: application/json; Bearer means Authorization: Bearer accessToken with single-flight refresh on 401. Public requests do not attach access credentials. ApiClient accepts 2xx and JSON or empty responses; canonical statuses below are verified against server handlers. Shared errors: 400 validation, 401 expired/revoked auth, 403 ownership/role/policy, 404 missing resource/route, 409 revision/concurrency, 422 unsafe/unsupported route, 429 rate limit, 500 internal, 502 upstream, 503 configuration/service unavailable; exact code distinguishes retry/review/auth. Native network errors use status 0.

Truck fields: name,isDefault,heightFt,widthFt,lengthFt,weightLbs,currentWeightLbs,weightPerAxleLbs,axleCount,tractorType,trailerType,trailerCount,unitNumber,trailerNumber,hazmatEnabled,hazardousGoods,avoidTolls,avoidFerries,avoidHighways,avoidResidential,avoidDirtRoads. Routing excludes name/default/tractor/unit/trailer number; revision identity is sent separately. Truck response adds id,revision,verificationState,verifiedRevision,verifiedAt. Coordinate is {lat,lng}; named trip point adds id,name. SavedTrip includes revision,status,origin,destination,stops,assigned,startedAt,completedAt,completedStopIds. Document includes revision,truckId,dates,verificationState,expired,fileAvailable:false. TruckRoute uses [lng,lat] geometry, maneuvers with validated offsets, legs, alternatives, alerts, Trimble/truckSafe/navigationAllowed and validatedStops.

| Method | Path | Request body | Query | Auth | Success | Expected response | Original production comparison  Expected errors | Final backend contract / disposition |
|---|---|---|---|---|---|---|---|---|---|
| GET | /health | — | — | Public | 200 | health/config object | MATCH  G | Retained request, status and response shown. MATCH. |
| POST | /auth/register | email,password,fullName | — | Public | 201 | user + accessToken + refreshToken | MATCH  G; 400; 401 (credentials/session); 409 (register); 403 (authenticated change) | Retained request, status and response shown. MATCH. |
| POST | /auth/login | email,password | — | Public | 200 | user + accessToken + refreshToken | MATCH  G; 400; 401 (credentials/session); 409 (register); 403 (authenticated change) | Retained request, status and response shown. MATCH. |
| POST | /auth/refresh | refreshToken | — | Public opaque token | 200 | accessToken + refreshToken | MATCH  G; 400; 401 (credentials/session); 409 (register); 403 (authenticated change) | Retained request, status and response shown. MATCH. |
| POST | /auth/logout | refreshToken | — | Captured session | 204 | empty | MATCH  G; 400; 401 (credentials/session); 409 (register); 403 (authenticated change) | Retained request, status and response shown. MATCH. |
| POST | /auth/password-reset/request | email | — | Public | 202 | generic acknowledgement (ignored) | MATCH  G; 400; 401 (credentials/session); 409 (register); 403 (authenticated change) | Retained request, status and response shown. MATCH. |
| GET | /me | — | — | Bearer | 200 | User | MATCH  A; 400 on validated input | Retained request, status and response shown. MATCH. |
| PATCH | /me | fullName,phone nullable | — | Bearer | 200 | User | MATCH  A; 400 on validated input | Retained request, status and response shown. MATCH. |
| POST | /auth/password/change | currentPassword,password | — | Bearer | 204 | empty | MISMATCH: unmounted  G; 400; 401 (credentials/session); 409 (register); 403 (authenticated change) | Mounted/normalized to the request, status and response shown. MATCH. |
| GET | /trucks | — | — | Bearer owner | 200 | {items:Truck[]} | MATCH  A; 400; 403/404; 409 revision/idempotency | Retained request, status and response shown. MATCH. |
| POST | /trucks | Truck fields + createOperationId UUID | — | Bearer owner | 201 | Truck | MISMATCH: operation identity ignored  A; 400; 403/404; 409 revision/idempotency | 201 Truck with durable user-scoped createOperationId replay/conflict rules. MATCH. |
| PATCH | /trucks/:id | Truck fields + expectedRevision | — | Bearer owner | 200 | Truck (new revision, unverified) | MATCH  A; 400; 403/404; 409 revision/idempotency | Retained request, status and response shown. MATCH. |
| POST | /trucks/:id/verify | expectedRevision | — | Bearer owner | 200 | Truck (verified current revision) | MATCH  A; 400; 403/404; 409 revision/idempotency | Retained request, status and response shown. MATCH. |
| DELETE | /trucks/:id | — | — | Bearer owner | 204 | empty | MATCH  A; 400; 403/404; 409 revision/idempotency | Retained request, status and response shown. MATCH. |
| POST | /routing/truck-route | origin,destination,viaStops,truck,truckProfileId,truckRevision,routeMode=fastest,alternatives | — | Bearer verified owner | 200 | TruckRoute + validatedStops proof | MISMATCH: missing stop proof; alternate provider; optional preference rejection  A; 400; 409 profile; 422 unsafe/unproven route; 502/503 provider | 200 response now includes validatedStops and optional preferenceWarnings; Trimble only. MATCH. |
| GET | /trips | — | — | Bearer owner | 200 | {items:SavedTrip[]} | MISMATCH: unmounted  A; 400; 403/404; 409 revision/idempotency | Mounted/normalized to the request, status and response shown. MATCH. |
| POST | /trips | createOperationId,name,origin,destination,stops,truckId,expectedTruckRevision | — | Bearer owner | 201 | SavedTrip (driver-reported, not native guidance) | MISMATCH: unmounted/schema drift  A; 400; 403/404; 409 revision/idempotency | Mounted/normalized to the request, status and response shown. MATCH. |
| PATCH | /trips/:id/status | expectedRevision,status,completedStopId? | — | Bearer owner | 200 | SavedTrip | MISMATCH: unmounted  A; 400; 403/404; 409 revision/idempotency | Mounted/normalized to the request, status and response shown. MATCH. |
| PATCH | /trips/:id/truck | expectedRevision,truckId,expectedTruckRevision | — | Bearer owner | 200 | SavedTrip | MISMATCH: unmounted  A; 400; 403/404; 409 revision/idempotency | Mounted/normalized to the request, status and response shown. MATCH. |
| GET | /documents | — | — | Bearer owner | 200 | {items:Document[],uploadAvailable:false} | MISMATCH: unmounted/schema drift  A; 400; 403/404; 409 revision/idempotency | Mounted/normalized to the request, status and response shown. MATCH. |
| POST | /documents | createOperationId,type,fileName,truckId?,issuedOn?,expiresOn? | — | Bearer owner | 201 | Document metadata; fileAvailable:false | MISMATCH: unmounted  A; 400; 403/404; 409 revision/idempotency | Mounted/normalized to the request, status and response shown. MATCH. |
| PATCH | /documents/:id | expectedRevision,metadata:{type,fileName,truckId?,issuedOn?,expiresOn?} | — | Bearer owner | 200 | Document metadata | MISMATCH: unmounted  A; 400; 403/404; 409 revision/idempotency | Mounted/normalized to the request, status and response shown. MATCH. |
| GET | /places/search | — | category,lat,lng,limit=30 | Bearer | 200 | {items:Poi[]}; safe unavailable error otherwise | MISMATCH: cat_scale/truck_repair not accepted; unapproved HERE active  A; 400; 422 location (corridor); 503 provider unconfigured | 503 POI_PROVIDER_NOT_CONFIGURED after validation. Error contract MATCH; successful POI service remains BLOCKED. |
| POST | /places/corridor | category,route,currentLocation:{lat,lng,accuracy,timestamp} | — | Bearer | 200 | {items:Poi[]} | MISMATCH: currentLocation ignored; route length limit; unapproved HERE active  A; 400; 422 location (corridor); 503 provider unconfigured | 503 POI_PROVIDER_NOT_CONFIGURED after validation. Error contract MATCH; successful POI service remains BLOCKED. |
| POST | /weather/route | route,currentLocation:{lat,lng,accuracy,timestamp} | — | Bearer | 200 | {items:area-observation-or-unavailable[]} | MISMATCH: unmounted  A; 400; 422 corridor location (where supplied) | Mounted/normalized to the request, status and response shown. MATCH. |
| POST | /safety/community-reports | type,entityId,value,latitude,longitude,numericValue? | — | Bearer | 201 | record acknowledgement (ignored) | MATCH  A; 400; 422 corridor location (where supplied) | Retained request, status and response shown. MATCH. |
| GET | /navigation-settings | — | — | Bearer owner | 200 | settings | MATCH  A; 400 on validated input | Retained request, status and response shown. MATCH. |
| PUT | /navigation-settings | full settings object | — | Bearer owner | 200 | settings | MATCH  A; 400 on validated input | Retained request, status and response shown. MATCH. |
| GET | /eld/connections | — | — | Bearer owner | 200 | {items:{provider,status}[]} | MATCH  A; 400 on validated input | Retained request, status and response shown. MATCH. |
| GET | /eld/hos/current | — | — | Bearer owner | 200 | {status:UNKNOWN,reason,...} | MISMATCH: production returns raw items only  A; 400 on validated input | Mounted/normalized to the request, status and response shown. MATCH. |
| GET | /entitlements | — | — | Bearer owner | 200 or 503 BILLING_DISABLED | accessState object or intentional disabled error | MATCH  A; 503 BILLING_DISABLED | Retained request, status and response shown. MATCH. |
| POST | /analytics/events | eventType=APP_OPENED | — | Bearer | 202 | acknowledgement ignored | MATCH  A; 400 on validated input | Retained request, status and response shown. MATCH. |
| POST | /safety/restrictions/corridor | route,currentRouteOffsetMeters,currentLocation?,maxDistanceAheadMeters=160934,limit=50 | — | Bearer | 200 | {items:record[]} | MISMATCH: currentLocation ignored / ahead metadata  A; 400; 422 corridor location (where supplied) | Mounted/normalized to the request, status and response shown. MATCH. |
| POST | /safety/road-events/corridor | route,currentRouteOffsetMeters,currentLocation?,maxDistanceAheadMeters=160934,limit=50 | — | Bearer | 200 | {items:record[]} | MISMATCH: currentLocation ignored / ahead metadata  A; 400; 422 corridor location (where supplied) | Mounted/normalized to the request, status and response shown. MATCH. |
| POST | /safety/cameras/corridor | route,currentRouteOffsetMeters,currentLocation?,maxDistanceAheadMeters=160934,limit=50 | — | Bearer | 200 | {items:record[]} | MISMATCH: currentLocation ignored / ahead metadata  A; 400; 422 corridor location (where supplied) | Mounted/normalized to the request, status and response shown. MATCH. |
| POST | /safety/parking/corridor | route,currentRouteOffsetMeters,currentLocation?,maxDistanceAheadMeters=160934,limit=50 | — | Bearer | 200 | {items:record[]} | MISMATCH: currentLocation ignored / ahead metadata  A; 400; 422 corridor location (where supplied) | Mounted/normalized to the request, status and response shown. MATCH. |
| POST | /safety/fuel/corridor | route,currentRouteOffsetMeters,currentLocation?,maxDistanceAheadMeters=160934,limit=50 | — | Bearer | 200 | {items:record[]} | MISMATCH: currentLocation ignored / ahead metadata  A; 400; 422 corridor location (where supplied) | Mounted/normalized to the request, status and response shown. MATCH. |
| POST | /safety/weigh-stations/corridor | route,currentRouteOffsetMeters,currentLocation?,maxDistanceAheadMeters=160934,limit=50 | — | Bearer | 200 | {items:record[]} | MISMATCH: currentLocation ignored / ahead metadata  A; 400; 422 corridor location (where supplied) | Mounted/normalized to the request, status and response shown. MATCH. |

| GET | /capabilities | — | — | Bearer | 200 | rn-p0-v1; truckRouting health/state/requestAllowed/verifiedProfileRequired/optionalPreferences; turnByTurn unavailable/license UNVERIFIED; places/trips/documents capability flags | MISMATCH: endpoint and RN consumer absent | A | New authenticated handler and validated RN consumer. MATCH. |

G: shared infrastructure errors 429/500/502/503 and network status 0; these are client-handled possibilities, not a claim every handler intentionally emits every status. A: G plus 401/403 authentication/account authorization. Resource handlers may intentionally use 404 to conceal non-owned resources. Specific business codes take precedence over generic status messages.

No RN GET truck-detail/default endpoint call exists: detail/current/default derive from GET /trucks; verification selects the default. Old POST /trucks/:id/default remains a verification-required rejection. No direct RN dispatch call exists; assigned trips are read via /trips. Password reset confirmation is the external website POST /auth/password-reset/confirm contract, retained. Mapbox forward/reverse HTTPS geocoding is external display/search (q or longitude/latitude, country=us,ca, limit=6, public access token); it is not truck routing. Before repair the capability endpoint was absent and the global native banner was unconditional; the new endpoint and state-aware banners resolve that drift.


## Source identity and working trees

| Source | Authoritative branch | Exact base HEAD | Repair root / current branch |
|---|---|---|---|
| API/Admin | codex/prepare-semitrax-api-render | a57d5f3f2dfe1cef081e298e936952954d685e0d | C:/Users/duken/Documents/Codex/2026-09-14/files-pasted-by-the-user-semitrax/backend-repair; detached HEAD |
| React Native | codex/semitrax-react-native-prelicense | 44ef97b22d58c0883b07199b68a0cdf37d904cae | C:/Users/duken/Documents/Codex/2026-09-14/files-pasted-by-the-user-semitrax/mobile-repair; detached HEAD |

Both repair clones began clean at the exact named commits. All changes below are uncommitted in these isolated clones, not in the original checkouts. No source-line merge or branch movement was performed. The original long checkout remains on the mobile branch at 44ef97b22d58c0883b07199b68a0cdf37d904cae, with exactly ?? test/failures/. C:/ST retains its three existing untracked APK audit directories. Both original checkouts have no tracked changes. No deployment was changed or reverified in this local pass.

## Mismatches found and repaired

| Drift | Repair and evidence |
|---|---|
| Password-change route absent | Mounted POST /auth/password/change (204), checks current password, invalidates sessions/reset tokens under serialized user updates. Password/session and HTTP integration tests pass. |
| Truck create operation ignored | Durable user-scoped identity; replay returns original, payload reuse conflicts, deleted result cannot recreate. Actual RN serialization/HTTP response-loss test passes. Older callers may omit createOperationId. |
| Trips/stops unmounted and schema drift | Mounted owned/versioned trips, status and truck endpoints; supporting migration and dispatch scoping. Progress is driver-reported, never native guidance proof. |
| Document workflow absent | Mounted owned/versioned metadata endpoints and schema. UploadAvailable/fileAvailable remain false; ownership/revision tests pass. |
| Route stop proof absent | Trimble validates stop count/order, origin/destination/leg and path coverage; returns validatedStops and consistent maneuvers/legs. Invalid/sparse/unproven responses rejected. |
| Alternate providers active | Active routingService requires Trimble; comparison/traffic-preview reject with 410. Historical provider source retained. |
| Optional preferences blocked valid routing | Unsupported avoidHighways/avoidResidential/avoidDirtRoads return OPTIONAL_PREFERENCE_UNSUPPORTED metadata and alerts; all eight combinations preserve mandatory truck options. |
| No truthful capability contract | New authenticated GET /capabilities plus RN consumer separates planning, profile verification, configuration, outage and not-started. Configuration alone cannot be green. |
| Admin current-provider drift | Trimble Routing uses actual shared health evidence; retired HERE/TomTom rows excluded from current analytics. Stale/missing/error data cannot remain operational. |
| HERE POI/timezone still active | Removed active server calls/imports. POI categories/corridor location accepted and validated; typed 503 until approved provider exists. This fixes the boundary, not successful POI availability. |
| Weather route endpoint absent | Mounted bounded current-location-aware weather observations/timeouts and explicit unavailable items. Paired service/HTTP tests pass. |
| Safety corridor location/freshness drift | Correlates location with route; rejects stale/inaccurate/off-route/ambiguous location; adds ahead metadata and DOT freshness/camera safety handling. |
| HOS response drift | Returns explicit UNKNOWN/reason rather than treating raw synchronized rows as usable HOS. ELD encryption guard retained. |
| Error-body HTTP classification lost | RN preserves HTTP status on malformed error JSON, uses safe local messages and treats 429 as retryable. Tests cover all ten requested statuses. |
| Generic native banner | Distinct setup/provisioning/maps/turn-by-turn/not-started display; CoPilot licensing remains UNVERIFIED. |

Original matching auth/me/settings/telemetry/basic-truck contracts remain. Dispatch supports assigned-trip consistency with existing Admin authorization; no separate dispatch UI port. Production Vite origin validation, deployment files, dependency manifests and lockfiles remain unchanged.

## Truck and route invariants

Dimensions remain decimal feet; weights remain pounds; axles/trailers remain integer counts. API/RN agree on all truck fields, hazard classes and verification metadata. The external status field is verificationState. PATCH expectedRevision increments revision and invalidates verification/default. POST verify requires current expectedRevision and records VERIFIED, verifiedRevision == revision and verifiedAt. No auto-verification. Route requests compare the owned verified saved snapshot before and after provider work.

Mandatory height/width/length/weight/axles/trailers/hazmat/commercial restrictions remain in Trimble TruckCfg with restriction overrides disabled. Unsupported optional preferences only add warnings; saved values are not silently cleared. A route preview is not CoPilot acceptance.

## Provider paths and evidence

| Path | Final classification |
|---|---|
| src/server.ts -> services/routingService.ts -> providers/trimbleProvider.ts | Sole active commercial truck route path; validated real Directions/RoutePath evidence required. |
| services/providers/hereProvider.ts | Legacy implementation; removed from active server routing graph; historical tests retained. |
| services/providers/mapboxProvider.ts | Legacy passenger/traffic implementation; no active truck or traffic-preview call. |
| herePlacesProvider.ts, herePlacesParser.ts, hereTimeZoneProvider.ts, hereTimeZoneParser.ts, hereTime.ts, hereVehicleUnits.ts | Legacy source retained; active server POI/timezone handlers no longer invoke it. |
| src/R.server.ts, src/Expess.server.ts | Historical entrypoints, not package start/dev entrypoints. |
| TomTom | No active route provider selected or introduced. |
| RN Mapbox | Existing approved display and forward/reverse geocoding only; no passenger routing fallback. |
| CoPilot/CPIK | Separate external guidance gates; pinned dependency and native source unchanged. |

Shared routingHealth uses: missing key -> NOT_CONFIGURED; configured without fresh routing proof -> DEGRADED; actual failed provider attempt -> UNAVAILABLE; actual validated route success or qualifying recent durable Trimble ROUTING health record -> OPERATIONAL. Evidence expires in five minutes. Per-process observations are in memory, not durable probes; restart falls back to stored evidence or conservative state. No real vendor acceptance was performed. No private credentials were introduced or printed.

## Validation results

All final validations below passed. Database tests used an isolated loopback cluster, synthetic secrets and billing disabled; no production database was accessed.

| Validation | Final result |
|---|---|
| Full relevant API run | 193 passed, 0 failed, 0 skipped |
| Actual RN serialization/HTTP response-loss rerun after final RN fix | 3 passed, 0 failed |
| API TypeScript production compilation | PASS |
| Prisma generate and validate | PASS |
| Clean local PostgreSQL 17.11 migration application | All 10 migrations PASS |
| RN Jest | 24 suites; 329 passed, 0 failed |
| RN TypeScript and ESLint (max warnings 0) | PASS |
| Admin tests | 29 passed, 0 failed |
| Admin TypeScript | PASS |
| Admin production Vite build | PASS; 31 modules |
| RN production Android JavaScript bundle | PASS; bundle and 42 assets |
| Both repair roots git diff --check | PASS |
| Staged changes | None |

API coverage includes database/HTTP ownership, revisions, password/session invalidation, missing-provider and capabilities behavior. Existing production tests were retained. Reused reviewed test fixtures were updated for required stop proof and warning behavior; two unrelated legacy HERE enhancement tests from the other branch were not imported. Test timeouts were not relaxed.

Environment caveats: ordinary Vite configuration bundling hit Windows ancestor access denial. An external native-Node loader built with the unchanged production vite.config.ts and approved API URL. Metro needed an external configuration exposing existing dependency junctions and normalizing Windows paths. No ACL changes or dependency downgrades. Initial setup/path/cold-run failures were resolved before the final passing runs.

The RN bundle is JavaScript, not an APK/AAB, native release build, signature, final packaged 16-KB audit or device verification. Those were not performed. PostgreSQL 17 clean migrations do not prove PostgreSQL 16 incremental migration safety with existing data. A representative disposable PostgreSQL 16 rehearsal remains required. The owned test cluster was stopped and its temporary password file removed.

## Exact changed-file inventory

50 review files: 41 API/Admin/report and 9 RN. M means unstaged modification; ?? means new untracked candidate. These repairs live only in isolated clones.

### API/Admin

Root: C:/Users/duken/Documents/Codex/2026-09-14/files-pasted-by-the-user-semitrax/backend-repair

     M apps/admin/src/App.tsx
     M apps/admin/src/types.ts
     M apps/api/prisma/schema.prisma
     M apps/api/src/config/env.ts
     M apps/api/src/modules/admin/adminAccount.routes.ts
     M apps/api/src/modules/admin/operational.routes.ts
     M apps/api/src/modules/analytics/adminAnalytics.service.ts
     M apps/api/src/modules/dispatch/dispatch.routes.ts
     M apps/api/src/modules/documents/document.routes.ts
     M apps/api/src/modules/safety/safety.routes.ts
     M apps/api/src/modules/trips/trip-status.routes.ts
     M apps/api/src/modules/trucks/profileRevision.ts
     M apps/api/src/server.ts
     M apps/api/src/services/dotFeedService.ts
     M apps/api/src/services/eldNormalization.ts
     M apps/api/src/services/passwordRecovery.ts
     M apps/api/src/services/providers/dot511Provider.ts
     M apps/api/src/services/providers/routeProvider.ts
     M apps/api/src/services/providers/trimbleProvider.ts
     M apps/api/src/services/routingService.ts
     M apps/api/src/services/safetyDataService.ts
     M apps/api/src/services/sessionRotation.ts
     M apps/api/src/services/weatherService.ts
     M apps/api/src/types.ts
     M apps/api/src/utils/password.ts
     M apps/api/test/p0Routing.test.ts
     M apps/api/test/p0Session.test.ts
     M apps/api/test/trimbleProvider.test.ts
    ?? apps/admin/src/providerHealth.ts
    ?? apps/admin/test/provider-health.test.cjs
    ?? apps/api/prisma/migrations/20260915040000_phase3_driver_workflows/migration.sql
    ?? apps/api/src/modules/analytics/providerHealth.ts
    ?? apps/api/src/services/routingCapabilities.ts
    ?? apps/api/test/phase2Database.integration.test.ts
    ?? apps/api/test/phase2Services.test.ts
    ?? apps/api/test/phase3Database.integration.test.ts
    ?? apps/api/test/phase3Http.integration.test.ts
    ?? apps/api/test/providerHealth.test.ts
    ?? apps/api/test/routingCapabilities.test.ts
    ?? apps/api/test/truckCreateIdempotency.test.ts
    ?? docs/SEMITRAX_P0_CONTRACT_RECONCILIATION.md

### React Native

Root: C:/Users/duken/Documents/Codex/2026-09-14/files-pasted-by-the-user-semitrax/mobile-repair

     M apps/mobile-react-native/src/components/CopilotStatus.tsx
     M apps/mobile-react-native/src/errors/driverErrors.ts
     M apps/mobile-react-native/src/features/routing/RouteStore.ts
     M apps/mobile-react-native/src/models/contracts.ts
     M apps/mobile-react-native/src/screens/PlanningScreen.tsx
     M apps/mobile-react-native/src/services/api/ApiClient.ts
    ?? apps/mobile-react-native/__tests__/p0-contract-capabilities.test.ts
    ?? apps/mobile-react-native/src/components/RoutingCapabilityStatus.tsx
    ?? apps/mobile-react-native/src/features/routing/capabilities.ts

Excluded: test/failures/; pre-existing APK audit folders; dependencies/junctions; generated dist/build/configuration; Git metadata/local line-ending attributes; external Vite/Metro helpers; local database/logs; abandoned incomplete p0-api setup clone; other scratch output. Temporary local DB password removed. No environment file, credential, signing material, Flutter source or production configuration belongs in this repair. isolatedDatabaseGuard.ts is byte-identical to HEAD and excluded.

## Remaining compatibility and acceptance gates

1. Local source contracts pass. Deployed a57 API is unchanged and still has original drift until a separately approved migration/deployment. Ship the new RN capability consumer with the repaired API; against the old API it conservatively displays unverified health.
2. Successful POI search/corridor and timezone service remain unavailable until an approved provider is integrated. Typed 503 is intentional, not a fake success.
3. Real Trimble testing can proceed next as a controlled local test after review, using separately approved credentials/configuration and required RoutePath entitlement. Verify mandatory restrictions, stop coverage, geometry, maneuvers, optional warnings and failure behavior against actual provider responses. No real vendor acceptance occurred here.
4. CoPilot licensing/provisioning/maps/runtime and physical-device acceptance remain separate gates. No Android Auto/CarPlay verification implied.
5. PostgreSQL 16 incremental rehearsal, rollout approval, rebuilt/signed APK and final package/device checks remain. Old APK hashes/device results do not apply to these repairs.
6. Document uploads, usable HOS authority, billing acceptance and wider-product gates remain outside this contract repair. Disabled/unknown states are intentional.

## Practical readiness and disposition

Local review-candidate readiness estimate: approximately 44%, a rough engineering judgment rather than a measured release score. The previous approximately 41% deployed-product assessment is unchanged because nothing was deployed or installed. The modest local increase credits tested contract/revision/session/capability/Admin compatibility; no provider, production-migration or device credit is granted.

LOCAL CONTRACT REPAIR: COMPLETE FOR REVIEW

PRODUCTION READY: NO

REAL TRIMBLE TESTING NEXT: YES, conditional on review and approved local credentials/configuration/entitlement

COMMITTED: NO

PUSHED: NO

DEPLOYED: NO

SAMSUNG INSTALLED: NO

STOP FOR REVIEW.
