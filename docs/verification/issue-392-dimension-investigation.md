# Build 149 device failure: truck dimension comparison

## Evidence and boundary

The November 21 device report identifies commit d038b271ba536f4ff15ebf948b69731d58ea4436. Start fails twice during validation with TRUCK_DIMENSIONS_MISMATCH. Engine initialization, maps and navigation/truck licensing report ready. GPS reception is true and hasDestination is false. This establishes a profile-validation failure before guidance; it does not establish current map-follow freshness, a network failure, or a license failure.

## Confirmed code findings

1. synchronizeHybridTruck is read-only despite its internal name. It builds the standard request from the selected verified SemiTraX profile and calls verifyStandardTruckProfile. It does not set or copy a CoPilot profile. Editing the saved profile alone cannot guarantee native equality.
2. CoPilotStandardTruck compared eight fields in one condition: height, width, legacy length, maximum straight length, trailer count, bumper-to-bumper minimum, total routing weight and axle-group routing weight. Every difference had one code and no field/value evidence. The existing report cannot identify which comparison failed.
3. A missing nested native dimension previously dereferenced null and could be reported as a generic recheck instead of identifying unavailable readback.
4. Navigation instructions still described a mandatory assigned fleet profile after build 148 accepted valid default/manual/API heavy-duty profiles. Corrected the copy to active heavy-duty CoPilot profile.
5. Height and width use conservative feet-to-inches conversion; standard length is 636 inches. The reported conventional 13.5 ft / 8.5 ft / 53 ft values convert to 162 / 102 / 636. This is not evidence that the current selected profile or native values actually equal those numbers.
6. Total routing weight comes from saved gross weight. Missing axle-group measurement uses the disclosed 34,000 lb standard routing value. Neither the current report nor the screenshots includes native readbacks. Do not infer a specific weight mismatch or replace actual measurements.

## Correction

Preserve every comparison and explicit acceptance gate. Collect every failed field with required and actual values, using null for absent readback and an explicit minimum comparator for bumper-to-bumper length. Return structured native error userInfo. Render units and values in the error and include only allowlisted, bounded numeric comparison fields in shared diagnostics. Never include profile names, account identifiers, coordinates or raw exception strings. Copy diagnostic arrays/rows defensively; clear old differences on a later failure.

No profile setters, auto-selection, tolerance widening, new truck configurations, licensing changes, or production deployment are introduced. The diagnostic explicitly states that checking does not copy settings. This corrects the inability to diagnose the mismatch, not the unknown phone-specific mismatch itself.

## Evidence required next

Read the new per-field comparison from the phone. Check any legacy length versus maximum-straight-length discrepancy against the licensed 11.4 implementation before changing mappings. Do not assume trailer length is overall combination length. If native settings are genuinely wrong, correct the active heavy-duty profile to the actual truck, then rerun verification and explicit confirmation. Confirm destination creation and guidance independently afterward. GPS reception alone does not prove moving-map behavior.

## Reference

https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/routemgr/ documents active profile get/set, integer inches and pounds, and the older 53-foot NA profile example. Its public VehicleDimensions table omits the newer maximum-straight-length and bumper-to-bumper accessors; it cannot alone establish equivalence of those fields in 11.4.

## Tests

Native regression cases cover simultaneous height/weight differences, absent nested dimensions, completely absent dimensions, unchanged acceptance gating and recovery. TypeScript cases cover actionable units/minimum/missing readback, diagnostic copy isolation, stale difference clearing, unknown fields, nonnumeric/nonfinite values and older APK fallback. Full CI must additionally compile against the licensed SDK before APK delivery. Physical-device verification is outstanding.
