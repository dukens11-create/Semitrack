# Edited truck activation — November 17, 2026

## Reproduced defect and correction

The truck list's Set Active button passed the saved card snapshot into the review dialog even when that same truck was open in the editor. Confirm & Use then selected the old snapshot without PATCHing the edited fields. In the regression, editing three axles/two trailers to five axles/one trailer produced no PATCH before the fix.

Set Active now reviews the open form when it belongs to that truck, uses the existing validation and explicit acknowledgement, saves the reviewed values, and verifies the saved revision before activation. It is enabled for an open edit of the currently active truck. Invalid edits stay in the form and cannot silently activate the old copy through this button. No equipment values, weights, or road preferences are inferred or changed automatically.

## Validation

- Regression failed against the original implementation because no PATCH was sent.
- All 23 truck-profile tests passed after the correction, including both new regressions.
- TypeScript and full ESLint with zero warnings passed.
- All 76 mobile suites / 1,048 tests passed.
- Native wiring checks, Java handoff/profile helper tests, and start-attempt tests passed. These are not Android device validation.
- git diff --check passed.

## Evidence and remaining limits

Render's live deployment is 42416acc5d7b675447c986ee5a31004413a27303 from October 17. Request logs in the reported November 14 session include successful truck PATCH and verification requests. They do not contain the submitted field values, so they do not prove this reproduced UI defect caused the user's particular failure. No live account or deployment was modified.

The latest provided phone report still blocks before native handoff with unsupported trailer/axle counts, missing axle-group weight, and unsupported residential/dirt avoidance. This correction prevents one path from dropping edited counts; it does not remove those gates, populate missing weights, implement general truck support, or transfer the saved truck into CoPilot. The current native verifier remains read-only and limited to the standard single 53-foot mode. Physical confirmation, native guidance, and the broader 22-area repair remain incomplete.
