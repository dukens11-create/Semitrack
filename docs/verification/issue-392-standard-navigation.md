# Standard semitrailer navigation integration

This change uses SemiTraX controls and Trimble's existing embedded routing engine.
It is a limited CoPilot 11.3 mode, not an implementation of the new 11.4 trailer-count
and separate overall-length controls. Those fields remain explicitly unverified.

## Evidence and scope

- The supplied React Native package identifies itself as 11.3.0-2016; the Java API
  exposes height, width, length, total weight, and weight per axle group.
- The supplied sample's `Util.getRoutingTypeFromString('PRACTICAL')` maps to
  `RoutingType.QUICKEST`. This is checked against the real SDK, not an invented enum.
- Trimble documents 53-foot semitrailer routing before 11.4, including CPIK:
  https://developer.trimblemaps.com/copilot-navigation/release-notes/v10_26/
- The new 11.4 fields are distinct capabilities:
  https://developer.trimblemaps.com/copilot-navigation/feature-guide/operating-features/vehicle-routing-profile/?copilot-version=v11
- `NO_PREVIEW` is the documented mode for adding a trip without opening the SDK preview:
  https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/routemgr/

The app accepts only a saved, server-verified default truck with one 53-foot dry van
or reefer, a day-cab/sleeper tractor, five axles, height at most 13 ft 6 in, width at
most 102 in, maximum routing weight at most 80,000 lb and axle-group weight at most
34,000 lb. This is not permit/oversize routing. The maximum saved weight is used
conservatively even when current load weight is lower. Hazardous cargo, strict
unsupported avoidance preferences, different trailer configurations and unknown
new truck-model fields remain blocked. No saved settings are silently changed.

## Runtime controls

1. Convert the saved dimensions to inches without rounding downward.
2. Read the active native fleet-origin Heavy Duty profile and require matching
   dimensions, axle-group weight, Practical routing, no hazmat and matching toll use.
3. Require an explicit driver confirmation explaining the limited 11.3 mode.
4. Recheck the saved truck and native profile after confirmation and before submission.
5. Reject changed native profiles before/during calculation; monitor the accepted
   profile and prerequisites during the session and pause guidance on changes.
6. Wait for correlated stop and route-calculation callbacks before opening the
   SemiTraX live screen. A route preview or successful API submission is not proof
   that calculation completed. Display controls do not resume guidance.

This does not assert that the native SDK read back trailer count, overall length,
or axle count. Driver-supplied configuration eligibility and actual native field
readback are different evidence. A driver must not select this mode when the
additional unavailable controls are required for the trip.

## Validation limits

Unit/native-double tests cover supported input, unsupported input, dimensions,
preferences, fleet origin, confirmation, profile mutation, callback correlation,
cancellation, and failed starts. The Java helper compiles against the supplied SDK.
A signed APK build and a parked-device test of the actual downloaded fleet profile
are required before treating the integration as working on the phone. Road testing
of voice instructions and rerouting remains separate; mocks cannot prove it.
