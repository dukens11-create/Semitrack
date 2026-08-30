# SemiTrack live-data integrations

Updated: 2026-08-20

## Safety rule

The mobile client accepts active-navigation routes only when the API returns
both `truckSafe: true` and `navigationAllowed: true`. HERE Routing v8 is the
authoritative truck-routing provider. Mapbox may render the map and traffic
preview, but its passenger route is never substituted for a failed truck route.

Provider, official, community, stale, and unknown data remain distinguishable.
Community corrections never overwrite authoritative restrictions. Missing
speed limits, HOS values, diesel prices, availability, and station status remain
unknown rather than being inferred.

## Repository-complete systems

- Normalized truck restrictions, weigh facilities, parking, diesel prices,
  community reports/votes, DOT events/cameras, and provider health records.
- Route-corridor projection, actual route ordering, direction filtering,
  freshness, centralized TTLs, confidence scoring, official precedence, and
  independent provider failure isolation.
- Authenticated submission/voting, proximity checks, duplicate cooldown,
  server-side value/price validation, moderation, and role-protected provider
  diagnostics.
- Generic GeoJSON and ArcGIS REST DOT/511 adapters with configurable field
  mappings, refresh intervals, cache persistence, and no invented endpoints.
- Samsara and Motive OAuth/token refresh architecture, AES-256-GCM token
  storage, sync health, normalized driver/vehicle/HOS snapshots, and disconnect.
- Flutter route alerts for verified/authoritative restrictions and severe DOT
  events, cameras, sourced weigh-station markers/status reporting, route-ahead
  parking availability, cheapest known route-ahead diesel prices, community
  parking/price reporting, and a provider-backed HOS display.

## API surface

All `/safety` routes require authentication. Admin routes additionally require
an appropriate role.

```text
POST /safety/restrictions/corridor
GET  /safety/restrictions/:id
POST /safety/weigh-stations/corridor
GET  /safety/weigh-stations/nearby
POST /safety/parking/corridor
POST /safety/fuel/corridor
POST /safety/road-events/corridor
POST /safety/cameras/corridor
POST /safety/community-reports
PUT  /safety/community-reports/:id/vote
GET  /safety/community-reports/:type/:entityId/aggregate
PATCH /safety/admin/community-reports/:id
GET  /safety/admin/provider-status
POST /safety/admin/provider-sync
```

ELD endpoints include connection listing, provider authorization/callback,
refresh, sync, disconnect, and `GET /eld/hos/current`. Tokens never leave the
server.

## DOT/511 configuration

Set `DOT_PROVIDER_CONFIG_JSON` to a JSON array. Add only provider-published
endpoints and mappings. A credential value belongs in its own environment
variable; `authorizationHeaderEnv` contains only that variable's name.

```json
[
  {
    "id": "official-provider-id",
    "jurisdiction": "XX",
    "endpointUrl": "https://official-government-host.example/feed",
    "format": "GEOJSON",
    "dataType": "ROAD_EVENTS",
    "refreshIntervalSec": 300,
    "authorizationHeaderEnv": "XX_511_AUTHORIZATION",
    "mapping": {
      "id": "event_id",
      "title": "title",
      "type": "event_type",
      "severity": "severity",
      "road": "roadway",
      "updatedAt": "updated_at"
    }
  }
]
```

This example is configuration shape only; its URL is intentionally not a live
feed. Each real source must be verified with the relevant agency and tested
before enabling it.

## External configuration required

| System | Required configuration/data |
| --- | --- |
| Truck routing | `HERE_API_KEY`, billing/quota policy |
| Native guidance | Licensed HERE SDK Navigate Android/iOS artifacts and entitlements |
| Weigh locations | Authoritative state/federal datasets imported and validated; all states currently remain `PENDING` |
| Weigh/parking/fuel live data | Approved official/commercial feed agreements where available; community reporting works after DB deployment |
| DOT/511 | Verified agency endpoints, field mappings, and any state credentials |
| Samsara | Client ID/secret, redirect URI, approved scopes and account authorization |
| Motive | Client ID/secret, redirect URI, approved scopes and account authorization |
| Data protection | PostgreSQL `DATABASE_URL`, strong JWT secret, and a unique 32+ character `ELD_ENCRYPTION_KEY` |

Until those are configured, the corresponding status is:

`CODE COMPLETE — EXTERNAL DATA/CONFIGURATION REQUIRED`

## Operations

- Provider refresh runs once per minute and each adapter observes its own
  configured minimum interval.
- A failed provider records health/error state and does not stop other feeds.
- Community status expires centrally: weigh OPEN/CLOSED 60 minutes,
  INSPECTION 30 minutes; parking 30–45 minutes; diesel 24 hours.
- Official live weigh/parking status is accepted only inside its configured
  freshness window; otherwise the aggregate falls back to active community
  evidence or `UNKNOWN`.
- Admin diagnostics never return decrypted provider tokens.
