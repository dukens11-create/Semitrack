# Step 10 — Camera, compass, zoom and orientation

Status: Partially Fixed.

Root causes: North-up sent only setMapOrientation even when the map was 3D, which the documented SDK contract says remains heading-up. Recenter discarded the boolean result of lockToChevron and reported success with no lock.

Correction: explicitly switch to 2D without SDK widgets before setting north-up. Recenter rejects when lockToChevron returns false, using the existing safe map-command failure path. Guidance and truck settings are unchanged.

Files changed:
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/CoPilotCameraCommands.java
- apps/mobile-react-native/android/app/src/main/java/com/semitrax/nativebridge/CoPilotHostModule.java
- apps/mobile-react-native/scripts/test-hybrid-handoff.cjs
- docs/verification/step-09-offline-search.md
- docs/verification/step-10-camera-controls.md

Tests: Java production helper contract tests passed (3D to north-up, unavailable chevron rejection, available chevron success), together with existing handoff/profile/calculation harness. Uses SDK doubles. Full Android compile not run; APK builds deferred per user instruction.

Official API evidence:
https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/mapdrawer/
Uses existing documented setMapView, setMapOrientation and lockToChevron APIs.

Android verification pending: manual pan/recenter, stationary/no GPS, 3D→north-up→heading-up, min/max zoom, portrait/landscape and foreground/background. Existing zoom commands delegate bounds to SDK. Smooth rendering and real vehicle-follow require the licensed device.

Branch: codex/step-10-camera-controls, stacked on codex/step-08-satellite-capability.
Next: Step 11 — Traffic.
