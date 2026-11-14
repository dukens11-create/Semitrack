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
