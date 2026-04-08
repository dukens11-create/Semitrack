# Semitrack Implementation Notes

## Feature mapping
1. Truck GPS navigation -> mobile navigation screen + /routing/truck-route API
2. Trip planner -> mobile planner screen + /trip-planner/create API
3. POI system -> mobile poi screen + /poi/nearby API
4. Parking system -> mobile parking screen + /parking + /parking/report API
5. Fuel system -> mobile fuel screen + /fuel/nearby API
6. Weigh stations -> mobile scales screen + /weigh-stations/nearby API
7. Alerts & safety -> mobile alerts screen + /alerts/route/:routeId API
8. Weather -> mobile weather screen + /weather/route API
9. Explore mode -> same mobile map foundation
10. Offline maps -> offline screen scaffold
11. Driver profile -> profile screen
12. Driver community -> community screen
13. Fleet/company -> fleet screen + admin dashboard
14. Load board -> load-board screen + API
15. Integrations -> not fully wired, backend extension point required
16. Analytics -> admin dashboard starter extension point
17. Subscriptions -> subscriptions screen + plans endpoint
18. Documents & operations -> documents screen + documents endpoint
19. Advanced route editing -> routing service extension point

## POI Data – truck_stop_default naming convention

Truck stop entries in `assets/locations.json` that have no `name` (missing key,
`null`, or empty string) are assigned the sentinel value **`"truck_stop_default"`**.

This applies to both **USA** (`"country": "US"`) and **Canada** (`"country": "CA"`)
POI data. Entries with an existing non-empty name are never modified.

**Where the rule is enforced:**
- **Data layer** (`assets/locations.json`): all unnamed truck stop entries carry
  `"name": "truck_stop_default"` directly in the JSON.  Entries with a proper
  brand name (e.g. `"Pilot Travel Center - Portland"`) are left unchanged.
- **Code layer** (`lib/services/poi_service.dart`,
  `apps/mobile/lib/services/poi_service.dart`): `loadAllPois()` falls back to
  `'truck_stop_default'` when parsing a JSON entry whose `name` field is absent
  or empty, so the map always shows a labelled marker even for incomplete data.

**Marker asset:** `assets/logo_brand_markers/truck_stop_default.png` is used as
the map icon for these generic stops (already bundled in the app).



## Production integrations still required
- HERE / TomTom / Mapbox / custom routing graph
- real-time traffic
- real-time weather
- camera feeds / 511
- ELD vendors
- billing
- auth
- cloud DB
- moderation
