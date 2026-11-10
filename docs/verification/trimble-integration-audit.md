# SemiTraX Trimble integration audit — 2026-10-30

Scope: Android CPIK 11.3.0.2016, React Native app. No identified Trimble PWA URL or authenticated PWA integration was supplied; this work does not claim to embed a PWA.

| Capability | Connection and evidence | Remaining limitation |
| --- | --- | --- |
| Planner and active map | CopilotPlannerMap / EngineCopilotMap render CopilotView; planner uses Trimble before search as of build 118 | Physical-device interaction still requires validation |
| Follow, north/heading up, 2D/3D, zoom | Explicit native MapDrawer commands; new settings panel exposes orientation and view modes | Map display does not start guidance |
| Start/resume | Fresh lifecycle recheck, saved truck validation, assigned native profile readback, explicit consent, native trip handoff | Device previously reports COPILOT_NOT_READY; no bypass or confirmed resolution |
| Turn instructions, ETA, lane codes, limits | Native guidance telemetry; route revision polling now accepts newer snapshots if an event is missed | No fabricated lane recommendations or speed limits; optional geometry failures no longer suppress all telemetry |
| Voice | Existing native speech mute, volume and sample controls | Device audio delivery unverified |
| Warning settings | Existing seven native settings now have a mounted panel and readback after changes | A failed setting is shown as unavailable, never falsely saved |
| Offline POIs | Android PoiService now delegates nearby and along-route searches to CoPilotPoiSearch | Along-route filtering is an advisory geometry estimate, not verified truck access |
| Map POI categories | Native installed category catalogue and verified visibility writes exposed in settings | Category availability depends on installed maps |
| Offline maps | Existing licensed catalogue, per-region download/resume and installed-map verification | Setup-region readiness is not proof of full trip coverage |
| Address search | Existing Mapbox SearchService remains separate from the Trimble map | Native offline address-search adapter is not implemented by this change |
| Commercial route preview | Existing server Trimble routing | Preview estimates do not prove an active native route |
| Satellite imagery | No verified CPIK satellite capability in the shipped integration | Not enabled or relabeled as Trimble |
| Live traffic, parking availability, fuel prices, weather | Separate provider/capability paths | Not all are supplied or entitled by the CPIK license; no claim of universal availability |

Diagnostics now export native readyToAddStops, receivingGps and hasDestination separately, with fixed status codes and no coordinates or account identifiers. These distinguish a native route-readiness failure from the generic setup message.

## SDK evidence

The delivered vendor source contains the preference and speech methods used by the existing services. The supplier's October 27 delivery points to the same CPIK RN package currently pinned by the preparation script.

[Trimble release notes](https://developer.trimblemaps.com/copilot-navigation/release-notes/v11_0/) list the after-map-download ready-to-add-stops fix under **11.2.0.1099**, older than the shipped 11.3.0.2016. This historical note does not establish the cause of the current failure or justify bypassing readiness.

## Acceptance on device

Install over the existing signed package; preserve device enrollment and installed maps. While parked, verify Trimble appears before search, test map controls and setting readbacks, search an installed POI category, and attempt Start with a verified supported truck. Capture diagnostics if readiness fails. Verify active instructions and route recalculation only after native start confirmation. Do not report full feature parity until these checks and outstanding provider integrations are complete.
