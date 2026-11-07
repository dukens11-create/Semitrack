# Step 1 — Truck profile and axle validation

Status: Partially fixed; native acceptance blocked. No release approval implied.

## Repository and baseline

Android: `dukens11-create/Semitrack`, `apps/mobile-react-native`.
Backend: same repository, `apps/api`.
Website: `semitrack00-sys/Semitrax-web` (separate website, not the native driver app).
Baseline: `fix/392-standard-truck-navigation` at `baefbb4fc32ff608137a0ef9e5da1a874f83fc7f`.
This is a stacked change against the current CoPilot repair branch, not the older Flutter default branch.

## Diagnosis

TruckProfileScreen -> parseTruckForm -> truckSchema/serializeTruck -> truck API persists the actual profile. HybridControls -> standardTruckRequest -> CoPilotHostModule.verifyStandardTruckProfile -> CoPilotStandardTruck compares the active FLEET_PORTAL profile's dimensions, gross weight, weightPerAxle, Practical routing, hazmat and toll preference. Acceptance is separately required and a profile snapshot is rechecked.

The generic NativeGuidanceAdapter/assessCopilotTruckProfile path deliberately always rejects with TRUCK_RESTRICTIONS_UNREPRESENTABLE. The Hybrid path is separate and supports only the existing limited single 53-foot semitrailer mode with five axles. Neither path currently applies a locally created native profile. Therefore a saved profile alone does not prove engine configuration.

Confirmed defects corrected here:

- Missing axle-group weight was optional in the PC*Miler request builder. It could omit MaxWeightPerAxleGroup and rely on provider defaults. Route construction now rejects null/undefined before a provider request, with an actionable client message.
- Exact whole-inch measurements converted to decimal feet and back could be rounded upward by an extra inch due to floating-point noise. Conversion now removes only machine-precision noise; genuine fractional inches still round upward.
- Missing measured axle weight and unsupported native fields shared one generic error. The assessment now separates missingFields from unsupportedFields and emits TRUCK_PROFILE_INCOMPLETE for missing weight without changing the truck.

Profile storage remains compatible: an incomplete profile can be saved, but cannot be routed through this Trimble request builder. No missing weight is inferred from total weight or axle count.

## SDK evidence and unresolved mapping

The source targets CPIK 11.3.0.2016 and React Native 0.85.0. This is not a claim about the binary currently installed on the phone. The licensed vendor directory is absent from this workspace.

Official CPIK documentation exposes VehicleDimensions length, width, height, totalWeight and weightPerAxle, with explicit unit objects:
https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/routemgr/

REST truck parameters and the embedded SDK are different contracts; REST axle/trailer count and split-length support cannot be copied into CPIK as invented setters.
https://developer.trimblemaps.com/restful-apis/developer-guide/how-to-guides/set-vehicle-dimensions/

Finn's October 30 clarification describes vehicle-type-associated trailers and local CPIK profiles, but it does not supply runtime evidence that the current saved equipment maps to the active native profile. His November 3 recommendation concerns V10/V11 authentication and a fresh licensed asset. This change does not log out a device, create an asset, reassign licensing, delete data, or send email.

Remaining blockers:

1. Obtain/build against the licensed v11 package and validate native signatures and vehicle-type semantics, especially legacy length and weightPerAxle versus axle-group meaning.
2. Authenticate the physical Android installation and verify its assigned vehicle/group/license without clearing app data.
3. Implement and verify a supported local profile application path or verify the matching assigned fleet profile; retain unsupported avoidance/hazmat/oversize restrictions as blockers.
4. Physically save, reload, apply, read back, start commercial routing, then change one restriction and verify the previous acceptance is invalidated.
5. Database-backed API tests need the test database; unit tests do not establish persistence behavior on production.

## Android acceptance procedure

While parked, record application ID, signing certificate, runtime SDK version and installed map inventory. Save actual truck measurements, counts, axle-group weight and avoidance settings. Restart and compare saved values. Compare each supported native readback field and vehicle type; reject mismatches. Verify missing weight, unsupported restrictions and altered profiles block start. Calculate a representative truck route and verify engine acceptance and active commercial profile. Repeat without internet inside installed coverage. Do not uninstall, clear storage, alter dimensions to fit, or delete/re-download maps.

## Rollback

Unmerged draft: close the PR; no running service is changed. After any separately approved deployment, revert this commit and rerun tests. Reverting restores the prior missing-weight behavior and must not be represented as safe routing acceptance. No data migration, billing change, map change or credential change is included.

## Verification results

- Mobile TypeScript: passed.
- Full mobile Jest suite: 72 suites / 984 tests passed before the final additional error regression.
- Final targeted profile suite: 3 suites / 94 tests passed, including that additional regression.
- API build and suite: 322 passed, 43 skipped (database-dependent), 0 failed.
- Licensed Android compilation and physical device checks: not run; SDK/device unavailable.
- Mobile dependencies were installed in an isolated test environment without the proprietary SDK; no SDK double counts as native acceptance.

## Exact changed files

- `apps/api/src/services/providers/trimbleProvider.ts`
- `apps/api/test/trimbleLineMetrics.test.ts`
- `apps/api/test/trimbleProvider.test.ts`
- `apps/mobile-react-native/__tests__/copilot-p0.test.ts`
- `apps/mobile-react-native/__tests__/truck-units.test.ts`
- `apps/mobile-react-native/src/errors/driverErrors.ts`
- `apps/mobile-react-native/src/features/routing/routeDiagnostic.ts`
- `apps/mobile-react-native/src/services/copilot/CopilotConfiguration.ts`
- `apps/mobile-react-native/src/services/copilot/CopilotTruckProfile.ts`
- `docs/verification/step-01-truck-profile-validation.md`
