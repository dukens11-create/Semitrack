# Start rejection investigation — build 144

## Evidence and limits

The supplied device report identifies commit 818d1cec4d6f0656ce5194969c6ed8192f60c5ef.
Engine initialized, licenses/maps ready, ready-to-add-stops and GPS are true.
START_RESUME reaches VALIDATING and fails with STANDARD_TRUCK_SCOPE; no
NATIVE_CALL stage occurs and the SDK has no destination. This establishes a
JavaScript profile-validation failure, not an engine startup failure.
The current diagnostic format did not record which fields failed. It cannot
establish the exact remaining fields after the user's subsequent edits.

## Traced execution

1. Start rechecks lifecycle readiness.
2. synchronizeHybridTruck reads the selected server-verified profile.
3. standardTruckRequest validates the saved profile and limited supported mode.
4. Only after step 3 succeeds does verifyStandardTruckProfile compare the active
   native fleet profile. Despite the previous button label, this is read-only.
5. Driver confirmation, native profile acceptance, stop handoff, calculation,
   and guidance resume happen later. They are not reached in the supplied failure.

The save path sends the edited values, refreshes the server record, checks its
revision/fingerprint, verifies it, and reloads the selected profile. No observed
code path automatically substitutes the confirmed chat values for phone values.
New profiles default residential/dirt avoidance to true, while the limited
native mode rejects those options. Existing choices must not be silently erased.

## Reproduced failures

The previously supplied profile (3 axles, 2 trailers, absent axle-group weight,
residential and dirt avoidance enabled) produces exactly five blockers and never
calls the native verifier. Changing counts to 5/1 removes only the count blockers;
the other three remain. A supported complete fixture does reach the verifier.
Tests also verify that rejected validation does not mutate saved truck data.

## Corrections

- Introduce fixed field-level blocker codes without profile values or identifiers.
- Preserve those codes in sanitized diagnostics; discard arbitrary strings/objects.
- Classify invalid schema/unknown fields as SAVED_TRUCK_INVALID rather than falsely
  labeling all Error instances STANDARD_TRUCK_SCOPE.
- Clear the last failure when the same action succeeds; unrelated successful
  actions do not hide it. Snapshot arrays are copied to prevent mutation.
- Rename Synchronize truck with engine to Check truck against engine profile and
  explain that it does not copy settings or modify the assigned fleet profile.

Validation: TypeScript, zero-warning lint, 76 suites / 1,037 tests, bridge/source
checks, tooling and native Java helpers passed locally. This is not a new device
acceptance result. No safety gate, saved value, SDK API, credential, map or license
was changed. No new APK is claimed for this source-only follow-up.

## Remaining implementation boundary

Actual navigation for additional trucks requires explicit vehicle classes,
separate maximum-straight and bumper-to-bumper dimensions, trustworthy weight
provenance/preset selection, verified native profile application or matching,
and a supported policy for each required road preference. Removing the current
check without implementing those contracts would discard restrictions. Build
144 remains limited; its successful build did not establish universal truck
support or resolve the supplied profile's Start rejection.


## Follow-up: complete 11.4 standard-profile readback

The old native verifier compared deprecated length but did not compare trailer count
or maximum straight length. It could therefore accept inconsistent native routing
fields. Verification now also requires one native trailer, 636-inch maximum straight
length, and a reported bumper-to-bumper length at least as long as the trailer.
The last condition establishes a usable readback, not a measurement of the driver's
vehicle. The driver must review the displayed overall length against the vehicle.

The pre-navigation review now includes both length fields, trailer count, and
axle-group routing weight, distinguishing routing values from measured load weights.
Incomplete readback cannot reach confirmation. Behavioral tests reject conflicting
native trailer/length fields and invalidate acceptance when overall length changes.

Validation: full mobile check passed (76 suites, 1,043 tests), TypeScript,
zero-warning ESLint, native source/codegen and tooling, Java helper tests. The actual
CoPilotStandardTruck and CoPilotFleetProfiles classes also compiled against the
licensed 11.4 classes.jar. This is not Android APK compilation or device acceptance.
No APK was generated for this source follow-up. Saved-profile synchronization remains
unimplemented; no native setter, fleet overwrite, or restriction removal was added.

SDK review confirms createNewProfile and setActiveVehicleRoutingProfile exist;
setVehicleDimensions returns per-field modification results that must be checked.
A complete transfer must model explicit maximum-straight and bumper-to-bumper length,
weight provenance/routing-limit consent, and supported restrictions, then verify
all effective fields after activation. The existing single length field must not be
silently reused as the combination length. Unsupported avoidance preferences still
cannot be silently disabled. This work does not certify all truck configurations.

Primary API reference:
https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/routemgr/
