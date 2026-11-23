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
