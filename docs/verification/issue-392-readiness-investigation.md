# Readiness controls and truck-profile integration investigation

Investigated against commit `adef50fa1d39eae052d51a616d74acc58ff75607` (test build 109). Public documentation checked October 28, 2026.

## Confirmed code behavior

1. `HybridNavigation` placed Check readiness, navigation setup, licensing status, and map status inside `!state.readyToAddStops`. When the route manager becomes ready, all those controls disappear. Engine readiness does not certify a synchronized truck profile or a confirmed route. Keep the controls and status visible in both states.
2. `coPilotDiagnosticReport` serialized the native timelines before the readiness summary. Truncated shares can lose the license/map checks. Put readiness first; include `readyToAddStops` and only allowlisted failure codes, never raw error messages.
3. Guidance is unconditionally blocked by this integration. `assessCopilotTruckProfile` returns `canApply: false`; `requireRepresentableCopilotTruckProfile` always throws. `synchronizeHybridTruck` fails before a native profile write. Independently, native `requireSyncedTruck` always throws and is called before route start/resume. Native `applyTruckProfile` only compares four dimensions and always rejects even when those match. Repeated readiness refreshes, changing a phone setting, or saving the same truck again cannot implement this missing integration.
4. The current ready-state copy suggests reviewing a profile and starting, despite that unconditional block. Replace it with an accurate distinction between engine setup and truck-profile verification.

## Documented capability distinctions

- [CoPilot 10.19 release notes](https://developer.trimblemaps.com/copilot-navigation/release-notes/v10_19/) say axle count was removed from CoPilot vehicle settings because CoPilot does not use it; other Trimble products use it for toll calculations. Missing an axle-count setter must not be treated as proof that the engine cannot route trucks. Weight per axle/group is a separate concept.
- [CPIK RouteMgr reference](https://developer.trimblemaps.com/copilot-navigation/cpik-libraries/native-and-dot-net/api-functions/routemgr/) documents height, width, length, total weight and weight per axle in `VehicleDimensions`, plus vehicle type, hazmat and routing preferences in `VehicleRoutingProfile`. A successful login does not establish those fields were applied. A complete mapping needs validated values, native setters, activation, and readback.
- [CoPilot upgrade guide](https://developer.trimblemaps.com/copilot-navigation/release-notes/upgrade-copilot/) places trailer count and separate bumper-to-bumper/maximum-straight lengths in 11.4, requiring North America Q2 2026 map data. The pinned package here is 11.3.0-2016.
- [Version 11 release notes](https://developer.trimblemaps.com/copilot-navigation/release-notes/v11_0/) list those new fields under 11.4.0.1801, released for CoPilot GPS on Android. That consumer-app release is not proof that an equivalent Android CPIK/React Native package or public getter/setter exists. The native API reference does not establish that mapping. Do not invent SDK methods, use REST fields as native SDK fields, or equate a named preset with verified trailer readback.

## Remaining integration work

The current policy needs a documented distinction between navigation inputs, fleet metadata and unsupported requested restrictions. Axle count can remain stored without being represented as an applied CoPilot routing input. Trailer configuration, length semantics, loaded/gross weight, hazmat and requested avoids still require explicit handling; removing one erroneous blocker does not make a full profile safe to apply.

Before enabling guidance, establish the supported CPIK package and exact API/readback for the required trailer/length behavior. A newer CoPilot GPS version alone is insufficient. Preserve package identity, signing identity, stored enrollment and maps while upgrading. Do not disable the native guard merely because basic engine readiness succeeds.

The concrete vendor questions are:

1. Which Android CPIK/React Native library exposes trailer count, maximum straight length and bumper-to-bumper length? Provide the package version and exact Java setters/getters.
2. What is the supported behavior for trailer-specific restrictions in CPIK 11.3, and what map-data version is required?
3. Confirm axle count is metadata rather than a CoPilot route input, and confirm maximum loaded axle-group weight semantics for North America.

No account identifiers, support-case details or private SDK download URLs are needed to answer these API questions.

## Scope of this patch

This patch fixes control visibility, truthful driver messages and diagnostic ordering. It does not enable guidance or certify a truck-profile mapping. Tests cover ready and blocked control states, safe error export, diagnostic ordering, and preservation of the existing no-partial-profile-write behavior. Device validation remains required after building an APK.
