# Device license activation from SemiTraX React Native

Open the CoPilot status bar → Details → Device license activation. Enter the Company ID and Device ID for an assigned Account Manager asset, then select Open CoPilot to activate. CoPilot GPS must be installed on that physical phone.

The app stores these identifiers in a separate device-only Keychain/Keystore service. They are not embedded in shared application builds or logged. Use a different assigned asset for every physical device.

The button uses the documented standalone activation protocol:
https://developer.trimblemaps.com/copilot-navigation/feature-guide/advanced-features/url-launch/

An accepted URL launch only opens CoPilot. Complete activation and map installation in CoPilot and verify Activated in Account Manager. Truck profile configuration and route verification remain necessary before navigation use.

This does not enable embedded CPIK startup or replace CopilotLifecycle readiness gates. The React Native branch already pins CPIK 10.28.2-497, but its secure provisioning provider and native startup validation remain separate outstanding requirements. Device-based account setup alone does not satisfy them.

Checks: TypeScript typecheck, changed-file ESLint, 856 Jest tests, and platform XML/plist syntax. No physical device activation, Android APK, or iOS build was verified here.
