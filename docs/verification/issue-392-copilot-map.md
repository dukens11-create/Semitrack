# Embedded CoPilot live map

The live navigation screen now mounts the licensed CoPilot native view instead of drawing CoPilot route geometry on Mapbox. SemiTraX retains its instruction, lane, speed, ETA, voice, nearby-place and weather interface. Zoom, north-up and recenter commands go to CoPilot. Satellite display is removed from this live screen because it was a Mapbox feature.

The display-only `embedded-navigation` command verifies maps/licensing and selects `THREE_DIMENSIONAL_NO_WIDGETS`. It does not enable GPS, submit stops, or resume navigation. The renderer mounts after this command succeeds, with the existing native-view lifecycle checks. Trip handoff uses `PREVIEW_TRIP_MAP_NO_WIDGET`; start confirmation still requires correlated stop and route calculation callbacks.

Both enum constants were verified against the installed 10.28.2-497 cpik.jar using the JDK javap module. This implements Finn's October 27 map-display guidance without claiming a v11 migration.

## Remaining acceptance work

- v11 download/install access is still pending from Trimble support case 02405327.
- Truck profile synchronization remains blocked by unverified axle/trailer restriction mapping. No guard was removed.
- Route previews now render on CoPilot with native markers, overview and place-picking events. Mapbox remains for browsing when no route is selected. Satellite imagery is unavailable for route previews. The planner unmounts before the navigation session opens, so two screens cannot mount the shared SDK view.
- No Android device or full Android toolchain is available in this workspace. Verify native compilation and on-device map mounting, return/reopen, rotation/background recovery, route preview/calculation callbacks, custom overlays and map controls after the profile blocker is resolved.
- This is not a verified APK and has not been installed on the user's phone. Package identity, signing configuration, SDK version, credentials and downloaded maps are unchanged.

## Automated verification

Run `npm run check` in apps/mobile-react-native. New component tests cover deferred map mounting, native map controls and display-setup failure. Existing trip safety and handoff tests remain required.

The existing signed Android workflow also runs on fix/392-copilot-live-map. Its signing-certificate checks remain mandatory; no replacement signing identity is generated.
