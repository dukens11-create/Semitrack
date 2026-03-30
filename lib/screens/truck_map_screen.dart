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

import '../features/documents/documents_screen.dart';
import '../models/stop_appointment.dart';
import '../models/trip.dart';
import '../models/route_poi.dart';
import '../models/trip_stop.dart';
import '../services/trip_storage.dart';

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

  // ── Trip statistics constants ─────────────────────────────────────────────
  /// Metres per mile conversion factor, used to convert GPS distances to miles.
  static const double _metersPerMile = 1609.34;

  // ── Speed monitoring constants ────────────────────────────────────────────
  /// Conversion factor: 1 m/s = 2.23694 mph.
  static const double _mpsToMph = 2.23694;

  /// Minimum seconds between "Slow down" TTS announcements when the driver
  /// is continuously exceeding the speed limit.  Prevents constant repetition.
  static const int _slowDownThrottleSeconds = 30;

  // ── HOS (Hours of Service) break planning constants ───────────────────────
  /// FMCSA 8-hour rule: warn the driver at 7 h 30 m so they have time to find
  /// a suitable rest stop before the mandatory break at 8 h.
  static const Duration _hosBreakDueSoon = Duration(hours: 7, minutes: 30);
  static const Duration _hosBreakRequired = Duration(hours: 8);

  /// Minimum GPS speed (m/s) to classify a tick as "driving" for HOS purposes.
  /// 0.5 m/s ≈ 1.8 km/h — filters out GPS drift while the truck is parked.
  static const double _hosMovingSpeedThreshold = 0.5;

  /// Maximum elapsed seconds between GPS ticks that may be counted toward the
  /// HOS drive clock.  Guards against skewing the timer during GPS outages or
  /// when the app is resumed from the background after a long pause.
  static const int _hosMaxTickGapSeconds = 120;

  /// Maximum distance in metres from the route polyline for a rest stop to
  /// qualify as a candidate for HOS break recommendations.
  static const double _hosRouteProximityMeters = 5000;

  /// Maximum number of rest stop recommendations shown in the HOS stop sheet.
  static const int _hosMaxStopRecommendations = 3;

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

  // ── Trip statistics ────────────────────────────────────────────────────────
  // Initialized by _startTripStats() when navigation begins and updated on
  // every GPS fix via _updateTripStats().  All fields reset at trip start so
  // the stats always reflect the current navigation session only.

  /// Timestamp when the current trip was started.  Null until
  /// [_startTripStats] is first called (i.e., before any route begins).
  DateTime? _tripStartTime;

  /// Timestamp of the last GPS fix where the truck was moving (speed ≥ 1 m/s).
  DateTime? _lastMoveTime;

  /// Cumulative stopped time accumulated when GPS speed is below 1 m/s.
  /// Resets to [Duration.zero] each time [_startTripStats] is called.
  Duration _stoppedDuration = Duration.zero;

  /// Total miles driven since the trip was started, computed from successive
  /// GPS point-to-point distances via [Geolocator.distanceBetween].
  double _milesDriven = 0.0;

  /// Latitude of the previous GPS fix, used to compute incremental distance.
  /// Zero until the first GPS fix arrives after [_startTripStats] is called.
  double _lastTripLat = 0.0;

  /// Longitude of the previous GPS fix, used to compute incremental distance.
  double _lastTripLng = 0.0;

  /// Timestamp of the previous GPS fix, used to compute the actual elapsed
  /// time between fixes for accurate stopped-time accumulation.
  DateTime? _lastGpsTimestamp;

  /// Navigation status message shown in the UI during special events such as
  /// rerouting (e.g. "Rerouting...").  Null when no status is active.
  String? _navStatus;

  // ── Route-fetch guard (prevents simultaneous or repeated API calls) ────────
  bool _isLoadingRoute = false;

  // ── POI state ─────────────────────────────────────────────────────────────
  //
  // _pois holds POIs filtered to within 5 km of the current route.  Populated
  // by _refreshPois() whenever _routePoints changes.
  // _showPoi* flags are toggled by the filter chip bar above the map.
  List<RoutePoi> _pois = const [];
  bool _showWeighStations = true;
  bool _showRestAreas = true;
  bool _showTruckParking = true;
  bool _showTruckStops = true;
  final Set<String> _warnedPoiIds = {};
  String? _poiApproachBanner;

  // ── Multi-stop trip planner state ─────────────────────────────────────────
  //
  // _tripStops is the ordered list of intermediate waypoints the driver added
  // (between origin and final destination).  Empty = single-destination mode
  // (the existing behaviour is fully preserved).
  //
  // _currentLegIndex tracks which leg is being navigated (0-based):
  //   0 = origin → first stop (or → destination when no stops)
  //   1 = first stop → second stop
  //   …
  //
  // _legData stores per-leg metadata extracted from the Mapbox response:
  //   {distanceMiles: double, etaMinutes: int}
  List<TripStop> _tripStops = [];
  int _currentLegIndex = 0;
  List<Map<String, dynamic>> _legData = [];

  // ── Speed monitoring state ─────────────────────────────────────────────────
  /// Current truck speed in metres per second, sourced from the GPS stream.
  /// Negative (-1.0) when speed is unavailable (e.g. cold start or stationary).
  double _currentSpeedMps = -1.0;

  /// Estimated speed limit in mph for the current road segment.
  /// Updated on every GPS position event using [_estimateSpeedLimit].
  double _speedLimitMph = 65.0;

  /// Timestamp of the last "Slow down" TTS announcement.  Used to throttle
  /// repeated announcements so the driver is not nagged every few seconds.
  DateTime? _lastSlowDownAnnouncementTime;

  // ── HOS (Hours of Service) break timer ────────────────────────────────────
  /// Accumulated driving duration since the last break was reset.
  /// Incremented on each GPS tick when the truck is moving (speed ≥ 0.5 m/s).
  Duration _drivingSinceBreak = Duration.zero;

  /// Wall-clock time of the most recent GPS tick classified as "driving".
  /// Used to measure elapsed time between ticks accurately.
  /// Null when the truck is stopped or the HOS timer has been reset.
  DateTime? _lastDrivingTick;

  /// Prevents repeated stop-suggestion modals within the same due-soon window
  /// (7 h 30 m – 8 h).  Flips true when the first suggestion is shown; resets
  /// once the driver clears the window (e.g. after a break reset).
  bool _hosStopSuggested = false;

  // ── Mock rest stop data (Portland, OR → Winnemucca, NV corridor) ──────────
  /// Hardcoded rest stops used for HOS break recommendations.
  /// In production this list would be fetched from a truck-stop POI API
  /// (e.g. Pilot/Flying J, TruckPark, NATSO) and filtered server-side.
  static const List<Map<String, dynamic>> _mockRestStops = [
    {
      'name': 'Pilot Travel Center',
      'type': 'truck_stop',
      'lat': 45.581,
      'lng': -122.571,
      'address': 'Portland, OR',
      'amenities': ['Diesel', 'Showers', 'Restaurant', 'Parking'],
    },
    {
      'name': "Love's Travel Stop",
      'type': 'truck_stop',
      'lat': 44.057,
      'lng': -123.092,
      'address': 'Eugene, OR',
      'amenities': ['Diesel', 'Showers', 'Fast Food', 'Parking'],
    },
    {
      'name': 'TA Travel Center',
      'type': 'truck_stop',
      'lat': 38.581,
      'lng': -121.494,
      'address': 'Sacramento, CA',
      'amenities': ['Diesel', 'Showers', 'Full Restaurant', 'Truck Repair'],
    },
    {
      'name': 'Flying J Travel Center',
      'type': 'truck_stop',
      'lat': 41.5,
      'lng': -120.5,
      'address': 'Alturas, CA',
      'amenities': ['Diesel', 'Showers', 'Restaurant', 'ATM'],
    },
    {
      'name': 'I-5 Rest Area',
      'type': 'rest_area',
      'lat': 43.5,
      'lng': -122.8,
      'address': 'I-5 NB, Douglas County, OR',
      'amenities': ['Restrooms', 'Picnic Area', 'Pet Area'],
    },
    {
      'name': 'Petro Stopping Center',
      'type': 'truck_stop',
      'lat': 39.8,
      'lng': -120.9,
      'address': 'Susanville, CA',
      'amenities': ['Diesel', 'Showers', 'Iron Skillet Restaurant', 'Truck Repair'],
    },
    {
      'name': 'Truck Parking Area',
      'type': 'parking',
      'lat': 42.1,
      'lng': -121.8,
      'address': 'US-97, Klamath Falls, OR',
      'amenities': ['Truck Parking', 'Restrooms'],
    },
  ];

  // ── Fuel planning state ───────────────────────────────────────────────────
  //
  // Tank size and average MPG are configured once at initialisation and remain
  // constant for the session.  _fuelPercent is updated by _updateFuelFromTrip()
  // as miles are accumulated via GPS.  _fuelWarningShown prevents the low-fuel
  // TTS + modal from firing more than once per low-fuel event — it resets to
  // false whenever the estimated range climbs back above 150 miles.

  /// Total diesel tank capacity in US gallons.  Default 150 gal is typical
  /// for a Class-8 semi-truck with dual 75-gallon saddle tanks.
  double _fuelTankGallons = 150.0;

  /// Current fuel level as a percentage of the full tank (0–100).
  /// Starts at 72 % (a realistic mid-trip state) and decreases as miles
  /// accumulate via [_updateFuelFromTrip].
  double _fuelPercent = 72.0;

  /// Fleet-average diesel fuel economy in miles per gallon.
  /// 6.8 MPG is a real-world average for a loaded Class-8 truck.
  double _avgMpg = 6.8;

  /// True after the low-fuel TTS + modal has been shown for the current
  /// below-150-mile event.  Prevents repeated announcements on every GPS fix.
  bool _fuelWarningShown = false;

  // ── Fuel planning computed getters ────────────────────────────────────────

  /// Gallons remaining in the tank, derived from [_fuelPercent].
  double get _gallonsLeft => _fuelTankGallons * (_fuelPercent / 100.0);

  /// Estimated driving range in miles given current fuel level and average MPG.
  double get _estimatedRangeMiles => _gallonsLeft * _avgMpg;

  /// Human-readable range string, e.g. "689 mi".
  String get _fuelRangeText => '${_estimatedRangeMiles.toStringAsFixed(0)} mi';

  /// Human-readable gallons-remaining string, e.g. "108.0 gal".
  String get _fuelLeftText => '${_gallonsLeft.toStringAsFixed(1)} gal';

  // ── Phase 5 intelligence (driveMinutesLeft, weather, riskScore) ────────────
  // Pre-populated with mock/placeholder values so the Drive Intelligence card
  // is never blank.  These are replaced by real API data once available.
  Map<String, dynamic> _intelligence = const {
    'driveMinutesLeft': 470, // ~7 h 50 m mock ETA
    'weather': 'Clear',      // placeholder weather condition
    'riskScore': 92.0,       // 92 → "Low" risk bucket
  };

  // ── Shipper / receiver appointment state ──────────────────────────────────
  //
  // _tripStops holds the ordered list of dispatch stops for the current load.
  // _appointments maps stopId → StopAppointment with time window, facility,
  // reference, and notes.  Both are seeded with demo data so the overlay is
  // never blank; a real integration would populate them from a dispatcher API.
  List<TripStop> _tripStops = [];
  Map<String, StopAppointment> _appointments = {};

  /// Whether the appointment warning overlay is currently dismissed by the
  /// driver.  Resets to false when a new appointment is saved or a stop's
  /// status changes.
  bool _appointmentWarningDismissed = false;

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

  // ── Route options state ────────────────────────────────────────────────────
  //
  // These fields control the route-request parameters sent to the Mapbox
  // Directions API and are exposed to the driver via the Route Options sheet.
  //
  //   _routeMode      – 'fastest' | 'fuel' | 'truck_safe'
  //   _avoidTolls     – add 'toll' to the exclude list when true
  //   _avoidFerries   – add 'ferry' to the exclude list when true
  //   _preferTruckSafe – gate the post-processing safety check when true
  String _routeMode = 'fastest';
  bool _avoidTolls = false;
  bool _avoidFerries = true;
  bool _preferTruckSafe = true;

  // ── Default route endpoints (Portland, OR → Winnemucca, NV) ───────────────
  static const _originLat = 45.5231;
  static const _originLng = -122.6765;
  static const _destLat = 39.5296;
  static const _destLng = -119.8138;

  static const _origin = LatLng(_originLat, _originLng);
  static const _destination = LatLng(_destLat, _destLng);

  // ── Searchable destination picker ────────────────────────────────────────
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  List<Map<String, dynamic>> _searchSuggestions = const [];
  LatLng? _customDestination;

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
    _seedDemoAppointments();
    // Rebuild whenever search text changes so the clear-icon suffix appears
    // and disappears correctly.
    _searchController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _gpsSubscription?.cancel();
    _animTimer?.cancel();
    _animGeneration++; // cancel any in-flight smooth animation
    _tts.stop();
    _searchController.dispose();
    _searchFocusNode.dispose();
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

  /// Returns the destination [Marker] (red pin).  Uses [_customDestination]
  /// when set, otherwise falls back to the default [_destination].
  Marker _buildDestinationMarker() {
    final point = _customDestination ?? _destination;
    return Marker(
      point: point,
      width: 40,
      height: 40,
      child: const Icon(Icons.location_on, size: 34, color: Colors.red),
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

  // ── POI helpers ───────────────────────────────────────────────────────────

  // ── Mock cities for the trip planner "Add Stop" picker ───────────────────
  //
  // Covers the default Portland → Winnemucca corridor.  Replace with a live
  // geocoding search (e.g. Mapbox Geocoding API) in a production build.
  static final List<TripStop> _mockTripStopOptions = [
    TripStop(id: 'opt_eugene',     name: 'Eugene, OR',       position: const LatLng(44.052, -123.087)),
    TripStop(id: 'opt_medford',    name: 'Medford, OR',      position: const LatLng(42.326, -122.876)),
    TripStop(id: 'opt_redding',    name: 'Redding, CA',      position: const LatLng(40.587, -122.392)),
    TripStop(id: 'opt_sacramento', name: 'Sacramento, CA',   position: const LatLng(38.576, -121.487)),
    TripStop(id: 'opt_reno',       name: 'Reno, NV',         position: const LatLng(39.529, -119.814)),
  ];

  /// Maximum distance (metres) from any route point for a POI to be shown.
  static const double _poiMaxDistanceMeters = 5000;

  // ── Truck Stop POI methods ─────────────────────────────────────────────────

  /// Filters [mockRoutePois] to only those within [_poiMaxDistanceMeters] of
  /// at least one point in [_routePoints], then updates [_pois] and triggers
  /// a rebuild.
  ///
  /// Called whenever a new route is loaded (or re-routed) so that displayed
  /// POIs always match the current route geometry.
  ///
  /// Performance: a coarse lat/lng bounding-box check eliminates most POIs
  /// before the full Geolocator distance call, keeping the nested loop fast
  /// even for routes with thousands of points.
  void _refreshPois() {
    if (!mounted) return;
    // When the route is unknown fall back to all POIs so the map still shows
    // something during initial load / demo mode.
    if (_routePoints.isEmpty) {
      setState(() => _pois = List.of(mockRoutePois));
      return;
    }

    // Pre-compute route bounding box + padding for a cheap O(n) pre-filter.
    // 5 km ≈ 0.045° latitude and ~0.065° longitude at mid-latitudes.
    const double bboxPad = 0.065; // conservative padding in degrees
    double minLat = _routePoints.first.latitude;
    double maxLat = minLat;
    double minLng = _routePoints.first.longitude;
    double maxLng = minLng;
    for (final pt in _routePoints) {
      if (pt.latitude < minLat) minLat = pt.latitude;
      if (pt.latitude > maxLat) maxLat = pt.latitude;
      if (pt.longitude < minLng) minLng = pt.longitude;
      if (pt.longitude > maxLng) maxLng = pt.longitude;
    }
    minLat -= bboxPad;
    maxLat += bboxPad;
    minLng -= bboxPad;
    maxLng += bboxPad;

    final nearby = mockRoutePois.where((poi) {
      // Cheap bounding-box rejection — skips the inner loop for distant POIs.
      final lat = poi.position.latitude;
      final lng = poi.position.longitude;
      if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
        return false;
      }
      // Exact distance check against each route point.
      for (final routePoint in _routePoints) {
        final d = Geolocator.distanceBetween(
          lat,
          lng,
          routePoint.latitude,
          routePoint.longitude,
        );
        if (d <= _poiMaxDistanceMeters) return true;
      }
      return false;
    }).toList();
    setState(() => _pois = nearby);
  }

  /// Returns the accent colour used for the marker and details sheet of a POI.
  Color _poiColor(PoiType type) {
    switch (type) {
      case PoiType.weighStation:
        return Colors.deepOrange;
      case PoiType.restArea:
        return Colors.teal;
      case PoiType.truckParking:
        return Colors.indigo;
      case PoiType.truckStop:
        return Colors.blue;
      case PoiType.portOfEntry:
        return Colors.red;
      case PoiType.inspectionSite:
        return Colors.deepPurple;
    }
  }

  /// Returns the icon used inside each POI marker.
  IconData _poiIcon(PoiType type) {
    switch (type) {
      case PoiType.weighStation:
        return Icons.scale;
      case PoiType.restArea:
        return Icons.hotel;
      case PoiType.truckParking:
        return Icons.local_parking;
      case PoiType.truckStop:
        return Icons.local_gas_station;
      case PoiType.portOfEntry:
        return Icons.flag_outlined;
      case PoiType.inspectionSite:
        return Icons.search;
    }
  }

  /// Builds the list of [Marker]s for currently-visible, filter-enabled POIs.
  ///
  /// Merged into [MarkerLayer] alongside the truck and destination markers so
  /// a single layer handles all map markers.
  List<Marker> _buildPoiMarkers() {
    return _pois.where((poi) {
      // Apply per-type filter toggles.
      switch (poi.type) {
        case PoiType.weighStation:
        case PoiType.portOfEntry:
        case PoiType.inspectionSite:
          return _showWeighStations;
        case PoiType.restArea:
          return _showRestAreas;
        case PoiType.truckParking:
          return _showTruckParking;
        case PoiType.truckStop:
          return _showTruckStops;
      }
    }).map((poi) {
      final color = _poiColor(poi.type);
      return Marker(
        point: poi.position,
        width: 36,
        height: 36,
        child: GestureDetector(
          onTap: () => _showPoiDetailsSheet(poi),
          child: Container(
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: color.withOpacity(0.45),
                  blurRadius: 6,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Icon(_poiIcon(poi.type), color: Colors.white, size: 20),
          ),
        ),
      );
    }).toList();
  }

  /// Shows a modal bottom sheet with details for the tapped [poi].
  ///
  /// Displays name, type, subtitle, and available spots with a close button.
  void _showPoiDetailsSheet(RoutePoi poi) {
    final color = _poiColor(poi.type);
    final statusLabel = switch (poi.status) {
      PoiStatus.open => 'Open',
      PoiStatus.closed => 'Closed',
      PoiStatus.bypassRequired => 'Bypass Required',
      PoiStatus.unknown => 'Status Unknown',
      null => null,
    };
    final statusColor = switch (poi.status) {
      PoiStatus.open => Colors.green.shade700,
      PoiStatus.closed => Colors.red.shade700,
      PoiStatus.bypassRequired => Colors.orange.shade700,
      _ => Colors.grey.shade600,
    };
    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: color,
                  child: Icon(_poiIcon(poi.type), color: Colors.white),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        poi.name,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        poi.type.fullLabel,
                        style: TextStyle(
                          fontSize: 13,
                          color: color,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (statusLabel != null) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: statusColor, width: 1),
                ),
                child: Text(
                  statusLabel,
                  style: TextStyle(
                    fontSize: 13,
                    color: statusColor,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
            if (poi.subtitle != null) ...[
              const SizedBox(height: 12),
              Text(poi.subtitle!, style: const TextStyle(fontSize: 14)),
            ],
            if (poi.availableSpots != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.local_parking, size: 16, color: Colors.grey),
                  const SizedBox(width: 6),
                  Text('\${poi.availableSpots} spots available'),
                ],
              ),
            ],
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: const Text('Close'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Shipper / receiver appointment helpers ────────────────────────────────

  /// Seeds demo trip stops + appointments so the overlay is visible on first
  /// launch.  Replace with a dispatcher API call in production.
  void _seedDemoAppointments() {
    _tripStops = [
      TripStop(
        id: 'stop_1',
        name: 'Portland Freight Hub',
        position: const LatLng(45.5231, -122.6765),
        type: StopType.pickup,
      ),
      TripStop(
        id: 'stop_2',
        name: 'Boise, ID (Waypoint)',
        position: const LatLng(43.6150, -116.2023),
        type: StopType.waypoint,
      ),
      TripStop(
        id: 'stop_3',
        name: 'Reno Distribution Center',
        position: const LatLng(39.5296, -119.8138),
        type: StopType.delivery,
      ),
    ];
    _appointments = {
      'stop_1': StopAppointment(
        stopId: 'stop_1',
        type: 'pickup',
        appointmentTime: DateTime.now().add(const Duration(hours: 1)),
        earliestArrival: DateTime.now().add(const Duration(minutes: 45)),
        latestArrival: DateTime.now().add(const Duration(hours: 2)),
        facilityName: 'Portland Freight Hub',
        referenceNumber: 'BOL-20240101',
        note: 'Dock 4 - call 503-555-0120',
      ),
      'stop_3': StopAppointment(
        stopId: 'stop_3',
        type: 'delivery',
        appointmentTime: DateTime.now().add(const Duration(hours: 13)),
        earliestArrival:
            DateTime.now().add(const Duration(hours: 12, minutes: 30)),
        latestArrival: DateTime.now().add(const Duration(hours: 14)),
        facilityName: 'Reno Distribution Center',
        referenceNumber: 'PO-88421',
        note: 'Gate B - check in at security',
      ),
    };
  }

  /// Simple per-stop ETA estimator: 60 mph average speed from the current
  /// truck position along the ordered stop list.
  static const double _etaAvgSpeedMph = 60.0;
  static const double _metersPerMileAppt = 1609.34;

  DateTime _stopEta(int stopIndex) {
    if (_tripStops.isEmpty || stopIndex >= _tripStops.length) {
      return DateTime.now();
    }
    final origin =
        _truckPosition ?? _tripStops.first.position;
    double totalMeters = 0;
    var from = origin;
    for (int i = 0; i <= stopIndex; i++) {
      totalMeters += Geolocator.distanceBetween(
        from.latitude,
        from.longitude,
        _tripStops[i].position.latitude,
        _tripStops[i].position.longitude,
      );
      from = _tripStops[i].position;
    }
    final miles = totalMeters / _metersPerMileAppt;
    final minutes = (miles / _etaAvgSpeedMph * 60).round();
    return DateTime.now().add(Duration(minutes: minutes));
  }

  /// Returns true when any appointment window will be missed.
  bool get _hasLateAppointment {
    for (int i = 0; i < _tripStops.length; i++) {
      final appt = _appointments[_tripStops[i].id];
      if (appt != null && appt.isLate(_stopEta(i))) return true;
    }
    return false;
  }

  /// Returns true when any appointment is at risk (within 30 min of cutoff).
  bool get _hasAtRiskAppointment {
    if (_hasLateAppointment) return false;
    for (int i = 0; i < _tripStops.length; i++) {
      final appt = _appointments[_tripStops[i].id];
      if (appt != null && appt.isAtRisk(_stopEta(i))) return true;
    }
    return false;
  }

  /// Builds stop markers (numbered pins) for each [TripStop] on the map.
  List<Marker> _buildStopMarkers() {
    if (_tripStops.isEmpty) return const [];
    return List.generate(_tripStops.length, (i) {
      final stop = _tripStops[i];
      Color markerColor;
      switch (stop.type) {
        case StopType.pickup:
          markerColor = Colors.blue.shade700;
          break;
        case StopType.delivery:
          markerColor = Colors.green.shade700;
          break;
        case StopType.waypoint:
          markerColor = Colors.grey.shade600;
          break;
      }
      return Marker(
        point: stop.position,
        width: 34,
        height: 34,
        alignment: Alignment.center,
        child: GestureDetector(
          onTap: () => _showStopAppointmentSheet(i),
          child: Container(
            decoration: BoxDecoration(
              color: markerColor,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.3),
                  blurRadius: 4,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Text(
              '${i + 1}',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 13,
              ),
            ),
          ),
        ),
      );
    });
  }

  /// Returns the complete list of [Marker]s for the [MarkerLayer]:
  /// truck position, destination pin, visible truck stop POIs, and all
  /// trip-planner stop markers.
  ///
  /// Centralises marker assembly so [build] stays clean and future POI types
  /// (weigh stations, parking, etc.) can be merged here in one place.
  List<Marker> _buildMarkers() {
    return [
      _buildTruckMarker(),
      if (_isArrived || _tripStops.isEmpty) _buildDestinationMarker(),
      ..._buildPoiMarkers(),
      ..._buildTripStopMarkers(),
    ];
  }

  // ── Multi-stop trip planner helpers ───────────────────────────────────────

  /// Ordered list of all leg end-points:
  ///   [stop1, stop2, …, destination]
  ///
  /// Used by [_checkLegProgress] and the trip-summary card to iterate legs.
  List<LatLng> get _legDestinations => [
    ..._tripStops.map((s) => s.position),
    _destination,
  ];

  /// Display name of the stop at the end of the current leg.
  String get _currentLegDestinationName {
    if (_currentLegIndex < _tripStops.length) {
      return _tripStops[_currentLegIndex].name;
    }
    return 'Destination';
  }

  /// Sum of all per-leg distances in miles.
  double get _totalTripMiles => _legData.fold(
        0.0,
        (sum, leg) => sum + ((leg['distanceMiles'] as num?)?.toDouble() ?? 0.0),
      );

  /// Sum of all per-leg durations in minutes.
  int get _totalTripEtaMinutes => _legData.fold(
        0,
        (sum, leg) => sum + ((leg['etaMinutes'] as num?)?.toInt() ?? 0),
      );

  /// Builds numbered circle [Marker]s for every trip stop in [_tripStops].
  ///
  /// The stop currently being navigated (index == [_currentLegIndex]) is
  /// highlighted in deep-orange; all other stops use green so the driver can
  /// immediately see which stop is next.  Tapping a marker opens
  /// [_showStopInfoSheet].
  List<Marker> _buildTripStopMarkers() {
    if (_tripStops.isEmpty) return const [];
    return _tripStops.asMap().entries.map((entry) {
      final i = entry.key;
      final stop = entry.value;
      final bool isCurrent = i == _currentLegIndex;
      return Marker(
        point: stop.position,
        width: 40,
        height: 40,
        alignment: Alignment.center,
        child: GestureDetector(
          onTap: () => _showStopInfoSheet(stop, i),
          child: Container(
            decoration: BoxDecoration(
              color: isCurrent ? Colors.deepOrange : Colors.green.shade700,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 2),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.3),
                  blurRadius: 4,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Center(
              child: Text(
                '${i + 1}',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 14,
                ),
                ),
              ),
            ),
          ),
        ),
      );
    }).toList();
  }

  /// Adds a new [TripStop] at [position], naming it "Stop N" automatically.
  ///
  /// Called when the driver long-presses on the map.  A [SnackBar] confirms
  /// the addition and provides a one-tap Undo action.
  void _addStopAtPosition(LatLng position) {
    final id = 'pin_${DateTime.now().millisecondsSinceEpoch}';
    final name = 'Stop ${_tripStops.length + 1}';
    setState(() => _tripStops.add(TripStop(id: id, name: name, position: position)));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Added: $name — open Trip Planner to start'),
        action: SnackBarAction(
          label: 'Undo',
          onPressed: () => setState(() {
            _tripStops.removeWhere((s) => s.id == id);
          }),
        ),
      ),
    );
  }

  /// Checks whether the truck has arrived at the end of the current leg.
  ///
  /// For an intermediate stop ([_currentLegIndex] < last leg): advances the
  /// leg counter and announces the arrival via TTS.
  /// For the final destination (last leg): calls [_triggerArrival] to end
  /// the trip.
  ///
  /// This is called on every GPS fix (via [_checkArrival]) and on every
  /// smooth-animation step (via [_moveTruckSmoothly]) when multi-stop mode is
  /// active.
  void _checkLegProgress(LatLng current) {
    if (_isArrived) return;
    final destinations = _legDestinations;
    if (_currentLegIndex >= destinations.length) return;

    final target = destinations[_currentLegIndex];
    final dist = _distanceBetween(current, target);
    if (dist > _arrivalThresholdMeters) return;

    if (_currentLegIndex < destinations.length - 1) {
      // Arrived at an intermediate stop — advance to the next leg.
      final arrivedName = _currentLegDestinationName;
      setState(() => _currentLegIndex++);
      _speak('Arrived at $arrivedName. Starting next leg.');
    } else {
      // Arrived at the final destination — end the trip.
      _triggerArrival();
    }
  }

  /// Opens a modal bottom sheet that lets the driver:
  ///   • See all planned stops in sequence (origin → stops → destination)
  ///   • Reorder stops by drag-and-drop
  ///   • Remove individual stops
  ///   • Add new stops from a curated pick list
  ///   • Start the multi-stop trip (calls [fetchRoute])
  void _showTripPlannerSheet() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            return DraggableScrollableSheet(
              initialChildSize: 0.55,
              minChildSize: 0.35,
              maxChildSize: 0.88,
              expand: false,
              builder: (_, scrollController) {
                return Column(
                  children: [
                    // ── Drag handle + title ──────────────────────────────
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: Column(
                        children: [
                          Container(
                            width: 40,
                            height: 4,
                            decoration: BoxDecoration(
                              color: Colors.grey.shade400,
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                          const SizedBox(height: 12),
                          const Text(
                            'Plan Trip',
                            style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            'Long-press the map to pin stops',
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.grey.shade600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 1),
                    // ── Stop list ──────────────────────────────────────
                    Expanded(
                      child: ListView(
                        controller: scrollController,
                        children: [
                          // Origin row (non-draggable)
                          ListTile(
                            leading: const CircleAvatar(
                              backgroundColor: Colors.blue,
                              radius: 14,
                              child: Icon(Icons.my_location, color: Colors.white, size: 16),
                            ),
                            title: const Text('Current Location',
                                style: TextStyle(fontWeight: FontWeight.w600)),
                            subtitle: const Text('Starting point'),
                          ),
                          // Reorderable intermediate stops
                          if (_tripStops.isNotEmpty)
                            ReorderableListView(
                              shrinkWrap: true,
                              physics: const NeverScrollableScrollPhysics(),
                              onReorder: (oldIdx, newIdx) {
                                setState(() {
                                  if (newIdx > oldIdx) newIdx--;
                                  final s = _tripStops.removeAt(oldIdx);
                                  _tripStops.insert(newIdx, s);
                                });
                                setSheetState(() {});
                              },
                              children: [
                                for (int i = 0; i < _tripStops.length; i++)
                                  ListTile(
                                    key: ValueKey(_tripStops[i].id),
                                    leading: CircleAvatar(
                                      backgroundColor: Colors.green.shade700,
                                      radius: 14,
                                      child: Text(
                                        '${i + 1}',
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontSize: 12,
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                    title: Text(_tripStops[i].name),
                                    subtitle: Text(
                                      '${_tripStops[i].position.latitude.toStringAsFixed(3)}, '
                                      '${_tripStops[i].position.longitude.toStringAsFixed(3)}',
                                      style: const TextStyle(fontSize: 11),
                                    ),
                                    trailing: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        IconButton(
                                          icon: const Icon(Icons.delete_outline,
                                              color: Colors.red, size: 20),
                                          onPressed: () {
                                            setState(() => _tripStops.removeAt(i));
                                            setSheetState(() {});
                                          },
                                          tooltip: 'Remove stop',
                                        ),
                                        const Icon(Icons.drag_handle,
                                            color: Colors.grey),
                                      ],
                                    ),
                                  ),
                              ],
                            ),
                          // Destination row (non-draggable)
                          ListTile(
                            leading: const CircleAvatar(
                              backgroundColor: Colors.red,
                              radius: 14,
                              child: Icon(Icons.flag, color: Colors.white, size: 16),
                            ),
                            title: const Text('Winnemucca, NV',
                                style: TextStyle(fontWeight: FontWeight.w600)),
                            subtitle: const Text('Final destination'),
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 1),
                    // ── Action buttons ─────────────────────────────────
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          OutlinedButton.icon(
                            icon: const Icon(Icons.add_location_alt),
                            label: const Text('Add Stop'),
                            onPressed: () => _showAddStopDialog(ctx, setSheetState),
                          ),
                          const SizedBox(height: 8),
                          ElevatedButton.icon(
                            icon: const Icon(Icons.navigation),
                            label: Text(
                              _tripStops.isEmpty
                                  ? 'Start Navigation'
                                  : 'Start ${_tripStops.length + 1}-Leg Trip',
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.blue.shade700,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            onPressed: () {
                              Navigator.of(ctx).pop();
                              setState(() {
                                _currentLegIndex = 0;
                                _isArrived = false;
                              });
                              fetchRoute();
                            },
                          ),
                        ],
                      ),
                    ),
                  ],
                );
              },
            );
          },
        );
      },
    );
  }

  /// Shows a dialog listing [_mockTripStopOptions] so the driver can pick a
  /// city to add as an intermediate stop.  The [setSheetState] callback
  /// refreshes the planner sheet after the selection is made.
  void _showAddStopDialog(BuildContext ctx, StateSetter setSheetState) {
    showDialog<void>(
      context: ctx,
      builder: (dCtx) {
        return AlertDialog(
          title: const Text('Add Stop'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('Choose a city along your route:'),
              const SizedBox(height: 8),
              for (final opt in _mockTripStopOptions)
                ListTile(
                  leading: Icon(Icons.place, color: Colors.green.shade700),
                  title: Text(opt.name),
                  dense: true,
                  onTap: () {
                    // Create a new instance with a unique id so duplicates
                    // in the list each have their own key.
                    final newStop = TripStop(
                      id: '${opt.id}_${DateTime.now().millisecondsSinceEpoch}',
                      name: opt.name,
                      position: opt.position,
                    );
                    setState(() => _tripStops.add(newStop));
                    setSheetState(() {});
                    Navigator.of(dCtx).pop();
                  },
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dCtx).pop(),
              child: const Text('Cancel'),
            ),
          ],
        );
      },
    );
  }

  /// Shows a detail sheet when the driver taps a trip-stop marker on the map.
  ///
  /// Displays the stop name, number, and per-leg ETA / distance (when known).
  /// Provides a "Remove Stop" button so the driver can drop the stop from the
  /// trip without opening the full planner sheet.
  void _showStopInfoSheet(TripStop stop, int index) {
    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final bool isCurrent = _currentLegIndex == index;
        final Map<String, dynamic>? ld =
            index < _legData.length ? _legData[index] : null;
        return Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor:
                        isCurrent ? Colors.deepOrange : Colors.green.shade700,
                    child: Text(
                      '${index + 1}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          stop.name,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        if (isCurrent)
                          Text(
                            'Current leg destination',
                            style: TextStyle(
                              color: Colors.deepOrange.shade700,
                              fontSize: 13,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              if (ld != null) ...[
                const SizedBox(height: 14),
                Row(
                  children: [
                    const Icon(Icons.timer, size: 16, color: Colors.grey),
                    const SizedBox(width: 6),
                    Text(
                      'Leg ETA: ${_formatEta((ld['etaMinutes'] as num?)?.toInt())}',
                    ),
                    const SizedBox(width: 16),
                    const Icon(Icons.straighten, size: 16, color: Colors.grey),
                    const SizedBox(width: 6),
                    Text(
                      '${((ld['distanceMiles'] as num?)?.toStringAsFixed(1)) ?? '--'} mi',
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.delete_outline, color: Colors.red),
                  label: const Text(
                    'Remove Stop',
                    style: TextStyle(color: Colors.red),
                  ),
                  onPressed: () {
                    Navigator.of(ctx).pop();
                    setState(() => _tripStops.removeAt(index));
                  },
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: const Text('Close'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  /// Builds the leg progress banner that floats above the nav banner.
  ///
  /// Shows "Leg X/Y → <stop name>" plus the per-leg ETA so the driver always
  /// knows their position in the multi-stop trip at a glance.
  ///
  /// Returns an empty [SizedBox] when there are no intermediate stops or the
  /// trip has ended, so the build tree is never altered in single-dest mode.
  Widget _buildLegBanner() {
    if (_tripStops.isEmpty || _isArrived) return const SizedBox.shrink();
    final int legNum = _currentLegIndex + 1;
    final int totalLegs = _legDestinations.length;
    final String destName = _currentLegDestinationName;
    final Map<String, dynamic>? ld = _currentLegIndex < _legData.length
        ? _legData[_currentLegIndex]
        : null;
    final String etaText = ld != null
        ? _formatEta((ld['etaMinutes'] as num?)?.toInt())
        : '—';

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 0),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.deepOrange.shade700,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.25),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          const Icon(Icons.route, color: Colors.white, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Leg $legNum/$totalLegs  →  $destName',
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 14,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Text(
            etaText,
            style: const TextStyle(color: Colors.white70, fontSize: 13),
          ),
        ],
      ),
    );
  }

  /// Builds a single row in the trip-summary card for [legIndex].
  ///
  /// The currently-active leg is highlighted in deep-orange; completed or
  /// upcoming legs are shown in the default text colour.
  Widget _tripLegRow(int legIndex) {
    final bool isCurrent = legIndex == _currentLegIndex;
    final Map<String, dynamic> ld = _legData[legIndex];
    // fromName: the stop that starts this leg (origin or a previous stop).
    final String fromName =
        legIndex == 0 ? 'Origin' : _tripStops[legIndex - 1].name;
    // toName: the stop at the end of this leg.
    final String toName = legIndex < _tripStops.length
        ? _tripStops[legIndex].name
        : 'Destination';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          // Active-leg indicator bar
          Container(
            width: 4,
            height: 36,
            decoration: BoxDecoration(
              color:
                  isCurrent ? Colors.deepOrange : Colors.grey.shade300,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Leg ${legIndex + 1}: $fromName → $toName',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight:
                        isCurrent ? FontWeight.bold : FontWeight.normal,
                    color: isCurrent
                        ? Colors.deepOrange.shade700
                        : Colors.black87,
                  ),
                ),
                Text(
                  '${((ld['distanceMiles'] as num?)?.toStringAsFixed(0)) ?? '--'} mi  ·  '
                  '${_formatEta((ld['etaMinutes'] as num?)?.toInt())}',
                  style: TextStyle(
                    fontSize: 11,
                    color: Colors.grey.shade600,
                  ),
                ),
              ],
            ),
          ),
          if (isCurrent)
            const Icon(Icons.navigation, size: 16, color: Colors.deepOrange),
        ],
      ),
    );
  }

  /// Shows a read-only detail + edit sheet for the appointment at [stopIndex].
  void _showStopAppointmentSheet(int stopIndex) {
    if (stopIndex >= _tripStops.length) return;
    final stop = _tripStops[stopIndex];
    final appt = _appointments[stop.id];
    final eta = _stopEta(stopIndex);

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Header ─────────────────────────────────────────────
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor: _stopBadgeColor(stop.type),
                    child: Text(
                      '${stopIndex + 1}',
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          stop.name,
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          stop.type.label,
                          style: TextStyle(
                            fontSize: 13,
                            color: _stopBadgeColor(stop.type),
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  // ── Edit button ──────────────────────────────────
                  IconButton(
                    icon: const Icon(Icons.edit),
                    tooltip: 'Edit appointment',
                    onPressed: () {
                      Navigator.pop(ctx);
                      _showEditAppointmentSheet(stopIndex);
                    },
                  ),
                ],
              ),
              const SizedBox(height: 12),

              if (appt == null) ...[
                const Text(
                  'No appointment set for this stop.',
                  style: TextStyle(color: Colors.grey),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    icon: const Icon(Icons.add),
                    label: const Text('Add Appointment'),
                    onPressed: () {
                      Navigator.pop(ctx);
                      _showEditAppointmentSheet(stopIndex);
                    },
                  ),
                ),
              ] else ...[
                // ── ETA vs window ────────────────────────────────────
                _apptDetailRow(Icons.schedule, 'ETA',
                    _formatApptDateTime(eta)),
                if (appt.appointmentTime != null)
                  _apptDetailRow(Icons.calendar_today, 'Appointment',
                      _formatApptDateTime(appt.appointmentTime!)),
                if (appt.earliestArrival != null ||
                    appt.latestArrival != null)
                  _apptDetailRow(
                    Icons.access_time,
                    'Window',
                    '${appt.earliestArrival != null ? _formatApptDateTime(appt.earliestArrival!) : "-"}'
                        '  ->  '
                        '${appt.latestArrival != null ? _formatApptDateTime(appt.latestArrival!) : "-"}',
                  ),
                // ── Lateness warning ─────────────────────────────────
                if (appt.isLate(eta))
                  _statusChip(
                      'LATE - will miss appointment window', Colors.red),
                if (!appt.isLate(eta) && appt.isAtRisk(eta))
                  _statusChip('AT RISK - less than 30 min margin',
                      Colors.orange),
                if (!appt.isLate(eta) && !appt.isAtRisk(eta))
                  _statusChip('On Time', Colors.green),
                const SizedBox(height: 8),
                // ── Facility / reference / note ──────────────────────
                if (appt.facilityName != null)
                  _apptDetailRow(Icons.business, 'Facility',
                      appt.facilityName!),
                if (appt.referenceNumber != null)
                  _apptDetailRow(Icons.tag, 'Reference',
                      appt.referenceNumber!),
                if (appt.note != null && appt.note!.isNotEmpty)
                  _apptDetailRow(
                      Icons.notes, 'Notes', appt.note!),
              ],
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  Color _stopBadgeColor(StopType type) {
    switch (type) {
      case StopType.pickup:
        return Colors.blue.shade700;
      case StopType.delivery:
        return Colors.green.shade700;
      case StopType.waypoint:
        return Colors.grey.shade600;
    }
  }

  Widget _apptDetailRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: Colors.grey),
          const SizedBox(width: 8),
          SizedBox(
            width: 90,
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

  Widget _statusChip(String text, Color color) {
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding:
          const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        text,
        style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: 13),
      ),
    );
  }

  String _formatApptDateTime(DateTime dt) {
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    return '${dt.month}/${dt.day}  $h:$m';
  }

  /// Opens an editable bottom sheet to set / update an appointment.
  void _showEditAppointmentSheet(int stopIndex) {
    if (stopIndex >= _tripStops.length) return;
    final stop = _tripStops[stopIndex];
    final appt = _appointments[stop.id];

    final facilityCtrl =
        TextEditingController(text: appt?.facilityName ?? '');
    final refCtrl =
        TextEditingController(text: appt?.referenceNumber ?? '');
    final noteCtrl = TextEditingController(text: appt?.note ?? '');
    String apptType = appt?.type ?? stop.type.name;
    DateTime? apptTime = appt?.appointmentTime;
    DateTime? earliest = appt?.earliestArrival;
    DateTime? latest = appt?.latestArrival;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            Widget timeTile(
              String label,
              DateTime? value,
              void Function(DateTime) onPicked,
            ) {
              return ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(label,
                    style:
                        const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(
                  value != null
                      ? _formatApptDateTime(value)
                      : 'Not set',
                  style: TextStyle(
                    color:
                        value != null ? Colors.black87 : Colors.grey,
                  ),
                ),
                trailing: const Icon(Icons.access_time),
                onTap: () async {
                  final date = await showDatePicker(
                    context: ctx,
                    initialDate: value ?? DateTime.now(),
                    firstDate: DateTime.now()
                        .subtract(const Duration(days: 1)),
                    lastDate: DateTime.now()
                        .add(const Duration(days: 365)),
                  );
                  if (date == null || !ctx.mounted) return;
                  final time = await showTimePicker(
                    context: ctx,
                    initialTime: value != null
                        ? TimeOfDay.fromDateTime(value)
                        : TimeOfDay.now(),
                  );
                  if (time == null) return;
                  onPicked(DateTime(date.year, date.month, date.day,
                      time.hour, time.minute));
                },
              );
            }

            return Padding(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 20,
                bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
              ),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Edit Appointment – ${stop.name}',
                      style: const TextStyle(
                          fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 12),
                    const Divider(),
                    DropdownButtonFormField<String>(
                      value: apptType,
                      decoration:
                          const InputDecoration(labelText: 'Type'),
                      items: const [
                        DropdownMenuItem(
                            value: 'pickup', child: Text('Pickup')),
                        DropdownMenuItem(
                            value: 'delivery',
                            child: Text('Delivery')),
                        DropdownMenuItem(
                            value: 'waypoint',
                            child: Text('Waypoint')),
                      ],
                      onChanged: (v) {
                        if (v != null) {
                          setSheetState(() => apptType = v);
                        }
                      },
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: facilityCtrl,
                      decoration: const InputDecoration(
                          labelText: 'Facility name',
                          prefixIcon: Icon(Icons.business)),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: refCtrl,
                      decoration: const InputDecoration(
                          labelText: 'Reference / BOL / PO #',
                          prefixIcon: Icon(Icons.tag)),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: noteCtrl,
                      maxLines: 2,
                      decoration: const InputDecoration(
                        labelText: 'Notes (dock #, phone, gate code)',
                        prefixIcon: Icon(Icons.notes),
                      ),
                    ),
                    const Divider(),
                    timeTile('Appointment time', apptTime, (v) {
                      setSheetState(() => apptTime = v);
                    }),
                    timeTile('Earliest arrival', earliest, (v) {
                      setSheetState(() => earliest = v);
                    }),
                    timeTile('Latest arrival (cutoff)', latest, (v) {
                      setSheetState(() => latest = v);
                    }),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        if (_appointments.containsKey(stop.id))
                          Expanded(
                            child: OutlinedButton.icon(
                              icon: const Icon(Icons.delete_outline,
                                  color: Colors.red),
                              label: const Text('Clear',
                                  style:
                                      TextStyle(color: Colors.red)),
                              onPressed: () {
                                setState(() {
                                  _appointments.remove(stop.id);
                                  _appointmentWarningDismissed = false;
                                });
                                Navigator.pop(ctx);
                              },
                            ),
                          ),
                        if (_appointments.containsKey(stop.id))
                          const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton.icon(
                            icon: const Icon(Icons.save),
                            label: const Text('Save'),
                            onPressed: () {
                              setState(() {
                                _appointments[stop.id] =
                                    StopAppointment(
                                  stopId: stop.id,
                                  type: apptType,
                                  appointmentTime: apptTime,
                                  earliestArrival: earliest,
                                  latestArrival: latest,
                                  facilityName:
                                      facilityCtrl.text
                                              .trim()
                                              .isEmpty
                                          ? null
                                          : facilityCtrl.text.trim(),
                                  referenceNumber:
                                      refCtrl.text.trim().isEmpty
                                          ? null
                                          : refCtrl.text.trim(),
                                  note:
                                      noteCtrl.text.trim().isEmpty
                                          ? null
                                          : noteCtrl.text.trim(),
                                );
                                _appointmentWarningDismissed = false;
                              });
                              Navigator.pop(ctx);
                            },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  /// Builds the appointment warning card shown on the map when any stop is
  /// late or at risk.  Dismissed by the driver via a close button.
  Widget _buildAppointmentWarningCard() {
    if (_appointmentWarningDismissed ||
        _tripStops.isEmpty ||
        (!_hasLateAppointment && !_hasAtRiskAppointment)) {
      return const SizedBox.shrink();
    }

    final isLate = _hasLateAppointment;
    final color = isLate ? Colors.red.shade700 : Colors.orange.shade700;
    final icon = isLate ? Icons.alarm_off : Icons.alarm;
    final message = isLate
        ? 'Stop appointment window will be missed!'
        : 'One or more stops are at risk of late arrival.';

    return Positioned(
      left: 12,
      right: 12,
      bottom: 70,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.25),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          children: [
            Icon(icon, color: Colors.white, size: 24),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    message,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  GestureDetector(
                    onTap: () {
                      if (_tripStops.isNotEmpty) {
                        _showStopAppointmentSheet(0);
                      }
                    },
                    child: const Text(
                      'Tap to view stop details',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                        decoration: TextDecoration.underline,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            IconButton(
              icon: const Icon(Icons.close, color: Colors.white70),
              onPressed: () => setState(
                  () => _appointmentWarningDismissed = true),
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(),
            ),
          ],
        ),
      ),
    );
  }

  /// Builds the horizontal [FilterChip] bar that lets the driver toggle which
  /// POI types are shown on the map.
  ///
  /// Placed as a [Positioned] overlay at the top of the map Stack so it
  /// remains accessible in both navigation and overview modes.  When the
  /// navigation banner is active the bar shifts down to avoid overlap.
  Widget _buildPoiFilterBar() {
    // Offset the filter bar below the navigation banner (≈56 px) so both
    // can be visible simultaneously during active turn-by-turn guidance.
    final double topOffset = _navSteps.isNotEmpty ? 64.0 : 8.0;
    return Positioned(
      top: topOffset,
      left: 0,
      right: 0,
      child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _poiFilterChip(
                  label: PoiType.weighStation.label,
                  icon: Icons.scale,
                  color: _poiColor(PoiType.weighStation),
                  selected: _showWeighStations,
                  onSelected: (v) =>
                      setState(() => _showWeighStations = v),
                ),
                const SizedBox(width: 6),
                _poiFilterChip(
                  label: PoiType.restArea.label,
                  icon: Icons.hotel,
                  color: _poiColor(PoiType.restArea),
                  selected: _showRestAreas,
                  onSelected: (v) => setState(() => _showRestAreas = v),
                ),
                const SizedBox(width: 6),
                _poiFilterChip(
                  label: PoiType.truckParking.label,
                  icon: Icons.local_parking,
                  color: _poiColor(PoiType.truckParking),
                  selected: _showTruckParking,
                  onSelected: (v) =>
                      setState(() => _showTruckParking = v),
                ),
                const SizedBox(width: 6),
                _poiFilterChip(
                  label: PoiType.truckStop.label,
                  icon: Icons.local_gas_station,
                  color: _poiColor(PoiType.truckStop),
                  selected: _showTruckStops,
                  onSelected: (v) =>
                      setState(() => _showTruckStops = v),
                ),
              ],
            ),
  /// Opens the trip documents panel in a modal bottom sheet.
  ///
  /// Uses a [DraggableScrollableSheet] so the driver can expand the panel
  /// to full-screen height when reviewing multiple documents, or collapse it
  /// back to a peek height while keeping the map partially visible.
  ///
  /// [_activeTripId] is passed to [TripDocumentsScreen] so the list is
  /// pre-filtered to the current trip's documents.
  void _openDocumentsSheet() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      // Rounded top corners to match the existing bottom sheets in the app.
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        // DraggableScrollableSheet allows expanding/collapsing with a swipe.
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.55, // ~55 % of screen height on open
          minChildSize: 0.35,     // minimum peek height
          maxChildSize: 0.92,     // near full-screen at maximum expansion
          builder: (_, scrollController) {
            return ClipRRect(
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(20)),
              child: TripDocumentsScreen(
                activeTripId: _activeTripId,
              ),
            );
          },
  // ── Weigh station / port-of-entry methods ─────────────────────────────────

  /// Maps a weigh station status string to a colour for the status badge.
  ///
  /// - `'open'`     → red   (driver must stop — urgent)
  /// - `'closed'`   → green (safe to pass)
  /// - `'bypass'`   → blue  (transponder bypass may be used)
  /// - anything else → grey  (unknown status)
  Color _weighStatusColor(PoiStatus? status) {
    switch (status) {
      case PoiStatus.open:
        return Colors.red;
      case PoiStatus.closed:
        return Colors.green;
      case PoiStatus.bypassRequired:
        return Colors.blue;
      default:
        return Colors.grey;
    }
  }

  /// Maps a weigh station status to an alert banner background colour.
  ///
  /// Uses stronger shades so the banner is clearly visible over the map.
  Color _weighAlertColor(RoutePoi poi) {
    switch (poi.status) {
      case PoiStatus.open:
        return Colors.red.shade700;
      case PoiStatus.closed:
        return Colors.green.shade700;
      case PoiStatus.bypassRequired:
        return Colors.blue.shade700;
      default:
        return Colors.orange.shade700;
    }
  }

  /// Formats a distance in metres to a human-readable string.
  ///
  /// Values below 1 000 m are shown as "NNN m"; values from 1 km upward are
  /// shown as "N.N km".  Matches the brevity expected in a navigation overlay.
  String _formatRoadDistance(double meters) {
    if (meters < 1000) {
      return '${meters.toInt()} m';
    }
    return '${(meters / 1000).toStringAsFixed(1)} km';
  }

  /// Returns the nearest [RoutePoi] of type [PoiType.weighStation] or
  /// [PoiType.portOfEntry] from [_pois] to the truck's current GPS
  /// position.  Returns null when [_truckPosition] is unavailable or
  /// [_pois] is empty.
  RoutePoi? _findNearestWeighStation() {
    if (_truckPosition == null) return null;
    RoutePoi? nearest;
    double nearestDistance = double.infinity;

    for (final poi in _pois) {
      if (poi.type != PoiType.weighStation &&
          poi.type != PoiType.portOfEntry) {
        continue;
      }
      final meters = Geolocator.distanceBetween(
        _truckPosition!.latitude,
        _truckPosition!.longitude,
        poi.position.latitude,
        poi.position.longitude,
      );
      if (meters < nearestDistance) {
        nearestDistance = meters;
        nearest = poi;
      }
    }
    return nearest;
  }

  /// Checks whether the truck is within 1 mile (1 609 m) of a weigh station
  /// or port of entry and updates [_upcomingWeighStation] accordingly.
  ///
  /// When the truck enters the 1-mile radius the alert banner is shown and a
  /// one-time TTS warning ("Weigh station ahead") is spoken.  When the truck
  /// leaves the radius (or no position is available) the banner is hidden and
  /// [_weighAlertSpoken] is reset so the warning fires again on the next
  /// approach.
  ///
  /// Call this from the GPS position listener so it runs on every fix.
  Future<void> _checkWeighStationAlert() async {
    if (_truckPosition == null) return;

    final poi = _findNearestWeighStation();

    if (poi == null) {
      if (_upcomingWeighStation != null || _weighAlertSpoken) {
        setState(() {
          _upcomingWeighStation = null;
          _weighAlertSpoken = false;
        });
      }
      return;
    }

    final meters = Geolocator.distanceBetween(
      _truckPosition!.latitude,
      _truckPosition!.longitude,
      poi.position.latitude,
      poi.position.longitude,
    );

    // ~1 mile alert radius
    if (meters <= 1609.0) {
      if (!_weighAlertSpoken) {
        setState(() {
          _upcomingWeighStation = poi;
          _weighAlertSpoken = true;
        });
        await _speak('Weigh station ahead');
      } else {
        setState(() {
          _upcomingWeighStation = poi;
        });
      }
    } else {
      if (_upcomingWeighStation != null || _weighAlertSpoken) {
        setState(() {
          _upcomingWeighStation = null;
          _weighAlertSpoken = false;
        });
      }
    }
  }

  /// Shows a modal bottom sheet with full details for the given [RoutePoi].
  ///
  /// Displays: station name, distance from truck, colour-coded status badge,
  /// bypass availability, driver notes, and a button to centre the map on the
  /// station.
  void _showWeighStationSheet(RoutePoi poi) {
    final double meters = _truckPosition != null
        ? Geolocator.distanceBetween(
            _truckPosition!.latitude,
            _truckPosition!.longitude,
            poi.position.latitude,
            poi.position.longitude,
          )
        : 0.0;

    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) {
        return Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Station name ───────────────────────────────────────────────
              Text(
                poi.name,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 10),
              // ── Status badge + distance ────────────────────────────────────
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: _weighStatusColor(poi.status),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      switch (poi.status) {
                        PoiStatus.open => 'Open',
                        PoiStatus.closed => 'Closed',
                        PoiStatus.bypassRequired => 'Bypass Available',
                        _ => 'Unknown',
                      },
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  if (_truckPosition != null)
                    Text(_formatRoadDistance(meters)),
                ],
              ),
              const SizedBox(height: 14),
              // ── Bypass availability ────────────────────────────────────────
              if (poi.bypassAvailable != null)
                Text(
                  poi.bypassAvailable!
                      ? 'Bypass: Available'
                      : 'Bypass: Not available',
                  style: const TextStyle(fontSize: 16),
                ),
              // ── Driver note ────────────────────────────────────────────────
              if (poi.note != null) ...[
                const SizedBox(height: 8),
                Text(
                  poi.note!,
                  style: const TextStyle(
                      fontSize: 15, color: Colors.black87),
                ),
              ],
              const SizedBox(height: 20),
              // ── Center-on-station button ───────────────────────────────────
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () {
                    Navigator.pop(context);
                    _mapController.move(poi.position, 16);
                  },
                  icon: const Icon(Icons.center_focus_strong),
                  label: const Text('Center on Station'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  /// Builds the list of [Marker]s for each visible weigh station / port of
  /// entry POI in [_pois].
  ///
  /// Returns an empty list when [_showWeighStations] is false.
  List<Marker> _buildWeighStationMarkers() {
    if (!_showWeighStations) return const [];

    return _pois
        .where((poi) =>
            poi.type == PoiType.weighStation ||
            poi.type == PoiType.portOfEntry)
        .map((poi) {
      return Marker(
        point: poi.position,
        width: 36,
        height: 36,
        alignment: Alignment.center,
        child: GestureDetector(
          onTap: () => _showWeighStationSheet(poi),
          child: Container(
            decoration: BoxDecoration(
              color: _weighStatusColor(poi.status),
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.3),
                  blurRadius: 4,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: const Icon(
              Icons.scale,
              color: Colors.white,
              size: 20,
            ),
          ),
        ),
      );
    }).toList();
  }

  /// Returns a colour-coded alert banner positioned near the top of the map
  /// stack when [_upcomingWeighStation] is set (truck within 1 mile of a weigh
  /// station or port of entry).  Returns [SizedBox.shrink] when no alert is
  /// active so the widget tree stays stable.  Tapping the banner opens the
  /// full details sheet via [_showWeighStationSheet].
  Widget _buildWeighStationAlertCard() {
    if (_upcomingWeighStation == null || _truckPosition == null) {
      return const SizedBox.shrink();
    }

    final poi = _upcomingWeighStation!;
    final meters = Geolocator.distanceBetween(
      _truckPosition!.latitude,
      _truckPosition!.longitude,
      poi.position.latitude,
      poi.position.longitude,
    );

    return Positioned(
      left: 16,
      right: 16,
      top: 140,
      child: GestureDetector(
        onTap: () => _showWeighStationSheet(poi),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: _weighAlertColor(poi),
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.2),
                blurRadius: 10,
              ),
            ],
          ),
          child: Row(
            children: [
              const Icon(
                Icons.warning_amber_rounded,
                color: Colors.white,
                size: 28,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      poi.name,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      poi.status ?? poi.subtitle ?? 'Status unknown',
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                _formatRoadDistance(meters),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Builds a single styled [FilterChip] for the POI filter bar.
  Widget _poiFilterChip({
    required String label,
    required IconData icon,
    required Color color,
    required bool selected,
    required ValueChanged<bool> onSelected,
  }) {
    return FilterChip(
      avatar: Icon(icon, size: 14, color: selected ? Colors.white : color),
      label: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          color: selected ? Colors.white : color,
          fontWeight: FontWeight.w600,
        ),
      ),
      selected: selected,
      onSelected: onSelected,
      selectedColor: color,
      checkmarkColor: Colors.white,
      showCheckmark: false,
      backgroundColor: Colors.white.withOpacity(0.9),
      side: BorderSide(color: color, width: 1.2),
      elevation: selected ? 3 : 1,
      pressElevation: 4,
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    );
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

    // ── Trip statistics: update mileage and stopped time from live GPS ───────
    _updateTripStats(position);

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

    // ── Speed update: read GPS speed and compute new speed limit estimate ────
    // pos.speed is in m/s; negative values mean the speed is unavailable.
    final double newSpeedMps =
        position.speed >= 0 ? position.speed : _currentSpeedMps;
    final double newSpeedLimit = _estimateSpeedLimit();

    setState(() {
      // Use the raw GPS fix so the marker reflects actual device location.
      _truckPosition = gpsPoint;
      // Use real device heading for accurate marker rotation.
      _truckBearing = trueBearing;
      // Persist updated speed and speed-limit for the PositionPanel overlay.
      _currentSpeedMps = newSpeedMps;
      _speedLimitMph = newSpeedLimit;
    });

    // ── HOS timer update ──────────────────────────────────────────────────────
    // Must run after setState so _truckPosition is current for distance calcs.
    _updateHosTimer(position);

    // ── Over-speed announcement (throttled) ──────────────────────────────────
    // Only announce during active navigation and when speed data is available.
    if (_navigationMode && newSpeedMps >= 0) {
      final double speedMph = newSpeedMps * _mpsToMph;
      if (speedMph > newSpeedLimit) {
        final now = DateTime.now();
        // Throttle: announce at most once every [_slowDownThrottleSeconds] s.
        if (_lastSlowDownAnnouncementTime == null ||
            now
                    .difference(_lastSlowDownAnnouncementTime!)
                    .inSeconds >=
                _slowDownThrottleSeconds) {
          _lastSlowDownAnnouncementTime = now;
          _speak('Slow down');
        }
      }
    }

    // ── POI proximity warning (weigh stations / ports of entry) ──────────────
    // Warn once per POI when the driver comes within 1 mile.
    _checkPoiProximity(gpsPoint);

    // Keep the camera centred on the truck while in navigation mode.
    if (_navigationMode) {
      _followTruckCamera();
    }

    // ── Fuel warning: check after each GPS fix ────────────────────────────
    _checkFuelWarning();

    // ── Weigh station / port of entry proximity check ────────────────────────
    // Run after position state is updated so _truckPosition is current.
    _checkWeighStationAlert();
  }

  /// Warns the driver when approaching a regulatory POI (weigh station, port of
  /// entry, or inspection site) within [_metersPerMile] (≈ 1609 m).
  ///
  /// Each POI fires the warning at most once per session ([_warnedPoiIds]).
  /// A banner ([_poiApproachBanner]) is shown in the UI and a TTS announcement
  /// is spoken.  The banner dismisses itself after 8 seconds.
  void _checkPoiProximity(LatLng current) {
    if (!_showWeighStations || _pois.isEmpty) return;

    for (final poi in _pois) {
      // Only warn for regulatory POIs.
      if (poi.type != PoiType.weighStation &&
          poi.type != PoiType.portOfEntry &&
          poi.type != PoiType.inspectionSite) continue;

      // Skip if we've already warned about this POI.
      if (_warnedPoiIds.contains(poi.id)) continue;

      final dist = _distanceBetween(current, poi.position);
      if (dist <= _metersPerMile) {
        _warnedPoiIds.add(poi.id);
        final label = poi.type.fullLabel;
        final statusText = switch (poi.status) {
          PoiStatus.open => 'Open',
          PoiStatus.closed => 'Closed',
          PoiStatus.bypassRequired => 'Bypass required',
          _ => '',
        };
        final announcement = statusText.isEmpty
            ? '$label ahead in 1 mile'
            : '$label ahead in 1 mile – $statusText';

        _speak(announcement);

        setState(() => _poiApproachBanner = announcement);
        // Auto-dismiss banner after 8 seconds.
        Future.delayed(const Duration(seconds: 8), () {
          if (mounted) setState(() => _poiApproachBanner = null);
        });
      }
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

  // ── HOS break timer ───────────────────────────────────────────────────────

  /// Updates the HOS drive clock on every GPS position event.
  ///
  /// Accumulates drive time only when the truck is moving (speed ≥
  /// [_hosMovingSpeedThreshold] m/s).  When the truck stops, the tick timer
  /// is paused so parked time is not counted toward HOS.
  ///
  /// Thresholds (FMCSA 8-hour rule):
  ///   7 h 30 m → due-soon  (orange card, stop recommendation shown once)
  ///   8 h      → required  (red card)
  ///
  /// The stop-suggestion flag resets when [_drivingSinceBreak] drops below the
  /// due-soon threshold (i.e. after the driver taps RESET on the HOS card).
  ///
  /// TODO: auto-reset after a 30-minute continuous stop (FMCSA compliant).
  void _updateHosTimer(Position position) {
    final now = DateTime.now();
    final bool isMoving = position.speed >= _hosMovingSpeedThreshold;

    if (isMoving) {
      if (_lastDrivingTick != null) {
        final elapsed = now.difference(_lastDrivingTick!);
        // Guard: only add reasonable intervals (< _hosMaxTickGapSeconds) to
        // avoid skewing the timer during GPS outages or app-background events.
        if (elapsed.inSeconds > 0 &&
            elapsed.inSeconds < _hosMaxTickGapSeconds) {
          setState(() => _drivingSinceBreak += elapsed);
        }
      }
      _lastDrivingTick = now;
    } else {
      // Truck is stopped — pause the tick so parked time is not counted.
      _lastDrivingTick = null;
    }

    final bool dueSoon = _drivingSinceBreak >= _hosBreakDueSoon &&
        _drivingSinceBreak < _hosBreakRequired;
    final bool required = _drivingSinceBreak >= _hosBreakRequired;

    // Show stop recommendation sheet once when the driver enters the due-soon
    // window.  Set the flag immediately (before any async work) to prevent a
    // second GPS tick from triggering a duplicate sheet while the first
    // addPostFrameCallback is still pending.
    if ((dueSoon || required) && !_hosStopSuggested) {
      _hosStopSuggested = true; // Set synchronously to prevent re-entry
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showHosStopSheet(context);
      });
    }

    // Reset the suggestion flag once the driver is no longer in a break window
    // (i.e. they have reset the HOS timer via the card button).
    if (!dueSoon && !required && _hosStopSuggested) {
      _hosStopSuggested = false;
    }
  }

  // ── HOS rest-stop recommendation ──────────────────────────────────────────

  /// Returns rest stops from [_mockRestStops] that lie within
  /// [maxDistanceMeters] of any point on the current route polyline.
  ///
  /// When the route is empty all stops are returned so the feature degrades
  /// gracefully (e.g. before the first route fetch completes).
  List<Map<String, dynamic>> _filterStopsNearRoute({
    double maxDistanceMeters = _hosRouteProximityMeters,
  }) {
    if (_routePoints.isEmpty) return List.of(_mockRestStops);
    return _mockRestStops.where((stop) {
      final lat = stop['lat'] as double;
      final lng = stop['lng'] as double;
      for (final pt in _routePoints) {
        final d = Geolocator.distanceBetween(lat, lng, pt.latitude, pt.longitude);
        if (d <= maxDistanceMeters) return true;
      }
      return false;
    }).toList();
  }

  /// Shows a modal bottom sheet recommending up to 3 rest stops near the route.
  ///
  /// Candidates are filtered with [_filterStopsNearRoute] and sorted by
  /// distance from the current truck position so the nearest options appear
  /// first.  Tapping a stop tile calls [_showRestStopDetail] for POI details.
  void _showHosStopSheet(BuildContext context) {
    final nearby = _filterStopsNearRoute();
    final pos = _truckPosition;
    if (pos != null) {
      nearby.sort((a, b) {
        final dA = Geolocator.distanceBetween(
            pos.latitude, pos.longitude, a['lat'] as double, a['lng'] as double);
        final dB = Geolocator.distanceBetween(
            pos.latitude, pos.longitude, b['lat'] as double, b['lng'] as double);
        return dA.compareTo(dB);
      });
    }
    // Show at most _hosMaxStopRecommendations nearest stops; fall back to the
    // first _hosMaxStopRecommendations mocks if none are close to the route
    // (e.g. very short test route).
    final candidates = (nearby.isNotEmpty ? nearby : _mockRestStops)
        .take(_hosMaxStopRecommendations)
        .toList();

    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Sheet header ───────────────────────────────────────────
              Row(
                children: [
                  const Icon(Icons.king_bed_outlined,
                      color: Colors.orange, size: 28),
                  const SizedBox(width: 10),
                  const Expanded(
                    child: Text(
                      'Recommended Rest Stops',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(ctx).pop(),
                  ),
                ],
              ),
              const Text(
                'Break required soon — top stops along your route:',
                style: TextStyle(fontSize: 13, color: Colors.grey),
              ),
              const SizedBox(height: 12),
              // ── Stop list ──────────────────────────────────────────────
              for (final stop in candidates) ...[
                _buildRestStopTile(ctx, stop),
                const Divider(height: 8),
              ],
            ],
          ),
        );
      },
    );
  }

  /// Builds a single row tile for a rest stop in the recommendation sheet.
  Widget _buildRestStopTile(BuildContext ctx, Map<String, dynamic> stop) {
    final type = stop['type'] as String;
    final IconData typeIcon;
    final Color typeColor;
    switch (type) {
      case 'truck_stop':
        typeIcon = Icons.local_gas_station;
        typeColor = Colors.blue;
        break;
      case 'rest_area':
        typeIcon = Icons.park;
        typeColor = Colors.green;
        break;
      default:
        typeIcon = Icons.local_parking;
        typeColor = Colors.purple;
    }

    // Distance from the current truck position (when known).
    String distLabel = '';
    final pos = _truckPosition;
    if (pos != null) {
      final d = Geolocator.distanceBetween(
        pos.latitude,
        pos.longitude,
        stop['lat'] as double,
        stop['lng'] as double,
      );
      distLabel = d >= 1000
          ? '${(d / 1000).toStringAsFixed(1)} km away'
          : '${d.round()} m away';
    }

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        backgroundColor: typeColor.withOpacity(0.15),
        child: Icon(typeIcon, color: typeColor, size: 20),
      ),
      title: Text(
        stop['name'] as String,
        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
      ),
      subtitle: Text(
        [if (distLabel.isNotEmpty) distLabel, stop['address'] as String]
            .join(' · '),
        style: const TextStyle(fontSize: 12),
      ),
      trailing: const Icon(Icons.chevron_right),
      onTap: () {
        Navigator.of(ctx).pop();
        _showRestStopDetail(stop);
      },
    );
  }

  /// Shows a dialog with detailed POI information for [stop].
  void _showRestStopDetail(Map<String, dynamic> stop) {
    final amenities = (stop['amenities'] as List).cast<String>();
    showDialog<void>(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: Text(stop['name'] as String),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                stop['address'] as String,
                style: const TextStyle(color: Colors.grey, fontSize: 13),
              ),
              const SizedBox(height: 12),
              const Text(
                'Amenities',
                style:
                    TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: amenities
                    .map((a) => Chip(
                          label: Text(a,
                              style: const TextStyle(fontSize: 11)),
                          padding: EdgeInsets.zero,
                          visualDensity: VisualDensity.compact,
                        ))
                    .toList(),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Close'),
            ),
          ],
        );
      },
    );
  }

  // ── Trip statistics logic ──────────────────────────────────────────────────

  /// Resets all trip-statistics fields to zero and stamps [_tripStartTime] to
  /// the current wall-clock time.
  ///
  /// Call this once when route navigation begins (e.g. inside
  /// [_startRouteAnimation]) so that every new navigation session starts with
  /// clean counters regardless of prior trips.
  void _startTripStats() {
    setState(() {
      _tripStartTime = DateTime.now();
      _lastMoveTime = DateTime.now();
      _stoppedDuration = Duration.zero;
      _milesDriven = 0.0;
      // Reset last-known position so the first GPS fix does not compute a
      // bogus distance from (0, 0) to the real location.
      _lastTripLat = 0.0;
      _lastTripLng = 0.0;
      // Reset GPS timestamp so the first fix delta starts fresh.
      _lastGpsTimestamp = null;
    });
  }

  /// Updates trip statistics from the latest [pos] GPS fix.
  ///
  /// On each call:
  ///   1. Adds the metres-to-miles distance from the previous GPS fix to the
  ///      current one to [_milesDriven] using [Geolocator.distanceBetween].
  ///   2. Accumulates [_stoppedDuration] by the real time elapsed since the
  ///      previous GPS fix when [pos.speed] is below 1 m/s (stopped / very
  ///      slow), otherwise records [_lastMoveTime].  Using the actual time
  ///      delta is more accurate than a fixed 1-second increment because GPS
  ///      update frequency varies with speed and device settings.
  ///   3. Stores [pos.latitude] / [pos.longitude] as the new previous fix for
  ///      the next incremental distance calculation.
  ///
  /// No-ops if the trip has not been started ([_tripStartTime] is null).
  void _updateTripStats(Position pos) {
    if (_tripStartTime == null) return;

    final now = DateTime.now();
    final currentLat = pos.latitude;
    final currentLng = pos.longitude;

    // Only compute incremental distance once we have a valid previous fix.
    // Both lat and lng must be non-zero to avoid a bogus distance from the
    // initialization values of (0.0, 0.0).
    if (_lastTripLat != 0.0 && _lastTripLng != 0.0) {
      final meters = Geolocator.distanceBetween(
        _lastTripLat,
        _lastTripLng,
        currentLat,
        currentLng,
      );
      // Convert metres to miles and add to the running total.
      _milesDriven += meters / _metersPerMile;
    }

    // Store the current position as the reference for the next GPS fix.
    _lastTripLat = currentLat;
    _lastTripLng = currentLng;

    // Compute how long it has been since the previous GPS fix so that stopped
    // time reflects real elapsed wall-clock seconds rather than a fixed 1-s
    // estimate per update (GPS fires at varying intervals).
    final fixDelta = _lastGpsTimestamp != null
        ? now.difference(_lastGpsTimestamp!)
        : Duration.zero;

    // Accumulate stopped time when the truck is not moving.
    if (pos.speed < 1.0 && fixDelta > Duration.zero) {
      _stoppedDuration += fixDelta;
    } else if (pos.speed >= 1.0) {
      // Truck is moving — record this as the most recent movement time.
      _lastMoveTime = now;
    }

    // Record when this GPS fix arrived for the next delta calculation.
    _lastGpsTimestamp = now;

    // Trigger a UI rebuild so the trip-stats panel reflects the latest values.
    if (mounted) setState(() {});

    // Update simulated fuel level from the latest mileage total.
    _updateFuelFromTrip();
  }

  // ── Fuel planning logic ───────────────────────────────────────────────────

  /// Updates [_fuelPercent] from the cumulative miles driven so far.
  ///
  /// Simulates diesel consumption by dividing [_milesDriven] by [_avgMpg]
  /// to get gallons used, converting that to a percentage of the full tank,
  /// and clamping the result to [0, 100].
  ///
  /// Call this after [_updateTripStats] so [_milesDriven] is already fresh.
  void _updateFuelFromTrip() {
    if (_milesDriven <= 0) return;
    final gallonsUsed = _milesDriven / _avgMpg;
    final percentLeft =
        100.0 - ((gallonsUsed / _fuelTankGallons) * 100.0);
    setState(() {
      _fuelPercent = percentLeft.clamp(0.0, 100.0);
    });
  }

  /// Returns up to three nearest truck stops from the current position,
  /// sorted closest-first.  Only fuel stops (non-rest-area brands) are
  /// included so the driver sees actionable diesel options.
  ///
  /// Falls back to returning all visible stops when [_truckPosition] is null
  /// (before the first GPS fix), sorted by their original list order.
  List<RoutePoi> _getRecommendedFuelStops() {
    final fuelStops = _pois
        .where((s) => s.type == PoiType.truckStop)
        .toList();

    if (_truckPosition != null) {
      fuelStops.sort((a, b) {
        final da = Geolocator.distanceBetween(
          _truckPosition!.latitude,
          _truckPosition!.longitude,
          a.position.latitude,
          a.position.longitude,
        );
        final db = Geolocator.distanceBetween(
          _truckPosition!.latitude,
          _truckPosition!.longitude,
          b.position.latitude,
          b.position.longitude,
        );
        return da.compareTo(db);
      });
    }

    return fuelStops.take(3).toList();
  }

  /// Shows a modal bottom sheet listing the three nearest recommended fuel
  /// stops.  Tapping a stop dismisses the sheet and opens the full stop
  /// detail sheet via [_showTruckStopSheet].
  void _showFuelRecommendations() {
    if (!mounted) return;
    final stops = _getRecommendedFuelStops();

    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(Icons.local_gas_station,
                      color: Colors.blue, size: 28),
                  const SizedBox(width: 10),
                  const Text(
                    'Recommended Fuel Stops',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (stops.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    'No fuel stops found near the current route.',
                    style: TextStyle(color: Colors.grey),
                  ),
                )
              else
                for (final stop in stops)
                  ListTile(
                    leading: const Icon(Icons.local_gas_station,
                        color: Colors.blue),
                    title: Text(stop.name),
                    subtitle: stop.subtitle != null ? Text(stop.subtitle!) : null,
                    onTap: () {
                      Navigator.of(context).pop();
                      _showPoiDetailsSheet(stop);
                    },
                  ),
            ],
          ),
        );
      },
    );
  }

  /// Checks the current estimated range and, when it drops below 150 miles,
  /// fires a TTS announcement and opens the fuel-stop recommendation sheet —
  /// but only once per low-fuel event.  The warning resets automatically
  /// when the range recovers above the threshold.
  Future<void> _checkFuelWarning() async {
    if (_estimatedRangeMiles > 150) {
      // Range is safe — reset the warning so it fires again if fuel drops later.
      if (_fuelWarningShown) setState(() => _fuelWarningShown = false);
      return;
    }
    // Already warned for this low-fuel event — do not repeat.
    if (_fuelWarningShown) return;
    setState(() => _fuelWarningShown = true);

    await _speak('Fuel stop recommended. Less than 150 miles remaining.');
    if (mounted) {
      _showFuelRecommendations();
    }
  }

  // ── Fuel planning UI ──────────────────────────────────────────────────────

  /// Builds the floating fuel status card that overlays the map.
  ///
  /// Layout: gas-station icon | range + gallons remaining | fuel percentage
  ///
  /// The card turns red when the estimated range drops below 150 miles,
  /// matching the urgency colour convention used in the navigation banner.
  /// Tapping the card when fuel is low opens [_showFuelRecommendations].
  Widget _buildFuelCard() {
    final bool lowFuel = _estimatedRangeMiles < 150;

    return Positioned(
      left: 16,
      right: 16,
      top: 250,
      child: GestureDetector(
        onTap: lowFuel ? _showFuelRecommendations : null,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: lowFuel ? Colors.red : Colors.black87,
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.2),
                blurRadius: 10,
              ),
            ],
          ),
          child: Row(
            children: [
              const Icon(Icons.local_gas_station, color: Colors.white),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      lowFuel ? 'Fuel Stop Needed' : 'Fuel Range',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Range: $_fuelRangeText · Left: $_fuelLeftText',
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                '${_fuelPercent.toStringAsFixed(0)}%',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Trip statistics computed display strings ───────────────────────────────

  /// Returns the elapsed trip time as a formatted "Xh Ym" string, or '--'
  /// when no trip has been started.
  String get _tripElapsedText {
    if (_tripStartTime == null) return '--';
    final diff = DateTime.now().difference(_tripStartTime!);
    final hours = diff.inHours;
    final minutes = diff.inMinutes % 60;
    return '${hours}h ${minutes}m';
  }

  /// Returns the cumulative stopped time as a formatted "Xh Ym" string.
  String get _stoppedTimeText {
    final hours = _stoppedDuration.inHours;
    final minutes = _stoppedDuration.inMinutes % 60;
    return '${hours}h ${minutes}m';
  }

  /// Returns the average speed in mph for this trip, or '--' when the trip
  /// has not started or has not elapsed enough time for a meaningful value.
  String get _avgSpeedText {
    if (_tripStartTime == null) return '--';
    final elapsedSeconds =
        DateTime.now().difference(_tripStartTime!).inSeconds;
    // Avoid division-by-zero and nonsensical values on very short elapsed times.
    if (elapsedSeconds <= 0) return '--';
    final elapsedHours = elapsedSeconds / 3600.0;
    final avg = _milesDriven / elapsedHours;
    return '${avg.toStringAsFixed(1)} mph';
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
    // In multi-stop mode delegate to the leg-aware progress checker so that
    // intermediate stops are advanced before the final arrival is triggered.
    if (_tripStops.isNotEmpty) {
      _checkLegProgress(current);
      return;
    }
    // Single-destination mode: check proximity to the configured destination.
    final dest = _customDestination ?? _destination;
    final dist = _distanceBetween(current, dest);
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
    // Persist the completed trip to local storage.
    _saveCompletedTrip();
    // Speak the arrival announcement (interrupts any in-progress TTS).
    _speak('You have arrived at your destination');
    // Show the trip-complete sheet after the current frame is fully drawn.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _showArrivalSheet(context);
    });
  }

  /// Saves the just-completed trip to [TripStorage] using data from
  /// [_routeData] (distance / ETA from the Mapbox response) and
  /// [_tripStartTime] (wall-clock duration).  Silently no-ops if the
  /// required state is unavailable (e.g. no route was loaded).
  Future<void> _saveCompletedTrip() async {
    final tripDistanceMiles =
        (_routeData?['distanceMiles'] as num?)?.toDouble() ?? _milesDriven;
    final start = _tripStartTime;
    final duration =
        start != null ? DateTime.now().difference(start) : Duration.zero;

    final trip = Trip(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      destinationName: 'Winnemucca, NV',
      distanceMiles: tripDistanceMiles,
      duration: duration,
      completedAt: DateTime.now(),
    );
    await TripStorage.saveTrip(trip);
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

  /// Estimates the speed limit in mph for the current road segment.
  ///
  /// Uses simple heuristics based on the truck's progress along the route to
  /// approximate city vs. highway segments.  In a production implementation
  /// this would query a road-network speed-limit dataset.
  ///
  ///   progress < 5 % or > 95 %  → 35 mph  (city/suburban near start or end)
  ///   everything else            → 65 mph  (highway mid-route)
  double _estimateSpeedLimit() {
    if (_routePoints.isEmpty) return 65.0;
    final double progress = _truckIndex / _routePoints.length;
    // Near the route's start/end we assume a city segment with a lower limit.
    if (progress < 0.05 || progress > 0.95) return 35.0;
    return 65.0;
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
    // Initialize trip statistics so the stats panel shows live data from the
    // moment navigation begins.
    _startTripStats();
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
      // In multi-stop mode, check whether the truck just reached an
      // intermediate stop or the final destination during simulation.
      // _checkLegProgress either advances _currentLegIndex (intermediate
      // stop) or calls _triggerArrival (final), both of which are safe to
      // call during animation — the latter increments _animGeneration,
      // causing the loop to self-cancel on the next iteration.
      if (_tripStops.isNotEmpty) {
        _checkLegProgress(pos);
      }
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

  // ── Searchable destination methods ──────────────────────────────────────

  /// Queries the Mapbox Geocoding API with [query] and updates
  /// [_searchSuggestions] with the returned place features.
  Future<void> _searchDestinations(String query) async {
    if (query.trim().isEmpty) {
      setState(() => _searchSuggestions = const []);
      return;
    }
    final url =
        'https://api.mapbox.com/geocoding/v5/mapbox.places/${Uri.encodeComponent(query)}.json'
        '?access_token=$_mapboxToken'
        '&types=place,address,poi'
        '&country=US'
        '&limit=5';
    try {
      final res = await http.get(Uri.parse(url));
      if (res.statusCode != 200) {
        setState(() => _searchSuggestions = const []);
        return;
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final features =
          (data['features'] as List).cast<Map<String, dynamic>>();
      setState(() => _searchSuggestions = features);
    } catch (_) {
      setState(() => _searchSuggestions = const []);
    }
  }

  /// Sets [_customDestination] from a geocoding [feature] map and starts
  /// routing to that location.
  void _selectDestination(Map<String, dynamic> feature) {
    final coords =
        (feature['geometry']['coordinates'] as List).cast<num>();
    final dest = LatLng(coords[1].toDouble(), coords[0].toDouble());
    final name = feature['place_name'] as String? ?? 'Destination';
    setState(() {
      _customDestination = dest;
      _searchController.text = name;
      _searchSuggestions = const [];
      _isArrived = false;
      _navigationActive = false;
    });
    _searchFocusNode.unfocus();
    fetchRoute();
  }

  /// Called when the user long-presses on the map; shows a confirmation sheet
  /// to set the pressed location as the destination.
  void _onMapLongPress(TapPosition tapPos, LatLng point) {
    _showDestinationConfirmSheet(point);
  }

  /// Displays a bottom sheet asking the user to confirm a map-tapped point as
  /// their destination.  On confirmation, sets [_customDestination] and
  /// triggers [fetchRoute].
  void _showDestinationConfirmSheet(LatLng point) {
    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Set Destination Here?',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              '${point.latitude.toStringAsFixed(5)}, '
              '${point.longitude.toStringAsFixed(5)}',
              style: const TextStyle(color: Colors.grey),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.pop(context);
                      setState(() {
                        _customDestination = point;
                        _searchController.text =
                            '${point.latitude.toStringAsFixed(5)}, '
                            '${point.longitude.toStringAsFixed(5)}';
                        _searchSuggestions = const [];
                        _isArrived = false;
                        _navigationActive = false;
                      });
                      fetchRoute();
                    },
                    child: const Text('Navigate Here'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // ── Search bar UI builders ───────────────────────────────────────────────

  /// Returns the destination search bar with an optional suggestions list
  /// shown directly below it.
  Widget _buildSearchBarArea() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _searchController,
            focusNode: _searchFocusNode,
            decoration: InputDecoration(
              hintText: 'Search destination…',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _searchController.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () {
                        _searchController.clear();
                        setState(() {
                          _searchSuggestions = const [];
                          _customDestination = null;
                        });
                      },
                    )
                  : null,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              contentPadding:
                  const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
            ),
            onChanged: _searchDestinations,
            textInputAction: TextInputAction.search,
          ),
          if (_searchSuggestions.isNotEmpty) _buildSuggestionList(),
        ],
      ),
    );
  }

  /// Returns a scrollable list of geocoding suggestions beneath the search
  /// field.
  Widget _buildSuggestionList() {
    return Container(
      constraints: const BoxConstraints(maxHeight: 200),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: Colors.grey),
        borderRadius:
            const BorderRadius.vertical(bottom: Radius.circular(12)),
      ),
      child: ListView.separated(
        shrinkWrap: true,
        itemCount: _searchSuggestions.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (_, i) {
          final feature = _searchSuggestions[i];
          final name = feature['place_name'] as String? ?? '';
          return ListTile(
            dense: true,
            leading: const Icon(Icons.location_on_outlined, size: 20),
            title:
                Text(name, maxLines: 2, overflow: TextOverflow.ellipsis),
            onTap: () => _selectDestination(feature),
          );
        },
      ),
    );
  }


  /// Fetches a driving route from the Mapbox Directions API and updates all
  /// relevant state fields, including the decoded polyline6 coordinates used
  /// to draw the route on the map.
  ///
  /// When [fromPosition] is provided (e.g. during off-route rerouting), the
  /// route is requested from that live GPS position instead of the default
  /// origin.  The final destination is [_customDestination] when set, or the
  /// default [_destination] otherwise.  When [_tripStops] is non-empty, each
  /// stop is included as an intermediate waypoint in the Mapbox URL so the
  /// route covers the full multi-leg trip.
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
      final profile = _buildRouteProfile();
      final excludeStr = _buildExcludeString();
      final dest = _customDestination ?? _destination;

      // ── Build multi-stop waypoints string ─────────────────────────────────
      // When stops are planned, build a Mapbox URL with all remaining stops as
      // intermediate waypoints.  For a reroute from a live GPS fix, only include
      // stops that have not been reached yet (_currentLegIndex and beyond).
      final remainingStops = fromPosition != null && _tripStops.isNotEmpty
          ? _tripStops.sublist(_currentLegIndex.clamp(0, _tripStops.length))
          : _tripStops;
      final waypointsStr = remainingStops.isEmpty
          ? ''
          : ';${remainingStops.map((s) => '${s.position.longitude},${s.position.latitude}').join(';')}';

      final url =
          "https://api.mapbox.com/directions/v5/$profile/"
          "${from.longitude},${from.latitude}$waypointsStr;${dest.longitude},${dest.latitude}"
          "?overview=full"
          "&geometries=polyline6"
          "&steps=true"
          "&alternatives=true"
          "${excludeStr.isNotEmpty ? '&exclude=$excludeStr' : ''}"
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
      // Only run the safety check when _preferTruckSafe is enabled; drivers
      // who have disabled the truck-safe preference receive whichever route
      // the API returns without the automatic fallback to the alternative.
      // When already on the alternative, we accept the route regardless —
      // no further candidates are available to try.
      if (_preferTruckSafe && !_isTruckSafe(newPoints) && !alternative) {
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

      // ── Extract per-leg data for multi-stop trip summary ──────────────────
      // The Mapbox response includes a legs[] array with one entry per segment
      // (origin→stop1, stop1→stop2, …, stopN→destination).  We store the
      // distance and duration of each leg so the trip summary card and leg
      // banner can show accurate per-leg ETAs.
      final legsRaw = route['legs'] as List?;
      final newLegData = legsRaw != null
          ? legsRaw.map<Map<String, dynamic>>((dynamic leg) {
              final l = leg as Map<String, dynamic>;
              return {
                'distanceMiles':
                    ((l['distance'] as num?)?.toDouble() ?? 0.0) / 1609.34,
                'etaMinutes':
                    (((l['duration'] as num?)?.toDouble() ?? 0.0) / 60)
                        .round(),
              };
            }).toList()
          : <Map<String, dynamic>>[];

      setState(() {
        _navSteps = allSteps;
        _currentStepIndex = 0;
        _routeData = {
          "distanceMiles": (route["distance"] / 1609.34).round(),
          "etaMinutes": (route["duration"] / 60).round(),
          "turnByTurn": turnByTurnList,
          // Snapshot the active mode so _buildRouteInfo() always shows the
          // settings that were used to generate the currently displayed route.
          "routeMode": _routeMode,
          "avoidTolls": _avoidTolls,
          "avoidFerries": _avoidFerries,
        };
        // Store per-leg metadata for the trip summary card and leg banner.
        _legData = newLegData;
        // Reset the leg index to 0 on a full new route fetch (not a reroute
        // from a live GPS fix).  Reroutes preserve _currentLegIndex so the
        // driver continues from the correct leg after a brief off-route detour.
        if (fromPosition == null) _currentLegIndex = 0;
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

      // Refresh the POI list now that we have up-to-date route geometry.
      _refreshPois();
      // Reset proximity warnings so the new route triggers fresh alerts.
      _warnedPoiIds.clear();
      _poiApproachBanner = null;

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
        // Sample lane hint for demonstration; replace with real lane data
        // from a lane-aware API (e.g. Mapbox guidance) when available.
        laneHint: _sampleLaneHint(modifier),
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

  // ── Route options helpers ──────────────────────────────────────────────────

  /// Returns a short user-facing label for the active route mode.
  String _routeModeLabel() {
    switch (_routeMode) {
      case 'fuel':
        return 'Fuel Efficient';
      case 'truck_safe':
        return 'Truck Safe';
      case 'fastest':
      default:
        return 'Fastest';
    }
  }

  /// Builds the Mapbox Directions `profile` path segment from [_routeMode].
  ///
  /// 'fastest' and 'truck_safe' both use driving-traffic so live congestion
  /// data is included; 'fuel' uses the plain driving profile which typically
  /// produces a steady-speed route that avoids stop-and-go traffic.
  String _buildRouteProfile() {
    switch (_routeMode) {
      case 'fuel':
        return 'mapbox/driving';
      case 'fastest':
      case 'truck_safe':
      default:
        return 'mapbox/driving-traffic';
    }
  }

  /// Builds the `exclude` query-string value from the current avoidance flags.
  ///
  /// Returns an empty string when nothing is excluded so the caller can
  /// conditionally append the `&exclude=…` segment to avoid a malformed URL.
  String _buildExcludeString() {
    final items = <String>[];
    if (_avoidTolls) items.add('toll');
    if (_avoidFerries) items.add('ferry');
    return items.join(',');
  }

  // ── Route options UI ───────────────────────────────────────────────────────

  /// Floating action button that opens the Route Options bottom sheet.
  Widget _buildRouteOptionsButton() {
    return Positioned(
      top: 16,
      right: 16,
      child: FloatingActionButton.small(
        heroTag: 'route_options',
        tooltip: 'Route options',
        onPressed: _isArrived ? null : _showRouteOptionsSheet,
        backgroundColor: _isArrived ? Colors.grey : Colors.white,
        foregroundColor: _isArrived ? Colors.white : Colors.blue.shade700,
        child: const Icon(Icons.tune),
      ),
    );
  }

  /// Shows a modal bottom sheet that lets the driver choose a route mode and
  /// toggle avoidance preferences, then re-fetches the route when confirmed.
  void _showRouteOptionsSheet() {
    // Local copies so the driver can cancel without mutating state.
    String tempMode = _routeMode;
    bool tempTolls = _avoidTolls;
    bool tempFerries = _avoidFerries;
    bool tempTruckSafe = _preferTruckSafe;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            return Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ── Header ─────────────────────────────────────────────
                  Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'Route Options',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => Navigator.of(ctx).pop(),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),

                  // ── Route mode ─────────────────────────────────────────
                  const Text(
                    'Route Mode',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 8),
                  SegmentedButton<String>(
                    segments: const [
                      ButtonSegment(
                        value: 'fastest',
                        label: Text('Fastest'),
                        icon: Icon(Icons.speed,
                            semanticLabel: 'Fastest route'),
                      ),
                      ButtonSegment(
                        value: 'fuel',
                        label: Text('Fuel'),
                        icon: Icon(Icons.local_gas_station,
                            semanticLabel: 'Fuel-efficient route'),
                      ),
                      ButtonSegment(
                        value: 'truck_safe',
                        label: Text('Truck Safe'),
                        icon: Icon(Icons.local_shipping,
                            semanticLabel: 'Truck-safe route'),
                      ),
                    ],
                    selected: {tempMode},
                    onSelectionChanged: (s) =>
                        setSheetState(() => tempMode = s.first),
                  ),

                  const SizedBox(height: 16),

                  // ── Avoidance toggles ──────────────────────────────────
                  const Text(
                    'Avoid',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Tolls'),
                    value: tempTolls,
                    onChanged: (v) => setSheetState(() => tempTolls = v),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Ferries'),
                    value: tempFerries,
                    onChanged: (v) => setSheetState(() => tempFerries = v),
                  ),

                  const SizedBox(height: 4),

                  // ── Truck safety post-processing ───────────────────────
                  const Text(
                    'Safety',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Auto-select safe alternative routes'),
                    subtitle: const Text(
                      'Avoids routes through restricted zones',
                      style: TextStyle(fontSize: 12),
                    ),
                    value: tempTruckSafe,
                    onChanged: (v) => setSheetState(() => tempTruckSafe = v),
                  ),

                  const SizedBox(height: 8),

                  // ── Apply button ───────────────────────────────────────
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      icon: const Icon(Icons.refresh),
                      label: const Text('Apply & Reroute'),
                      onPressed: () {
                        Navigator.of(ctx).pop();
                        _applyRouteOptionsAndRefresh(
                          mode: tempMode,
                          avoidTolls: tempTolls,
                          avoidFerries: tempFerries,
                          preferTruckSafe: tempTruckSafe,
                        );
                      },
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  /// Persists the chosen route options to state and re-fetches the route.
  ///
  /// When a live GPS position is available the re-fetch starts from the
  /// truck's current location; otherwise it falls back to the default origin.
  void _applyRouteOptionsAndRefresh({
    required String mode,
    required bool avoidTolls,
    required bool avoidFerries,
    required bool preferTruckSafe,
  }) {
    setState(() {
      _routeMode = mode;
      _avoidTolls = avoidTolls;
      _avoidFerries = avoidFerries;
      _preferTruckSafe = preferTruckSafe;
    });
    // Re-fetch from the truck's current position when GPS is active so the
    // new route starts from where the driver actually is.
    fetchRoute(fromPosition: _truckPosition);
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

  /// Returns a chip background [Color] for the lane-hint label.
  ///
  /// Directional keywords drive the colour so drivers instantly associate
  /// colour with action:
  ///   contains 'left'     → blue
  ///   contains 'right'    → green
  ///   contains 'straight' → orange
  ///   anything else       → white24 (neutral)
  Color _laneHintColor(String? laneHint) {
    if (laneHint == null || laneHint.isEmpty) return Colors.white24;
    final text = laneHint.toLowerCase();
    if (text.contains('left')) return Colors.blue;
    if (text.contains('right')) return Colors.green;
    if (text.contains('straight')) return Colors.orange;
    return Colors.white24;
  }

  /// Returns a sample lane guidance hint for [modifier] used as mock data
  /// until a lane-aware API source is integrated.
  ///
  /// Only turn-type maneuvers receive a hint; straight/continue steps return
  /// null so the chip is hidden for simple forward movement.
  String? _sampleLaneHint(String modifier) {
    switch (modifier.toLowerCase()) {
      case 'left':
      case 'slight left':
        return 'Keep left';
      case 'sharp left':
        return 'Use left 2 lanes';
      case 'right':
      case 'slight right':
        return 'Use right lane';
      case 'sharp right':
        return 'Use right 2 lanes';
      case 'merge':
        return 'Stay straight';
      default:
        return null;
    }
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

  // ── Trip Stats panel ──────────────────────────────────────────────────────

  /// Builds the live Trip Stats overlay card.
  ///
  /// Shows four live-updating metrics in two rows:
  ///   Top row:    Miles driven  |  Elapsed time
  ///   Bottom row: Stopped time  |  Average speed
  ///
  /// The card is only rendered when [_tripStartTime] is non-null (i.e. after
  /// navigation has begun), so it never appears on a blank map.  All values
  /// update on every [setState] call triggered by [_updateTripStats].
  Widget _buildTripStatsPanel() {
    return Positioned(
      // Position above the rerouting status indicator (bottom: 16) and any
      // future bottom-bar UI.  Horizontal padding matches the nav banner.
      left: 16,
      right: 16,
      bottom: 110,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.18),
              blurRadius: 10,
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Trip Stats',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            // ── Top row: miles driven + elapsed time ─────────────────────
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _statItem('Miles', _milesDriven.toStringAsFixed(1)),
                _statItem('Elapsed', _tripElapsedText),
              ],
            ),
            const SizedBox(height: 10),
            // ── Bottom row: stopped time + average speed ──────────────────
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _statItem('Stopped', _stoppedTimeText),
                _statItem('Avg Speed', _avgSpeedText),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// Builds a single labelled stat item for the Trip Stats panel.
  ///
  /// [label] is rendered in a small grey caption style; [value] is rendered
  /// bold below it — matching the visual hierarchy used in real trucking apps.
  Widget _statItem(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Colors.grey,
            fontSize: 12,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
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
                        // Lane guidance chip — shown when a lane hint is
                        // available for the current step (e.g. 'Keep left',
                        // 'Use right 2 lanes').  Hidden on arrival.
                        if (!isArrived &&
                            step.laneHint != null &&
                            step.laneHint!.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 5,
                            ),
                            decoration: BoxDecoration(
                              color: _laneHintColor(step.laneHint),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              step.laneHint!,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
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

  /// Builds the live speed / speed-limit overlay panel (PositionPanel).
  ///
  /// Always visible while [_navigationMode] is active, positioned at the
  /// bottom-right corner of the map.  The panel displays:
  ///   • Current speed in mph (computed from GPS m/s via [_mpsToMph]).
  ///   • Estimated speed limit badge (from [_estimateSpeedLimit] mock logic).
  ///   • Red text + red border when the driver exceeds the speed limit.
  ///
  /// "0" is shown when speed data is not yet available (e.g. cold GPS start).
  Widget _buildSpeedPanel() {
    // Convert m/s → mph; clamp to 0 when speed is unavailable.
    final double speedMph =
        _currentSpeedMps >= 0 ? _currentSpeedMps * _mpsToMph : 0.0;
    // Overspeed flag: only active when we have a valid speed reading.
    final bool overLimit =
        _currentSpeedMps >= 0 && speedMph > _speedLimitMph;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.black87,
        borderRadius: BorderRadius.circular(10),
        // Highlight the panel border in red when the driver is over the limit.
        border: overLimit
            ? Border.all(color: Colors.red, width: 2)
            : Border.all(color: Colors.transparent, width: 2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.35),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── Current speed ─────────────────────────────────────────────────
          // Red text when over the limit; white otherwise.
          Text(
            speedMph.toStringAsFixed(0),
            style: TextStyle(
              color: overLimit ? Colors.red : Colors.white,
              fontSize: 28,
              fontWeight: FontWeight.bold,
              height: 1.0,
            ),
          ),
          const Text(
            'mph',
            style: TextStyle(
              color: Colors.white70,
              fontSize: 11,
            ),
          ),
          const SizedBox(height: 6),
          // ── Speed-limit badge ─────────────────────────────────────────────
          // Styled like a US road speed-limit sign: white background, black
          // text, "LIMIT" caption above the numeric value.
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(4),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'LIMIT',
                  style: TextStyle(
                    color: Colors.black87,
                    fontSize: 8,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.8,
                  ),
                ),
                Text(
                  _speedLimitMph.toStringAsFixed(0),
                  style: const TextStyle(
                    color: Colors.black,
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    height: 1.0,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Builds the HOS (Hours of Service) break status overlay card.
  ///
  /// Positioned at the bottom-left of the map during active navigation.
  /// Color coding follows the FMCSA 8-hour rule:
  ///   • black   — normal driving window (< 7 h 30 m)
  ///   • orange  — break due soon (7 h 30 m – 8 h)
  ///   • red     — break required immediately (≥ 8 h)
  ///
  /// A RESET button lets the driver acknowledge the break and restart the clock.
  /// TODO: auto-reset after a verified 30-minute continuous stop (FMCSA HOS).
  Widget _buildHosCard() {
    final Duration driving = _drivingSinceBreak;
    final bool dueSoon =
        driving >= _hosBreakDueSoon && driving < _hosBreakRequired;
    final bool required = driving >= _hosBreakRequired;

    // Card background color matches urgency level.
    final Color cardColor = required
        ? Colors.red.shade700
        : dueSoon
            ? Colors.orange.shade700
            : Colors.black87;

    final String statusLabel = required
        ? 'BREAK REQUIRED'
        : dueSoon
            ? 'BREAK DUE SOON'
            : 'HOS';

    // Format accumulated drive time as "Xh Ym" or "Ym".
    final int h = driving.inHours;
    final int m = driving.inMinutes.remainder(60);
    final String timeLabel = h > 0 ? '${h}h ${m}m' : '${m}m';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: cardColor,
        borderRadius: BorderRadius.circular(10),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.35),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // ── Status label ───────────────────────────────────────────────
          Text(
            statusLabel,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 9,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 2),
          // ── Accumulated drive time ─────────────────────────────────────
          Text(
            timeLabel,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.bold,
              height: 1.0,
            ),
          ),
          const Text(
            'driving',
            style: TextStyle(color: Colors.white70, fontSize: 10),
          ),
          const SizedBox(height: 6),
          // ── Reset button ───────────────────────────────────────────────
          // Driver taps this after taking their break to restart the clock.
          GestureDetector(
            onTap: () {
              setState(() {
                _drivingSinceBreak = Duration.zero;
                _lastDrivingTick = null;
                _hosStopSuggested = false;
              });
            },
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                borderRadius: BorderRadius.circular(4),
              ),
              child: const Text(
                'RESET',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 9,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.8,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

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
          // ── Destination search bar ────────────────────────────────────
          _buildSearchBarArea(),

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
                    // Long-press the map (outside active navigation) to drop a
                    // trip-planner stop at the tapped position.
                    onLongPress: (tapPosition, latLng) {
                      if (!_navigationActive) {
                        _addStopAtPosition(latLng);
                      }
                    },
                    // Disable camera follow when the user manually interacts
                    // with the map (drag / pinch / scroll) so they can freely
                    // explore without forced camera snaps back to the truck.
                    onMapEvent: (MapEvent event) {
                      if (event is MapEventMoveStart &&
                          event.source != MapEventSource.mapController) {
                        if (_searchFocusNode.hasFocus) {
                          _searchFocusNode.unfocus();
                        }
                        if (_followTruck) {
                          setState(() => _followTruck = false);
                        }
                      }
                    },
                    onLongPress: _onMapLongPress,
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
                      // _buildMarkers() assembles the truck marker, the optional
                      // destination pin, and all visible truck stop POI markers
                      // into a single list.  Adding new POI types in the future
                      // only requires updating _buildMarkers() in one place.
                      markers: _buildMarkers(),
                    ),
                  ],
                ),
                if (_isLoading)
                  const Center(child: CircularProgressIndicator()),
                // ── Navigation + leg banners ──────────────────────────────
                // Both banners are stacked vertically at the top of the map.
                // The nav banner shows the upcoming turn maneuver; the leg
                // banner (multi-stop only) shows which leg is active and its
                // ETA so the driver always knows their position in the trip.
                // _buildNavBanner() carries its own SafeArea so the outer
                // Positioned does not add a second one.
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: Column(
                    children: [
                      if (_navSteps.isNotEmpty) _buildNavBanner(),
                      _buildLegBanner(),
                    ],
                  ),
                ),
                // ── POI filter bar ────────────────────────────────────────
                // Horizontal chip row lets drivers toggle weigh stations,
                // rest areas, truck parking, and truck stops independently.
                // Rendered above the navigation banner area (offset downward
                // when the nav banner is active to avoid overlap).
                _buildPoiFilterBar(),
                // ── Route Options FAB ──────────────────────────────────────
                // Top-right corner of the map; opens the options bottom sheet
                // so the driver can change route mode and avoidance settings.
                _buildRouteOptionsButton(),
                // ── Weigh station proximity alert card ────────────────────
                // Shown when the truck is within 1 mile of a weigh station
                // or port of entry.  Banner colour reflects open/closed/bypass
                // status; tapping it opens the full details sheet.
                _buildWeighStationAlertCard(),
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
                // ── Trip Stats panel ──────────────────────────────────────
                // Overlays live trip metrics (miles, elapsed time, stopped
                // time, average speed) at the bottom of the map.  Only shown
                // once navigation has started (_tripStartTime != null) so the
                // panel never appears on a blank or pre-route map view.
                if (_tripStartTime != null) _buildTripStatsPanel(),
                // ── Appointment warning card ──────────────────────────────
                // Warns the driver when any stop's ETA exceeds the appointment
                // window or is within 30 min of the cutoff.  Dismissible.
                _buildAppointmentWarningCard(),
                // ── Fuel card ─────────────────────────────────────────────
                // Shows estimated range, gallons remaining, and fuel %.
                // Turns red and becomes tappable when range is below 150 mi.
                // Only shown once navigation is underway.
                if (_tripStartTime != null) _buildFuelCard(),
                // ── Speed / speed-limit panel (PositionPanel) ─────────────
                // Always visible during active navigation.  Positioned at the
                // bottom-right corner of the map so it never obscures the
                // navigation banner or the rerouting indicator.
                if (_navigationMode)
                  Positioned(
                    bottom: 24,
                    right: 16,
                    child: _buildSpeedPanel(),
                  ),
                // ── HOS break status card ─────────────────────────────────
                if (_navigationMode)
                  Positioned(
                    bottom: 80,
                    left: 16,
                    child: _buildHosCard(),
                  ),
                // ── POI approach warning banner ───────────────────────────
                if (_poiApproachBanner != null)
                  Positioned(
                    top: _navSteps.isNotEmpty ? 72 : 12,
                    left: 16,
                    right: 16,
                    child: Material(
                      elevation: 4,
                      borderRadius: BorderRadius.circular(12),
                      color: Colors.orange.shade800,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 10),
                        child: Row(
                          children: [
                            const Icon(Icons.warning_amber_rounded,
                                color: Colors.white, size: 20),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _poiApproachBanner!,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14,
                                ),
                              ),
                            ),
                            GestureDetector(
                              onTap: () =>
                                  setState(() => _poiApproachBanner = null),
                              child: const Icon(Icons.close,
                                  color: Colors.white, size: 18),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                Positioned(
                  bottom: 24,
                  left: 12,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _buildPoiFilterChip(
                        label: 'Fuel & Rest',
                        icon: Icons.local_gas_station,
                        selected: _showTruckStops,
                        color: Colors.blue.shade700,
                        onSelected: (v) =>
                            setState(() => _showTruckStops = v),
                      ),
                      const SizedBox(height: 6),
                      _buildPoiFilterChip(
                        label: 'Weigh Stations',
                        icon: Icons.monitor_weight_outlined,
                        selected: _showWeighStations,
                        color: Colors.orange.shade700,
                        onSelected: (v) =>
                            setState(() => _showWeighStations = v),
                      ),
                    ],
                  ),
                ),
                // ── Documents FAB ─────────────────────────────────────────
                // Quick-access button for the trip documents panel.
                // Positioned just above the POI toggle FAB on the left so it
                // is always reachable during active navigation.  Opens the
                // TripDocumentsScreen in a DraggableScrollableSheet so the
                // driver can review / add paperwork without leaving the map.
                Positioned(
                  bottom: 72,
                  left: 16,
                  child: FloatingActionButton.small(
                    heroTag: 'docs_fab',
                    tooltip: 'Trip documents',
                    backgroundColor: Colors.indigo.shade600,
                    onPressed: _openDocumentsSheet,
                    child: const Icon(Icons.description, color: Colors.white),
                  ),
                ),
                // ── Plan Trip FAB ─────────────────────────────────────────
                // Opens the multi-stop trip planner bottom sheet.  A badge
                // on the icon shows the number of planned stops so the driver
                // can see at a glance whether stops are queued.  The button
                // is shown at all times so drivers can plan before departing.
                Positioned(
                  bottom: 120,
                  left: 16,
                  child: FloatingActionButton.small(
                    heroTag: 'plan_trip',
                    tooltip: _tripStops.isEmpty
                        ? 'Plan multi-stop trip'
                        : 'Trip planner (${_tripStops.length} stop${_tripStops.length == 1 ? '' : 's'})',
                    backgroundColor: _tripStops.isNotEmpty
                        ? Colors.green.shade700
                        : Colors.blueGrey.shade700,
                    onPressed: _showTripPlannerSheet,
                    child: Stack(
                      alignment: Alignment.center,
                      clipBehavior: Clip.none,
                      children: [
                        const Icon(Icons.route, color: Colors.white),
                        if (_tripStops.isNotEmpty)
                          Positioned(
                            right: -4,
                            top: -4,
                            child: Container(
                              width: 16,
                              height: 16,
                              decoration: const BoxDecoration(
                                color: Colors.orange,
                                shape: BoxShape.circle,
                              ),
                              child: Center(
                                child: Text(
                                  '${_tripStops.length}',
                                  style: const TextStyle(
                                    fontSize: 10,
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ),
                          ),
                      ],
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
    final routeAvoidTolls = route['avoidTolls'] as bool? ?? false;
    final routeAvoidFerries = route['avoidFerries'] as bool? ?? false;
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
                // ── Avoidance badges ───────────────────────────────────
                if (routeAvoidTolls || routeAvoidFerries) ...[
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    children: [
                      if (routeAvoidTolls)
                        const Chip(
                          label: Text('No Tolls'),
                          avatar: Icon(Icons.money_off, size: 16,
                              semanticLabel: 'Avoiding tolls'),
                          visualDensity: VisualDensity.compact,
                          padding: EdgeInsets.zero,
                        ),
                      if (routeAvoidFerries)
                        const Chip(
                          label: Text('No Ferries'),
                          avatar: Icon(Icons.directions_boat_outlined,
                              size: 16,
                              semanticLabel: 'Avoiding ferries'),
                          visualDensity: VisualDensity.compact,
                          padding: EdgeInsets.zero,
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),

        // ── Multi-stop Trip Summary ───────────────────────────────────────
        // Shown only when a multi-stop trip is active and per-leg data has
        // been populated by fetchRoute.  Displays each leg's distance and ETA
        // plus a total row so the driver can see the full trip scope at once.
        if (_tripStops.isNotEmpty && _legData.isNotEmpty)
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
                        'Trip Summary',
                        style: TextStyle(
                            fontWeight: FontWeight.bold, fontSize: 16),
                      ),
                      const Spacer(),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: Colors.blue.shade50,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '${_legDestinations.length} leg${_legDestinations.length == 1 ? '' : 's'}',
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.blue.shade800,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  // Per-leg rows
                  for (int i = 0; i < _legData.length; i++) ...[
                    _tripLegRow(i),
                    if (i < _legData.length - 1)
                      const Divider(height: 8, indent: 14),
                  ],
                  const Divider(height: 16),
                  // Total row
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Total',
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      Text(
                        '${_totalTripMiles.toStringAsFixed(0)} mi  ·  ${_formatEta(_totalTripEtaMinutes)}',
                        style: const TextStyle(fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
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

        // ── Dispatch Stops / Appointments ────────────────────────────────
        if (_tripStops.isNotEmpty)
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Dispatch Stops',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 8),
                  for (int i = 0; i < _tripStops.length; i++) ...[
                    _buildStopRow(i),
                    if (i < _tripStops.length - 1)
                      const Divider(height: 8),
                  ],
                ],
              ),
            ),
          ),
      ],
    );
  }

  /// Builds a compact summary row for a dispatch stop in the route-info panel.
  Widget _buildStopRow(int index) {
    final stop = _tripStops[index];
    final appt = _appointments[stop.id];
    final eta = _stopEta(index);

    Color statusColor = Colors.grey.shade400;
    String statusText = 'No Appt';
    if (appt != null) {
      if (appt.isLate(eta)) {
        statusColor = Colors.red;
        statusText = 'LATE';
      } else if (appt.isAtRisk(eta)) {
        statusColor = Colors.orange;
        statusText = 'At Risk';
      } else {
        statusColor = Colors.green;
        statusText = 'On Time';
      }
    }

    return InkWell(
      onTap: () => _showStopAppointmentSheet(index),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 13,
              backgroundColor: _stopBadgeColor(stop.type),
              child: Text(
                '${index + 1}',
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.bold),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(stop.name,
                      style:
                          const TextStyle(fontWeight: FontWeight.w600)),
                  if (appt?.facilityName != null)
                    Text(appt!.facilityName!,
                        style: const TextStyle(
                            fontSize: 12, color: Colors.grey)),
                  if (appt?.latestArrival != null)
                    Text(
                      'Cutoff: ${_formatApptDateTime(appt!.latestArrival!)}',
                      style: TextStyle(
                        fontSize: 12,
                        color: statusColor == Colors.red
                            ? Colors.red
                            : Colors.black87,
                      ),
                    ),
                  if (appt?.note != null && appt!.note!.isNotEmpty)
                    Text(
                      appt.note!,
                      style:
                          const TextStyle(fontSize: 11, color: Colors.grey),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                ],
              ),
            ),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
              decoration: BoxDecoration(
                color: statusColor,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                statusText,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
      ),
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

  /// Builds a compact [FilterChip] for toggling a POI layer on/off.
  ///
  /// [label] is the chip text, [icon] the leading icon, [selected] the current
  /// toggle state, [color] the active chip color, and [onSelected] the callback.
  Widget _buildPoiFilterChip({
    required String label,
    required IconData icon,
    required bool selected,
    required Color color,
    required ValueChanged<bool> onSelected,
  }) {
    return FilterChip(
      label: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: selected ? Colors.white : color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              color: selected ? Colors.white : color,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
      selected: selected,
      onSelected: onSelected,
      selectedColor: color,
      backgroundColor: Colors.white.withOpacity(0.9),
      checkmarkColor: Colors.white,
      showCheckmark: false,
      side: BorderSide(color: color, width: 1.5),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      visualDensity: VisualDensity.compact,
      elevation: 2,
      shadowColor: Colors.black38,
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
    this.laneHint,
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

  /// Optional lane guidance hint shown below the instruction in the maneuver
  /// card, e.g. 'Keep left', 'Use right 2 lanes'.  Currently populated with
  /// sample data for common maneuver types; ready for real lane-data
  /// integration (e.g. Mapbox guidance API) in the future.
  final String? laneHint;
}

