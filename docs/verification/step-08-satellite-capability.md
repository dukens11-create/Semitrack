# Step 8 — Satellite mode

Status: Partially Fixed (misleading setting corrected); native satellite activation blocked.

Root cause: Settings offered an enabled Satellite map toggle, while the mounted CopilotPlannerMap path explicitly rejects satellite requests. The stored preference did not enable satellite imagery in that renderer.

Correction: replace the unsupported toggle with clear availability text. Preserve saved preferences and working camera controls. No replacement renderer, SDK upgrade or invented method was introduced.

Files changed:
- apps/mobile-react-native/src/screens/SettingsScreen.tsx
- apps/mobile-react-native/__tests__/settings-hub.test.tsx
- docs/verification/step-08-satellite-capability.md

Tests: 20 settings tests passed; TypeScript typecheck passed; diff whitespace check passed after cleanup.
Android verification: pending.

Official documentation checked November 7, 2026:
- https://developer.trimblemaps.com/copilot-navigation/feature-guide/copilot11-integration-guide/ confirms CoPilot 11 has satellite rendering resources.
- https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/mapdrawer/ documents the map interface; no satellite activation method was found on that page.

This is not evidence that Trimble lacks satellite support. Exact activation/readback API compatibility with the installed 11.3.0.2016 binary, imagery entitlement, online behavior, route/position synchronization and native device behavior remain unverified. The private SDK package is available to CI but not this workspace. Do not enable an assumed constant or substitute an unrelated web SDK API.

Branch: codex/step-08-satellite-capability, stacked on codex/step-07-reroute-confirmation.
Next: Step 9 — Offline maps and offline destination search.
No new APK build requested.
