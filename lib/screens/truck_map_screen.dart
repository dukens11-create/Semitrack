import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';

/// Full-featured truck navigation screen.
///
/// Integrates a Mapbox map widget (via flutter_map), fetches a live truck
/// route from the backend, parses the returned GeoJSON geometry, and
/// displays dynamic ETA / distance / maneuver information together with the
/// Phase 5 intelligence overlay (driveMinutesLeft, weather, riskScore).
class TruckMapScreen extends StatefulWidget {
  const TruckMapScreen({super.key});

  @override
  State<TruckMapScreen> createState() => _TruckMapScreenState();
}

class _TruckMapScreenState extends State<TruckMapScreen> {
  // ── Navigation banner constants ────────────────────────────────────────────
  /// Distance threshold below which the banner shows "Now" instead of metres.
  static const double _imminentManeuverThresholdMeters = 30.0;

  /// Distance threshold below which the banner turns orange (urgent alert).
  static const double _urgentColorThresholdMeters = 50.0;

  /// Distance threshold below which the banner turns yellow (medium alert).
  static const double _mediumColorThresholdMeters = 150.0;

  // ── Arrival detection threshold ───────────────────────────────────────────
  /// Radius in metres within which the driver is considered to have arrived at
  /// the destination.  30 m provides a comfortable buffer that triggers before
  /// the truck physically stops at the dock, matching professional GPS apps.
  static const double _arrivalThresholdMeters = 30.0;

  // ── Off-route detection constants ─────────────────────────────────────────
  /// Distance in metres beyond which the truck is considered off-route.
  static const double _offRouteThresholdMeters = 40.0;

  /// Minimum seconds that must elapse between automatic reroutes to prevent
  /// rapid repeated API calls in areas with poor GPS accuracy.
  static const int _rerouteThrottleSeconds = 8;

  // ── Loading / error ────────────────────────────────────────────────────────
  bool _isLoading = false;
  String? _error;

  // ── Map ready state ────────────────────────────────────────────────────────
  bool _mapReady = false;

  // ── Full route response ────────────────────────────────────────────────────
  Map<String, dynamic>? _routeData;

  // ── Map route points (from GeoJSON coordinates) ────────────────────────────
  List<LatLng> _routePoints = const [];

  // ── Truck marker position, bearing, and current route index ───────────────
  //
  // These three fields drive the animated truck marker and correspond to the
  // Google Maps pattern:
  //   currentTruckPosition → _truckPosition  (LatLng)
  //   currentBearing       → _truckBearing   (degrees, 0–360 clockwise from N)
  //   currentRouteIndex    → _truckIndex     (index into _routePoints)
  LatLng? _truckPosition;
  double _truckBearing = 0.0;
  int _truckIndex = 0;

  // ── GPS subscription + route animation timer ──────────────────────────────
  //
  // _animTimer is kept for cancellation (e.g. in dispose) even though
  // route animation is now driven by _runSmoothRouteAnimation.  The GPS
  // stream takes priority when real device location fixes are available.
  StreamSubscription<Position>? _gpsSubscription;
  Timer? _animTimer; // kept for dispose / GPS-mode cancellation

  // Generation counter — incremented each time a new smooth animation is
  // started so that any in-flight async animation loop can self-cancel when
  // it detects a stale generation value.
  int _animGeneration = 0;
  // True while the GPS stream is delivering real position fixes so that the
  // periodic animation timer defers to the GPS-driven updates.
  bool _gpsActive = false;

  // ── Turn-by-turn navigation steps (from Mapbox route) ─────────────────────
  //
  // Each entry holds the instruction text and the maneuver LatLng so the
  // driver's current position can be compared to the next waypoint.
  List<_NavStep> _navSteps = const [];
  int _currentStepIndex = 0;

  // ── Flutter TTS engine for voice guidance ────────────────────────────────
  final FlutterTts _tts = FlutterTts();

  // ── Arrival state ─────────────────────────────────────────────────────────
  //
  // _isArrived becomes true once the driver has reached the destination.
  // All navigation actions (camera-follow, step advancement, off-route checks,
  // new GPS callbacks) are gated on this flag to prevent post-arrival updates.
  //
  // _navigationActive is true from the moment route playback/GPS tracking
  // starts until the driver arrives.  It is used to guard _followTruckCamera
  // and to disable the nav-mode toggle button after the trip ends.
  bool _isArrived = false;
  bool _navigationActive = false;

  // ── Off-route rerouting lock (prevents re-entrant reroute calls) ──────────
  bool _isRerouting = false;

  /// Timestamp of the last automatic reroute, used to throttle rerouting
  /// frequency to at most one reroute every [_rerouteThrottleSeconds] seconds.
  DateTime? _lastRerouteTime;

  /// Navigation status message shown in the UI during special events such as
  /// rerouting (e.g. "Rerouting...").  Null when no status is active.
  String? _navStatus;

  // ── Route-fetch guard (prevents simultaneous or repeated API calls) ────────
  bool _isLoadingRoute = false;

  // ── Phase 5 intelligence (driveMinutesLeft, weather, riskScore) ────────────
  // Pre-populated with mock/placeholder values so the Drive Intelligence card
  // is never blank.  These are replaced by real API data once available.
  Map<String, dynamic> _intelligence = const {
    'driveMinutesLeft': 470, // ~7 h 50 m mock ETA
    'weather': 'Clear',      // placeholder weather condition
    'riskScore': 92.0,       // 92 → "Low" risk bucket
  };

  // ── Map controller ─────────────────────────────────────────────────────────
  final MapController _mapController = MapController();

  // ── Navigation vs overview mode ────────────────────────────────────────────
  // When true the camera stays close to the truck (navigation zoom 12.5–15).
  // When false the camera shows the full-route overview.
  bool _navigationMode = false;

  // ── Camera follow state ────────────────────────────────────────────────────
  // When true the camera continuously follows the truck (GPS navigation mode).
  // Set to false automatically when the user manually pans/zooms the map so
  // they can freely explore without forced camera snaps.  Tapping the recenter
  // FAB resets this to true and immediately re-centres the camera.
  bool _followTruck = true;

  // ── Navigation pause state ─────────────────────────────────────────────────
  // When true, live GPS tracking and camera follow updates are suspended.
  // Useful when the driver needs to review the route without the map moving.
  bool _navigationPaused = false;

  // ── Default route endpoints (Portland, OR → Winnemucca, NV) ───────────────
  static const _originLat = 45.5231;
  static const _originLng = -122.6765;
  static const _destLat = 39.5296;
  static const _destLng = -119.8138;

  static const _origin = LatLng(_originLat, _originLng);
  static const _destination = LatLng(_destLat, _destLng);

  // Navigation-mode zoom level (12.5–15) — close enough for street detail
  // without losing surrounding road context.
  static const _navigationZoomLevel = 14.0;

  // Camera-follow zoom level for GPS navigation mode.
  // Zoom 17 keeps the truck close and road detail visible at a true
  // street-level view; mirrors CameraPosition(zoom: 17) in Google Maps
  // navigation.  Adjust to 16 or 18 if surrounding road context is needed.
  static const _followCameraZoomLevel = 17.0;

  // Latitude offset applied to the camera target so that more road *ahead* of
  // the truck is visible on screen.  A negative value shifts the target south
  // (down-screen), revealing the upcoming road — identical to the Google Maps
  // navigation trick.  Tune between −0.001 and −0.002 for your zoom level.
  static const _cameraLeadLatitude = 0.0015;

  // ── Mapbox public tile access token ──────────────────────────────────────────
  static const _mapboxToken =
      'pk.eyJ1Ijoic2VtaXRyYWNrLTExIiwiYSI6ImNtbmFoeHRoNjBqcjcycXE2ZWk5cGpzNGMifQ.09eo4qJKyLZq_3aUEXWiAA';

  @override
  void initState() {
    super.initState();
    _initTts();
    _startGps();
  }

  @override
  void dispose() {
    _gpsSubscription?.cancel();
    _animTimer?.cancel();
    _animGeneration++; // cancel any in-flight smooth animation
    _tts.stop();
    super.dispose();
  }

  // ── Truck marker builders ─────────────────────────────────────────────────
  //
  // flutter_map uses Widget-based, stateless markers that are rebuilt each
  // frame from the current state variables.  The three helpers below mirror
  // the Google Maps Flutter pattern:
  //
  //   Google Maps Flutter              flutter_map equivalent
  //   ─────────────────────────────    ────────────────────────────────────────
  //   BitmapDescriptor.fromAssetImage  Image.asset (warmed by Flutter cache)
  //   Marker(anchor: Offset(0.5,0.5))  Marker(alignment: Alignment.center)
  //   marker.rotation = bearing        AnimatedRotation(turns: bearing/360)
  //   markers = {truckMarker, …}       MarkerLayer(markers: […]) in build()
  //   setState(() => markers = …)      _updateMarkers() → setState(() {})
  //
  // NOTE: truck_top.png (64 × 192 px portrait, red cab facing UP) must be
  // placed at assets/icons/truck_top.png before building the app.

