# CoPilot device activation

Navigation Settings → CoPilot device setup opens the separately installed CoPilot GPS app using Trimble's documented Account Manager activation URL.

Enter the Company ID and the Device ID of an asset with an assigned CoPilot Truck license. These are stored in device secure storage, never hardcoded in a shared build. Do not reuse the same asset on multiple phones. Adding or assigning a license in the portal does not activate a physical device.

1. Install CoPilot GPS on the test phone.
2. Enter its assigned company and device IDs in the setup screen.
3. Select Open CoPilot to activate and complete CoPilot's activation/map download.
4. Verify the asset becomes Activated in Account Manager.
5. Configure the correct truck routing profile before driving or testing routing.

This is standalone app activation, not CPIK embedded navigation. This repository has no licensed CPIK binaries or CoPilot native bridge. Embedded navigation requires the licensed SDK and platform implementation. Do not interpret a successful URL launch as activation or routing verification.

Protocol: https://developer.trimblemaps.com/copilot-navigation/feature-guide/advanced-features/url-launch/

Validation: run `flutter test test/copilot_device_license_test.dart` and `flutter analyze` in a provisioned Flutter environment. The existing `plugins/here_sdk` dependency must be supplied separately; it is absent from this repository checkout. Android/iOS device acceptance remains required.
