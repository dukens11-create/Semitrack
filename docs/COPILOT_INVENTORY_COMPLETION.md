# CoPilot first-install inventory verification

The pinned CPIK 10.28.2-497 bridge now reacts to `INSTALLATION_FINISHED` by reading installed inventory immediately, then with bounded backoff (up to seven probes within 90 seconds). `SUCCEEDED` starts the same read-only fallback for runtimes that omit the installation callback. Repeated callbacks do not reset a phase's budget. A later installation-complete callback starts a new bounded phase; neither phase invokes download, cancels a transaction, overwrites maps, restarts the engine, or changes credentials.

Only licensed, unambiguous installed inventory with a valid year, quarter and version confirms selected coverage. Confirmation clears pending/error state and notifies both the open map panel and application-wide status to re-read inventory. The event payload itself is not trusted. Missing or unavailable inventory leaves guidance gated and produces `COPILOT_MAP_INVENTORY_TIMEOUT`; routine status reads can recover later if authoritative inventory appears. Cancellation or a new permitted selection invalidates old scheduled probes. Background reads do not query the native inventory, and returning to foreground retains the existing status-refresh path.

The previous implementation already polled inventory. This change adds immediate callback-driven verification, an explicit retry budget and prompt UI notification; it does not establish why the SDK's original first installation was visible only after reopening.

This publication also includes the previously device-tested AMS readiness repair and automatic coverage selection: constrained ASCII case comparison for the SDK's normalized Device ID, unchanged company/license gates, sanitized readiness reasons, and additive downloads. No device-specific credentials are embedded.

## Validation

- React Native: 914 passed, 58 suites, zero failed/skipped.
- Targeted CoPilot suites: 55 passed.
- Native policy: 20 assertions; readiness: 25 checks; inventory retry policy: 17 checks, all passed.
- TypeScript, lint with zero warnings, native wiring and nine page-size tooling tests: passed.
- Turn-by-turn remains gated pending native truck-profile, route-coverage and guidance/device verification.

## Device acceptance boundary

California 2026 Q3 was previously confirmed in the Samsung test app's real installed inventory after reopening, and survived a second cold launch. That is restoration evidence, not first-install-without-reopening evidence for this change.

Fresh first-install device acceptance is **PENDING**. The owner has no additional authorized device and explicitly requires preservation of installed California maps and both existing apps. Do not delete maps, clear app data, uninstall either package, copy credentials to another profile, or create a second licensed identity to manufacture a clean test. A future authorized clean installation must show the actual installation callback, bounded inventory reads, transition to Installed in the same process, and matching provider inventory. Unit fixtures are not device acceptance.

The test update uses the existing test package/certificate. It is not a production release signature. Native vendor libraries, routing restrictions and dependencies are unchanged. Existing GNU_RELRO arithmetic findings remain documented separately; no new 16 KB runtime acceptance is claimed.