  /// Returns a [Marker] for the truck at its current position and bearing.
  ///
  /// **Icon** — top-down 64 × 64 px PNG (truck_top.png) rendered at 26 × 26
  /// logical pixels.  This size keeps the marker compact at close zoom levels
  /// (zoom 16+) so it does not obscure adjacent road lanes.  If the icon
  /// looks too small on high-density displays, increase to 28 × 28.
  ///
  /// **Rotation** — the sprite faces UP (north = 0°), so bearing maps
  /// directly to fractional turns with no offset: `turns: _truckBearing / 360`.
  /// [AnimatedRotation] interpolates smoothly between bearing changes.
  ///
  /// **Anchor** — `alignment: Alignment(0.0, 0.24)` (≡ `anchor: Offset(0.5, 0.62)`)
  /// shifts the anchor point slightly below centre so the cab sits on the road
  /// coordinate rather than floating above it.  Fine-tune with 0.60 or 0.65
  /// if road alignment looks off on a specific device.
  Marker _buildTruckMarker() {
    return Marker(
      point: _truckPosition ??
          (_routePoints.isNotEmpty ? _routePoints.first : _origin),
      // Bounding box matches the rendered icon size: 26 × 26 logical px.
      width: 26,
      height: 26,
      // Anchor slightly below centre (≡ Offset(0.5, 0.62)) so the cab nose
      // sits on the GPS coordinate rather than the trailer centre.
      alignment: const Alignment(0.0, 0.24),
      child: AnimatedRotation(
        // Sprite faces UP → bearing maps directly; no offset needed.
        turns: _truckBearing / 360.0,
        duration: const Duration(milliseconds: 300),
        // Top-down truck sprite (assets/icons/truck_top.png, 64 × 64 px).
        child: Image.asset(
          'assets/icons/truck_top.png',
          width: 26,
          height: 26,
          errorBuilder: (_, __, ___) => const Icon(
            Icons.local_shipping,
            size: 32,
            color: Colors.blue,
          ),
        ),
      ),
    );
  }

  /// Returns the fixed destination [Marker] (red pin at [_destination]).
  Marker _buildDestinationMarker() {
    return const Marker(
      point: _destination,
      width: 40,
      height: 40,
      child: Icon(Icons.location_on, size: 34, color: Colors.red),
    );
  }

  /// Triggers a rebuild of the [MarkerLayer] with the latest truck position
  /// and bearing.
  ///
  /// Equivalent to the Google Maps pattern:
  /// ```dart
  /// setState(() => markers = {buildTruckMarker(), destinationMarker});
  /// ```
  /// In flutter_map there is no separate marker set — calling [setState]
  /// causes [build] to re-invoke [_buildTruckMarker], which reads the updated
  /// state fields.  This helper is provided so call-sites remain readable and
  /// consistent with the Google Maps idiom.
  void _updateMarkers() {
    if (!mounted) return;
    setState(() {
      // Marker rebuild is implicit: build() calls _buildTruckMarker() which
      // reads the already-updated _truckPosition and _truckBearing fields.
    });
  }

  /// Animates the map camera to follow the truck in navigation mode.
  ///
  /// Equivalent to the Google Maps navigation camera pattern:
  /// ```dart
  /// Future<void> followTruckCamera() async {
  ///   await mapController.animateCamera(
  ///     CameraUpdate.newCameraPosition(CameraPosition(
  ///       target: LatLng(
  ///         currentTruckPosition.latitude - 0.0015, // shift ahead for road visibility
  ///         currentTruckPosition.longitude,
  ///       ),
  ///       zoom: 17,           // close street-level navigation zoom
  ///       bearing: currentBearing, // rotate map to match truck heading
  ///       tilt: 45,           // 3-D navigation feel (Google Maps only)
  ///     )),
  ///   );
  /// }
  /// ```
  ///
  /// In flutter_map, [MapController.moveAndRotate] combines the pan, zoom, and
  /// heading rotation into a single call.  Camera tilt (45°) is a Google Maps
  /// API feature and is not available in flutter_map; the heading rotation
  /// achieves a similar GPS-navigation feel on a flat map.
  ///
  /// The camera target is shifted slightly south (latitude − [_cameraLeadLatitude] °) so that
  /// more road *ahead* of the truck is visible on screen — identical to the
  /// Google Maps real-navigation feel described in the feature spec.
  ///
  /// Guards: skips the animation when [_followTruck] is false (user is freely
  /// exploring the map) or when the driver has arrived at the destination.
  ///
  /// Call this after every truck position/bearing update while [_navigationMode]
  /// is active.  Guards against calls before the map widget is ready with
  /// [_mapReady].
  void _followTruckCamera() {
    // Do not move the camera after arrival — the trip is complete and the
    // driver is viewing the arrival sheet or the overview.
    if (!_mapReady || _truckPosition == null || _isArrived) return;
    // Skip camera follow if user is freely exploring the map.
    if (!_followTruck) return;
    // Shift the camera target slightly ahead of the truck (−_cameraLeadLatitude°)
    // so the road in front is always visible, matching Google Maps navigation.
    final cameraTarget = LatLng(
      _truckPosition!.latitude - _cameraLeadLatitude,
      _truckPosition!.longitude,
    );
    // Rotate the map to the truck's current heading and zoom to street level.
    _mapController.moveAndRotate(
      cameraTarget,
      _followCameraZoomLevel,
      _truckBearing,
    );
  }

  // ── TTS initialisation ────────────────────────────────────────────────────

  Future<void> _initTts() async {
    await _tts.setLanguage('en-US');
    await _tts.setSpeechRate(0.5);
    await _tts.setVolume(1.0);
    await _tts.setPitch(1.0);
  }

  /// Speaks [text] via the TTS engine, interrupting any current utterance.
  Future<void> _speak(String text) async {
    await _tts.stop();
    await _tts.speak(text);
  }

  // ── GPS tracking ──────────────────────────────────────────────────────────

