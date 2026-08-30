# SemiTrack hybrid migration audit

Updated: 2026-08-20

## Safety architecture

Flutter remains the authoritative application UI and account/truck-profile layer. The API uses HERE Routing v8 as the only authoritative truck-routing provider. Mapbox supplies maps and may supply a clearly labelled traffic preview, but a Mapbox passenger route is never marked truck-safe or accepted for active navigation.

The Flutter/native channel exposes route preview, start/stop, destination and waypoint changes, voice controls, profile updates, rerouting, location, speed, bearing, progress, maneuvers, lanes, road name, reroute state, GPS accuracy, arrival, and errors. Android and iOS deliberately fail closed with `TRUCK_SAFE_NATIVE_ROUTING_UNAVAILABLE` until a licensed native HERE Navigate SDK is supplied.

## Implemented repository work

- HERE truck requests include dimensions, gross/current and axle weight, axle/trailer counts, hazardous goods, toll/ferry/highway/dirt-road avoidance, alternatives, traffic-aware departure time, all sections, all maneuvers, and lanes only when the provider returns them.
- Flutter route requests use the authenticated backend and reject results lacking `truckSafe` and `navigationAllowed`.
- Multi-profile CRUD/default selection and validation are persisted per account and the selected profile is sent to routing and the native bridge.
- Secure mobile authentication supports signup, login, logout, password reset requests, session restoration, rotating refresh tokens, and authenticated retry.
- Prisma models and migration cover users, refresh/reset tokens, truck profiles, settings, favorites, trips, community moderation/audit data, subscriptions, and encrypted ELD connection metadata.
- API middleware includes validation, authentication/authorization, rate limiting, CORS, request logging, consistent errors, and health reporting.
- ELD provider architecture supports Samsara and Motive OAuth exchange/refresh, encrypted token storage, driver/vehicle/HOS synchronization, disconnect, sync/error state, and timestamps.
- Mapbox offline regions use real style-pack/tile-region downloads with bounded geometry, progress, storage reporting, listing/deletion, Wi-Fi restriction, and reconnect refresh. This is not represented as offline truck route calculation.
- Obsolete duplicate `apps/mobile/lib` and unused scaffold feature trees were removed. The production Firebase placeholder files and unused Firebase runtime dependency were removed.
- Normalized restriction, weigh-station, parking, diesel-price, community-report/vote, DOT event/camera, and provider-health persistence was added with a production Prisma migration.
- Authenticated safety APIs now provide route-corridor filtering, route ordering, direction checks, centralized expiry/confidence aggregation, official-source precedence, moderation, and provider diagnostics.
- A configurable GeoJSON/ArcGIS DOT/511 adapter, cached provider scheduler, and failure isolation were added without inventing state endpoints.
- Samsara/Motive OAuth, encrypted token storage, refresh/disconnect/sync, normalized provider-only HOS, and Flutter account/HOS integration were added. Missing HOS is no longer locally fabricated.
- The weigh-station system now includes a versioned 50-state offline asset structure, official-source importer/merge/validation tooling, route-aware repository, status reporting, and marker/navigation integration. All unimported states truthfully remain `PENDING`.
- Legacy approximate weigh stations, invented diesel prices, inferred posted speed limits, and placeholder weather/risk values were removed from production behavior.
- HERE SDK credentials now have a separate ignored `config/here/credentials.properties` path, a placeholder-only template, and a helper that converts HERE's local Java-properties format to a temporary Flutter define file without logging values. The backend `HERE_API_KEY` remains separate and unchanged.
- The official HERE SDK Explore Flutter 4.27.2 package is installed locally under the ignored `plugins/here_sdk` path. `HereSdkService` initializes the engine and performs a debug-only `SearchEngine` credential probe without logging credential values.

## External configuration still required

1. HERE REST API key for the backend (`HERE_API_KEY`) and production billing/quota policy.
2. HERE SDK Navigate entitlement, Navigate Android/iOS package access, offline truck-navigation entitlement, and a commercial contract are still required before replacing the native guidance placeholders. The installed Explore package does not grant Navigate features.
3. A newly rotated Mapbox public token at runtime and a newly rotated secret downloads token in the user Gradle properties or CI secret. Never commit either credential.
4. PostgreSQL `DATABASE_URL`, strong JWT and token-encryption secrets, production CORS origins, and deployment infrastructure.
5. Samsara/Motive OAuth client IDs, secrets, redirect URIs, provider approval, and production scopes.
6. Google Play/App Store application records, product IDs, purchase-verification credentials, signing keys, iOS provisioning, and final application/bundle identifiers.
7. Verified official state weigh-station datasets and real state DOT/511 feed configurations. No state is marked imported until source records are actually validated.

## Known limitations and risks

- Licensed native turn-by-turn guidance, native rerouting, native voice/audio focus, Android Auto, and true offline truck routing cannot be completed or device-tested without HERE Navigate access.
- HERE Explore 4.27.2 is installed and the application-side initialization/search boundary analyzes successfully. On-device engine initialization, credential acceptance, map rendering, and route behavior still require an Android device/emulator test; none is claimed from a source-only check.
- Subscription records and entitlement reads exist, but genuine purchases, restore flows, and server receipt verification require store products and credentials; no purchase is simulated.
- Moderation persistence and authorization exist; a dedicated admin client is not yet implemented.
- The active map screen remains very large and contains disabled legacy passenger routing plus many legacy warnings. Removal should follow real-route regression testing, not precede it.
- Android 10–15 foreground/background behavior, Bluetooth voice routing, process recovery, and iOS lifecycle behavior require real-device validation.
- Production application IDs, signing, provisioning, and deployment configuration remain operator decisions.

## Verification

- Flutter formatting: passed.
- Flutter tests: 9 passed.
- Flutter analysis: 0 errors; 52 warnings and 105 informational findings remain in legacy UI code.
- Weigh importer tests: 5 passed.
- Prisma client generation/schema validation, API TypeScript type-check, 6 backend tests, and backend build: passed.
- Android debug build: dependency resolution includes the local HERE package and the build reaches Java compilation. Repeated fresh-cache/JDK 17/JDK 21 attempts fail when this Codex Windows sandbox closes ordinary Android/Gradle dependency JARs with `AccessDeniedException`; disabling Jetifier merely moves the failure to another dependency JAR. No APK success is claimed.
- HERE credential loading test: passed against the downloaded local properties file with values hidden and the temporary define file removed. Application-side HERE initialization and the debug `SearchEngine` credential probe are implemented; actual credential acceptance must be observed by running on an Android device/emulator.
- Secret scan: no live Mapbox token or populated current secret assignment found in the active tree. A previously committed populated HERE `credentials.properties` file is removed and ignored, but its credentials and the previously disclosed Mapbox secret must be rotated; repository history still requires a separately authorized purge.

## Local secret placement

Runtime public Mapbox token:

```powershell
flutter run --dart-define=MAPBOX_ACCESS_TOKEN=YOUR_NEW_PUBLIC_TOKEN
```

Private Android artifact token (outside the repository):

```properties
# %USERPROFILE%\.gradle\gradle.properties
MAPBOX_DOWNLOADS_TOKEN=YOUR_NEW_SECRET_DOWNLOADS_TOKEN
```

On this computer `%USERPROFILE%\.gradle\gradle.properties` is currently a
directory, not a file. Rename that directory first, then create the text file
at the path above. The previously disclosed secret token must be revoked and
replaced before use.
