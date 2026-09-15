# CoPilot iOS delivery gate

The official Android npm package does not contain the iOS bridge, a podspec, or
iOS SDK binaries. This Xcode project still builds the migration foundation;
CoPilot has not been linked or initialized on iOS.

Obtain the matching, licensed delivery from Trimble. The current
[official iOS platform guide](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/react-native/platform-setup-guide/ios-guide/)
requires `CoPilotIntegrationKit.framework`, `CPIKReactNative.framework`, and the
delivered resource bundle(s). Its current RN note is 0.85; older setup examples
on that page must not replace this project's RN 0.85.0 configuration.

On the Mac build host, point `SEMITRAX_COPILOT_IOS_SDK_DIR` at the delivered
`Resource/ios` directory containing `framework/` and `resources/`. Run
`npm run copilot:check` to inventory the framework executables and bundles.
This command does not copy, link, activate, or certify the SDK, and intentionally
returns failure while the integration blockers recorded in it remain unresolved.
If Trimble supplies a different layout or XCFrameworks, review that delivery and
update the inventory; do not rename incompatible binaries to satisfy the check.

Once the actual delivery is available, inspect framework versions, minimum iOS
version, device/simulator slices, static/dynamic linkage, embedded dependencies,
privacy resources and signing requirements. Add the real frameworks and bundles
to the SemiTrax target using that delivery's instructions; embed/sign only the
frameworks that require it. Confirm RN/New Architecture compatibility before
enabling the bridge. No empty frameworks or speculative pod download URLs are
included. A private local copy may use ignored `ios/copilot-vendor/`.

Use native Keychain/provisioning for licensing material. Do not store AMS
credentials, activation keys, or map staging keys in JS, checked-in files or
build logs. Preserve the existing background location capability and debug
bundle identifier. Validate foreground startup, permissions, real truck/region
entitlements, installed maps, actual truck route calculation, CoPilotView,
voice and lifecycle behavior on devices before enabling guidance.

See `../COPILOT_INTEGRATION_AUDIT.md` for the audited APIs and parity blockers.
