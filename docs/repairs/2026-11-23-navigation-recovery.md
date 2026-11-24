# Navigation recovery repair

This change addresses four findings from the November 23 investigation:

- A failed authenticated truck refresh blocks navigation but retains the last confirmed identity for reconciliation. A successful refresh restores only the matching, server-verified profile. Changed profiles and logout invalidate that recovery.
- Native map snapshot reads time out after ten seconds. Polling can resume; late results from the timed-out request cannot overwrite the recovered sample. This is read-only recovery, not automatic route/profile mutation retry.
- A missing axle-group measurement can use the existing standard 34,000 lb routing preset only after an explicit planning prompt. The request carries acceptance separately from measurements. The API checks the saved verified profile and restricted standard-mode eligibility, then applies the preset to the provider request without changing the saved profile. Measured values, other equipment, hazardous cargo and incompatible preferences are never silently replaced.
- Start reports an expired/missing route instead of silently returning.

## Rollout

Deploy the API and mobile changes together. An older API safely rejects the missing measurement; it does not understand the new request-scoped preset acceptance. No database migration is required. Existing profile revision checks before and after provider calculation remain in place.

This change does not certify physical guidance, background GPS, all truck configurations, offline startup/search, provider feeds, purchases or ELD. It does not fix the separate native display-command queue or provision fleet assignments. No production deployment or new APK is implied by a source commit.

## Verification

Run the API suite, mobile typecheck, mobile Jest suite and lint on changed mobile files. Added cases cover explicit preset acceptance/cancellation, preservation of measured fields, incompatible presets, recovery after timeouts, changed profiles/logout, and delayed native snapshots. Database-dependent API tests still require an isolated database. Physical phone checks remain required before release.

## Foreground GPS recovery follow-up

Returning to the foreground explicitly refreshes the app location subscription even if its previous state still said tracking. The restart rechecks permission without a new permission prompt, clears the old fix, and preserves the service's existing background intent. Initial map opening retains the non-restarting behavior. This does not enable background tracking or alter CoPilot's separate GPS source.

Validation: mobile typecheck and 80 Jest suites / 1,077 tests pass, including resume after a silent subscription and revoked permission. The preceding API/mobile repair passed APK CI run 45290698050 (build 152). This follow-up still requires its own Android build and physical-device acceptance.

## Native display acknowledgement follow-up

Appearance, route-preview, marker and map-control acknowledgements now have ten-second deadlines. A lost preview acknowledgement no longer holds follow-position and markers indefinitely. Calls are not replayed automatically; an appearance timeout never claims readiness. Android still owns serialized main-thread execution, and a blocked SDK/main thread cannot be repaired by a JavaScript deadline alone. Tests cover a late preview response and a missing appearance response.
