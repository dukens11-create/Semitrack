# Test 392: native startup visibility

Phone screenshots after build 141 show the Trimble EULA under planning overlays,
with COPILOT_NOT_READY at ready-to-add-stops. Login SUCCESS and SDK device readback
MATCH do not establish route readiness or EULA completion.

The planner now displays an unobstructed native setup area when the existing
licensed-map rendering gate permits mounting but the SDK is not ready to add stops.
Planner controls, route drawing and marker mutations wait for route readiness.
An explicit Check readiness action uses the existing recheck path; it does not
restart the engine, accept terms, alter credentials, or reset licensing/maps.

Enrollment comparison labels now distinguish an absent/unreported assignment
reference from an actual mismatch. The shared sanitized diagnostic report retains
these nonsecret reference-presence fields. No IDs are added to reports.

Local validation: TypeScript, zero-warning ESLint, 76 suites / 1,024 tests,
Android/iOS bridge code generation/source wiring, page-size tooling and Java
handoff/start helpers passed. Native APK compilation and physical acceptance of
this change remain pending at commit creation. Build 141 predates this correction.

Parked acceptance: confirm the Trimble setup view is unobstructed; review and
complete any vendor prompts yourself; tap Check readiness; confirm planner controls
only return when the SDK reports ready-to-add-stops. If still blocked, share the
sanitized diagnostics including build identity, lifecycle, route engine and login
trace. Do not change assigned IDs based on a comparison marked Not evaluated.
Do not uninstall, clear data, reset licenses, or relax truck restrictions.
