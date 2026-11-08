# Step 9 — Offline maps and destination search

Status: Blocked for acceptance; native offline address-search adapter is missing.

Investigation: apps/mobile-react-native/src/features/search/SearchService.ts supplies Mapbox online address/reverse search. DestinationSearchStore calls it. CoPilotHostModule has native POI search and installed-map/download operations, but no offline address-search bridge. CopilotOfflineMap gates map rendering on installed data and licensing; that does not establish address-search or trip-wide coverage.

No fabricated offline address results were introduced. Existing California maps, download/resume support and installed-data checks are preserved. Native POI availability depends on installed data and licensed categories.

Required next implementation: verify the installed SDK TypeAheadGeocoder/address-search interface and integrate cancellable, serialized requests with regional coverage errors. Verify offline routing using the actual truck profile. Public documentation alone does not establish the installed binary's bridge contract or device license.

Official reference: https://developer.trimblemaps.com/copilot-navigation/feature-guide/operating-features/destination-entry/
Tests: no new offline-address test passed because the adapter is not implemented. Existing automated suites are not offline-device evidence.
Android: airplane-mode address search, native POI search, route calculation and California map preservation remain pending.
Files changed: this report only; included with subsequent camera-control PR.
Next: Step 10 — Camera controls, after explicitly recording this blocker.
