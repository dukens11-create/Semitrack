# Step 14 — Weigh stations and restrictions

Status: Partially Fixed.

Root cause: stationStatus honored report age but ignored explicit expiry/end/start validity windows if supplied.
Correction: apply the common evidence validity gate while retaining recognized official/community sources, known statuses and the existing 15-minute maximum age. Expired evidence displays UNKNOWN. No bypass advice, truck settings or routing restrictions changed.

Files changed:
- apps/mobile-react-native/src/features/poi/stationStatus.ts
- apps/mobile-react-native/__tests__/station-expiry.test.ts
- docs/verification/step-14-station-expiry.md

Tests: 29 station/navigation tests passed; TypeScript passed.
Android verification: pending.
Remaining blockers: authorized live station-status coverage, installed native category verification, actual clearance/weight/hazmat route acceptance and real exit information. The API currently aggregates community reports; labels do not certify a station's present operations. No unverified bypass recommendations were introduced.
Branch: codex/step-14-station-expiry, stacked on codex/step-13-parking-evidence.
Next: Step 15 — Weather and route risk.
No new APK build requested.