  /// Requests location permission and subscribes to the device GPS stream.
  ///
  /// Each position update snaps the truck marker to the nearest route point
  /// ahead of the current position, so the marker always follows the real
  /// device location when available.
  Future<void> _startGps() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return;

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) return;
    }
    if (permission == LocationPermission.deniedForever) return;

    const locationSettings = LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 10,
    );

    _gpsSubscription = Geolocator.getPositionStream(
      locationSettings: locationSettings,
    ).listen(_onGpsPosition);
  }

  /// Handles a new GPS position: updates the truck marker to the real device
  /// location, rotates the marker to the true GPS heading, and checks for
  /// step advancement and off-route conditions.
  ///
  /// Skips all updates when [_navigationPaused] is true so the driver can
  /// review the route without the map or marker moving.
  ///
  /// **Position** — [_truckPosition] is set directly to the GPS fix for
  /// accurate real-world placement (matches `currentTruckPosition = gpsPoint`
  /// in the Google Maps pattern).  The nearest route index is still tracked so
  /// step-advancement and off-route logic remain correct.
  ///
  /// **Bearing** — `position.heading` returns the true device compass heading
  /// in degrees (0–360) when the device is moving; Geolocator returns −1 when
  /// the heading is unavailable (stationary, cold start, or no sensor).  We
  /// use the true heading when ≥ 0, falling back to the bearing derived from
  /// the route geometry when not available.
  void _onGpsPosition(Position position) {
    // Ignore all GPS updates once the driver has arrived — the trip is done.
    if (_routePoints.isEmpty || _isArrived) return;
    // Pause guard: skip all tracking updates while navigation is paused.
    if (_navigationPaused) return;
    _gpsActive = true;
    final gpsPoint = LatLng(position.latitude, position.longitude);

    // ── Arrival detection: check proximity to destination first ─────────────
    // Always evaluated before step/off-route logic so arrival wins immediately.
    _checkArrival(gpsPoint);
    if (_isArrived) return; // arrival was just triggered — stop all processing

    // ── Step advancement: speak instruction when nearing next maneuver ──────
    _checkStepAdvancement(gpsPoint);

    // ── Off-route detection: reroute when >30 m from the route line ─────────
    _checkOffRoute(gpsPoint);

    // ── Update truck position and heading from real GPS data ─────────────────
    // Snap to the nearest ahead-of-index route point for step/off-route logic.
    final nearest = _nearestRouteIndex(gpsPoint);

    // Prefer the true device heading from GPS (heading ≥ 0 = valid fix).
    // Fall back to route-computed bearing when heading is unavailable (−1).
    final double trueBearing;
    if (position.heading >= 0) {
      // Real device compass heading — use directly for marker rotation.
      trueBearing = position.heading;
    } else if (nearest != _truckIndex) {
      // No GPS heading but route index changed: compute from route geometry.
      trueBearing = _bearingBetween(
        _routePoints[_truckIndex.clamp(0, _routePoints.length - 1)],
        _routePoints[nearest.clamp(0, _routePoints.length - 1)],
      );
    } else {
      // No GPS heading and no index change: keep current bearing.
      trueBearing = _truckBearing;
    }

    _truckIndex = nearest;
    setState(() {
      // Use the raw GPS fix so the marker reflects actual device location.
      _truckPosition = gpsPoint;
      // Use real device heading for accurate marker rotation.
      _truckBearing = trueBearing;
    });

    // Keep the camera centred on the truck while in navigation mode.
    if (_navigationMode) {
      _followTruckCamera();
    }
  }

  /// Advances to the next step when the driver comes within 20 m of the
  /// upcoming maneuver point, then speaks the new instruction aloud.
  void _checkStepAdvancement(LatLng current) {
    if (_navSteps.isEmpty) return;
    final nextIdx = _currentStepIndex + 1;
    if (nextIdx >= _navSteps.length) return;
    final nextStep = _navSteps[nextIdx];
    final dist = _distanceBetween(current, nextStep.location);
    // Advance when within 20 m of the next maneuver waypoint.
    if (dist <= 20.0) {
      setState(() => _currentStepIndex = nextIdx);
      _speak(nextStep.instruction);
    }
  }

  /// Detects whether [current] has strayed more than [_offRouteThresholdMeters]
  /// from the nearest point on the route polyline.  When off-route, triggers a
  /// full reroute from the current live GPS position to the original destination.
  ///
  /// Uses [Geolocator.distanceBetween] for GPS-grade distance measurement and
  /// throttles reroutes to at most one every [_rerouteThrottleSeconds] seconds
  /// to prevent rapid repeated API calls in areas with poor GPS accuracy.
  void _checkOffRoute(LatLng current) {
    if (_routePoints.length < 2 || _isRerouting) return;

    // Throttle: skip if a reroute was triggered within the last 8 seconds.
    if (_lastRerouteTime != null &&
        DateTime.now().difference(_lastRerouteTime!).inSeconds <
            _rerouteThrottleSeconds) {
      return;
    }

    // Compute minimum distance from current position to any route point using
    // Geolocator.distanceBetween for accurate GPS-grade measurement.
    double minDist = double.infinity;
    for (final pt in _routePoints) {
      final d = Geolocator.distanceBetween(
        current.latitude,
        current.longitude,
        pt.latitude,
        pt.longitude,
      );
      if (d < minDist) minDist = d;
    }

    if (minDist > _offRouteThresholdMeters) {
      _isRerouting = true;
      _lastRerouteTime = DateTime.now();
      // Show rerouting status indicator and announce the change via TTS.
      setState(() => _navStatus = 'Rerouting...');
      _speak('Rerouting');
      // Re-fetch the route from the current live position to the original
      // destination, then clear the rerouting lock and status indicator.
      fetchRoute(fromPosition: current).then((_) {
        _isRerouting = false;
        if (mounted) setState(() => _navStatus = null);
      });
    }
  }

  // ── Arrival detection ─────────────────────────────────────────────────────

  /// Checks whether [current] is within [_arrivalThresholdMeters] of the
  /// destination.  When within range, triggers the full arrival flow once.
  ///
  /// This is called on every GPS position update (see [_onGpsPosition]) and
  /// from [_runSmoothRouteAnimation] when the truck reaches the final point,
  /// so that arrival is detected in both real-GPS mode and simulation mode.
  void _checkArrival(LatLng current) {
    // Guard: only trigger once per trip.
    if (_isArrived) return;
    final dist = _distanceBetween(current, _destination);
    if (dist <= _arrivalThresholdMeters) {
      _triggerArrival();
    }
  }

  /// Executes the full arrival flow:
  ///   1. Sets [_isArrived] = true and [_navigationActive] = false so all
  ///      navigation actions (camera-follow, step checks) are disabled.
  ///   2. Cancels the GPS position subscription — no further tracking needed.
  ///   3. Announces "You have arrived at your destination" via TTS.
  ///   4. Schedules [_showArrivalSheet] for the next frame so the build tree
  ///      is stable before the bottom sheet is pushed.
  void _triggerArrival() {
    if (!mounted) return;
    setState(() {
      _isArrived = true;
      _navigationActive = false;
      // Invalidate any in-flight smooth animation loop.
      _animGeneration++;
    });
    // Cancel GPS subscription — all tracking ceases after arrival.
    _gpsSubscription?.cancel();
    _gpsSubscription = null;
    // Speak the arrival announcement (interrupts any in-progress TTS).
    _speak('You have arrived at your destination');
    // Show the trip-complete sheet after the current frame is fully drawn.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _showArrivalSheet(context);
    });
  }

  /// Returns the index of the route point closest to [point], searching only
  /// from the current truck index onward to prevent backward snapping.
  int _nearestRouteIndex(LatLng point) {
    double minDist = double.infinity;
    int nearest = _truckIndex;
    for (int i = _truckIndex; i < _routePoints.length; i++) {
      final d = _distanceBetween(point, _routePoints[i]);
      if (d < minDist) {
        minDist = d;
        nearest = i;
      }
    }
    return nearest;
  }

  // ── Route animation ───────────────────────────────────────────────────────

  /// Starts smooth interpolated truck movement along the loaded route.
  ///
  /// Replaces the previous `Timer.periodic` jump-to-point approach with a
  /// continuous async animation cascade — see [_runSmoothRouteAnimation] and
  /// [_moveTruckSmoothly].  Switches to navigation mode so the camera stays
  /// close to the truck at zoom 14.0 (within the 12.5–15 navigation range).
  ///
  /// Equivalent to the Google Maps `startTruckSimulation()` pattern; any
  /// existing animation is invalidated via [_animGeneration] before the new
  /// one begins.
  void _startRouteAnimation() {
    _animTimer?.cancel();
    // Invalidate any in-flight smooth animation loop.
    _animGeneration++;
    _truckIndex = 0;
    _truckPosition =
        _routePoints.isNotEmpty ? _routePoints.first : null;

    // Enter navigation mode: camera zooms to truck position (12.5–15 range).
    // _navigationActive is set true here so _followTruckCamera and step checks
    // are enabled for the duration of the trip.
    setState(() {
      _navigationMode = true;
      _navigationActive = true;
    });
    if (_mapReady && _truckPosition != null) {
      _mapController.move(_truckPosition!, _navigationZoomLevel);
    }

    // Launch smooth async animation; pass the current generation so the
    // loop can self-cancel if _startRouteAnimation is called again.
    _runSmoothRouteAnimation(_animGeneration);
  }

  /// Drives smooth truck movement through every segment of [_routePoints].
  ///
  /// Iterates each consecutive pair of route points and awaits
  /// [_moveTruckSmoothly] for each segment.  The loop self-terminates when
  /// the widget is disposed or a newer animation generation is started.
  ///
  /// When the final segment completes, [_checkArrival] is called with the
  /// last route point so that arrival is detected in simulation mode (i.e.
  /// when no real GPS fixes are available).
  Future<void> _runSmoothRouteAnimation(int generation) async {
    for (int i = 0; i < _routePoints.length - 1; i++) {
      if (!mounted || _animGeneration != generation) return;
      _truckIndex = i;
      await _moveTruckSmoothly(_routePoints[i], _routePoints[i + 1], generation);
    }
    // Snap to the final point once all segments are complete.
    if (mounted && _animGeneration == generation) {
      _truckIndex = _routePoints.length - 1;
      // Check arrival from the last route point so simulation mode also
      // triggers the arrival flow when the animation finishes at the destination.
      if (_routePoints.isNotEmpty) {
        _checkArrival(_routePoints.last);
      }
    }
  }

  /// Smoothly interpolates the truck from [from] to [to] over ~500 ms using
  /// 10 steps of 50 ms each.
  ///
  /// On each step the truck [_truckPosition] and [_truckBearing] are updated
  /// via [setState] and the camera is animated to follow — replacing the old
  /// single-frame jump with a continuous GPS-style glide.
  ///
  /// Equivalent to `moveTruckSmoothly(from, to)` from the smooth-movement
  /// implementation guide.  The [generation] parameter allows early exit when
  /// a new route animation has been started.
  Future<void> _moveTruckSmoothly(
      LatLng from, LatLng to, int generation) async {
    final bearing = _bearingBetween(from, to);
    for (double t = 0.0; t <= 1.0 + 1e-9; t += 0.1) {
      if (!mounted || _animGeneration != generation) return;
      await Future.delayed(const Duration(milliseconds: 50));
      if (!mounted || _animGeneration != generation) return;
      final pos = _interpolate(from, to, t.clamp(0.0, 1.0));
      setState(() {
        _truckPosition = pos;
        _truckBearing = bearing;
      });
      // Keep the camera centred on the truck in navigation mode.
      if (_navigationMode) {
        _followTruckCamera();
      }
    }
  }

  /// Linearly interpolates between two [LatLng] points.
  ///
  /// [t] is the interpolation factor in the range [0, 1]: 0 returns [start],
  /// 1 returns [end], intermediate values give proportional positions along
  /// the segment.
  ///
  /// Equivalent to `interpolate(start, end, t)` from the smooth-movement
  /// implementation guide.
  LatLng _interpolate(LatLng start, LatLng end, double t) {
    return LatLng(
      start.latitude + (end.latitude - start.latitude) * t,
      start.longitude + (end.longitude - start.longitude) * t,
    );
  }

  /// Moves the truck marker to the route point at [index], updates the
  /// bearing, and pans the camera to follow in navigation mode.
  ///
  /// State is committed via [_updateMarkers] so all marker changes flow
  /// through the same path as explicit marker-set refreshes.
  void _advanceTruckTo(int index) {
    if (index < 0 || index >= _routePoints.length) return;
    final prev = _routePoints[_truckIndex];
    final next = _routePoints[index];
    // Update position / bearing fields, then call _updateMarkers() to
    // trigger a rebuild — mirrors the Google Maps pattern:
    //   currentTruckPosition = to;
    //   currentBearing = calculateBearing(from, to);
    //   currentRouteIndex++;
    //   setState(() => markers = {buildTruckMarker(), …});
    _truckBearing = _bearingBetween(prev, next);
    _truckIndex = index;
    _truckPosition = next;
    _updateMarkers();
    // Only follow the truck with the camera while in navigation mode;
    // overview mode keeps the full-route view undisturbed.
    if (_navigationMode) {
      _followTruckCamera();
    }
  }

  // ── Bearing / distance helpers ────────────────────────────────────────────

  /// Returns the initial bearing in degrees (0–360) from [from] to [to].
  ///
  /// This is the `calculateBearing(LatLng start, LatLng end)` function
  /// described in the smooth-movement implementation guide, using the
  /// standard spherical bearing formula (atan2 of the cross-product
  /// of the start/end lat-lon pairs).
  double _bearingBetween(LatLng from, LatLng to) {
    final lat1 = from.latitude * math.pi / 180.0;
    final lat2 = to.latitude * math.pi / 180.0;
    final dLng = (to.longitude - from.longitude) * math.pi / 180.0;
    final y = math.sin(dLng) * math.cos(lat2);
    final x = math.cos(lat1) * math.sin(lat2) -
        math.sin(lat1) * math.cos(lat2) * math.cos(dLng);
    return (math.atan2(y, x) * 180.0 / math.pi + 360.0) % 360.0;
  }

  /// Returns the approximate great-circle distance in metres between [a] and
  /// [b] using the Haversine formula.
  double _distanceBetween(LatLng a, LatLng b) {
    final lat1 = a.latitude * math.pi / 180.0;
    final lat2 = b.latitude * math.pi / 180.0;
    final dLat = lat2 - lat1;
    final dLng = (b.longitude - a.longitude) * math.pi / 180.0;
    final sinDLat = math.sin(dLat / 2);
    final sinDLng = math.sin(dLng / 2);
    final ax =
        sinDLat * sinDLat + math.cos(lat1) * math.cos(lat2) * sinDLng * sinDLng;
    return 6371000 * 2 * math.atan2(math.sqrt(ax), math.sqrt(1 - ax));
  }

  // ── Restricted-zone dataset for truck routing ─────────────────────────────
  //
  // Each entry represents a physical restriction a truck must avoid (low
  // bridge, weight-limited road, etc.).  The proximity check radius is
  // defined in [_isTruckSafe].  The `limit_value` field stores the
  // applicable restriction (height in feet for bridges, tons for weight
  // limits) and is used for display / future enforcement logic.
  static const _restrictedZones = [
    {'lat': 40.123, 'lng': -120.456, 'type': 'low_bridge', 'limit_value': 12.6},
    {'lat': 41.234, 'lng': -121.567, 'type': 'low_bridge', 'limit_value': 13.5},
    {'lat': 39.876, 'lng': -119.234, 'type': 'weight_limit', 'limit_value': 40.0},
  ];

  // ── Mapbox Directions API integration ─────────────────────────────────────

  /// Decodes a Mapbox polyline6-encoded geometry string into a list of
  /// [LatLng] coordinates.
  ///
  /// polyline6 uses a precision factor of 1×10⁶ (vs 1×10⁵ for polyline5),
  /// giving sub-metre accuracy.  The algorithm is identical to the standard
  /// Mapbox/Google polyline algorithm aside from the division factor.
  List<LatLng> _decodePolyline6(String encoded) {
    final List<LatLng> points = [];
    int index = 0;
    int lat = 0;
    int lng = 0;

    while (index < encoded.length) {
      int result = 0;
      int shift = 0;
      int b;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      final dlat = (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
      lat += dlat;

      result = 0;
      shift = 0;
      do {
        b = encoded.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      final dlng = (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
      lng += dlng;

      points.add(LatLng(lat / 1e6, lng / 1e6));
    }
    return points;
  }

  /// Returns the perpendicular (cross-track) distance in metres from [p] to
  /// the great-circle line defined by segment [a]→[b].
  ///
  /// Uses the spherical cross-track distance formula, which gives accurate
  /// results in metres regardless of latitude.
  double _crossTrackDistance(LatLng p, LatLng a, LatLng b) {
    const r = 6371000.0;
    final d13 = _distanceBetween(p, a) / r;
    final theta13 = _bearingBetween(a, p) * math.pi / 180.0;
    final theta12 = _bearingBetween(a, b) * math.pi / 180.0;
    final sinXte = math.sin(d13) * math.sin(theta13 - theta12);
    return (math.asin(sinXte.clamp(-1.0, 1.0)) * r).abs();
  }

  /// Simplifies [points] using the Ramer–Douglas–Peucker algorithm.
  ///
  /// Points that deviate less than [epsilonMeters] from the straight line
  /// between their neighbours are removed, eliminating micro-jogs and
  /// duplicate-back artefacts while preserving all meaningful curves and turns.
  List<LatLng> _simplifyRoute(
    List<LatLng> points, {
    double epsilonMeters = 10.0,
  }) {
    if (points.length <= 2) return points;

    double maxDist = 0.0;
    int maxIndex = 0;
    for (int i = 1; i < points.length - 1; i++) {
      final d = _crossTrackDistance(points[i], points.first, points.last);
      if (d > maxDist) {
        maxDist = d;
        maxIndex = i;
      }
    }

    if (maxDist > epsilonMeters) {
      final left = _simplifyRoute(
        points.sublist(0, maxIndex + 1),
        epsilonMeters: epsilonMeters,
      );
      final right = _simplifyRoute(
        points.sublist(maxIndex),
        epsilonMeters: epsilonMeters,
      );
      return [...left.sublist(0, left.length - 1), ...right];
    }
    return [points.first, points.last];
  }

  /// Returns `true` when none of the [routePoints] pass within 100 m of a
  /// restricted zone in [_restrictedZones].
  bool _isTruckSafe(List<LatLng> routePoints) {
    const double radiusMeters = 100.0;
    for (final zone in _restrictedZones) {
      final zonePt =
          LatLng(zone['lat']! as double, zone['lng']! as double);
      for (final pt in routePoints) {
        if (_distanceBetween(pt, zonePt) <= radiusMeters) return false;
      }
    }
    return true;
  }

  /// Fetches a driving route from the Mapbox Directions API and updates all
  /// relevant state fields, including the decoded polyline6 coordinates used
  /// to draw the route on the map.
  ///
  /// When [fromPosition] is provided (e.g. during off-route rerouting), the
  /// route is requested from that live GPS position instead of the default
  /// origin.  The destination always remains [_destination].
  ///
  /// When [alternative] is `true` the second route returned by Mapbox is used
  /// instead of the primary one, allowing the caller to avoid a route that
  /// fails the [_isTruckSafe] check.
  Future<void> fetchRoute({bool alternative = false, LatLng? fromPosition}) async {
    // Guard: prevent simultaneous or repeated API calls that would layer a new
    // route on top of the previous one, causing "spaghetti" polyline artefacts.
    if (_isLoadingRoute) {
      print("fetchRoute already in progress – skipping duplicate call");
      return;
    }
    _isLoadingRoute = true;
    print("fetchRoute started (alternative: $alternative)");

    // Hard-reset the route state before fetching to ensure no stale points
    // from a previous route are left in _routePoints or rendered on the map.
    setState(() {
      _isLoading = true;
      _routePoints = []; // 🔥 FULL RESET – prevents route duplication
      _error = null;
    });

    try {
      // Use the live GPS position for rerouting when provided; otherwise fall
      // back to the fixed default origin (Portland, OR → Winnemucca, NV).
      final from = fromPosition ?? _origin;
      final url =
          "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/"
          "${from.longitude},${from.latitude};$_destLng,$_destLat"
          "?overview=full"
          "&geometries=polyline6"
          "&steps=true"
          "&alternatives=true"
          "&exclude=ferry"
          "&access_token=$_mapboxToken";

      final res = await http.get(Uri.parse(url));
      print("MAPBOX RESPONSE: ${res.body}");

      final data = jsonDecode(res.body);
      final routes = data["routes"] as List;
      // Use the alternative route (index 1) when requested and available,
      // otherwise fall back to the primary route (index 0).
      final routeIndex =
          (alternative && routes.length > 1) ? 1 : 0;
      final route = routes[routeIndex] as Map<String, dynamic>;

      // Decode polyline6 geometry (1×10⁶ precision) and simplify to remove
      // micro-jogs that cause loops and double-back artefacts.
      final decoded = _decodePolyline6(route["geometry"] as String);
      final newPoints = _simplifyRoute(decoded);

      // Check whether the decoded route avoids all restricted zones.
      // If it does not, automatically re-fetch using the alternative route.
      // When already on the alternative, we accept the route regardless —
      // no further candidates are available to try.
      if (!_isTruckSafe(newPoints) && !alternative) {
        print("Route is not truck-safe – fetching alternative route");
        // Release the loading guard before the recursive call so the inner
        // fetchRoute() is not blocked by the guard we set above.
        _isLoadingRoute = false;
        await fetchRoute(alternative: true, fromPosition: fromPosition);
        return;
      }

      // Extract all turn-by-turn steps (instruction + maneuver location).
      final allSteps = _extractAllSteps(route);
      // Build the legacy turnByTurn list for the route info panel.
      final turnByTurnList = allSteps
          .map((s) => {'instruction': s.instruction})
          .toList();

      setState(() {
        _navSteps = allSteps;
        _currentStepIndex = 0;
        _routeData = {
          "distanceMiles": (route["distance"] / 1609.34).round(),
          "etaMinutes": (route["duration"] / 60).round(),
          "turnByTurn": turnByTurnList,
        };
        // Clean replacement – never use addAll() here, which would layer new
        // points on top of previous route points and cause spaghetti lines.
        _routePoints = newPoints;
        // Deduplicate to remove any repeated coordinates that could cause
        // overlapping polyline segments near the route origin/destination.
        _routePoints = _routePoints.toSet().toList();
        _isLoading = false;
      });

      // Log the final route point count for debugging route-duplication issues.
      print("Route points count: ${_routePoints.length}");

      // Speak the first instruction when the route is (re-)loaded.
      if (allSteps.isNotEmpty) {
        _speak(allSteps.first.instruction);
      }

      _fitCameraToRoute(newPoints);
      _startRouteAnimation();
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    } finally {
      // Always release the loading guard so future fetchRoute() calls succeed.
      _isLoadingRoute = false;
    }
  }

  /// Extracts all turn-by-turn navigation steps from [route].
  ///
  /// Each [_NavStep] carries the maneuver instruction and its geographic
  /// location so that proximity checks can trigger step advancement at
  /// runtime.  Falls back to a single "Follow mapped route" step when the
  /// API response is missing the expected fields.
  List<_NavStep> _extractAllSteps(Map<String, dynamic> route) {
    final legs = route['legs'] as List?;
    if (legs == null || legs.isEmpty) {
      return [_NavStep('Follow mapped route', _origin)];
    }
    final steps = legs[0]['steps'] as List?;
    if (steps == null || steps.isEmpty) {
      return [_NavStep('Follow mapped route', _origin)];
    }
    return steps.map<_NavStep>((dynamic s) {
      final step = s as Map<String, dynamic>;
      final maneuver = step['maneuver'] as Map<String, dynamic>?;
      final instruction = maneuver?['instruction'] as String? ?? 'Continue';
      // Mapbox maneuver locations are [lng, lat] arrays.
      final loc = maneuver?['location'] as List?;
      final lat = loc != null && loc.length >= 2
          ? (loc[1] as num).toDouble()
          : _originLat;
      final lng = loc != null && loc.length >= 2
          ? (loc[0] as num).toDouble()
          : _originLng;
      // 'modifier' encodes turn direction: 'left', 'right', 'straight', etc.
      final modifier = maneuver?['modifier'] as String? ?? 'straight';
      // Step distance in metres from the Mapbox response.
      final distanceMeters = (step['distance'] as num?)?.toDouble() ?? 0.0;
      return _NavStep(
        instruction,
        LatLng(lat, lng),
        maneuver: modifier,
        distanceMeters: distanceMeters,
      );
    }).toList();
  }

  /// Fits the map camera to show the full route in overview mode.
  ///
  /// When in overview mode (not navigating) the full route is fitted so the
  /// driver can see the entire trip.  Navigation mode bypasses this method and
  /// keeps the camera close to the truck instead.
  void _fitCameraToRoute(List<LatLng> points) {
    if (!_mapReady || points.length < 2) return;
    // Overview: fit the full route bounding box so all waypoints are visible.
    final bounds = LatLngBounds.fromPoints(points);
    _mapController.fitCamera(
      CameraFit.bounds(
        bounds: bounds,
        padding: const EdgeInsets.all(50),
        maxZoom: 14.0,
      ),
    );
  }

  // ── Phase 5 intelligence helpers ──────────────────────────────────────────

  /// Extracts a human-readable weather summary from the route response.
  String _extractWeather(Map<String, dynamic> data) {
    final items = data['weather'] as List?;
    if (items != null && items.isNotEmpty) {
      final first = items.first as Map<String, dynamic>;
      final condition = first['condition'] as String?;
      final tempF = first['tempF'];
      if (condition != null) {
        return tempF != null
            ? '$condition · ${(tempF as num).toStringAsFixed(0)}°F'
            : condition;
      }
    }
    return 'Clear skies';
  }

  /// Computes a 0–100 risk score from the alerts list in [data].
  double _computeRiskScore(Map<String, dynamic> data) {
    final alerts = (data['alerts'] as List?) ?? const <dynamic>[];
    double score = 100.0;
    for (final a in alerts) {
      final text = a.toString().toLowerCase();
      if (text.contains('hazmat')) score -= 20;
      if (text.contains('restriction') || text.contains('restricted')) {
        score -= 10;
      }
    }
    return score.clamp(0.0, 100.0);
  }

  // ── Formatting helpers ─────────────────────────────────────────────────────

  /// Converts a raw route-mode API key (e.g. 'fastest') into a
  /// user-friendly display label (e.g. 'Fastest Route').
  ///
  /// Uses a switch statement so future mode keys can be added in one place.
  String _formatRouteMode(String mode) {
    switch (mode.toLowerCase()) {
      case 'fastest':
        return 'Fastest Route';
      case 'shortest':
        return 'Shortest Route';
      case 'eco':
        return 'Eco Route';
      case 'truck':
        return 'Truck Route';
      case 'driving-traffic':
        return 'Live Traffic Route';
      case 'driving':
        return 'Driving Route';
      default:
        // Capitalise the first letter for any unrecognised key so the UI
        // still looks polished rather than showing a raw lowercase string.
        return mode.isNotEmpty
            ? '${mode[0].toUpperCase()}${mode.substring(1)}'
            : '—';
    }
  }

  String _formatEta(int? minutes) {
    if (minutes == null) return '—';
    final h = minutes ~/ 60;
    final m = minutes % 60;
    return h > 0 ? '${h}h ${m}m' : '${m}m';
  }

  String _formatRisk(double? score) {
    if (score == null) return '—';
    if (score >= 90) return '${score.toStringAsFixed(0)} (Low)';
    if (score >= 70) return '${score.toStringAsFixed(0)} (Medium)';
    return '${score.toStringAsFixed(0)} (High)';
  }

  // ── Navigation banner helpers ─────────────────────────────────────────────

  /// Returns the [IconData] matching the Mapbox maneuver [modifier] string.
  ///
  /// Covers the full set of Mapbox modifier and type values:
  ///   'left' / 'slight left' / 'turn-left'  → turn_left
  ///   'sharp left'                           → turn_sharp_left
  ///   'right' / 'slight right' / 'turn-right' → turn_right
  ///   'sharp right'                          → turn_sharp_right
  ///   'uturn' / 'u-turn'                     → u_turn_left
  ///   'straight' / 'continue'                → straight
  ///   'merge'                                → straight
  ///   'roundabout' / 'rotary'                → roundabout_left
  ///   'arrive' / 'destination'               → flag (destination)
  ///   'depart' / 'head'                      → near_me (start)
  ///   all other values                        → navigation (default)
  IconData _maneuverIcon(String modifier) {
    switch (modifier.toLowerCase()) {
      case 'left':
      case 'slight left':
      case 'turn-left':
        return Icons.turn_left;
      case 'sharp left':
        return Icons.turn_sharp_left;
      case 'right':
      case 'slight right':
      case 'turn-right':
        return Icons.turn_right;
      case 'sharp right':
        return Icons.turn_sharp_right;
      case 'uturn':
      case 'u-turn':
        return Icons.u_turn_left;
      case 'straight':
      case 'continue':
        return Icons.straight;
      case 'merge':
        return Icons.straight; // merge onto highway — keep straight icon
      case 'roundabout':
      case 'rotary':
        return Icons.roundabout_left;
      case 'arrive':
      case 'destination':
        return Icons.flag;
      case 'depart':
      case 'head':
        return Icons.near_me;
      default:
        return Icons.navigation;
    }
  }

  /// Formats [meters] as a human-readable distance string.
  ///
  /// Uses the same priority logic as real GPS apps:
  ///   < 30 m  → "Now"   (imminent — act immediately)
  ///   < 200 m → exact metres, e.g. "85 m"
  ///   < 1000 m → rounded to the nearest 10 m, e.g. "400 m"
  ///   ≥ 1000 m → kilometres with one decimal place, e.g. "9.5 km"
  String _formatDistance(double meters) {
    // Imminent maneuver — tell the driver to act right away.
    if (meters < _imminentManeuverThresholdMeters) return 'Now';
    // Close range: show exact metres for precision.
    if (meters < 200.0) return '${meters.toInt()} m';
    // Medium range: round to nearest 10 m to avoid jitter.
    if (meters < 1000.0) return '${(meters / 10).round() * 10} m';
    return '${(meters / 1000.0).toStringAsFixed(1)} km';
  }

  /// Returns the banner background [Color] based on proximity to the next
  /// maneuver, providing real-time urgency feedback like a real GPS app:
  ///   < 50 m   → red     (very close — act now)
  ///   < 150 m  → orange  (approaching — prepare to turn)
  ///   otherwise → Colors.black87 (default driving mode)
  Color _getBannerColor(double meters) {
    if (meters < _urgentColorThresholdMeters) return Colors.red;
    if (meters < _mediumColorThresholdMeters) return Colors.orange;
    return Colors.black87;
  }

  /// Returns true when the driver has reached the final navigation step and
  /// is within the imminent-maneuver threshold of the destination.
  ///
  /// Checking both conditions prevents premature "arrived" messages at the
  /// start of the last leg when the destination may still be hundreds of
  /// metres away.
  bool _hasArrived() {
    if (_navSteps.isEmpty) return false;
    final safeIndex = _currentStepIndex.clamp(0, _navSteps.length - 1);
    return safeIndex >= _navSteps.length - 1 &&
        _distanceToNextStep() < _imminentManeuverThresholdMeters;
  }

  /// Returns the distance in metres from the truck's current position to the
  /// next maneuver waypoint (i.e. the upcoming turn, not the total remaining
  /// route distance).
  ///
  /// Falls back to the current step's stored [distanceMeters] when the truck
  /// position is not yet known (e.g. before the first GPS fix).
  double _distanceToNextStep() {
    if (_navSteps.isEmpty) return 0.0;
    final safeIndex = _currentStepIndex.clamp(0, _navSteps.length - 1);
    final nextStep = _navSteps[safeIndex];
    // Use the live truck position when available for real-time accuracy.
    if (_truckPosition != null) {
      return _distanceBetween(_truckPosition!, nextStep.location);
    }
    // Fallback: use the stored step distance before the first GPS fix.
    return nextStep.distanceMeters;
  }

  /// Converts a verbose Mapbox instruction into a concise, GPS-style phrase.
  ///
  /// Applies the following transforms in order:
  ///   1. Recognises arrival phrases and returns "Arrived".
  ///   2. Replaces "Head/Drive/Continue <direction> on" with "Continue on"
  ///      so that "Drive west on West Burnside Street" becomes
  ///      "Continue on West Burnside St".
  ///   3. Replaces a leading "Drive" verb with "Continue".
  ///   4. Abbreviates common street-type suffixes (Street → St, etc.).
  ///   5. Strips trailing distance phrases ("for 0.3 miles") since the
  ///      banner already shows the formatted distance separately.
  ///   6. Collapses any extra whitespace introduced by the replacements.
  String _formatInstruction(String instruction) {
    // Destination arrival — very common final step.
    if (instruction.toLowerCase().contains('arrived') ||
        instruction.toLowerCase().contains('destination')) {
      return 'Arrived';
    }
    // Replace "Head/Drive/Continue <cardinal direction> on" with "Continue on".
    // This removes the redundant direction word and normalises the verb.
    // e.g. "Drive west on West Burnside Street" → "Continue on West Burnside St"
    //
    // Pattern breakdown:
    //   ^(?:Head|Drive|Continue)  — leading navigation verb
    //   \s+                       — whitespace separator
    //   (?:north|south|…)         — cardinal/intercardinal direction word
    //   \s+on\s+                  — " on " connecting the direction to the road
    String result = instruction.replaceAllMapped(
      RegExp(
        r'^(?:Head|Drive|Continue)'
        r'\s+(?:north|south|east|west|northeast|northwest|southeast|southwest)'
        r'\s+on\s+',
        caseSensitive: false,
      ),
      (_) => 'Continue on ',
    );
    // Replace a remaining leading "Drive" verb with "Continue".
    // e.g. "Drive the route" → "Continue the route"
    result = result.replaceAllMapped(
      RegExp(r'^Drive\s+', caseSensitive: false),
      (_) => 'Continue ',
    );
    // Abbreviate common street suffixes for a cleaner display.
    // Note: "Drive" as a suffix is abbreviated AFTER the verb replacement
    // above so that "Pine Drive" correctly becomes "Pine Dr".
    result = result
        .replaceAll(RegExp(r'\bStreet\b', caseSensitive: false), 'St')
        .replaceAll(RegExp(r'\bAvenue\b', caseSensitive: false), 'Ave')
        .replaceAll(RegExp(r'\bBoulevard\b', caseSensitive: false), 'Blvd')
        .replaceAll(RegExp(r'\bDrive\b', caseSensitive: false), 'Dr')
        .replaceAll(RegExp(r'\bRoad\b', caseSensitive: false), 'Rd')
        .replaceAll(RegExp(r'\bHighway\b', caseSensitive: false), 'Hwy')
        .replaceAll(RegExp(r'\bFreeway\b', caseSensitive: false), 'Fwy')
        .replaceAll(RegExp(r'\bLane\b', caseSensitive: false), 'Ln')
        .replaceAll(RegExp(r'\bCourt\b', caseSensitive: false), 'Ct')
        .replaceAll(RegExp(r'\bPlace\b', caseSensitive: false), 'Pl');
    // Remove trailing distance phrases like "for 0.3 miles" or "for 500 m"
    // since the banner already shows the distance separately.
    result = result.replaceAll(
      RegExp(r'\s+for\s+[\d.]+ ?(m|km|miles?|mi)\b.*$', caseSensitive: false),
      '',
    );
    // Collapse multiple spaces that may result from the replacements above.
    result = result.replaceAll(RegExp(r'\s+'), ' ');
    return result.trim();
  }

  // ── Arrival bottom sheet ──────────────────────────────────────────────────

  /// Shows a persistent, non-dismissible bottom sheet with the trip-complete
  /// summary once the driver has reached the destination.
  ///
  /// The sheet displays:
  ///   • A green checkmark hero icon
  ///   • "Trip Complete" heading and destination message
  ///   • Total distance (miles) and trip duration side-by-side
  ///   • A "Done" button that dismisses the sheet and switches the map to the
  ///     full-route overview
  ///
  /// The sheet is shown by [_triggerArrival] via [WidgetsBinding.addPostFrameCallback]
  /// so that it is always pushed after the current build frame completes.
  void _showArrivalSheet(BuildContext context) {
    final distanceMiles = _routeData?['distanceMiles'];
    final etaMinutes = (_routeData?['etaMinutes'] as num?)?.toInt();

    showModalBottomSheet<void>(
      context: context,
      // Non-dismissible: the driver must tap Done to acknowledge arrival.
      isDismissible: false,
      enableDrag: false,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // ── Arrival hero icon ──────────────────────────────────────
              const Icon(Icons.check_circle, color: Colors.green, size: 64),
              const SizedBox(height: 12),
              // ── Heading ────────────────────────────────────────────────
              const Text(
                'Trip Complete',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'You have arrived at your destination',
                style: TextStyle(fontSize: 14, color: Colors.grey),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              // ── Trip stats row ─────────────────────────────────────────
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _arrivalStat(
                    Icons.straighten,
                    '${distanceMiles ?? "--"} mi',
                    'Distance',
                  ),
                  _arrivalStat(
                    Icons.timer,
                    _formatEta(etaMinutes), // total trip duration (h m)
                    'Trip Time',
                  ),
                ],
              ),
              const SizedBox(height: 28),
              // ── Done button ────────────────────────────────────────────
              // Tapping Done closes the sheet and switches to overview mode
              // so the driver can see the completed route on the full map.
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.green,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onPressed: () {
                    Navigator.of(ctx).pop();
                    // Return to overview mode so the driver sees the full route.
                    if (mounted) {
                      setState(() => _navigationMode = false);
                      if (_routePoints.isNotEmpty && _mapReady) {
                        _fitCameraToRoute(_routePoints);
                      }
                    }
                  },
                  child: const Text(
                    'Done',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  /// Builds a compact stat tile for the arrival bottom sheet.
  ///
  /// Each tile shows an [icon], a primary [value] label (e.g. "423 mi"), and
  /// a secondary [label] description (e.g. "Distance") below it.
  Widget _arrivalStat(IconData icon, String value, String label) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: Colors.green, size: 28),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        Text(
          label,
          style: const TextStyle(fontSize: 12, color: Colors.grey),
        ),
      ],
    );
  }

  /// Builds the premium turn-by-turn navigation banner that floats at the top
  /// of the map, styled like a modern GPS app (Google Maps / Apple Maps).
  ///
  /// Layout (left → right):
  ///   [Turn icon] | [Current instruction + next-step preview] | [Distance]
  ///
  /// A BackdropFilter blur gives the banner a glassy, high-end appearance
  /// when the map tiles are visible behind it.
  ///
  /// The banner is only rendered while [_navSteps] is non-empty so it never
  /// appears before a route has been loaded.
  ///
  /// Arrival mode: when [_isArrived] is true, the banner turns green and shows
  /// a checkmark with "You have arrived" instead of a maneuver instruction.
  Widget _buildNavBanner() {
    // Guard: clamp index so an out-of-sync state never throws a RangeError.
    final safeIndex = _currentStepIndex.clamp(0, _navSteps.length - 1);
    final step = _navSteps[safeIndex];

    // ── Declare all computed values before any UI reference ────────────────
    // Use the stateful _isArrived flag (set by _triggerArrival) rather than
    // recomputing from _hasArrived() so the banner is stable after the GPS
    // subscription has been cancelled.
    final bool isArrived = _isArrived;

    // distanceToNext MUST be declared before isImminent and bannerColor so
    // that Dart's forward-reference rule is never violated.
    final double distanceToNext = _distanceToNextStep();

    // isImminent flags when the driver is within the alert threshold —
    // may be used for accessibility cues or future audio feedback.
    final bool isImminent =
        distanceToNext < _imminentManeuverThresholdMeters;

    // Banner background color: green on arrival, urgency-based otherwise.
    final Color bannerColor =
        isArrived ? Colors.green.shade600 : _getBannerColor(distanceToNext);

    // Next step for driver preview (shown in a smaller, dimmed font below).
    final hasNextStep = !isArrived && safeIndex + 1 < _navSteps.length;
    final nextStep = hasNextStep ? _navSteps[safeIndex + 1] : null;

    return SafeArea(
      bottom: false,
      child: Padding(
        // Horizontal margin and top gap so the banner floats over the map with
        // visible rounded corners on all sides.
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
        // ClipRRect keeps the blur effect clipped to the banner's rounded shape.
        child: ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: BackdropFilter(
            // Subtle frosted-glass blur — mimics the Apple Maps / Google Maps
            // high-end navigation banner aesthetic.
            filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                // Dynamic fill: green on arrival, urgency-based otherwise.
                color: bannerColor,
                borderRadius: BorderRadius.circular(14),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.35),
                    blurRadius: 10,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  // ── Turn icon (left side) ───────────────────────────────────
                  // White icon on dark/coloured background mirrors GPS design.
                  // On arrival show a filled check circle; during navigation
                  // show the maneuver direction icon (turn, straight, etc.).
                  Icon(
                    isArrived ? Icons.check_circle : _maneuverIcon(step.maneuver),
                    color: Colors.white,
                    size: 34,
                  ),
                  const SizedBox(width: 14),
                  // ── Instruction text + next-step preview (centre, expands) ──
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // Current step — bold and prominent for at-a-glance reading.
                        Text(
                          isArrived
                              ? 'You have arrived'
                              : _formatInstruction(step.instruction),
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            fontWeight: FontWeight.bold,
                            height: 1.2,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        // Next step preview — lighter and smaller for driver preview.
                        if (nextStep != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Then: ${_formatInstruction(nextStep.instruction)}',
                            style: const TextStyle(
                              color: Colors.white54,
                              fontSize: 13,
                              height: 1.2,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  // ── Distance to next turn (right side) ──────────────────────
                  // Shows distance to the *next* maneuver only, never total route.
                  // Hidden on arrival since there is no next maneuver.
                  // When isImminent (< threshold), 'Now' is shown directly so
                  // the driver sees an instant cue without sub-threshold maths.
                  if (!isArrived)
                    Text(
                      isImminent ? 'Now' : _formatDistance(distanceToNext),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Semitrack NEW'),
        actions: [
          // Pause / resume navigation tracking.
          // When paused, GPS updates and camera follow are suspended so the
          // driver can review the route without the map moving.
          IconButton(
            tooltip: _navigationPaused ? 'Resume navigation' : 'Pause navigation',
            icon: Icon(
              _navigationPaused ? Icons.play_arrow : Icons.pause,
            ),
            onPressed: () => setState(() => _navigationPaused = !_navigationPaused),
          ),
          // Toggle between navigation mode (close zoom, follows truck) and
          // overview mode (full-route view so the driver can see the whole trip).
          // Disabled after arrival — no further navigation mode switching needed.
          IconButton(
            tooltip: _navigationMode ? 'Show full route' : 'Navigation mode',
            icon: Icon(
              _navigationMode ? Icons.map_outlined : Icons.navigation,
              color: _isArrived ? Colors.grey : null,
            ),
            // Disable the toggle after arrival so the driver cannot re-enter
            // navigation mode (which would restart camera-follow with no GPS).
            onPressed: _isArrived
                ? null
                : () {
                    setState(() => _navigationMode = !_navigationMode);
                    if (_navigationMode && _truckPosition != null && _mapReady) {
                      // Switch to navigation mode: zoom close to truck.
                      _mapController.move(_truckPosition!, _navigationZoomLevel);
                    } else if (!_navigationMode && _routePoints.isNotEmpty && _mapReady) {
                      // Switch to overview mode: fit the full route.
                      _fitCameraToRoute(_routePoints);
                    }
                  },
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            // Disable refresh while loading or after arrival (trip is done).
            onPressed: (_isLoading || _isArrived) ? null : () => fetchRoute(),
          ),
        ],
      ),
      body: Column(
        children: [
          // ── Mapbox map widget (flutter_map) ──────────────────────────────
          Expanded(
            flex: 2,
            child: Stack(
              children: [
                FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(
                    initialCenter: LatLng(
                      (_originLat + _destLat) / 2,
                      (_originLng + _destLng) / 2,
                    ),
                    initialZoom: 6,
                    onMapReady: () {
                      _mapReady = true;
                      fetchRoute();
                    },
                    // Disable camera follow when the user manually interacts
                    // with the map (drag / pinch / scroll) so they can freely
                    // explore without forced camera snaps back to the truck.
                    onMapEvent: (MapEvent event) {
                      if (event is MapEventMoveStart &&
                          event.source != MapEventSource.mapController &&
                          _followTruck) {
                        setState(() => _followTruck = false);
                      }
                    },
                  ),
                  children: [
                    TileLayer(
                      // When a MAPBOX_TOKEN is provided (via --dart-define),
                      // use Mapbox Streets tiles. Restrict the token to your
                      // app's bundle ID in the Mapbox dashboard to limit its
                      // exposure. Falls back to OpenStreetMap otherwise.
                      urlTemplate: _mapboxToken.isNotEmpty
                          ? 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}'
                              '?access_token=$_mapboxToken'
                          : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.semitrack.mobile',
                    ),
                    PolylineLayer(
                      polylines: [
                        if (_routePoints.isNotEmpty)
                          Polyline(
                            points: _routePoints,
                            strokeWidth: 5,
                            color: Colors.blue,
                            strokeJoin: StrokeJoin.round,
                            strokeCap: StrokeCap.round,
                          ),
                      ],
                    ),
                    MarkerLayer(
                      // _buildTruckMarker() + _buildDestinationMarker() are
                      // the flutter_map equivalent of passing a Set<Marker> to
                      // the GoogleMap widget; _updateMarkers() triggers setState
                      // to rebuild this layer whenever position/bearing changes.
                      //
                      // The destination marker is shown only after arrival so
                      // it does not clutter the map during active navigation —
                      // the route polyline already indicates the destination.
                      markers: [
                        _buildTruckMarker(),
                        if (_isArrived) _buildDestinationMarker(),
                      ],
                    ),
                  ],
                ),
                if (_isLoading)
                  const Center(child: CircularProgressIndicator()),
                // ── Navigation banner ─────────────────────────────────────
                // Floats at the top of the map so the current maneuver
                // instruction is always visible during active navigation,
                // independent of the scrollable info panel below the map.
                if (_navSteps.isNotEmpty)
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    child: _buildNavBanner(),
                  ),
                // ── Recenter FAB ──────────────────────────────────────────
                // Always visible in the bottom-right corner.
                // Icon and tooltip change based on follow state:
                //   navigation  = camera is actively following the truck
                //   my_location = user has panned away; tap to re-centre
                // Tapping re-enables camera follow and immediately snaps the
                // camera back to the live truck position/bearing.
                Positioned(
                  bottom: 16,
                  right: 16,
                  child: FloatingActionButton.small(
                    tooltip: _followTruck ? 'Following truck' : 'Recenter on truck',
                    onPressed: () {
                      // Re-enable follow and snap camera to truck immediately.
                      setState(() => _followTruck = true);
                      _followTruckCamera();
                    },
                    child: Icon(
                      _followTruck ? Icons.navigation : Icons.my_location,
                    ),
                  ),
                ),
                // ── Rerouting status indicator ────────────────────────────
                // Shown in the centre of the map while a new route is being
                // fetched from the driver's live position to the destination.
                if (_navStatus != null)
                  Positioned(
                    bottom: 16,
                    left: 0,
                    right: 0,
                    child: Center(
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 20, vertical: 10),
                        decoration: BoxDecoration(
                          color: Colors.orange.withOpacity(0.92),
                          borderRadius: BorderRadius.circular(24),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.2),
                              blurRadius: 8,
                            ),
                          ],
                        ),
                        child: Text(
                          _navStatus!,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 15,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),

          // ── Error banner ─────────────────────────────────────────────────
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                'Error: $_error',
                style: const TextStyle(color: Colors.red),
              ),
            ),

          // ── Route info + Phase 5 intelligence ────────────────────────────
          if (_routeData != null)
            Expanded(
              flex: 1,
              child: _buildRouteInfo(_routeData!),
            ),
        ],
      ),
    );
  }

  Widget _buildRouteInfo(Map<String, dynamic> route) {
    final distanceMiles = route['distanceMiles'];
    final etaMinutes = (route['etaMinutes'] as num?)?.toInt();
    final tollsUsd = route['tollsUsd'];
    final fuelGallons = route['fuelGallonsEstimate'];
    // Raw mode key (e.g. 'fastest') is converted to a friendly label below.
    final routeMode = route['routeMode'] as String? ?? 'fastest';
    final provider = route['provider'] as String? ?? '';
    final live = route['live'] as Map<String, dynamic>?;
    final warnings =
        (route['truckWarnings'] as List?)?.cast<String>() ?? const <String>[];
    final steps = route['turnByTurn'] as List?;

    // Trip ETA: total trip duration derived from the route's distance/speed.
    final tripEtaText = _formatEta(etaMinutes);

    // Phase 5 intelligence from state.
    // Time Left: remaining drive minutes sourced from Drive Intelligence, which
    // is separate from the total trip ETA — a route with an initial 10 h Trip
    // ETA may show 6 h Time Left after 4 hours of driving (or sooner if HOS
    // rules, breaks, or real-time traffic adjustments are factored in).
    final driveMinutesLeft =
        _intelligence['driveMinutesLeft'] as int?;
    final weather = _intelligence['weather'] as String?;
    final riskScore = _intelligence['riskScore'] as double?;

    return ListView(
      padding: const EdgeInsets.only(bottom: 16),
      children: [
        // ── Route Summary ────────────────────────────────────────────────
        // Visual hierarchy: Trip ETA is the primary hero value (large + bold),
        // secondary details (distance, mode, tolls) are displayed below it in
        // a smaller weight so the driver's eye goes straight to arrival time.
        Card(
          margin: const EdgeInsets.all(12),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Text(
                      'Route Summary',
                      style: TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 18),
                    ),
                    const Spacer(),
                    if (provider.isNotEmpty)
                      Chip(
                        label: Text(provider),
                        padding: EdgeInsets.zero,
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                // ── Trip ETA hero row ──────────────────────────────────
                // The arrival duration is the most important single value
                // on this screen; make it the visual focal point.
                Text(
                  tripEtaText,
                  style: const TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Text(
                  'Trip ETA',
                  style: TextStyle(fontSize: 12, color: Colors.grey),
                ),
                const SizedBox(height: 12),
                // ── Secondary details ──────────────────────────────────
                // _formatRouteMode converts raw API keys to friendly labels.
                _labelValue('Mode', _formatRouteMode(routeMode)),
                _labelValue('Distance', '${distanceMiles ?? "--"} mi'),
                if (tollsUsd != null)
                  _labelValue(
                      'Tolls', '\$${(tollsUsd as num).toStringAsFixed(2)}'),
                if (fuelGallons != null)
                  _labelValue('Fuel estimate', '$fuelGallons gal'),
                if (live != null) ...[
                  _labelValue('Traffic', '${live['traffic']}'),
                  _labelValue('Incidents', '${live['incidents']}'),
                ],
              ],
            ),
          ),
        ),

        // ── Phase 5: Drive Intelligence ──────────────────────────────────
        // "Time Left" here is intentionally distinct from "Trip ETA" above:
        // Trip ETA = total route duration; Time Left = remaining drive time
        // reported by the Phase 5 intelligence engine (may reflect HOS rules,
        // break requirements, or real-time traffic adjustments).
        Card(
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Drive Intelligence',
                  style:
                      TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
                const SizedBox(height: 8),
                // Time Left is derived from _intelligence['driveMinutesLeft'],
                // not from the route's etaMinutes, so the two values can
                // diverge as the trip progresses.
                _labelValue('Time Left', _formatEta(driveMinutesLeft)),
                _labelValue('Weather', weather ?? '—'),
                _labelValue('Risk score', _formatRisk(riskScore)),
              ],
            ),
          ),
        ),

        // ── Truck Warnings ───────────────────────────────────────────────
        if (warnings.isNotEmpty)
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Truck Warnings',
                    style: TextStyle(
                        fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 8),
                  for (final w in warnings)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.warning_amber,
                              size: 18, color: Colors.orange),
                          const SizedBox(width: 8),
                          Expanded(child: Text(w)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),

        // ── Turn-by-Turn ─────────────────────────────────────────────────
        Card(
          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Text(
                      'Turn-by-Turn',
                      style: TextStyle(
                          fontWeight: FontWeight.bold, fontSize: 16),
                    ),
                    const Spacer(),
                    if (_navSteps.isNotEmpty)
                      Text(
                        'Step ${_currentStepIndex + 1}/${_navSteps.length}',
                        style: const TextStyle(
                            fontSize: 12, color: Colors.grey),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                // Current active maneuver instruction — displayed prominently
                // so the driver can read it at a glance while driving.
                Text(
                  _navSteps.isNotEmpty
                      ? _navSteps[_currentStepIndex].instruction
                      : (steps != null && steps.isNotEmpty
                          ? (steps[0] as Map<String, dynamic>)['instruction']
                                  as String? ??
                              'Continue'
                          : 'Loading...'),
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                // Upcoming step — shown smaller and dimmed as a preview.
                if (_navSteps.isNotEmpty &&
                    _currentStepIndex + 1 < _navSteps.length)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      'Then: ${_navSteps[_currentStepIndex + 1].instruction}',
                      style: const TextStyle(
                          fontSize: 12, color: Colors.grey),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _labelValue(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}

/// A single turn-by-turn navigation step, holding the driver instruction text,
/// the geographic location of the maneuver, the maneuver modifier (e.g.
/// 'left', 'right', 'straight'), and the step distance in metres.
///
/// [maneuver] is the Mapbox `maneuver.modifier` value and drives the icon
/// displayed in the navigation banner.  [distanceMeters] is summed across
/// remaining steps to derive the remaining-distance label.
class _NavStep {
  const _NavStep(
    this.instruction,
    this.location, {
    this.maneuver = 'straight',
    this.distanceMeters = 0.0,
  });

  /// Human-readable turn instruction, e.g. "Turn left onto Main St".
  final String instruction;

  /// Geographic position of the maneuver waypoint.
  final LatLng location;

  /// Mapbox maneuver modifier: 'left', 'right', 'straight', 'slight left',
  /// 'sharp right', etc.  Used to select the icon shown in the nav banner.
  final String maneuver;

  /// Length of this step in metres, as reported by the Mapbox Directions API.
  final double distanceMeters;
}
