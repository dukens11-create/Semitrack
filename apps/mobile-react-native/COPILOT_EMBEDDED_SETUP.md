# Embedded Android setup check

SemiTraX includes CPIK `10.28.2-497`. The device setup form now offers an explicit
in-app check as well as the separate-app URL activation option. The in-app check
does not need a standalone CoPilot installation.

Company and asset IDs come from the device's assigned Trimble Account Manager
record and are case-preserving. They are saved in the existing device-only secure
store. No administrator password, product key, staging key, or fixed customer
identity is added to source, build configuration, or diagnostic messages.

The native host synchronously supplies `LicenseListenerModule.setAMSLoginInfo`
before binding `CopilotService`. It requires a resumed Activity and precise
location, uses an application context for binding, and creates a notification with
a real monochrome icon. Bind failures, foreground-service exceptions, null/dead
bindings and timeout reject with sanitized codes. It avoids the vendor startup
module's null icon and Activity-dependent connection lifetime. Changing identity
in the same process is rejected to prevent implicit license reassignment.

The report distinguishes service connection from the actual `onCPStartup`
callback. It queries licensing readiness and actual FULL_NAVIGATION and
TRUCK_HEAVY_DUTY feature statuses using native constants. Licensed map regions and
installed package count are inventory, not proof of route coverage or compatible
map version. An empty inventory is reported without downloading or fabricating
maps. The check stops polling after 30 seconds, on cancellation, or disconnection;
binding itself has a separate 15-second timeout. It unbinds on host pause/destroy.

This setup host is separate from the unavailable guidance adapter. It never
changes routing capability, applies a truck profile, adds stops, starts guidance,
or claims license success from a bind acknowledgement. In-app setup does not
complete the older CopilotLifecycle configuration/map-version contract.

Before enabling guidance, resolve the mandatory axle/trailer and other restriction
mappings listed in COPILOT_P0_REPORT.md, verify licensed compatible map coverage,
implement profile readback and serialized route callbacks, and exercise startup,
voice, route progress, rerouting and arrival on the licensed device. iOS frameworks
are still missing. JavaScript tests and an APK build cannot prove these outcomes.

Validation: permission refusal, storage failure, binding without startup, missing
truck entitlement, cancellation, disconnection and error-payload sanitization have
regressions. Android compilation and physical-device results must be recorded
separately; this document does not assert device acceptance.

## Explicit map management

The October 7 phone check after PR #363 reported actual embedded startup and
confirmed navigation/truck entitlements, with zero installed map packages. This
is setup evidence, not guidance acceptance.

After the in-app check confirms both entitlements, the form exposes searchable
licensed map regions. Names and descriptions come directly from the pinned SDK's
MapRegion objects rather than JavaScript enumeration of interop constants. An
explicit selection is required to download. Native commands recheck engine startup,
foreground state and the licensed region before calling the SDK on a serial worker.
The initial request downloads the latest SDK-compatible release without overwriting;
additional regions use the verified release of existing maps. Mixed or missing
release metadata prevents an additive request. No map deletion is exposed.

Progress comes from MapDataListener callbacks and downloaded/file byte counts.
Pause, resume and cancel call the vendor operations. SUCCESS means a request was
accepted, not installed. The panel polls every three seconds while foregrounded;
only getInstalledMaps inventory marks a region Installed, and its release is shown.
The displayed free storage is for the app's external-files volume (internal fallback);
the SDK performs download/storage validation. Keep the app open and use Wi-Fi.
Unbinding on background still applies, so background download continuity is not promised.

Map downloads do not change the guidance boundary, routing safety prerequisites,
truck profile, or navigation status. Physical download, pause/resume and inventory
verification remain device acceptance checks. Reference contracts:
- https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/mapdatamgr/
- https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/how-to-guides/map-updates/
