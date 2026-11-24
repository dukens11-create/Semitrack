# Truck profile configuration and routing trace

All 13 existing fields, hazardous goods and avoidance flags remain. No database, API contract, vendor, ABI or routing-provider changes are required.

## Driver workflow

Create, edit or duplicate a profile; choose equipment; enter actual dimensions/weights; Review truck profile; check all values and the acknowledgement; Confirm & Use. Set Active also opens the same review. Delete requires confirmation. The existing API refuses deletion of the last profile, so this restriction is shown explicitly.

Confirmation is session-local and tied to the exact server-returned profile. A legacy default is not automatically verified. Refreshes preserve confirmation only while all reviewed values still match. Editing/deleting the active profile invalidates routing; sign-out clears confirmation. A newly created or duplicated profile cannot route until confirmed. Saved profiles remain on the backend between sessions.

## Equipment and suggestions

Day Cab, Sleeper Cab, Straight / Box Truck, Dump Truck and Custom are equipment descriptions, not new Trimble vehicle enums. All continue to route as VehicleType=0 (Truck), Practical truck routing. Each commercial trailer body maps to TypeOfTrailer=3 when count>0. No Trailer requires count=0 and maps to 1. RV/caravan descriptions are rejected because the existing backend substring mapper would select TypeOfTrailer=2. Custom non-standard commercial equipment remains editable within the provider limits; this does not authorize oversize/permit routing.

Only nominal trailer length suggestions are populated, and only after an explicit tap. Manufacturer sources verified on 2026-09-12:

- Dry Van 28/48/53 ft: https://greatdane.com/champion-dry-vans/
- Reefer 28/36/48/53 ft: https://greatdane.com/refrigerated-foodservice-trailers-truck-bodies/
- Flatbed 28/45/48/53 ft: https://greatdane.com/freedom-flatbeds/steel-flatbed-trailer/

Other types and straight trucks require custom measured length; a box-body length is not automatically a full straight-truck length. Height, width, weights and counts are never inferred from equipment choice. Changing equipment does not silently overwrite measurements. Suggested length remains editable and requires final verification.

## Exact existing data path

TruckProfileScreen -> TruckProfileStore -> POST/PATCH /trucks -> Prisma Truck fields. Confirm & Use -> POST /trucks/:id/default -> re-fetch and verify exact values -> trucks.selected. PlanningScreen reads only trucks.selected; onChange clears routes. TruckRoutingService -> serializeTruck(profile,true) -> POST /routing/truck-route -> server routeSchema -> buildTruckRoute -> TrimbleRouteProvider -> buildTrimbleRouteRequest.

| RN/API field | Existing Trimble mapping |
| --- | --- |
| heightFt | TruckCfg.Height = feet * 12, decimal inches; Units=0 |
| widthFt | TruckCfg.Width = feet * 12, decimal inches |
| lengthFt | TruckCfg.Length = feet * 12; trailer length, or full straight-truck length |
| weightLbs | TruckCfg.Weight = rounded gross pounds, unchanged |
| currentWeightLbs | Saved and sent to API, but NOT consumed by the existing Trimble adapter. UI explicitly explains Gross Weight is used; no current weight inferred. |
| weightPerAxleLbs | TruckCfg.MaxWeightPerAxleGroup, pounds; not an axle average |
| axleCount | TruckCfg.Axles |
| trailerCount | TrailerCfg.Count; TruckCfg.LCV=true when >1 |
| trailerType | None (1) or commercial Trailer (3); body style does not have a separate specialized routing enum |
| tractorType, name, unitNumber, trailerNumber | Saved identifiers; omitted from route payload |

Activation validates the actual current provider limits: height 5–15 ft, width 5–8.5 ft, routing length 8–70 ft, gross 1,500–156,470 lb, optional axle-group 800–45,000 lb, axles 2–14, trailers 0–4 (existing SemiTraX API range). Out-of-range custom measurements are rejected without clamping or changing the original stored profile. Current weight still cannot exceed gross weight.

Primary provider reference: https://developer.trimblemaps.com/restful-apis/routing/route-reports/post-route-reports/

## Limits of verification

Tests verify RN serialization against the actual existing backend Trimble request builder without sending a live route or using credentials. No database is contacted or migrated. Existing backend ProfileName and any provider defaults remain unchanged; a live route is not proof of permits, full restriction coverage, or CoPilot navigation. CoPilot CPIK lifecycle is unchanged.
