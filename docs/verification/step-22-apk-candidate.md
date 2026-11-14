# Step 22 — Test APK candidate (not production acceptance)

Status: Partially Fixed / release blocked.

Full mobile validation found two hardcoded fourteen-day subscription badges contradicting the seven-day shared catalog. The badges now use pricing.trialDays; day/night regressions require matching seven-day terms.

Local verification: TypeScript and ESLint passed, all 75 suites / 1,020 mobile tests passed. Native contract check reached the private licensed CoPilot package and stopped because that package is absent locally. It is not stubbed or bypassed; CI must restore the authorized SDK and run the unchanged full check before building.

An isolated codex/apk-candidate-repair-20261110 branch is added to the existing workflow push list to request a test APK. The repair branch remains excluded. Existing persistent signing, package identity and certificate checks remain unchanged. No production deployment, app uninstall, data clearing or map deletion is authorized by this build.

This is a Test 392 debug APK, not a signed production release candidate. Physical Android acceptance is still pending for truck restriction readback, Start/Resume/End, GPS, speaker/Bluetooth, rerouting, lifecycle and offline-map preservation. Satellite/offline destination search, provider-dependent live data, store billing, driver-linked ELD and web route planning remain incomplete or unverified. Residual dependency findings remain unresolved. Never label this APK release-ready or all 22 steps complete.

Files changed: apps/mobile-react-native/src/screens/SubscriptionScreen.tsx; apps/mobile-react-native/__tests__/subscription-plans.test.tsx; .github/workflows/original_semitrax_copilot_apk.yml; docs/verification/step-22-apk-candidate.md.
