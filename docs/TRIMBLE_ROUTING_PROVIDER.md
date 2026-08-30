# Optional Trimble truck-routing provider

SemiTraX keeps its existing HERE integrations. This addition makes only the
backend truck-route calculator selectable between HERE Routing and Trimble
Maps REST routing. Flutter continues to consume the existing normalized
`POST /routing/truck-route` response, so POIs, DOT/511, parking, fuel, HOS/ELD,
the map UI, and the fail-closed native-guidance layer remain independent.

## Local configuration

Add the key only to `apps/api/.env`, which is excluded by the repository's
`.gitignore` rule for `.env` files:

```dotenv
TRIMBLE_API_KEY=your-local-trimble-key
ROUTING_PROVIDER=trimble
```

Do not put this key in Dart, Kotlin, Swift, `credentials.properties`, or any
tracked file. Restart the API after changing the provider.

To use the existing HERE calculator again:

```dotenv
ROUTING_PROVIDER=here
```

Optional development settings are:

```dotenv
ROUTING_COMPARE_ENABLED=true
TRIMBLE_REQUEST_TIMEOUT_MS=15000
TRIMBLE_PROFILE_NAME=
TRIMBLE_ROUTE_PATH_ENABLED=false
TRIMBLE_ALTERNATE_ROUTES_ENABLED=false
```

Leave `TRIMBLE_PROFILE_NAME` empty unless the exact profile name already exists
in your Trimble account. SemiTraX sends the explicit truck dimensions without a
named profile, which is safer for a new trial account.

With comparison enabled, an authenticated test client can send the same body
used for `/routing/truck-route` to `POST /routing/compare`. The response keeps
the HERE and Trimble results in separate provider objects and compares mileage,
ETA, geometry, reported restriction notices, and inferred major highways.

## Mapped Trimble parameters

| SemiTraX value | Trimble route-report field | Behavior |
| --- | --- | --- |
| Commercial truck profile | `VehicleType=0`, `RoutingType=Practical` | Fastest and fuel-optimized requests use Practical truck routing; shortest uses Shortest. |
| Height | `TruckCfg.Height` | Converted to decimal inches; accepted range is validated as 5–15 ft. |
| Width | `TruckCfg.Width` | Converted to inches; accepted range is validated as 60–102 in. |
| Length | `TruckCfg.Length` | Converted to decimal inches; accepted range is validated as 8–70 ft. Trimble documents this as trailer length excluding the tractor. |
| Gross weight | `TruckCfg.Weight` | Converted to pounds; accepted range is validated as 1,500–156,470 lb. |
| Axle weight | `TruckCfg.MaxWeightPerAxleGroup` | Converted to pounds; accepted range is validated as 800–45,000 lb. |
| Axle count | `TruckCfg.Axles` | Validated as 2–14. |
| Trailer count/type | `TrailerCfg.Count`, `TrailerCfg.TypeOfTrailer` | Zero trailers maps to none; one or more maps to trailer. |
| LCV | `TruckCfg.LCV` | Enabled for multi-trailer configurations. |
| Hazmat | `Options.HazMatTypes` | SemiTraX categories map to Trimble General, Caustic, Explosives, Flammable, Inhalants, Radioactive, Harmful-to-water, or Tunnel categories. |
| Tolls and ferries | `TollRoads`, `FerryDiscourage` | Existing avoid preferences are preserved. |
| Restrictions | `OverrideRestrict=false` | The adapter never weakens commercial restrictions. |
| Distance and ETA | Mileage report | Normalized to miles and seconds. |
| Maneuvers | Directions report | Normalized to the shared turn-by-turn model. |
| Geometry | GeoTunnel report | Normalized to the shared latitude/longitude geometry. |
| Alternatives | Alternate-route report | Available only when explicitly enabled and entitled. |

SemiTraX does not currently have distinct trailer-only height, weight, or axle
values, so it does not invent values for Trimble `TrailerCfg.MaxHeight`,
`MaxWeight`, or `MaxAxles`. Residential-road, dirt-road, and highway avoidance
preferences do not have an equivalent in the selected Trimble POST route-report
contract; the result includes an explicit limitation notice rather than
claiming they were applied.

## Licensing and operational boundaries

- `TRIMBLE_ROUTE_PATH_ENABLED` is off by default because the RoutePath report
  requires a Maps license.
- `TRIMBLE_ALTERNATE_ROUTES_ENABLED` is off by default because alternate routes
  are a premium add-on and require RoutePath access.
- The REST provider calculates commercial routes and exposes normalized
  directions and geometry. It does not add a licensed native CoPilot guidance
  engine, background voice guidance, or offline navigation.
- HERE Explore and the existing HERE/native files remain intact. HERE native
  turn-by-turn remains fail-closed until HERE Navigate entitlement is available.
- Route responses carry provider provenance. The comparison endpoint never
  splices HERE and Trimble geometries or proprietary attributes together.
- Before displaying Trimble route geometry over a third-party basemap in a
  production release, confirm the permitted display terms in the commercial
  Trimble agreement.

Provider logs include the provider name, route identifier, mileage, duration,
and alternative count. They do not include API keys, credentials, or route
coordinates.
