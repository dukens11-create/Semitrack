# Standard truck profile provenance correction

A device on build 147 reached native validation but failed FLEET_PROFILE_REQUIRED.
The standard verifier reused the fleet-picker predicate, rejecting any profile
whose source was not FLEET_PORTAL before checking its dimensions.

Trimble documents DEFAULT, MANUAL, API and FLEET_PORTAL as profile origins, not
as truck capability levels. RouteMgr.getVehicleRoutingProfiles includes default,
local and API profiles. Sources:
- https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/routemgr/
- https://developer.trimblemaps.com/copilot-navigation/feature-guide/operating-features/vehicle-routing-profile/

Standard-mode validation now accepts these known origins only for an active
TRUCK_HEAVY_DUTY profile. All dimension, weight, trailer, routing, hazmat and toll
checks remain unchanged. Confirmation and profile-change detection still apply.
No profile is created, modified or automatically selected. The assigned-fleet
picker remains fleet-only and preserves assigned profiles intact.

Regression coverage accepts all four origins with matching values, rejects each
with mismatched dimensions, rejects null source/profile and passenger-car type,
and invalidates confirmation after source changes. Existing preference, axle
weight, route and fleet-selection tests remain required.

Local syntax and whitespace checks passed. Full tests and licensed SDK compilation
must pass in the candidate APK workflow before distribution. Phone guidance and
the reported frozen-map behavior are not verified by this correction. If no active
heavy-duty profile exists, select the matching profile in native Truck settings;
it must pass actual readback checks before guidance can start.
