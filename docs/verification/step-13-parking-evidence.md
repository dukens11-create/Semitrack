# Step 13 — Fuel prices and parking

Status: Partially Fixed.

Root cause: parking presentation accepted any string value with a source/timestamp, without requiring a recognized source or distinguishing community estimates.

Correction: accept only PLENTY/SOME/ALMOST_FULL/FULL from OFFICIAL_LIVE or COMMUNITY with fresh evidence. Label provider reports separately from community estimates; invalid, stale and expired reports remain UNKNOWN.

Fuel inspection: currentDieselPrice already requires verified timestamped USD/US_GALLON diesel with finite expiry; display and candidates reject nonpositive/nonfinite prices. Provider interfaces exist in apps/api/src/services/providers/dataProviders.ts, but interfaces are not proof of active authorized integrations.

Files changed:
- apps/mobile-react-native/src/features/poi/parkingStatus.ts
- apps/mobile-react-native/src/features/dot511/CorridorRecords.tsx
- apps/mobile-react-native/__tests__/parking-evidence.test.ts
- docs/verification/step-13-parking-evidence.md

Tests: 21 targeted parking/evidence tests passed; TypeScript passed.
Android: pending.
Remaining blockers: authorized live fuel/parking feed ingestion, credentials/entitlements and regional coverage have not been verified. No fabricated prices/availability or production configuration changes. This UI correction does not activate a provider.
Branch: codex/step-13-parking-evidence, stacked on codex/step-12-poi-cache.
Next: Step 14 — Weigh stations and restrictions.
No APK build requested.
