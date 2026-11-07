# Step 12 — Truck stops and rest areas

Status: Partially Fixed.

Existing implementation: PoiService delegates Android searches to CoPilotPoiSearch, matching installed category names and filtering specialized name fallbacks. Native results carry provider identity. Along-route ordering is geometric advisory filtering, not a verified truck-access route. Truck navigation safety gates remain separate.

Root cause corrected: identical nearby queries repeatedly read the native catalogue and search provider, including concurrently queued duplicate requests.

Correction: cache successful static-place queries for 60 seconds, bounded to 24 exact category/coordinate keys. Queued duplicate requests reuse the result. Changed coordinates trigger a new query; failures are not cached. Cancellation is checked before cache access and after native results. Returned rows are copied so callers cannot mutate another result's top-level properties. Geometry-derived distances still use the supplied fresh fix; live fuel/parking availability is not established by this cache.

Files changed:
- apps/mobile-react-native/src/services/copilot/CoPilotPoiSearch.ts
- apps/mobile-react-native/__tests__/copilot-poi-cache.test.ts
- docs/verification/step-11-traffic.md
- docs/verification/step-12-poi-cache.md

Tests: 73 suites / 1,005 tests passed; TypeScript passed after test indexing correction. Five cache tests cover concurrent duplication, expiry, moved centers, cancellation, provider failure/recovery and capacity eviction.
Android verification: pending.

Remaining: verify installed truck-stop/rest-area category coverage, exit/amenity data and access roads; nearest-two-per-category automatic navigation discovery is not certified by this change. Catalogue/result freshness after map changes is bounded by the cache TTL, not live provider validation. Native address/offline integration and device route safety remain separate blockers.

Branch: codex/step-12-poi-cache, stacked on codex/step-10-camera-controls.
Next: Step 13 — Fuel prices and parking.
No new APK build requested.
