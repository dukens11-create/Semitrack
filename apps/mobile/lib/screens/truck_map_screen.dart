import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart' as mbx;
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart' as geo;
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart' hide Path;
import 'package:semitrack_mobile/data/warning_signs_data.dart';
import 'package:semitrack_mobile/models/truck_restriction.dart';
import 'package:semitrack_mobile/models/poi_item.dart';
import 'package:semitrack_mobile/models/warning_config.dart';
import 'package:semitrack_mobile/models/warning_sign.dart';
import 'package:semitrack_mobile/services/poi_service.dart';
import 'package:semitrack_mobile/services/warning_manager.dart';
import 'package:semitrack_mobile/widgets/road_guidance_banner.dart';
import 'package:semitrack_mobile/widgets/warning_popup_stack.dart';

// ── Lane guidance models ───────────────────────────────────────────────────

/// The direction an individual lane arrow can point.
///
/// Used by [LaneInfo] to describe each lane's allowed movements.
enum LaneDirection {
  left,
  slightLeft,
  straight,
  slightRight,
  right,
  uTurn,
}

/// Data for a single lane in the dynamic lane guidance panel.
///
/// [directions] lists the arrows shown on the lane marking.  Most lanes carry
/// a single direction, but shared lanes (e.g. straight-or-right) may carry
/// two.  [isRecommended] is true when the driver should use this lane to
/// follow the current route; recommended lanes are highlighted blue.
class LaneInfo {
  const LaneInfo({
    required this.directions,
    required this.isRecommended,
  });

  final List<LaneDirection> directions;
  final bool isRecommended;
}

/// Snapshot of the upcoming navigation maneuver that drives the lane guidance
/// panel.
///
/// Created by [_TruckMapScreenState._updateUpcomingManeuver] from live SDK
/// data (or sample data when the SDK does not yet provide lane information)
/// and stored in [_TruckMapScreenState._upcomingManeuverStep].
class UpcomingManeuverStep {
  const UpcomingManeuverStep({
    required this.maneuverType,
    required this.distanceMiles,
    required this.isHighwayManeuver,
    required this.roadName,
    required this.lanes,
  });

  /// Mapbox maneuver type string, e.g. "turn", "exit", "fork".
  /// Null when no step is available.
  final String? maneuverType;

  /// Distance in miles from the current position to this maneuver.
  final double distanceMiles;

  /// True when the maneuver occurs on a highway-class road (exit, on-ramp,
  /// off-ramp), warranting a wider 1.2-mile show threshold.
  final bool isHighwayManeuver;

  /// Human-readable name of the road at the maneuver point (may be null).
  final String? roadName;

  /// Per-lane data for the dynamic lane guidance panel.  Falls back to a
  /// sample four-lane array when the SDK does not provide lane data.
  final List<LaneInfo> lanes;
}

// ── Top navigation instruction card models ────────────────────────────────

/// Visual maneuver type used by [TopInstructionData] to select the correct
/// direction icon in the compact top navigation instruction card.
enum ManeuverVisualType {
  straight,
  left,
  slightLeft,
  right,
  slightRight,
  uTurnLeft,
  uTurnRight,
  merge,
  exit,
  forkLeft,
  forkRight,
  roundabout,
}

/// Camera behaviour mode for the truck navigation screen.
///
/// - [follow]   : camera locks onto the truck (lower-third framing, rotates
///               with heading, dynamic speed-based zoom).
/// - [overview] : shows the full route, north-up, low zoom.
/// - [free]     : user is manually panning/zooming; follow is paused and
///               automatically resumes after 8 s of idle.
enum NavigationCameraMode { follow, overview, free }

/// Immutable snapshot of the next navigation step shown in the compact top
/// instruction card.
///
/// Updated by [_TruckMapScreenState._updateTopInstructionFromNavigationStep]
/// whenever the route advances to a new step.
class TopInstructionData {
  const TopInstructionData({
    required this.visualType,
    required this.primaryText,
    required this.roadName,
    required this.distanceMiles,
    this.bottomChipText,
    this.shieldText,
  });

  /// Icon category derived from maneuver type + modifier.
  final ManeuverVisualType visualType;

  /// Short action verb phrase, e.g. "Turn left onto" or "Continue on".
  final String primaryText;

  /// Name of the road at the upcoming maneuver point.
  final String roadName;

  /// Distance in miles from the current position to the maneuver.
  final double distanceMiles;

  /// Optional label shown in the bottom chip (defaults to [roadName]).
  final String? bottomChipText;

  /// Optional highway shield label (e.g. "88", "I-5") shown as a green pill.
  final String? shieldText;
}

/// Full-featured truck navigation screen.
///
/// Integrates a Mapbox map widget (via flutter_map), fetches a live truck
/// route from the backend, parses the returned GeoJSON geometry, and
/// displays dynamic ETA / distance / maneuver information together with the
/// Phase 5 intelligence overlay (driveMinutesLeft, weather, riskScore).
class TruckMapScreen extends StatefulWidget {
  const TruckMapScreen({super.key});

  /// Broadcasts the live navigation state to other widgets (e.g. [AppShell])
  /// so they can hide/show the bottom navigation bar without requiring a
  /// direct reference to [_TruckMapScreenState].
  ///
  /// Set to `true` when the driver presses "Start Navigation" and back to
  /// `false` when they press "Stop Navigation" or the trip is cleared.
  static final ValueNotifier<bool> isNavigatingNotifier = ValueNotifier(false);

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

  /// Top offset for the road-info card below the RoadGuidanceBanner.
  /// The banner is approximately 170 px tall; 180 px provides a small gap.
  static const double _kRoadInfoCardTopOffset = 180.0;

  // ── Closest truck stops row bottom offsets ───────────────────────────────
  /// Bottom offset (px) for the truck-stop row when the weigh-station row is
  /// also visible.  The weigh-station panel (header ~20 px + card ~70 px) sits
  /// at bottom: 86, so its top edge is at ~176 px; adding an 8 px gap gives
  /// ~184 px.
  static const double _kTruckStopRowBottomWithWeighStations = 184.0;

  /// Bottom offset (px) for the truck-stop row when no weigh-station row is
  /// present — floats just above the bottom trip strip (bottom: 18 + ~52 px
  /// height + 18 px gap ≈ 88 px).
  static const double _kTruckStopRowBottomDefault = 88.0;

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

  // ── Truck speed limit constants (CA bounding box) ─────────────────────────
  /// Truck-specific speed limit in California (mph).
  static const double _caTruckSpeedLimitMph = 55.0;

  /// Southern latitude boundary of the California bounding box check.
  static const double _caMinLat = 32.0;

  /// Northern latitude boundary of the California bounding box check.
  static const double _caMaxLat = 42.5;

  /// Western longitude boundary of the California bounding box check.
  static const double _caMinLng = -125.0;

  /// Eastern longitude boundary of the California bounding box check.
  static const double _caMaxLng = -114.0;

  /// Minimum GPS speed (mph) that counts as real vehicle movement.
  /// Route progress and step advancement are frozen below this threshold.
  static const double _minMovingSpeedMph = 1.5;

  // ── GPS drift-filter constants ─────────────────────────────────────────────
  /// Speed threshold below which the vehicle is considered stopped (mph).
  /// Aliases [_minMovingSpeedMph]; provided for clarity in filter code.
  static const double _stoppedSpeedMph = _minMovingSpeedMph;

  /// Minimum speed (mph) required before the camera rotates to the heading.
  static const double _noRotateSpeedMph = 3.0;

  /// Minimum distance (metres) a stopped vehicle must move before the GPS
  /// fix is accepted — prevents drift from being recorded as real movement.
  static const double _minStoppedDriftMeters = 15.0;

  /// GPS accuracy threshold (metres) above which small position jumps are
  /// ignored to suppress noise from low-quality satellites.
  static const double _poorAccuracyMeters = 25.0;

  /// Maximum distance (metres) a position jump can be when GPS accuracy is
  /// poor before the fix is discarded as noise.
  static const double _minPoorAccuracyJumpMeters = 25.0;

  /// Minimum displacement (metres) from the last accepted fix that triggers
  /// immediate position acceptance regardless of speed.
  static const double _immediateAcceptDistanceMeters = 20.0;

  /// Stability radius (metres) within which consecutive slow-speed fixes are
  /// considered the same candidate location during the confirmation window.
  static const double _candidateStabilityRadiusMeters = 10.0;

  /// Minimum distance (metres) the vehicle must have moved since the last
  /// accepted fix for route-progress (nearest-point) advancement to occur.
  static const double _minRouteProgressDistanceMeters = 10.0;

  /// Number of consecutive GPS fixes near the candidate position required
  /// before a slow-speed position shift is accepted.
  static const int _requiredCandidateFixCount = 3;

  /// Maximum number of route-index points the truck can jump in a single GPS
  /// fix.  Larger jumps are suppressed as GPS noise in real-device mode.
  static const int _maxRouteIndexJump = 3;

  /// Minimum seconds that must elapse between automatic directions (reroute)
  /// API calls.  Separate from [_rerouteThrottleSeconds] so the per-directions
  /// 5 s window is independent of the broader route-fetch guard.
  static const int _directionsThrottleSeconds = 5;

  // ── Route restriction constants ────────────────────────────────────────────
  /// Radius in metres around each restricted zone within which a route point
  /// is considered to violate the restriction.  Used by
  /// [_updateRouteViolationWarnings] and [_isTruckSafe].
  static const double _restrictionProximityThresholdMeters = 100.0;

  /// Multiplier applied to [_restrictionProximityThresholdMeters] when
  /// building red-overlay polyline segments for the map preview.  The larger
  /// radius ensures the red overlay visually leads into the restricted zone.
  static const double _restrictionSegmentThresholdMultiplier = 3.0;

  // ── California truck speed-limit constants ─────────────────────────────────
  /// California state law maximum speed for trucks (mph).
  static const double _californiaTruckSpeedLimitMph = 55.0;

  /// Southern latitude boundary of the California bounding box.
  static const double _californiaMinLat = 32.0;

  /// Northern latitude boundary of the California bounding box.
  static const double _californiaMaxLat = 42.5;

  /// Western longitude boundary of the California bounding box.
  static const double _californiaMinLng = -125.0;

  /// Eastern longitude boundary of the California bounding box.
  static const double _californiaMaxLng = -114.0;

  // ── Loading / error ────────────────────────────────────────────────────────
  bool _isLoading = false;
  String? _error;

  // ── Map ready state ────────────────────────────────────────────────────────
  bool _mapReady = false;

  // ── Full route response ────────────────────────────────────────────────────
  Map<String, dynamic>? _routeData;

  // ── Route totals – set when a route is fetched, used to compute remaining ──
  /// Total route distance in miles as returned by the Directions API.
  double _routeTotalDistanceMiles = 0.0;

  /// Total route duration in seconds as returned by the Directions API.
  int _routeTotalDurationSeconds = 0;

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
  StreamSubscription<geo.Position>? _gpsSubscription;
  Timer? _animTimer; // kept for dispose / GPS-mode cancellation

  // Generation counter — incremented each time a new smooth animation is
  // started so that any in-flight async animation loop can self-cancel when
  // it detects a stale generation value.
  int _animGeneration = 0;
  // True while the GPS stream is delivering real position fixes so that the
  // periodic animation timer defers to the GPS-driven updates.
  bool _gpsActive = false;

  // When true the smooth route-animation loop is allowed to auto-advance the
  // truck along the route without real GPS movement (useful for demo/testing).
  // When false (the default) the animation loop is suppressed and route
  // progress only advances from real GPS fixes whose speed ≥ _minMovingSpeedMph.
  bool _isSimulationMode = false;

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

  // _isNavigating is set true only when the user explicitly presses the
  // "Start Navigation" button after previewing the route.  It gates trip stats,
  // GPS tracking logic, and all navigation UI so the driver must opt in before
  // the session begins (route preview vs active trip).
  //
  // When true: planning UI (search bar, route options, preview panel, legend,
  // AppBar, bottom nav bar) is hidden; only the map + navigation components
  // remain visible.
  bool _isNavigating = false;

  // _panelExpanded controls the collapsible floating dashboard panel.
  // When false only the header row (destination + ETA) is shown; when true
  // the HOS/fuel summary cards and quick-action chips are also visible.
  bool _panelExpanded = false;

  // ── Lane-guidance visibility state ────────────────────────────────────────
  // These fields drive _shouldShowLaneGuidance().  They are updated by
  // _updateUpcomingManeuver() whenever the navigation engine advances to a new
  // route step or reports fresh distance-to-maneuver data.
  //
  // Default values ensure lane guidance is hidden until the engine provides
  // real step data (large sentinel distance + null maneuver type).

  /// The maneuver type string for the next upcoming step (e.g. "turn", "exit").
  /// Null when no step is available or navigation is idle.
  String? _nextManeuverType;

  /// Distance in miles to the next upcoming maneuver.
  /// Initialized to a large sentinel so the threshold check fails by default.
  double _distanceToNextManeuverMiles = 999.0;

  /// True when the upcoming maneuver is a highway-type event (exit, ramp,
  /// on-ramp, off-ramp), which uses a wider 1.2-mile show threshold instead
  /// of the 0.8-mile city default.
  bool _isHighwayManeuver = false;

  /// Full snapshot of the upcoming maneuver, including per-lane data.
  /// Null until [_updateUpcomingManeuver] is first called.
  /// Drives both [_shouldShowLaneGuidance] and [_buildDynamicLaneAssist].
  UpcomingManeuverStep? _upcomingManeuverStep;

  // ── Top instruction card state ─────────────────────────────────────────────
  /// Current data for the compact top navigation instruction card.
  /// Null until the first call to [_updateTopInstructionFromNavigationStep].
  /// Drives [_buildPrimaryManeuverCard].
  TopInstructionData? _topInstructionData;

  /// Data for the secondary "Then" maneuver card shown below the primary card.
  /// Set to the step after [_topInstructionData]'s step, null when no such step.
  TopInstructionData? _secondaryInstructionData;

  // ── Navigation alert state ─────────────────────────────────────────────────
  // Sample alerts shown during active navigation.  In production these would
  // be populated from live weather/traffic/restriction APIs.
  late List<NavigationAlert> _navAlerts;

  // Sample trip progress info for the TripSummaryStrip.
  late TripProgressInfo _tripProgressInfo;

  // ── Wind alert visibility state ────────────────────────────────────────────
  /// Controls whether the bottom wind advisory card is visible.
  /// Starts true so the card shows as soon as navigation begins; the driver
  /// can dismiss it with the close button.
  bool _showWindAlert = true;

  // ── Satellite view toggle ──────────────────────────────────────────────────
  /// When true the map tile layer switches to satellite imagery.
  bool _isSatelliteView = false;

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
  /// GPS point-to-point distances via [geo.Geolocator.distanceBetween].
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

  // ── Movement filter: track last position used for route checks ────────────
  /// Latitude of the last GPS fix that triggered a route-update check.
  double _lastRouteCheckLat = 0.0;

  /// Longitude of the last GPS fix that triggered a route-update check.
  double _lastRouteCheckLng = 0.0;

  // ── API debounce: limits fetchRoute calls to at most once per 5 seconds ───
  /// Timestamp of the most recent fetchRoute invocation from GPS position
  /// updates.  Null until the first qualifying call is made.
  DateTime? _lastApiCallTime;

  // ── GPS drift-filter state ─────────────────────────────────────────────────
  /// The last GPS position that passed the acceptance filter.  Used as the
  /// reference point for stop-drift, jump, and route-progress checks.
  geo.Position? _lastAcceptedPosition;

  /// Candidate position being evaluated for stable confirmation before
  /// acceptance when the vehicle is slow but not clearly stopped.
  geo.Position? _candidatePosition;

  /// Number of consecutive GPS fixes near [_candidatePosition].  When this
  /// reaches 3 the candidate is accepted as a real position shift.
  int _stableCandidateCount = 0;

  /// True when the most recent accepted GPS fix shows speed < [_stoppedSpeedMph].
  bool _isStopped = false;

  /// Timestamp of the most recent reroute call made via [_canCallDirections].
  /// Separate from [_lastApiCallTime] so directions throttling does not
  /// interfere with other route-fetch operations.
  DateTime? _lastDirectionsCallAt;

  // ── Route alternatives (pre-navigation selection) ─────────────────────────
  //
  // _routeOptions holds the list of RouteOption cards built from the Mapbox
  // alternatives response.  _selectedRouteOptionIndex tracks which card is
  // highlighted; tapping a card calls _applyRouteOption() to update the
  // preview.  Both are reset by _clearActiveRoute().
  List<RouteOption> _routeOptions = const [];
  int _selectedRouteOptionIndex = 0;

  // ── Destination picker state ──────────────────────────────────────────────
  //
  // Set by long-pressing the map.  _startRouteToSelectedDestination() uses
  // these fields to fetch a route to the pinned point and launch navigation.
  LatLng? _selectedDestination;
  String? _selectedDestinationName;
  bool _isBuildingRoute = false;

  // ── Multi-stop leg breakdown ───────────────────────────────────────────────
  //
  // _tripLegs holds the per-segment breakdown for a multi-stop route built by
  // _buildMultiStopRoute().  _activeLegIndex tracks which leg the driver is
  // currently on; it advances automatically as each stop is reached.  Both are
  // reset by _clearActiveRoute().
  List<TripLeg> _tripLegs = const [];
  int _activeLegIndex = 0;

  // ── Truck Stop POI state ───────────────────────────────────────────────────
  //
  // _truckStops holds the filtered list of stops near the current route.
  // _showTruckStops controls marker visibility — toggled by the POI FAB.
  // Expand this section later to support real API data, weigh stations, etc.
  List<TruckStop> _truckStops = const [];
  bool _showTruckStops = true;

  // POI entries are now rendered via the Mapbox GeoJSON cluster source
  // (poi-source) and associated style layers set up in _setupPoiCluster().
  // The legacy flutter_map widget-based markers have been removed.

  // ── Closest truck stops ahead (navigation mode) ───────────────────────────
  //
  // Holds up to 2 AheadTruckStop entries representing the nearest truck stops
  // ahead of the driver on the active route.  Refreshed on every GPS update
  // while _isNavigating == true.  Empty when not navigating or when no stops
  // are within range of the active route.
  List<AheadTruckStop> _closestTruckStopsAhead = [];

  // Full POI dataset loaded from assets/locations.json once the Mapbox style
  // is ready.  Used by _refreshClosestTruckStopsAhead as the primary data
  // source so the navigation strip works for any route, not only the I-5
  // corridor covered by _mockTruckStops.
  List<PoiItem> _loadedPois = const [];

  // Holds each brand's PNG decoded as raw bytes so markers can render via
  // Image.memory() — the flutter_map equivalent of Mapbox style.addImage().
  // Keyed by canonical brand key (e.g. 'pilot', 'loves', 'default').
  Map<String, Uint8List> _brandIconBytes = {};

  // ── Map POI state (weigh stations, police, ports of entry) ─────────────────
  //
  // _mapPois is the master list of weigh-station / police / port-of-entry POIs
  // shown as coloured map markers.  _poiAlertShown tracks which POI ids have
  // already triggered a proximity alert during this session so the same POI
  // does not spam repeated dialogs.
  final List<MapPoi> _mapPois = List<MapPoi>.from(_sampleMapPois);
  final Set<String> _poiAlertShown = {};

  // ── Ahead-on-route weigh stations ─────────────────────────────────────────
  //
  // Holds the next 1–2 weigh stations ahead of the truck on the current route,
  // sorted by ascending route miles.  Updated on every GPS fix while
  // _isNavigating is true via _refreshClosestWeighStationsAhead().
  List<AheadWeighStation> _closestWeighStationsAhead = const [];

  // ── Upcoming route alert chips (top-right overlay) ────────────────────────
  //
  // Holds up to 3 UpcomingAlertItem entries representing the nearest upcoming
  // alerts (truck stops, weigh stations, wind advisories, restrictions, fuel,
  // rest areas) ahead on the active route.  Refreshed on every GPS fix while
  // _isNavigating == true via _refreshUpcomingAlerts().  Empty when not
  // navigating.  Disable this feature by removing the _refreshUpcomingAlerts()
  // call from _onGpsPosition and the _buildRightSideUpcomingAlerts() call from
  // the Stack overlay.
  List<UpcomingAlertItem> _upcomingAlerts = const [];

  // ── Truck profile (height / weight / length / hazmat) ─────────────────────
  //
  // These defaults represent a standard 5-axle semi.  In a production build
  // these values would be loaded from the driver's saved truck profile.
  // They are used by _violatesRestriction() to compare against posted limits.

  /// Vehicle height in feet (standard semi: 13.6 ft).
  double _truckHeightFt = 13.6;

  /// Gross vehicle weight in short tons (80,000 lbs = 40 tons for a standard
  /// fully-loaded five-axle semi at the federal legal limit).
  double _truckWeightTons = 40.0;

  /// Overall vehicle length in feet (standard 53-ft trailer + tractor = ~70 ft).
  double _truckLengthFt = 70.0;

  /// True when the truck is carrying hazardous materials (HAZMAT placard).
  bool _hasHazmat = false;

  // ── Truck restriction state ────────────────────────────────────────────────
  //
  // _restrictions is the list of point-based truck restrictions shown as map
  // markers and used for route-violation checks.  _restrictionAlertShown
  // deduplicates proximity alerts so the same restriction does not re-alert
  // during a session.  _restrictionAhead holds the nearest upcoming violation
  // so the in-route alert card can display its details.
  final List<TruckRestriction> _restrictions =
      List<TruckRestriction>.from(_sampleRestrictions);
  final Set<String> _restrictionAlertShown = {};
  TruckRestriction? _restrictionAhead;

  // ── Warning popup manager ──────────────────────────────────────────────────
  //
  // _warningManager evaluates proximity to each [WarningSign] on every GPS
  // fix and exposes [activePopups] for the [WarningPopupStack] overlay.
  // It is seeded from the static [warningSigns] list; in production this list
  // would be replaced by API-loaded data matching the active route corridor.
  late final WarningManager _warningManager;


  // _isRestrictionRerouting is true while an automatic avoid-restriction
  // reroute is in progress so the UI can show the rerouting banner.
  // _restrictionRerouteAttempts counts how many avoid-point retries have been
  // made in the current rerouting cycle; reset to 0 before each new cycle.
  bool _isRestrictionRerouting = false;
  int _restrictionRerouteAttempts = 0;
  static const int _maxRestrictionReroutes = 3;

  // ── Warning sign state ────────────────────────────────────────────────────
  //
  // _warningSigns is the list of truck safety warning signs shown as coloured
  // map markers and used for route-proximity detection.
  // _warningAlertShown deduplicates proximity banners within a session.
  // _warningAhead holds the highest-priority warning currently ahead on the
  // route so the alert banner can display it.
  final List<WarningSign> _warningSigns =
      List<WarningSign>.from(_sampleWarningSigns);
  final Set<String> _warningAlertShown = {};
  WarningSign? _warningAhead;

  /// Radius in metres within which a warning sign is considered "on the route"
  /// for route-proximity detection.
  static const double _warningProximityMeters = 200.0;

  /// Radius in metres within which an ahead-on-route warning triggers the
  /// top alert banner (and TTS) for the driver.
  static const double _warningAlertRadiusMeters = 1000.0;

  /// Maximum cross-track distance (metres) for a weigh station to be
  /// considered "on" the active route and eligible for ahead-on-route display.
  static const double _weighStationProximityMeters = 500.0;

  /// Distance buffer (metres) used when deciding which warning signs are
  /// shown as map markers.  Wider than [_warningProximityMeters] so the driver
  /// can see upcoming hazards well in advance (~10 miles).
  static const double _warningDisplayBufferMeters = 16093.0; // ≈ 10 miles

  /// Distance buffer (metres) used when deciding which [MapPoi] markers
  /// (weigh stations, police, ports of entry) are shown on the map.
  /// Matches the truck-stop POI display buffer (~10 miles).
  static const double _poiDisplayBufferMeters = 16093.0; // ≈ 10 miles

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

  // ── Navigation camera mode ─────────────────────────────────────────────────
  // Primary mode driver for the GPS camera system.  All camera behaviour
  // (follow, overview, free/gesture) is derived from this field.
  NavigationCameraMode _cameraMode = NavigationCameraMode.follow;

  // Convenience getter: true while the camera actively locks onto the truck.
  bool get _followTruck => _cameraMode == NavigationCameraMode.follow;

  // Last bearing accepted for camera rotation (smoothed to avoid jitter).
  double _lastKnownBearing = 0.0;

  // Timestamp of the most recent map gesture so the 8-second idle window
  // can be measured precisely.
  DateTime? _lastManualMapInteractionAt;

  // True while a user gesture (pan / pinch / rotate) is in progress.
  bool _isUserInteractingWithMap = false;

  // Timer that fires after 8 s of idle to return from free → follow mode.
  Timer? _gestureReturnTimer;

  // ── Navigation session guard ───────────────────────────────────────────────
  /// True when a destination has been selected **and** the navigation session
  /// is currently active (i.e. after a route has been built and before
  /// arrival / clear).  All trip-logic methods (arrival, step advance, TTS,
  /// reroute, POI / restriction alerts, camera follow) are gated on this flag
  /// so that none of those behaviours fire in plain GPS-tracking mode.
  bool get _hasActiveDestination =>
      _selectedDestination != null && _navigationActive;

  // ── Navigation pause state ─────────────────────────────────────────────────
  // When true, live GPS tracking and camera follow updates are suspended.
  // Useful when the driver needs to review the route without the map moving.
  bool _navigationPaused = false;

  // ── Search bar state ───────────────────────────────────────────────────────
  // _searchController drives the inline search TextField at the top of the map.
  // _searchResults holds the current geocoding suggestions from Mapbox.
  // _isSearching is true while the HTTP request is in flight (shows spinner).
  // _isBuildingRoute is true while fetchRoute() is building a route from the
  // selected destination so the Start Route button can show a loading state.
  // _searchDebounce throttles geocoding calls to one per 400 ms so typing
  // a destination does not flood the Mapbox API with a request per keystroke.
  final TextEditingController _searchController = TextEditingController();
  List<PlaceSuggestion> _searchResults = const [];
  bool _isSearching = false;
  Timer? _searchDebounce;

  // ── Route restriction violations ───────────────────────────────────────────
  // Populated by _updateRouteViolationWarnings() after a route loads.
  // Each entry is a human-readable warning shown in the route info panel.
  List<String> _routeViolations = const [];

  // ── Preview weather risk ───────────────────────────────────────────────────
  // Optional string shown in the Trip Preview Intelligence Panel when weather
  // risk data is available (e.g. 'Low', 'Moderate', 'High').  Null means no
  // weather data is available and the Weather Risk row will be hidden.
  String? _weatherRisk;

  // ── Default destination (Winnemucca, NV) – used only when no destination ──
  // is selected by the user.  The origin is ALWAYS the device's live GPS
  // position; there is no hardcoded origin fallback.
  static const _destLat = 39.5296;
  static const _destLng = -119.8138;

  static const _destination = LatLng(_destLat, _destLng);

  // Navigation-mode zoom level (12.5–15) — close enough for street detail
  // without losing surrounding road context.
  static const _navigationZoomLevel = 14.0;

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
    _navAlerts = [
      NavigationAlert(
        id: 'alert_wind_1',
        type: AlertType.windAdvisory,
        severity: AlertSeverity.high,
        title: 'Wind Advisory',
        subtitle: 'Gusts up to 60 mph',
        message: 'High crosswinds reported — reduce speed and use caution.',
        distanceMiles: 12.0,
        roadName: 'I-80 Westbound',
        suggestedAction: 'Reduce speed, grip steering firmly.',
      ),
      NavigationAlert(
        id: 'alert_fuel_1',
        type: AlertType.fuelDistance,
        severity: AlertSeverity.low,
        title: 'Fuel Ahead',
        subtitle: 'Flying J Truck Stop',
        distanceMiles: 143.0,
        roadName: 'US-95 N',
        suggestedAction: 'Plan fuel stop at next exit.',
      ),
      NavigationAlert(
        id: 'alert_restriction_1',
        type: AlertType.restrictionDistance,
        severity: AlertSeverity.medium,
        title: 'Truck Restriction',
        subtitle: 'Weight limit 80,000 lbs',
        message: 'Bridge weight restriction ahead — verify gross vehicle weight.',
        distanceMiles: 139.0,
        roadName: 'NV-227',
        suggestedAction: 'Confirm vehicle weight or use alternate route.',
      ),
    ];
    _tripProgressInfo = TripProgressInfo(
      milesRemaining: 318.0,
      durationRemaining: const Duration(hours: 5, minutes: 12),
      etaLocal: DateTime.now().add(const Duration(hours: 5, minutes: 12)),
      timezoneLabel: 'PDT',
    );
    _initTts();
    _startGps();
    // Initialise the warning manager with the pre-seeded sign list.
    // In production, replace [warningSigns] with API-loaded data for the
    // active route corridor.
    _warningManager = WarningManager(signs: warningSigns);
    // On initial load there is no active route yet, so show all stops so the
    // map is useful before the driver sets a destination.  Once a route is
    // fetched, _truckStops is replaced by the filtered list.
    _truckStops = _filterStopsNearRoute(_mockTruckStops, _routePoints);
    // Load all brand logo PNGs as raw bytes so that _buildTruckStopMarkers()
    // can render them via Image.memory() — equivalent to Mapbox addImage().
    _preloadBrandIcons();
  }

  @override
  void dispose() {
    _gpsSubscription?.cancel();
    _animTimer?.cancel();
    _gestureReturnTimer?.cancel();
    _animGeneration++; // cancel any in-flight smooth animation
    _tts.stop();
    _searchController.dispose();
    _searchDebounce?.cancel();
    _warningManager.dispose();
    super.dispose();
  }

  // ── Icon preloader ────────────────────────────────────────────────────────
  //
  // flutter_map equivalent of the Mapbox native SDK pattern:
  //
  //   Mapbox (native SDK)                flutter_map equivalent
  //   ──────────────────────────────     ──────────────────────────────────────
  //   style.addImage("weigh", bytes)  →  _brandIconBytes["weigh"] = bytes
  //   GeoJSON Feature { brand:"weigh" }→  TruckStop(icon: 'weigh', ...)
  //   SymbolLayer iconImage:["get","brand"]→ Image.memory(_brandIconBytes[stop.icon])
  //
  // To add or change an icon, add entries to [_brandIcons] and place the
  // corresponding PNG assets in the project, then re-register them in pubspec.yaml.

  /// Discovers and loads every PNG in `assets/logo_brand_markers/` into
  /// [_brandIconBytes].
  ///
  /// Uses [AssetManifest] to iterate all registered assets at runtime, then
  /// loads each matching PNG via [rootBundle].  This is the flutter_map
  /// equivalent of calling Mapbox `style.addImage(id, bytes)` for every icon
  /// before adding a SymbolLayer with `iconImage: ["get", "icon"]`.
  ///
  /// Each PNG is stored under its full asset path (e.g.
  /// `'assets/logo_brand_markers/pilot.png'`) so [_buildTruckStopMarkers] can
  /// look it up directly from [TruckStop.assetLogo].  Assets that fail to load
  /// are logged and skipped — the marker builder omits the marker entirely
  /// rather than falling back to a generic icon.
  Future<void> _preloadBrandIcons() async {
    final loaded = <String, Uint8List>{};

    // Discover all PNG assets registered under assets/logo_brand_markers/ via
    // the asset manifest so the loader automatically picks up any new logo
    // files added to the folder without requiring code changes.
    final AssetManifest manifest =
        await AssetManifest.loadFromAssetBundle(rootBundle);
    final List<String> allPaths = manifest.listAssets();
    final List<String> logoPaths = allPaths
        .where(
          (s) =>
              s.startsWith('assets/logo_brand_markers/') &&
              s.endsWith('.png'),
        )
        .toList();

    debugPrint(
      '[BrandIcons] Found ${logoPaths.length} PNG(s) in '
      'assets/logo_brand_markers/ to preload.',
    );

    for (final path in logoPaths) {
      try {
        final data = await rootBundle.load(path);
        loaded[path] = data.buffer.asUint8List();
        debugPrint('[BrandIcons] ✓ Loaded "$path"');
      } catch (e) {
        // Asset unreadable — log the error so missing files are visible.
        debugPrint('[BrandIcons] ✗ Failed to load "$path": $e');
      }
    }

    debugPrint(
      '[BrandIcons] Preload complete: ${loaded.length} of '
      '${logoPaths.length} icon(s) loaded.',
    );

    if (mounted) setState(() => _brandIconBytes = loaded);
  }

  // ── Truck marker builders ─────────────────────────────────────────────────
  //
  // flutter_map uses Widget-based, stateless markers that are rebuilt each
  // frame from the current state variables.  The three helpers below mirror
  // the Google Maps Flutter pattern:
  //
  //   Google Maps Flutter              flutter_map equivalent
  //   ─────────────────────────────    ────────────────────────────────────────
  //   BitmapDescriptor.fromAssetImage  Image.memory (from rootBundle bytes)
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
          (_routePoints.isNotEmpty ? _routePoints.first : const LatLng(0, 0)),
      // Bounding box matches the rendered icon size: 48 × 48 logical px.
      width: 48,
      height: 48,
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
          width: 48,
          height: 48,
          errorBuilder: (_, __, ___) => const Icon(
            Icons.local_shipping,
            size: 44,
            color: Colors.blue,
          ),
        ),
      ),
    );
  }

  /// Returns the fixed destination [Marker] at the selected (or default)
  /// destination position.
  Marker _buildDestinationMarker() {
    final pos = _selectedDestination ?? _destination;
    return Marker(
      point: pos,
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

  // ── Truck Stop POI mock dataset ────────────────────────────────────────────
  //
  // Hard-coded stops covering the default Portland → Winnemucca route.
  // Replace with a real API call or local database in a production build.
  //
  // ── GeoJSON / SymbolLayer equivalent ──────────────────────────────────────
  // In the native Mapbox SDK you would represent these locations as a
  // GeoJSON FeatureCollection and render them with a SymbolLayer:
  //
  //   {
  //     "type": "FeatureCollection",
  //     "features": [
  //       { "type": "Feature",
  //         "geometry": { "type": "Point", "coordinates": [-122.571, 45.581] },
  //         "properties": { "brand": "pilot" }   // key == PNG filename w/o .png
  //       },
  //       { "type": "Feature",
  //         "geometry": { "type": "Point", "coordinates": [-123.092, 44.057] },
  //         "properties": { "brand": "loves" }
  //       },
  //       { "type": "Feature",
  //         "geometry": { "type": "Point", "coordinates": [-122.875, 42.328] },
  //         "properties": { "brand": "ta" }
  //       },
  //       { "type": "Feature",
  //         "geometry": { "type": "Point", "coordinates": [-122.637, 41.740] },
  //         "properties": { "brand": "petro" }
  //       },
  //       { "type": "Feature",
  //         "geometry": { "type": "Point", "coordinates": [-123.022, 44.940] },
  //         "properties": { "brand": "weigh" }
  //       },
  //       { "type": "Feature",
  //         "geometry": { "type": "Point", "coordinates": [-122.990, 43.210] },
  //         "properties": { "brand": "rest" }
  //       }
  //     ]
  //   }
  //
  // With the SymbolLayer configured as:
  //   iconImage: ["get", "brand"]   // picks the image registered via addImage()
  //
  // In flutter_map, TruckStop.icon plays the role of the "brand" GeoJSON
  // property, and _brandIconBytes[stop.icon] plays the role of addImage().
  // To add a new icon type: add an entry to _brandIcons and register the asset
  // in pubspec.yaml, then create a TruckStop with icon: '<name>'.
  static final List<TruckStop> _mockTruckStops = [
    TruckStop(
      id: '1',
      name: 'Pilot Travel Center',
      brand: 'Pilot',
      position: const LatLng(45.581, -122.571),
      address: 'Portland, OR',
      dieselPrice: 4.25,
      icon: 'pilot',
      assetLogo: 'assets/logo_brand_markers/pilot.png',
      description: 'Large Pilot with 24/7 fuel, truck parking, showers, and Subway restaurant.',
    ),
    TruckStop(
      id: '2',
      name: "Love's Travel Stop",
      brand: "Love's",
      position: const LatLng(44.057, -123.092),
      address: 'Eugene, OR',
      dieselPrice: 4.19,
      icon: 'loves',
      assetLogo: 'assets/logo_brand_markers/loves.png',
      description: "Love's with CAT scale, showers, Hardee's, and tire care center.",
    ),
    TruckStop(
      id: '3',
      name: 'TA Travel Center',
      brand: 'TA',
      position: const LatLng(42.328, -122.875),
      address: 'Medford, OR',
      dieselPrice: 4.35,
      icon: 'ta',
      assetLogo: 'assets/logo_brand_markers/ta_truck_stop.png',
      description: 'TA with full truck service shop, Iron Skillet, showers, and CAT scale.',
    ),
    TruckStop(
      id: '4',
      name: 'Petro Stopping Center',
      brand: 'Petro',
      position: const LatLng(41.740, -122.637),
      address: 'Yreka, CA',
      dieselPrice: 4.45,
      icon: 'petro',
      assetLogo: 'assets/logo_brand_markers/petro_truck_stop.png',
      description: 'Petro with certified truck lube, CAT scale, Iron Skillet, and 24/7 fuel.',
    ),
    TruckStop(
      id: '5',
      name: 'Flying J Travel Center',
      brand: 'Flying J',
      position: const LatLng(40.770, -122.388),
      address: 'Redding, CA',
      dieselPrice: 4.29,
      icon: 'flyingj',
      assetLogo: 'assets/logo_brand_markers/flying_j_truck_stop.png',
      description: 'Flying J with myPilot rewards, truck parking for 150 rigs, and Denny\'s.',
    ),
    TruckStop(
      id: '6',
      name: 'Pilot Travel Center',
      brand: 'Pilot',
      position: const LatLng(39.724, -121.836),
      address: 'Chico, CA',
      dieselPrice: 4.32,
      icon: 'pilot',
      assetLogo: 'assets/logo_brand_markers/pilot.png',
      description: 'Pilot with 24/7 diesel, DEF dispensers, showers, and convenience store.',
    ),
    TruckStop(
      id: '7',
      name: 'Rest Area – I-5 North',
      brand: 'Rest Area',
      position: const LatLng(43.210, -122.990),
      address: 'I-5 Northbound, OR',
      icon: 'rest',
      assetLogo: 'assets/logo_brand_markers/rest_area.png',
      description: 'Oregon DOT rest area with parking, restrooms, picnic tables, and dog walk area.',
    ),
    TruckStop(
      id: '8',
      name: 'Rest Area – I-80 East',
      brand: 'Rest Area',
      position: const LatLng(40.210, -121.500),
      address: 'I-80 Eastbound, CA',
      icon: 'rest',
      assetLogo: 'assets/logo_brand_markers/rest_area.png',
      description: 'Caltrans rest area with truck-specific parking bays and vending machines.',
    ),
    TruckStop(
      id: '9',
      name: 'Mobil Truck Stop',
      brand: 'Mobil',
      position: const LatLng(41.500, -122.300),
      address: 'Weed, CA',
      dieselPrice: 4.38,
      icon: 'mobil',
      assetLogo: 'assets/logo_brand_markers/truck_parking.png',
      description: 'Mobil with high-flow diesel pumps, DEF, and 24-hour convenience store.',
    ),
    TruckStop(
      id: '10',
      name: 'Esso Travel Plaza',
      brand: 'Esso',
      position: const LatLng(40.400, -122.250),
      address: 'Red Bluff, CA',
      dieselPrice: 4.41,
      icon: 'esso',
      assetLogo: 'assets/logo_brand_markers/truck_parking.png',
      description: 'Esso travel plaza with high-flow diesel lanes, DEF dispensers, and 24/7 convenience store.',
    ),
    TruckStop(
      id: '11',
      name: 'Chevron Truck Stop',
      brand: 'Chevron',
      position: const LatLng(39.500, -121.700),
      address: 'Orland, CA',
      dieselPrice: 4.33,
      icon: 'chevron',
      assetLogo: 'assets/logo_brand_markers/truck_parking.png',
      description: 'Chevron with Techron diesel, DEF, truck parking, and 24/7 service.',
    ),
    TruckStop(
      id: '12',
      name: 'Shell Travel Center',
      brand: 'Shell',
      position: const LatLng(38.900, -121.600),
      address: 'Williams, CA',
      dieselPrice: 4.30,
      icon: 'shell',
      assetLogo: 'assets/logo_brand_markers/truck_parking.png',
      description: 'Shell with V-Power diesel, car wash, and large-format truck canopy.',
    ),
    TruckStop(
      id: '13',
      name: 'BP Truck Stop',
      brand: 'BP',
      position: const LatLng(40.580, -122.350),
      address: 'Cottonwood, CA',
      dieselPrice: 4.27,
      icon: 'bp',
      assetLogo: 'assets/logo_brand_markers/truck_parking.png',
      description: 'BP with Amoco Ultimate diesel, DEF, and convenience store with hot food.',
    ),
    TruckStop(
      id: '14',
      name: 'Circle K Travel Stop',
      brand: 'Circle K',
      position: const LatLng(39.800, -121.750),
      address: 'Corning, CA',
      dieselPrice: 4.22,
      icon: 'circlek',
      assetLogo: 'assets/logo_brand_markers/circle_truck_stop.png',
      description: 'Convenience store with diesel lanes and a quick DEF fill-up station.',
    ),
    // ── New stops ────────────────────────────────────────────────────────────
    TruckStop(
      id: '15',
      name: "Love's Travel Stop",
      brand: "Love's",
      position: const LatLng(46.871, -114.017),
      address: 'Missoula, MT',
      dieselPrice: 4.18,
      icon: 'loves',
      assetLogo: 'assets/logo_brand_markers/loves.png',
      description: 'Full-service Love\'s with showers, laundry, CAT scale, and Subway restaurant on-site.',
    ),
    TruckStop(
      id: '16',
      name: 'TA Travel Center',
      brand: 'TA',
      position: const LatLng(43.613, -116.202),
      address: 'Boise, ID',
      dieselPrice: 4.31,
      icon: 'ta',
      assetLogo: 'assets/logo_brand_markers/ta_truck_stop.png',
      description: 'TravelCenters of America — diesel, DEF, parking for 200+ trucks, Iron Skillet restaurant.',
    ),
    TruckStop(
      id: '17',
      name: 'Pilot Flying J',
      brand: 'Pilot',
      position: const LatLng(47.658, -117.426),
      address: 'Spokane, WA',
      dieselPrice: 4.24,
      icon: 'pilot',
      assetLogo: 'assets/logo_brand_markers/pilot.png',
      description: 'Pilot Flying J with myPilot rewards, 24/7 fuel, truck parking, and Denny\'s inside.',
    ),
    TruckStop(
      id: '18',
      name: 'Petro Stopping Center',
      brand: 'Petro',
      position: const LatLng(41.263, -95.855),
      address: 'Omaha, NE',
      dieselPrice: 4.12,
      icon: 'petro',
      assetLogo: 'assets/logo_brand_markers/petro_truck_stop.png',
      description: 'Petro truck stop with Iron Skillet diner, CAT scale, and full truck service center.',
    ),
    TruckStop(
      id: '19',
      name: 'Flying J Travel Center',
      brand: 'Flying J',
      position: const LatLng(36.170, -115.139),
      address: 'Las Vegas, NV',
      dieselPrice: 4.47,
      icon: 'flyingj',
      assetLogo: 'assets/logo_brand_markers/flying_j_truck_stop.png',
      description: 'Flying J with myPilot loyalty perks, diesel exhaust fluid, showers, and Wi-Fi lounge.',
    ),
    TruckStop(
      id: '20',
      name: 'Maverik Adventure\'s First Stop',
      brand: 'Maverik',
      position: const LatLng(40.760, -111.891),
      address: 'Salt Lake City, UT',
      dieselPrice: 4.09,
      icon: 'maverik',
      assetLogo: 'assets/logo_brand_markers/truck_parking.png',
      description: 'Maverik BonFire grill, diesel, DEF, and adventure-themed convenience store.',
    ),
    // ── Stops for remaining logos ────────────────────────────────────────────
    TruckStop(
      id: '21',
      name: 'QuikTrip Travel Center',
      brand: 'QuikTrip',
      position: const LatLng(33.749, -84.388),
      address: 'Atlanta, GA',
      dieselPrice: 4.05,
      icon: 'quicktrip',
      assetLogo: 'assets/logo_brand_markers/quicktrip_truck_stop.png',
      description: 'QuikTrip with high-flow diesel pumps, fresh food kitchen, truck parking, and 24/7 service.',
    ),
    TruckStop(
      id: '22',
      name: 'Weigh Station – I-5 Southbound',
      brand: 'Weigh Station',
      position: const LatLng(44.940, -123.022),
      address: 'Salem, OR – I-5 SB',
      icon: 'weigh',
      assetLogo: 'assets/logo_brand_markers/weight_station.png',
      description: 'Oregon DOT portable scale site. All vehicles over 26,001 lbs must stop when open.',
    ),
    TruckStop(
      id: '23',
      name: 'Weigh Station – I-80 Westbound',
      brand: 'Weigh Station',
      position: const LatLng(41.120, -112.017),
      address: 'Ogden, UT – I-80 WB',
      icon: 'weigh',
      assetLogo: 'assets/logo_brand_markers/weight_station.png',
      description: 'Utah DOT permanent weigh station. WIM sensors active 24/7; booths open Mon–Fri.',
    ),
    TruckStop(
      id: '24',
      name: 'AmBest Travel Center',
      brand: 'AmBest',
      position: const LatLng(35.227, -80.843),
      address: 'Charlotte, NC',
      dieselPrice: 4.08,
      icon: 'ambest',
      assetLogo: 'assets/logo_brand_markers/truck_parking.png',
      description: 'AmBest certified truck stop with showers, CAT scale, full restaurant, and truck repair.',
    ),
    TruckStop(
      id: '25',
      name: 'Road Ranger Fuel Center',
      brand: 'Road Ranger',
      position: const LatLng(41.880, -87.630),
      address: 'Chicago, IL',
      dieselPrice: 4.55,
      icon: 'roadranger',
      assetLogo: 'assets/logo_brand_markers/truck_parking.png',
      description: 'Road Ranger high-volume diesel lanes with cardlock access and reefer plug-ins.',
    ),
    TruckStop(
      id: '26',
      name: 'Petro-Canada Truck Stop',
      brand: 'Petro-Canada',
      position: const LatLng(49.895, -97.138),
      address: 'Winnipeg, MB',
      dieselPrice: 4.60,
      icon: 'petrocanada',
      assetLogo: 'assets/logo_brand_markers/petro_canada_truck_stop.png',
      description: 'Petro-Canada with high-volume diesel, DEF, driver lounge, and full parking.',
    ),
    TruckStop(
      id: '27',
      name: 'Walmart Supercenter',
      brand: 'Walmart',
      position: const LatLng(36.362, -94.209),
      address: 'Bentonville, AR',
      icon: 'walmart',
      assetLogo: 'assets/logo_brand_markers/walmart_store.png',
      description: 'Walmart Supercenter with designated truck parking, overnight stays, and full shopping access.',
    ),
    TruckStop(
      id: '28',
      name: 'Trucker Hotel & Lodging',
      brand: 'Hotel',
      position: const LatLng(32.785, -96.800),
      address: 'Dallas, TX',
      icon: 'hotel',
      assetLogo: 'assets/logo_brand_markers/hotel_default.png',
      description: 'Truck-friendly hotel with extra-long parking stalls, complimentary breakfast, and Wi-Fi.',
    ),
    TruckStop(
      id: '29',
      name: 'Truck Stop Restaurant',
      brand: 'Restaurant',
      position: const LatLng(36.174, -86.767),
      address: 'Nashville, TN',
      icon: 'restaurant',
      assetLogo: 'assets/logo_brand_markers/restaurant.png',
      description: 'Full-service truck-stop restaurant with hot meals, salad bar, and 24/7 coffee service.',
    ),
    TruckStop(
      id: '30',
      name: 'Semi Truck Wash',
      brand: 'Truck Wash',
      position: const LatLng(38.871, -97.622),
      address: 'Salina, KS',
      icon: 'truckwash',
      assetLogo: 'assets/logo_brand_markers/commercial_vehicle_wash.png',
      description: 'High-pressure semi truck wash with hand-dry service and fleet discount programs.',
    ),
    TruckStop(
      id: '31',
      name: 'Truck Stop Fitness Center',
      brand: 'Gym',
      position: const LatLng(39.099, -94.578),
      address: 'Kansas City, MO',
      icon: 'gym',
      assetLogo: 'assets/logo_brand_markers/gym.png',
      description: 'On-site gym with showers, locker rooms, and 24/7 access for professional truck drivers.',
    ),
  ];

  // ── Truck Stop POI methods ─────────────────────────────────────────────────

  /// Filters [allStops] to only those within [maxDistanceMeters] of any point
  /// on [routePoints].  Call this after a new route loads to refresh the POI
  /// overlay without showing every stop in the country.
  ///
  /// Uses [geo.Geolocator.distanceBetween] for GPS-grade accuracy.
  ///
  /// **Performance note:** This is an O(n×m) scan (n stops × m route points).
  /// With the current mock dataset (≤ 10 stops) this is negligible.  When
  /// switching to a real data source with thousands of entries, replace this
  /// Returns only the [TruckStop]s that lie within [maxDistanceMeters] of the
  /// active route polyline, sorted by proximity to the current truck position,
  /// and capped at [maxPOIs] entries for rendering performance.
  ///
  /// For each stop, we iterate the decoded route points and use
  /// [geo.Geolocator.distanceBetween] (haversine) for accuracy.  The inner
  /// loop exits as soon as one qualifying point is found (early-exit) so the
  /// overall complexity is O(stops × route_points) in the worst case but
  /// typically much faster.
  ///
  /// When [routePoints] is empty (no active route) an empty list is returned
  /// so that unrelated POIs are not shown before the driver sets a destination.
  ///
  /// Production note: for very long routes consider sub-sampling [routePoints]
  /// with a spatial index (e.g. R-tree or bounding-box pre-filter) to avoid
  /// scanning every stop against every route point.
  List<TruckStop> _filterStopsNearRoute(
    List<TruckStop> allStops,
    List<LatLng> routePoints, {
    double maxDistanceMeters = 10000, // 10 km corridor around the route
    int maxPOIs = 50, // rendering cap for performance
  }) {
    // No active route — hide all POI stops so that distant (e.g. West-Coast)
    // markers are not shown before the driver picks a destination.
    if (routePoints.isEmpty) {
      debugPrint('[POI/Alert Filter] Truck stop markers: route not set – hiding all stops.');
      return const [];
    }

    // Step 1: keep only stops within [maxDistanceMeters] of any route point.
    final List<TruckStop> nearRoute = [];
    for (final stop in allStops) {
      for (final point in routePoints) {
        final double d = geo.Geolocator.distanceBetween(
          stop.position.latitude,
          stop.position.longitude,
          point.latitude,
          point.longitude,
        );
        if (d <= maxDistanceMeters) {
          // At least one route point is close enough – include and move on.
          nearRoute.add(stop);
          break;
        }
      }
    }

    // Step 2: sort by distance from the current truck position so the closest
    // stops appear first in the list (used by the "ahead" chip strip).
    // Pre-compute each distance once to avoid O(n²) haversine calls inside the
    // comparator (each comparison would otherwise call distanceBetween twice).
    final LatLng userPos =
        _truckPosition ?? (routePoints.isNotEmpty ? routePoints.first : const LatLng(0, 0));
    final Map<TruckStop, double> distToUser = {
      for (final stop in nearRoute)
        stop: geo.Geolocator.distanceBetween(
          stop.position.latitude,
          stop.position.longitude,
          userPos.latitude,
          userPos.longitude,
        ),
    };
    nearRoute.sort((a, b) => distToUser[a]!.compareTo(distToUser[b]!));

    // Step 3: cap at [maxPOIs] to keep the marker layer performant.
    final result =
        nearRoute.length > maxPOIs ? nearRoute.sublist(0, maxPOIs) : nearRoute;

    debugPrint(
      '[POI/Alert Filter] Truck stop markers: ${result.length}/${allStops.length} shown '
      '(within ${(maxDistanceMeters / 1609.34).toStringAsFixed(1)} miles of route).',
    );

    return result;
  }

  /// Returns the number of fuel stops (non-rest-area truck stops) within
  /// [maxDistanceMeters] of any point in [routePoints].
  int _countFuelStopsForRoute(
    List<LatLng> routePoints, {
    double maxDistanceMeters = 5000,
  }) {
    return _mockTruckStops
        .where((stop) =>
            stop.brand != 'Rest Area' && stop.brand != 'Weigh Station')
        .where((stop) {
          for (final pt in routePoints) {
            final d = geo.Geolocator.distanceBetween(
              stop.position.latitude,
              stop.position.longitude,
              pt.latitude,
              pt.longitude,
            );
            if (d <= maxDistanceMeters) return true;
          }
          return false;
        })
        .length;
  }

  /// Returns the number of weigh-station [MapPoi]s within [maxDistanceMeters]
  /// of any point in [routePoints].
  int _countWeighStationsForRoute(
    List<LatLng> routePoints, {
    double maxDistanceMeters = 5000,
  }) {
    return _mapPois
        .where((p) => p.type == PoiType.weighStation)
        .where((poi) {
          for (final pt in routePoints) {
            final d = geo.Geolocator.distanceBetween(
              poi.position.latitude,
              poi.position.longitude,
              pt.latitude,
              pt.longitude,
            );
            if (d <= maxDistanceMeters) return true;
          }
          return false;
        })
        .length;
  }

  /// Normalizes a raw truck-stop name or brand string into a canonical
  /// lower-case brand key used by [_getTruckStopLogo].
  ///
  /// Handles messy real-world inputs such as "Love's Travel Stop", "Loves",
  /// "Flying J Travel Center", "TA Petro", as well as Canadian brands
  /// (Petro-Canada, Husky, Esso, Ultramar, Irving), regional chains
  /// (Kwik Trip, Maverik, Casey's, Sapp Bros), and major fuel brands
  /// (Mobil, Exxon, Chevron, Shell, BP, Circle K).
  ///
  /// Returns one of the canonical keys: pilot, flyingj, loves, ta, petro,
  /// ambest, roadranger, kwiktrip, qt, maverik, caseys, sappbros, petro-canada,
  /// husky, esso, ultramar, irving, independent, mobil, exxon, chevron,
  /// shell, bp, circlek, or 'default'.
  String _normalizeTruckStopBrand(String rawName) {
    final n = rawName.toLowerCase().trim();

    // National chains
    if (n.contains('pilot')) return 'pilot';
    if (n.contains('flying j') || n.contains('flyingj')) return 'flyingj';
    if (n.contains("love's") || n.contains('loves')) return 'loves';
    if (n.contains('road ranger') || n.contains('roadranger')) return 'roadranger';
    if (n.contains('am best') || n.contains('ambest')) return 'ambest';
    if (n.contains('sapp bros') || n.contains('sappbros')) return 'sappbros';

    // Canadian brands (check before generic 'petro' to avoid false match)
    if (n.contains('petro-canada') ||
        n.contains('petrocanada') ||
        n.contains('petro canada')) return 'petro-canada';
    if (n.contains('husky')) return 'husky';
    if (n.contains('esso')) return 'esso';
    if (n.contains('ultramar')) return 'ultramar';
    if (n.contains('irving')) return 'irving';

    // TA / Petro (must follow petro-canada check above)
    if (n == 'ta' ||
        n.startsWith('ta ') ||
        n.contains('travelcenters') ||
        n.contains('travel center') ||
        n.contains('ta petro')) return 'ta';
    if (n.contains('petro')) return 'petro';

    // Regional chains
    if (n.contains('kwik trip') || n.contains('kwiktrip')) return 'kwiktrip';
    if (n == 'qt' || n.contains('quiktrip') || n.contains('quicktrip') || n.contains('quick trip')) return 'qt';
    if (n.contains('maverik')) return 'maverik';
    if (n.contains("casey's") || n.contains('caseys')) return 'caseys';

    // Major fuel brands with uploaded logos
    if (n.contains('mobil')) return 'mobil';
    if (n.contains('exxon')) return 'exxon';
    if (n.contains('chevron')) return 'chevron';
    if (n.contains('shell')) return 'shell';
    if (n.contains('bp') || n.contains('british petroleum')) return 'bp';
    if (n.contains('circle k') || n.contains('circlek')) return 'circlek';

    // Independent
    if (n.contains('independent') || n == 'indie') return 'independent';

    // Rest areas — matches before weigh-station to avoid false positives
    if (n.contains('rest area') || n.contains('rest stop') || n == 'rest') {
      return 'rest';
    }

    // Weigh stations / scales — must check last so branded stops resolve first.
    if (n.contains('weigh station') ||
        n.contains('weight station') ||
        n.contains('weigh sta') ||
        n.contains('scale') ||
        n == 'weigh') return 'weigh';

    return 'default';
  }

  /// Maps each brand icon key to its asset path in the project.
  ///
  /// Keys match the [TruckStop.icon] field and GeoJSON `properties["icon"]`.
  /// Values are Flutter asset paths registered in `pubspec.yaml`.
  ///
  /// This is the flutter_map equivalent of calling `style.addImage(key, bytes)`
  /// for each entry before adding a Mapbox SymbolLayer with
  /// `iconImage: ["get", "icon"]`.
  /// Full map of brand key → asset path for every PNG in `assets/logo_brand_markers/`.
  ///
  /// This is kept in sync with the actual files in `assets/logo_brand_markers/`
  /// so that the legacy [_brandIcons] lookup path still works alongside the
  /// dynamic [AssetManifest] loading in [_preloadBrandIcons].
  static const Map<String, String> _brandIcons = {
    'pilot':        'assets/logo_brand_markers/pilot.png',
    'loves':        'assets/logo_brand_markers/loves.png',
    'ta':           'assets/logo_brand_markers/ta_truck_stop.png',
    'petro':        'assets/logo_brand_markers/petro_truck_stop.png',
    'flyingj':      'assets/logo_brand_markers/flying_j_truck_stop.png',
    'mobil':        'assets/logo_brand_markers/truck_parking.png',
    'chevron':      'assets/logo_brand_markers/truck_parking.png',
    'shell':        'assets/logo_brand_markers/truck_parking.png',
    'bp':           'assets/logo_brand_markers/truck_parking.png',
    'circlek':      'assets/logo_brand_markers/circle_truck_stop.png',
    'weigh':        'assets/logo_brand_markers/weight_station.png',
    'rest':         'assets/logo_brand_markers/rest_area.png',
    'roadranger':   'assets/logo_brand_markers/truck_parking.png',
    'ambest':       'assets/logo_brand_markers/truck_parking.png',
    'quicktrip':    'assets/logo_brand_markers/quicktrip_truck_stop.png',
    'esso':         'assets/logo_brand_markers/truck_parking.png',
    'petrocanada':  'assets/logo_brand_markers/petro_canada_truck_stop.png',
    'walmart':      'assets/logo_brand_markers/walmart_store.png',
    'hotel':        'assets/logo_brand_markers/hotel_default.png',
    'restaurant':   'assets/logo_brand_markers/restaurant.png',
    'truckwash':    'assets/logo_brand_markers/commercial_vehicle_wash.png',
    'gym':          'assets/logo_brand_markers/gym.png',
    'maverik':      'assets/logo_brand_markers/truck_parking.png',
  };

  /// Builds the list of [Marker]s for each visible truck stop in [_truckStops].
  ///
  /// Returns an empty list when [_showTruckStops] is false so markers disappear
  /// immediately when the driver toggles the POI overlay off.
  ///
  /// Only stops whose [TruckStop.assetLogo] has been successfully loaded into
  /// [_brandIconBytes] are rendered — this ensures that **every visible marker
  /// uses a logo image from `assets/logo_brand_markers/`** and no generic
  /// fallback icons appear on the map.  Tapping a marker calls
  /// [_showTruckStopSheet].
  ///
  /// Rest Area and Weigh Station markers display the raw PNG logo with no
  /// background, border, or container — the asset image is the full marker.
  /// If the PNG asset for a stop has not been loaded, that stop is silently
  /// omitted rather than falling back to a generic icon.
  List<Marker> _buildTruckStopMarkers() {
    if (!_showTruckStops || _truckStops.isEmpty) return const [];

    final markers = <Marker>[];
    for (final stop in _truckStops) {
      // Only render markers whose logo has been loaded — no fallback icons.
      // For Rest Area and Weigh Station brands this guarantees the marker is
      // always the branded PNG from assets/logo_brand_markers/.
      final Uint8List? bytes =
          stop.assetLogo != null ? _brandIconBytes[stop.assetLogo] : null;
      if (bytes == null) {
        debugPrint(
          '[TruckStopMarkers] ✗ Missing icon bytes for stop "${stop.name}" '
          '(assetLogo="${stop.assetLogo}"). Check that the file exists in '
          'assets/logo_brand_markers/ and is listed in pubspec.yaml.',
        );
        continue;
      }

      markers.add(Marker(
        point: stop.position,
        width: 40,
        height: 40,
        alignment: Alignment.center,
        child: GestureDetector(
          onTap: () => _showTruckStopSheet(stop),
          // Display the PNG logo directly — no ClipOval, no Container, no
          // background color.  The image fills the marker bounds exactly so
          // drivers see only the brand asset on the map.
          child: Image.memory(
            bytes,
            width: 40,
            height: 40,
            fit: BoxFit.contain,
            gaplessPlayback: true,
          ),
        ),
      ));
    }
    return markers;
  }

  /// Builds logo-only [Marker]s for [MapPoi] entries of type [PoiType.weighStation].
  ///
  /// Each weigh-station POI is rendered as its PNG logo from
  /// `assets/logo_brand_markers/` with no background, border, or container —
  /// the asset image is the full marker.  If the logo asset has not been loaded
  /// into [_brandIconBytes] the POI is silently skipped (no fallback icon).
  ///
  /// The fixed asset key used for all weigh-station POIs is
  /// `'assets/logo_brand_markers/weight_station.png'`.  Update this constant
  /// if the logo file is renamed.
  ///
  /// Tapping a weigh-station marker shows the proximity alert dialog via
  /// [_showPoiAlert] so drivers receive the same actionable status information
  /// they would get from the auto-proximity check.
  List<Marker> _buildPoiMarkers() {
    // Asset key for the weigh-station logo — must match the file registered in
    // pubspec.yaml and present under assets/logo_brand_markers/.
    const String weighStationAsset =
        'assets/logo_brand_markers/weight_station.png';

    // Guard: if the weigh-station logo was not loaded, omit all POI markers
    // rather than showing a fallback icon.
    final Uint8List? weighBytes = _brandIconBytes[weighStationAsset];
    if (weighBytes == null) {
      debugPrint(
        '[PoiMarkers] ✗ Weigh-station icon not loaded from "$weighStationAsset". '
        'Ensure weight_station.png exists in assets/logo_brand_markers/.',
      );
      return const [];
    }

    // Only display POI markers that lie within _poiDisplayBufferMeters of the
    // active route polyline.  When no route is set, no markers are shown so
    // that unrelated West-Coast (or any far-off) POIs are not cluttering the
    // map before the driver picks a destination.
    if (_routePoints.isEmpty) {
      debugPrint('[POI/Alert Filter] Map POI markers: route not set – hiding all POI markers.');
      return const [];
    }

    final List<MapPoi> poisNearRoute = _mapPois
        .where((poi) => poi.type == PoiType.weighStation)
        .where((poi) {
          for (final routePt in _routePoints) {
            if (_distanceBetween(poi.position, routePt) <=
                _poiDisplayBufferMeters) return true;
          }
          return false;
        })
        .toList();

    debugPrint(
      '[POI/Alert Filter] Map POI markers: ${poisNearRoute.length}/'
      '${_mapPois.where((p) => p.type == PoiType.weighStation).length} '
      'weigh-station POIs shown (within '
      '${(_poiDisplayBufferMeters / 1609.34).toStringAsFixed(0)} miles of route).',
    );

    // Determine which weigh station is the active next one during navigation
    // so it can be rendered with a distinct highlight ring.
    final String? nextStationId = (_isNavigating && _closestWeighStationsAhead.isNotEmpty)
        ? _closestWeighStationsAhead.first.poi.id
        : null;

    return poisNearRoute
        .map((poi) {
          final bool isNext = poi.id == nextStationId;
          // Next upcoming station is rendered at 48 px with an orange highlight
          // ring so it stands out clearly from other stations on the map.
          final double size = isNext ? 48.0 : 40.0;
          final Widget markerChild = isNext
              ? Container(
                  width: size,
                  height: size,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: Colors.orange,
                      width: 2.5,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.orange.withOpacity(0.5),
                        blurRadius: 8,
                        spreadRadius: 2,
                      ),
                    ],
                  ),
                  child: ClipOval(
                    child: Image.memory(
                      weighBytes,
                      fit: BoxFit.cover,
                      gaplessPlayback: true,
                    ),
                  ),
                )
              : Image.memory(
                  weighBytes,
                  width: size,
                  height: size,
                  fit: BoxFit.contain,
                  gaplessPlayback: true,
                );
          return Marker(
            point: poi.position,
            width: size,
            height: size,
            alignment: Alignment.center,
            child: GestureDetector(
              onTap: () => _showPoiAlert(poi),
              child: markerChild,
            ),
          );
        })
        .toList();
  }

  /// Checks whether the driver is within 500 m of any [MapPoi] and triggers
  /// [_showPoiAlert] for the first unshown POI that is in range.
  ///
  /// Each POI id is added to [_poiAlertShown] after the first alert so the
  /// same POI does not produce repeated popups during the same session.
  void _checkPoiAlerts(LatLng currentPosition) {
    for (final poi in _mapPois) {
      if (_poiAlertShown.contains(poi.id)) continue;
      final double dist = geo.Geolocator.distanceBetween(
        currentPosition.latitude,
        currentPosition.longitude,
        poi.position.latitude,
        poi.position.longitude,
      );
      if (dist <= 500) {
        _poiAlertShown.add(poi.id);
        _showPoiAlert(poi);
        break; // show one alert at a time to avoid dialog stacking
      }
    }
  }

  /// Shows an [AlertDialog] warning the driver that they are approaching [poi].
  ///
  /// The dialog displays the POI name, type label, and status so the driver
  /// has actionable information (e.g. "Weigh Station – Open") before arrival.
  void _showPoiAlert(MapPoi poi) {
    if (!mounted) return;
    final String typeLabel;
    final IconData typeIcon;
    final Color typeColor;
    switch (poi.type) {
      case PoiType.weighStation:
        typeLabel = 'Weigh Station';
        typeIcon = Icons.scale;
        typeColor = Colors.orange.shade700;
        break;
      case PoiType.police:
        typeLabel = 'Police / Inspection';
        typeIcon = Icons.local_police;
        typeColor = Colors.deepPurple.shade700;
        break;
      case PoiType.portOfEntry:
        typeLabel = 'Port of Entry';
        typeIcon = Icons.border_all;
        typeColor = Colors.indigo.shade700;
        break;
    }
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Icon(typeIcon, color: typeColor, size: 28),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                typeLabel,
                style: TextStyle(
                  color: typeColor,
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                ),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              poi.name,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            Text(
              'Status: ${poi.status}',
              style: const TextStyle(fontSize: 14),
            ),
            const SizedBox(height: 12),
            const Text(
              'Approaching in less than 500 m.',
              style: TextStyle(fontSize: 13, color: Colors.grey),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Dismiss'),
          ),
        ],
      ),
    );
  }

  /// Returns the complete list of [Marker]s for the [MarkerLayer]:
  /// truck position, destination pin (when selected or arrived), visible truck
  /// stop POIs (logo-backed only), weigh-station [MapPoi] logo markers, and
  /// truck restriction / warning markers.
  ///
  /// [_buildTruckStopMarkers] renders brand-logo markers for all [TruckStop]
  /// entries (including Rest Area and Weigh Station brands) whose PNG has been
  /// loaded from `assets/logos/`.  Clustered POIs from `assets/locations.json`
  /// are rendered via the Mapbox style layers set up in [_setupPoiCluster].
  /// [_buildPoiMarkers] adds logo-only markers for [MapPoi] weigh stations
  /// using the same asset-existence guard — no generic fallback icons appear
  /// on the map for either category.
  List<Marker> _buildMarkers() {
    return [
      if (_truckPosition != null || _routePoints.isNotEmpty) _buildTruckMarker(),
      if (_selectedDestination != null || _isArrived) _buildDestinationMarker(),
      ..._buildTruckStopMarkers(),
      // Logo-only markers for MapPoi weigh stations (no background/fallback).
      ..._buildPoiMarkers(),
      ..._buildRestrictionMarkers(),
      ..._buildWarningMarkers(),
    ];
  }

  /// Shows a modal bottom sheet with full details for [stop].
  ///
  /// Displays brand, name, diesel price (if known), address (if known), and a
  /// close button.  Styled consistently with the arrival sheet.
  void _showTruckStopSheet(TruckStop stop) {
    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final bool isRestArea = stop.brand == 'Rest Area';
        final bool isWeighStation = stop.brand == 'Weigh Station';
        final Color headerColor = isRestArea
            ? Colors.teal.shade700
            : isWeighStation
                ? Colors.orange.shade700
                : Colors.blue.shade700;
        return Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ── Header row: icon + name ──────────────────────────────────
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor: headerColor,
                    child: Icon(
                      isRestArea
                          ? Icons.airline_seat_recline_normal
                          : isWeighStation
                              ? Icons.scale
                              : Icons.local_gas_station,
                      color: Colors.white,
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
                        Text(
                          stop.brand,
                          style: TextStyle(
                            fontSize: 13,
                            color: headerColor,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // ── Diesel price ─────────────────────────────────────────────
              if (stop.dieselPrice != null) ...[
                Row(
                  children: [
                    const Icon(Icons.local_gas_station,
                        size: 18, color: Colors.grey),
                    const SizedBox(width: 8),
                    Text(
                      'Diesel: \$${stop.dieselPrice!.toStringAsFixed(2)}/gal',
                      style: const TextStyle(fontSize: 15),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
              ],
              // ── Address ──────────────────────────────────────────────────
              if (stop.address != null) ...[
                Row(
                  children: [
                    const Icon(Icons.location_on,
                        size: 18, color: Colors.grey),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        stop.address!,
                        style: const TextStyle(fontSize: 15),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
              ],
              // ── Description snippet ───────────────────────────────────────
              if (stop.description != null) ...[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.info_outline,
                        size: 18, color: Colors.grey),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        stop.description!,
                        style: const TextStyle(fontSize: 14, height: 1.4),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
              ],
              // ── Close button ─────────────────────────────────────────────
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: headerColor,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
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
    // Only follow the truck when actively navigating to a destination.
    if (!_hasActiveDestination) return;
    // Skip camera follow if user is freely exploring the map.
    if (_cameraMode != NavigationCameraMode.follow) return;
    // Shift the camera target slightly ahead of the truck (−_cameraLeadLatitude°)
    // so the road in front is always visible, matching Google Maps navigation.
    final cameraTarget = LatLng(
      _truckPosition!.latitude - _cameraLeadLatitude,
      _truckPosition!.longitude,
    );
    final double speedMph = _currentSpeedMps > 0
        ? _currentSpeedMps * _mpsToMph
        : 0.0;

    // Compute next-step distance in miles for turn-zoom boost.
    double? nextStepMiles;
    if (_navSteps.isNotEmpty) {
      nextStepMiles = _distanceToNextStep() / _metersPerMile;
    }

    final double zoom = _navigationZoomForStep(speedMph, nextStepMiles);
    // Rotate map with heading only when truck is moving fast enough to produce
    // a stable heading from GPS.  Below _noRotateSpeedMph hold the bearing
    // steady to prevent the map from spinning from heading noise.
    double bearing;
    if (speedMph >= _noRotateSpeedMph) {
      bearing = _truckBearing;
      _lastKnownBearing = bearing;
    } else {
      bearing = _lastKnownBearing;
    }
    _mapController.moveAndRotate(cameraTarget, zoom, bearing);
  }

  /// Returns the appropriate navigation zoom level for [speedMph].
  ///
  /// Uses stepped thresholds based on speed range:
  /// - 0–10 mph  → 17.2  (urban / stopped, very close)
  /// - 10–30 mph → 16.3  (city/suburban)
  /// - 30–55 mph → 15.3  (highway approach)
  /// - 55+ mph   → 14.7  (open highway)
  double _navigationZoomForSpeed(double speedMph) {
    if (speedMph <= 10) return 17.0;
    if (speedMph <= 30) return 16.2;
    if (speedMph <= 55) return 15.3;
    return 14.7;
  }

  /// Updates the camera for a moving truck: rotates with heading when speed is
  /// high enough and zooms dynamically based on [pos] speed.
  ///
  /// Delegates to [_setFollowCamera] which applies turn-zoom, bearing
  /// filtering, and lower-third framing in one place.
  void _updateNavigationCamera(geo.Position pos) {
    if (!_mapReady || _truckPosition == null || _isArrived) return;
    if (_cameraMode != NavigationCameraMode.follow) return;
    _setFollowCamera(pos);
  }

  /// Updates the camera when the truck is stopped or moving very slowly.
  ///
  /// Keeps the map stable — no bearing changes — and zooms in slightly to
  /// show the immediate surroundings clearly.
  void _updateStoppedCamera(geo.Position pos) {
    if (!_mapReady || _truckPosition == null || _isArrived) return;
    if (_cameraMode != NavigationCameraMode.follow) return;
    // Use a fixed close-in zoom when stopped (top of the 0–10 mph band).
    const double stoppedZoom = 17.2;
    // Do not shift target ahead when stopped — centre the truck on screen.
    final cameraTarget = LatLng(pos.latitude, pos.longitude);
    // Hold the last known bearing so the map does not spin from heading noise.
    _mapController.moveAndRotate(cameraTarget, stoppedZoom, _lastKnownBearing);
  }

  /// Returns the appropriate navigation zoom level for [speedMph] with an
  /// optional turn-approach boost.
  ///
  /// When [nextStepMiles] is provided and the maneuver is close, the camera
  /// zooms in slightly beyond the speed-based level so the intersection is
  /// clearly visible before the turn:
  ///   - under 0.5 mi  → +0.5 zoom  (mild approach zoom)
  ///   - under 0.2 mi  → +1.0 zoom  (close approach zoom)
  /// After the maneuver the boost is removed and the map returns to the
  /// normal speed-based level on the next GPS cycle.
  double _navigationZoomForStep(double speedMph, double? nextStepMiles) {
    final double base = _navigationZoomForSpeed(speedMph);
    if (nextStepMiles == null) return base;
    if (nextStepMiles < 0.2) return (base + 1.0).clamp(0.0, 18.0);
    if (nextStepMiles < 0.5) return (base + 0.5).clamp(0.0, 18.0);
    return base;
  }

  /// Activates **follow mode**: locks the camera onto the truck with
  /// heading-based rotation, speed-adaptive zoom, and lower-third framing.
  ///
  /// Zoom is determined by [_navigationZoomForSpeed] using stepped thresholds.
  /// Bearing uses [geo.Position.heading] directly when speed ≥ [_noRotateSpeedMph];
  /// otherwise [_lastKnownBearing] is held to prevent jitter when stopped.
  ///
  /// Safe to call at any time; no-ops when the map is not ready.
  void _setFollowCamera(geo.Position pos) {
    if (!_mapReady || _isArrived) return;
    _gestureReturnTimer?.cancel();
    _gestureReturnTimer = null;
    _cameraMode = NavigationCameraMode.follow;

    final double speedMph = pos.speed > 0 ? pos.speed * _mpsToMph : 0.0;
    final double zoom = _navigationZoomForSpeed(speedMph);

    // Use pos.heading when moving fast enough for a stable heading;
    // hold the last known bearing when stopped to prevent jitter.
    final double bearing =
        speedMph >= _noRotateSpeedMph ? pos.heading : _lastKnownBearing;
    if (speedMph >= _noRotateSpeedMph && pos.heading >= 0) {
      _lastKnownBearing = pos.heading;
    }

    // Shift target ahead of truck so it sits in the lower third of screen.
    final cameraTarget = LatLng(
      pos.latitude - _cameraLeadLatitude,
      pos.longitude,
    );

    _mapController.moveAndRotate(cameraTarget, zoom, bearing);
  }

  /// Activates **overview mode**: fits the full route on screen, north-up.
  ///
  /// When no route is loaded the camera simply centres on the truck.
  void _setOverviewCamera() {
    if (!_mapReady) return;
    _gestureReturnTimer?.cancel();
    _gestureReturnTimer = null;
    setState(() => _cameraMode = NavigationCameraMode.overview);

    if (_routePoints.isNotEmpty) {
      _fitCameraToRoute(_routePoints);
    } else if (_truckPosition != null) {
      _mapController.moveAndRotate(_truckPosition!, 10.0, 0.0);
    }
  }

  /// Activates **free mode**: pauses camera follow so the user can pan/zoom
  /// without forced camera snaps.
  ///
  /// Schedules an automatic return to follow mode after 8 s of idle when
  /// navigation is active.
  void _setFreeCamera() {
    _gestureReturnTimer?.cancel();
    setState(() {
      _cameraMode = NavigationCameraMode.free;
      _lastManualMapInteractionAt = DateTime.now();
    });

    // Auto-return to follow mode after 8 s if navigating.
    if (_hasActiveDestination) {
      _gestureReturnTimer = Timer(const Duration(seconds: 8), () {
        _maybeReturnToFollowMode();
      });
    }
  }

  /// Called when the user starts a map gesture (pan / pinch / rotate).
  ///
  /// Switches to free mode so the camera does not fight the user's input.
  void _onMapGestureStarted() {
    if (_cameraMode == NavigationCameraMode.follow ||
        _cameraMode == NavigationCameraMode.overview) {
      _setFreeCamera();
    } else if (_cameraMode == NavigationCameraMode.free) {
      // Reset the idle timer while the user is still interacting.
      _gestureReturnTimer?.cancel();
      setState(() {
        _isUserInteractingWithMap = true;
        _lastManualMapInteractionAt = DateTime.now();
      });
    }
  }

  /// Called when the user ends a map gesture.
  ///
  /// Starts (or restarts) the 8-second idle countdown for auto-return to
  /// follow mode.
  void _onMapGestureEnded() {
    setState(() {
      _isUserInteractingWithMap = false;
      _lastManualMapInteractionAt = DateTime.now();
    });

    if (!_hasActiveDestination) return;
    _gestureReturnTimer?.cancel();
    _gestureReturnTimer = Timer(const Duration(seconds: 8), () {
      _maybeReturnToFollowMode();
    });
  }

  /// Returns to follow mode if enough idle time has elapsed and navigation
  /// is still active.
  ///
  /// Called by [_gestureReturnTimer] after 8 seconds.
  void _maybeReturnToFollowMode() {
    if (!mounted) return;
    if (!_hasActiveDestination) return;
    if (_isUserInteractingWithMap) return;
    final last = _lastManualMapInteractionAt;
    if (last != null &&
        DateTime.now().difference(last).inSeconds < 8) {
      return; // user interacted very recently; wait longer
    }
    setState(() => _cameraMode = NavigationCameraMode.follow);
    _followTruckCamera();
  }

  /// Handles the recenter button tap.
  ///
  /// - If in **free** mode: returns to follow mode and snaps camera to truck.
  /// - If already in **follow** mode: refreshes/snaps camera to truck.
  /// - If in **overview** mode: returns to follow mode.
  void _onRecenterPressed() {
    _gestureReturnTimer?.cancel();
    _gestureReturnTimer = null;
    setState(() => _cameraMode = NavigationCameraMode.follow);
    _followTruckCamera();
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

  /// Returns `true` when the new GPS fix is far enough from the last
  /// route-check position to warrant a fresh API call.
  ///
  /// Ignores movements smaller than ~55 m (0.0005° ≈ 55 m at mid-latitudes)
  /// to avoid hammering the Mapbox API while the truck is stationary or
  /// creeping in traffic.  Updates [_lastRouteCheckLat] / [_lastRouteCheckLng]
  /// only when movement is significant so the next check uses the correct
  /// reference point.
  bool _shouldUpdateRoute(double lat, double lng) {
    final distanceMoved =
        (lat - _lastRouteCheckLat).abs() + (lng - _lastRouteCheckLng).abs();
    if (distanceMoved < 0.0005) {
      return false; // ignore small movement
    }
    _lastRouteCheckLat = lat;
    _lastRouteCheckLng = lng;
    return true;
  }

  /// Returns `true` when at least 5 seconds have elapsed since the last
  /// GPS-triggered [fetchRoute] call.
  ///
  /// Prevents the directions API from being called more than once every
  /// 5 seconds regardless of how frequently GPS fixes arrive.  Updates
  /// [_lastApiCallTime] only when the call is allowed.
  bool _canCallApi() {
    if (_lastApiCallTime == null) {
      _lastApiCallTime = DateTime.now();
      return true;
    }
    final elapsed = DateTime.now().difference(_lastApiCallTime!).inSeconds;
    if (elapsed >= 5) {
      _lastApiCallTime = DateTime.now();
      return true;
    }
    return false;
  }

  // ── GPS drift-filter helpers ───────────────────────────────────────────────

  /// Converts a speed value in metres per second to miles per hour.
  /// Returns 0.0 for NaN or negative inputs (e.g. unavailable GPS speed).
  double _speedMphFromMps(double mps) {
    if (mps.isNaN || mps < 0) return 0.0;
    return mps * _mpsToMph;
  }

  /// Returns the haversine distance in metres between two [geo.Position] fixes.
  double _distanceMetersBetween(geo.Position a, geo.Position b) {
    return geo.Geolocator.distanceBetween(
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude,
    );
  }

  /// Returns `true` when at least [_directionsThrottleSeconds] seconds have
  /// elapsed since the last directions API reroute call, guarding against
  /// rapid repeated requests.
  /// Uses [_lastDirectionsCallAt] independently of [_lastApiCallTime].
  bool _canCallDirections() {
    final now = DateTime.now();
    if (_lastDirectionsCallAt == null) {
      _lastDirectionsCallAt = now;
      return true;
    }
    if (now.difference(_lastDirectionsCallAt!).inSeconds >=
        _directionsThrottleSeconds) {
      _lastDirectionsCallAt = now;
      return true;
    }
    return false;
  }

  /// Decides whether [newPos] should be accepted as a new truck location.
  ///
  /// Rules applied in order:
  ///   1. First fix is always accepted.
  ///   2. Ignore drift < [_minStoppedDriftMeters] when speed is below
  ///      [_stoppedSpeedMph] (vehicle is stopped).
  ///   3. Ignore jumps < [_minPoorAccuracyJumpMeters] when GPS accuracy
  ///      exceeds [_poorAccuracyMeters].
  ///   4. Accept immediately when speed ≥ [_stoppedSpeedMph] or distance
  ///      ≥ [_immediateAcceptDistanceMeters].
  ///   5. Require [_requiredCandidateFixCount] consistent candidate fixes
  ///      for a low-speed position shift.
  bool _shouldAcceptPosition(geo.Position newPos) {
    final speedMph = _speedMphFromMps(newPos.speed);

    if (_lastAcceptedPosition == null) {
      _candidatePosition = null;
      _stableCandidateCount = 0;
      return true;
    }

    final distanceMeters =
        _distanceMetersBetween(_lastAcceptedPosition!, newPos);
    final poorAccuracy = newPos.accuracy > _poorAccuracyMeters;
    final stopped = speedMph < _stoppedSpeedMph;

    // Ignore tiny drift when the vehicle is stopped.
    if (stopped && distanceMeters < _minStoppedDriftMeters) return false;

    // Ignore small jumps when GPS accuracy is poor.
    if (poorAccuracy && distanceMeters < _minPoorAccuracyJumpMeters) {
      return false;
    }

    // Accept immediately when clearly moving or significantly displaced.
    if (speedMph >= _stoppedSpeedMph ||
        distanceMeters >= _immediateAcceptDistanceMeters) {
      _candidatePosition = null;
      _stableCandidateCount = 0;
      return true;
    }

    // Candidate confirmation: require _requiredCandidateFixCount consistent
    // slow-movement fixes before accepting the new position.
    if (_candidatePosition == null) {
      _candidatePosition = newPos;
      _stableCandidateCount = 1;
      return false;
    }

    final candidateDistance =
        _distanceMetersBetween(_candidatePosition!, newPos);
    if (candidateDistance < _candidateStabilityRadiusMeters) {
      _stableCandidateCount++;
    } else {
      _candidatePosition = newPos;
      _stableCandidateCount = 1;
    }

    if (_stableCandidateCount >= _requiredCandidateFixCount) {
      _candidatePosition = null;
      _stableCandidateCount = 0;
      return true;
    }

    return false;
  }

  /// Returns `true` when route progress (nearest-point snapping) should
  /// advance for [pos].  Always returns `true` in [_isSimulationMode].
  bool _shouldAdvanceRouteProgress(geo.Position pos) {
    if (_isSimulationMode) return true;
    if (_speedMphFromMps(pos.speed) < _stoppedSpeedMph) return false;
    if (_lastAcceptedPosition == null) return false;
    return _distanceMetersBetween(_lastAcceptedPosition!, pos) >=
        _minRouteProgressDistanceMeters;
  }

  /// Advances [_truckIndex] to [nearestRouteIndex] only when movement is
  /// real and the jump is not spuriously large (GPS noise guard).
  void _tryAdvanceRouteIndex(int nearestRouteIndex, geo.Position pos) {
    if (!_shouldAdvanceRouteProgress(pos)) return;
    if (nearestRouteIndex <= _truckIndex) return;
    final jump = nearestRouteIndex - _truckIndex;
    // Cap index jumps to _maxRouteIndexJump points per fix to suppress
    // GPS noise teleports in real-device mode.
    if (jump > _maxRouteIndexJump && !_isSimulationMode) return;
    _truckIndex = nearestRouteIndex;
  }

  /// Requests location permission and subscribes to the device GPS stream.
  ///
  /// Each position update snaps the truck marker to the nearest route point
  /// ahead of the current position, so the marker always follows the real
  /// device location when available.
  Future<void> _startGps() async {
    bool serviceEnabled = await geo.Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return;

    geo.LocationPermission permission = await geo.Geolocator.checkPermission();
    if (permission == geo.LocationPermission.denied) {
      permission = await geo.Geolocator.requestPermission();
      if (permission == geo.LocationPermission.denied) return;
    }
    if (permission == geo.LocationPermission.deniedForever) return;

    const locationSettings = geo.LocationSettings(
      accuracy: geo.LocationAccuracy.high,
      distanceFilter: 10,
    );

    _gpsSubscription = geo.Geolocator.getPositionStream(
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
  void _onGpsPosition(geo.Position position) {
    // Ignore all GPS updates once the driver has arrived — the trip is done.
    if (_isArrived) return;
    // Pause guard: skip all tracking updates while navigation is paused.
    if (_navigationPaused) return;

    // ── GPS drift / noise filter ───────────────────────────────────────────
    // Apply the position acceptance filter: ignores stopped drift, poor-
    // accuracy jitter, and low-speed fluctuations until confirmed stable.
    // This replaces the old hard 20 m accuracy cut-off with a richer logic
    // that handles all cases described in the GPS-drift spec.
    if (!_shouldAcceptPosition(position)) return;

    // Mark whether the vehicle is currently stopped for all downstream logic.
    _isStopped = _speedMphFromMps(position.speed) < _stoppedSpeedMph;
    _gpsActive = true;
    final gpsPoint = LatLng(position.latitude, position.longitude);

    // ── Navigation-specific logic ─────────────────────────────────────────
    // The following checks only run when there is an active destination and
    // a live navigation session.  In plain GPS-tracking mode (no destination
    // selected) the truck marker and speed panel still update, but no
    // turn-by-turn, rerouting, TTS, or POI-alert behaviour fires.
    if (_hasActiveDestination) {
      // Arrival detection: check proximity to destination first.
      // Always evaluated before step/off-route logic so arrival wins immediately.
      _checkArrival(gpsPoint);
      if (_isArrived) return; // arrival was just triggered — stop all processing

      // Leg arrival detection: advance active leg when driver reaches each stop.
      _checkLegArrival(gpsPoint);

      // Step advancement: speak instruction when nearing next maneuver.
      _checkStepAdvancement(gpsPoint);

      // Off-route detection: reroute when >30 m from the route line.
      // Guard: do not reroute while stopped — GPS noise while parked can push
      // the position outside the route corridor and trigger spurious reroutes.
      if (!_isStopped) _checkOffRoute(gpsPoint);

      // POI proximity alerts: warn driver when within 500 m of a POI.
      _checkPoiAlerts(gpsPoint);

      // Restriction proximity alerts: warn about upcoming violations.
      _checkRestrictionAheadAlert(gpsPoint);

      // Warning sign proximity: update the WarningManager so popup cards
      // are added / updated / evicted based on the truck's distance to each
      // sign along the active route.
      _warningManager.update(
        truckPosition: gpsPoint,
        routePoints: _routePoints,
      );

      // Warning sign proximity alerts: single-banner alert for safety hazards.
      _checkWarningAheadAlert(gpsPoint);

      // Ahead-on-route weigh stations: refresh the closest 1–2 stations
      // ahead on the active route so the ClosestWeighStationsRow stays current.
      if (_isNavigating) _refreshClosestWeighStationsAhead();

      // Trip statistics: update mileage and stopped time from live GPS.
      _updateTripStats(position);
    }

    // ── Update truck position and heading (tracking + navigation) ─────────
    // Snap to the nearest ahead-of-index route point for step/off-route logic
    // only when a route exists; otherwise keep the raw GPS fix for display.
    // Use _tryAdvanceRouteIndex instead of direct assignment to prevent GPS
    // noise teleports and fake progress while stopped.
    int nearest = _truckIndex;
    if (_routePoints.isNotEmpty) {
      final candidate = _nearestRouteIndex(gpsPoint);
      _tryAdvanceRouteIndex(candidate, position);
      nearest = _truckIndex;
    }

    // Prefer the true device heading from GPS (heading ≥ 0 = valid fix).
    // Fall back to route-computed bearing when heading is unavailable (−1).
    // Suppress rotation when speed is below _noRotateSpeedMph to keep the
    // camera stable while the truck is slow or stopped.
    final double trueBearing;
    final double speedMph = _speedMphFromMps(position.speed);
    if (position.heading >= 0 && speedMph >= _noRotateSpeedMph) {
      // Real device compass heading — use directly for marker rotation.
      trueBearing = position.heading;
    } else if (_routePoints.isNotEmpty && nearest != _truckIndex) {
      // No GPS heading but route index changed: compute from route geometry.
      trueBearing = _bearingBetween(
        _routePoints[_truckIndex.clamp(0, _routePoints.length - 1)],
        _routePoints[nearest.clamp(0, _routePoints.length - 1)],
      );
    } else {
      // Low speed, no GPS heading, or no index change: keep current bearing.
      trueBearing = _truckBearing;
    }

    // ── Speed update: read GPS speed and compute new speed limit estimate ────
    // pos.speed is in m/s; negative values mean the speed is unavailable.
    final double newSpeedMps =
        position.speed >= 0 ? position.speed : _currentSpeedMps;
    final double carSpeedLimit = _estimateSpeedLimit();
    final double newSpeedLimit =
        _getTruckSpeedLimit(carSpeedLimit, position.latitude, position.longitude);

    setState(() {
      // Use the raw GPS fix so the marker reflects actual device location.
      _truckPosition = gpsPoint;
      // Use real device heading for accurate marker rotation.
      _truckBearing = trueBearing;
      // Persist updated speed and speed-limit for the PositionPanel overlay.
      _currentSpeedMps = newSpeedMps;
      _speedLimitMph = newSpeedLimit;
    });

    // Record this fix as the last accepted position for the next filter cycle.
    _lastAcceptedPosition = position;

    // ── Over-speed announcement (navigation only, throttled) ──────────────
    // Only announce during active navigation and when speed data is available.
    if (_hasActiveDestination && _navigationMode && newSpeedMps >= 0) {
      final double currentSpeedMph = newSpeedMps * _mpsToMph;
      if (currentSpeedMph > newSpeedLimit) {
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

    // Keep the camera centred on the truck while in navigation mode.
    // Use _updateNavigationCamera when moving and _updateStoppedCamera when
    // stopped so zoom, bearing, and target position are appropriate for speed.
    if (_navigationMode && _hasActiveDestination) {
      final double speedMph = newSpeedMps > 0 ? newSpeedMps * _mpsToMph : 0.0;
      if (speedMph >= _minMovingSpeedMph) {
        _updateNavigationCamera(position);
      } else {
        _updateStoppedCamera(position);
      }
    }

    // Refresh the 2-closest-ahead truck stops row on every GPS fix during
    // active navigation so the UI stays in sync with the driver's position.
    if (_isNavigating) {
      _refreshClosestTruckStopsAhead();
      // Refresh upcoming route alert chips (top-right overlay).
      // Remove the call below to disable the upcoming-alerts feature.
      _refreshUpcomingAlerts();
      // Recalculate remaining miles, drive time, and ETA so the bottom trip
      // strip and compact strip always reflect the true remaining distance
      // for the active route, even after reroutes or destination changes.
      _refreshTripProgress();
    }
  }

  /// Advances to the next step when the driver comes within 20 m of the
  /// upcoming maneuver point, then speaks the new instruction aloud.
  void _checkStepAdvancement(LatLng current) {
    if (_navSteps.isEmpty) return;
    // Do not advance steps unless the vehicle is actually moving.  GPS noise
    // while the truck is stationary can put the position within the threshold
    // of the next step even though the driver has not moved.
    // Use _shouldAdvanceRouteProgress for consistent movement gate logic.
    if (_lastAcceptedPosition == null ||
        !_shouldAdvanceRouteProgress(_lastAcceptedPosition!)) return;
    final nextIdx = _currentStepIndex + 1;
    if (nextIdx >= _navSteps.length) return;
    final nextStep = _navSteps[nextIdx];
    final dist = _distanceBetween(current, nextStep.location);
    // Advance when within 20 m of the next maneuver waypoint.
    if (dist <= 20.0) {
      setState(() => _currentStepIndex = nextIdx);
      _speak(nextStep.instruction);
      // Sync the top instruction card with the newly active step.
      _updateTopInstructionFromNavigationStep(
        maneuverType:  nextStep.type,
        modifier:      nextStep.maneuver,
        roadName:      nextStep.name,
        distanceMiles: nextStep.distanceMeters * 0.000621371,
      );
    }
  }

  /// Detects whether [current] has strayed more than [_offRouteThresholdMeters]
  /// from the nearest point on the route polyline.  When off-route, triggers a
  /// full reroute from the current live GPS position to the original destination.
  ///
  /// Uses [geo.Geolocator.distanceBetween] for GPS-grade distance measurement and
  /// throttles reroutes to at most one every [_rerouteThrottleSeconds] seconds
  /// to prevent rapid repeated API calls in areas with poor GPS accuracy.
  /// Only reroutes when the vehicle is moving (_isStopped == false).
  void _checkOffRoute(LatLng current) {
    if (_routePoints.length < 2 || _isRerouting) return;

    // Never reroute while stopped — GPS noise while parked can shift the
    // position outside the route corridor and trigger spurious reroutes.
    if (_isStopped) return;

    // Throttle: skip if a reroute was triggered within the last 8 seconds.
    if (_lastRerouteTime != null &&
        DateTime.now().difference(_lastRerouteTime!).inSeconds <
            _rerouteThrottleSeconds) {
      return;
    }

    // Compute minimum distance from current position to any route point using
    // geo.Geolocator.distanceBetween for accurate GPS-grade measurement.
    double minDist = double.infinity;
    for (final pt in _routePoints) {
      final d = geo.Geolocator.distanceBetween(
        current.latitude,
        current.longitude,
        pt.latitude,
        pt.longitude,
      );
      if (d < minDist) minDist = d;
    }

    if (minDist > _offRouteThresholdMeters) {
      // Only trigger a reroute when the API debounce window has elapsed AND
      // the truck has moved significantly, preventing flood of redundant calls.
      // _canCallDirections is checked first (5 s per-directions throttle), then
      // _canCallApi for the broader route-fetch guard, then _shouldUpdateRoute
      // to confirm meaningful position change before updating the reference.
      if (!_canCallDirections()) return;
      if (!_canCallApi()) return;
      if (!_shouldUpdateRoute(current.latitude, current.longitude)) return;
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

  /// Resets all navigation and trip-statistics state to idle.
  ///
  /// Cancels any in-flight route animation and stops TTS.  All navigation
  /// flags, route geometry, turn-by-turn steps, and trip counters are cleared
  /// so the screen returns to plain GPS-tracking mode.
  ///
  /// Call when:
  ///   • The user explicitly clears the current destination.
  ///   • The trip completes and the driver taps "Done" on the arrival sheet.
  ///   • A new destination is chosen (via [_startRouteToSelectedDestination]).
  void _clearActiveRoute() {
    _animTimer?.cancel();
    _animGeneration++; // invalidate any in-flight smooth animation loop
    _tts.stop();
    setState(() {
      _navigationActive = false;
      _navigationMode = false;
      _isNavigating = false;
      _isArrived = false;
      _cameraMode = NavigationCameraMode.free; // no active destination to follow
      _routePoints = const [];
      _navSteps = const [];
      _currentStepIndex = 0;
      _routeData = null;
      _routeTotalDistanceMiles = 0.0;
      _routeTotalDurationSeconds = 0;
      _routeViolations = const [];
      _weatherRisk = null;
      _restrictionAhead = null;
      _navStatus = null;
      _isRerouting = false;
      _isRestrictionRerouting = false;
      _restrictionRerouteAttempts = 0;
      _warningAhead = null;
      _routeOptions = const [];
      _selectedRouteOptionIndex = 0;
      _tripStartTime = null;
      _lastMoveTime = null;
      _milesDriven = 0.0;
      _stoppedDuration = Duration.zero;
      _lastTripLat = 0.0;
      _lastTripLng = 0.0;
      _lastGpsTimestamp = null;
      _truckStops = const [];
      _tripLegs = const [];
      _activeLegIndex = 0;
      _closestTruckStopsAhead = const [];
      _upcomingAlerts = const [];
      _topInstructionData = null;
    });
    _restrictionAlertShown.clear();
    _poiAlertShown.clear();
    // Reset warning manager so the next navigation session starts clean.
    _warningManager.reset();
    _warningAlertShown.clear();
    // Notify other widgets (e.g. AppShell) that navigation has ended so the
    // bottom navigation bar and other planning UI are restored.
    TruckMapScreen.isNavigatingNotifier.value = false;
  }

  /// Updates trip statistics from the latest [pos] GPS fix.
  ///
  /// On each call:
  ///   1. Adds the metres-to-miles distance from the previous GPS fix to the
  ///      current one to [_milesDriven] using [geo.Geolocator.distanceBetween].
  ///   2. Accumulates [_stoppedDuration] by the real time elapsed since the
  ///      previous GPS fix when [pos.speed] is below 1 m/s (stopped / very
  ///      slow), otherwise records [_lastMoveTime].  Using the actual time
  ///      delta is more accurate than a fixed 1-second increment because GPS
  ///      update frequency varies with speed and device settings.
  ///   3. Stores [pos.latitude] / [pos.longitude] as the new previous fix for
  ///      the next incremental distance calculation.
  ///
  /// No-ops if the trip has not been started ([_tripStartTime] is null).
  void _updateTripStats(geo.Position pos) {
    if (_tripStartTime == null) return;

    final now = DateTime.now();
    final currentLat = pos.latitude;
    final currentLng = pos.longitude;

    // Only compute incremental distance once we have a valid previous fix.
    // Both lat and lng must be non-zero to avoid a bogus distance from the
    // initialization values of (0.0, 0.0).
    if (_lastTripLat != 0.0 && _lastTripLng != 0.0) {
      final meters = geo.Geolocator.distanceBetween(
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
  }

  // ── Trip progress helpers ──────────────────────────────────────────────────

  /// Returns the remaining route distance in **miles** by summing polyline
  /// segments from [_truckIndex] to the end of [_routePoints].
  double _computeRemainingMilesOnRoute() {
    if (_routePoints.isEmpty) return 0.0;
    final end = _routePoints.length - 1;
    final start = _truckIndex.clamp(0, end);
    double total = 0.0;
    for (int i = start; i < end; i++) {
      total += _distanceMiles(
        _routePoints[i].latitude,
        _routePoints[i].longitude,
        _routePoints[i + 1].latitude,
        _routePoints[i + 1].longitude,
      );
    }
    return total;
  }

  /// Refreshes [_tripProgressInfo] from a freshly fetched full-route
  /// [distanceMiles] and [durationSeconds] (as returned by the Mapbox
  /// Directions API).  Also caches the totals so [_refreshTripProgress] can
  /// recalculate remaining values proportionally as the driver advances.
  void _updateTripProgressFromRoute(double distanceMiles, int durationSeconds) {
    _routeTotalDistanceMiles = distanceMiles;
    _routeTotalDurationSeconds = durationSeconds;
    final remaining = Duration(seconds: durationSeconds);
    if (mounted) {
      setState(() {
        _tripProgressInfo = TripProgressInfo(
          milesRemaining: distanceMiles,
          durationRemaining: remaining,
          etaLocal: DateTime.now().add(remaining),
          timezoneLabel: _tripProgressInfo.timezoneLabel,
        );
      });
    }
  }

  /// Recalculates [_tripProgressInfo] based on the driver's current position
  /// on the route ([_truckIndex]).  Called on every GPS tick while navigating
  /// so the miles-remaining, drive-time, and ETA values stay in real-time sync
  /// with the map whenever the driver advances, reroutes, or changes destination.
  void _refreshTripProgress() {
    if (_routePoints.isEmpty || _routeTotalDistanceMiles <= 0) return;
    final remainingMiles = _computeRemainingMilesOnRoute();
    // Estimate remaining duration proportionally: remaining miles / total miles
    // × original total duration, clamped to [0, total].
    final ratio = (remainingMiles / _routeTotalDistanceMiles).clamp(0.0, 1.0);
    final remainingSecs = (_routeTotalDurationSeconds * ratio).round();
    final remaining = Duration(seconds: remainingSecs);
    if (mounted) {
      setState(() {
        _tripProgressInfo = TripProgressInfo(
          milesRemaining: remainingMiles,
          durationRemaining: remaining,
          etaLocal: DateTime.now().add(remaining),
          timezoneLabel: _tripProgressInfo.timezoneLabel,
        );
      });
    }
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
    final dest = _selectedDestination ?? _destination;
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

  /// Returns the truck-specific speed limit for the given position.
  ///
  /// California state law caps trucks at 55 mph on most roads.  When the
  /// position falls inside the California bounding box (lat 32.0–42.5,
  /// lng -125.0–-114.0) this method returns 55.0.  For all other locations
  /// the car speed limit from [_estimateSpeedLimit] is used as a fallback.
  double _getTruckSpeedLimit(double carSpeedLimit, double lat, double lng) {
    final bool inCalifornia = lat >= _californiaMinLat &&
        lat <= _californiaMaxLat &&
        lng >= _californiaMinLng &&
        lng <= _californiaMaxLng;
    if (inCalifornia) return _californiaTruckSpeedLimitMph;
    return carSpeedLimit;
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
    // Camera is set to follow mode so it automatically centres on the
    // truck at route start (user may have panned away during destination search).
    setState(() {
      _navigationMode = true;
      _navigationActive = true;
      _cameraMode = NavigationCameraMode.follow;
    });
    if (_mapReady && _truckPosition != null) {
      _mapController.move(_truckPosition!, _navigationZoomLevel);
    }

    // Launch smooth async animation only in simulation mode.  In real-GPS mode
    // the animation loop is intentionally suppressed — route progress is driven
    // exclusively by _onGpsPosition() so that the truck never advances without
    // genuine vehicle movement.
    _startTripStats();
    if (_isSimulationMode) {
      _runSmoothRouteAnimation(_animGeneration);
    }
  }

  /// Called when the user taps the "Start Navigation" button after previewing
  /// the route.  Sets [_isNavigating] true and launches the GPS tracking
  /// session and route animation.
  ///
  /// Does nothing if no route has been loaded yet.
  void _startNavigation() {
    if (_routePoints.isEmpty) return;
    setState(() {
      _isNavigating = true;
    });
    // Notify AppShell (and any other listeners) that navigation is now active
    // so the bottom navigation bar is hidden during the driving session.
    TruckMapScreen.isNavigatingNotifier.value = true;
    // Start the warning manager so it evaluates proximity on each GPS fix.
    _warningManager.startNavigation();
    _startRouteAnimation();

    // Seed the top instruction card with the first navigation step so the
    // card is visible immediately when the driver starts.  Falls back to
    // sample data when no steps have been loaded yet (dev/testing mode).
    if (_navSteps.isNotEmpty) {
      final first = _navSteps[0];
      _updateTopInstructionFromNavigationStep(
        maneuverType:   first.type,
        modifier:       first.maneuver,
        roadName:       first.name,
        distanceMiles:  first.distanceMeters * 0.000621371,
      );
    } else {
      // Sample data — replace with real SDK values in production.
      _updateTopInstructionFromNavigationStep(
        maneuverType:   'continue',
        modifier:       null,
        roadName:       'Allegrini Drive',
        distanceMiles:  16.9,
      );
    }
  }

  /// Stops the active navigation session and returns to planning/idle UI.
  ///
  /// Delegates to [_clearActiveRoute] which resets all trip state, stops TTS,
  /// cancels the route animation, and resets [_isNavigating] to false.
  void _stopNavigation() {
    _clearActiveRoute();
  }

  // ── Multi-stop leg breakdown ───────────────────────────────────────────────

  /// Builds a multi-stop route by fetching individual legs from origin to each
  /// stop in [stops] and combining them into both a single merged polyline
  /// (for map display) and a [TripLeg] list (for the leg breakdown sheet).
  ///
  /// [originPosition] is the departure coordinate; [originName] is its display
  /// name shown in the first leg card (e.g. "Current Location").  Sets
  /// [_tripLegs] and [_activeLegIndex] = 0 once all legs are built.
  Future<void> _buildMultiStopRoute(
    List<_StopEntry> stops,
    LatLng originPosition,
    String originName,
  ) async {
    if (stops.isEmpty) return;

    final combinedPoints = <LatLng>[];
    final combinedSteps = <_NavStep>[];
    final builtLegs = <TripLeg>[];

    LatLng from = originPosition;
    String fromName = originName;

    for (int i = 0; i < stops.length; i++) {
      final stop = stops[i];
      final result = await _fetchRouteFromApi(from, stop.position);
      if (result == null) continue;

      final restrictions = _evaluateRouteRestrictions(result.points);

      builtLegs.add(TripLeg(
        id: 'leg_$i',
        fromName: fromName,
        toName: stop.name,
        fromPosition: from,
        toPosition: stop.position,
        points: result.points,
        steps: result.steps,
        distanceMiles: result.distanceMiles,
        durationSeconds: result.durationSeconds,
        restrictionCount: restrictions.length,
      ));

      combinedPoints.addAll(result.points);
      combinedSteps.addAll(result.steps);

      from = stop.position;
      fromName = stop.name;
    }

    if (!mounted) return;
    setState(() {
      _tripLegs = builtLegs;
      _activeLegIndex = 0;
      _routePoints = combinedPoints.toSet().toList();
      _navSteps = combinedSteps;
      _currentStepIndex = 0;
      _selectedDestination = stops.last.position;
      _selectedDestinationName = stops.last.name;
      _navigationActive = true;
      _isArrived = false;
      _isLoading = false;
    });

    _fitCameraToRoute(_routePoints);
    _updateRouteViolationWarnings();
  }

  /// Checks whether the truck has reached the end of the current active leg.
  ///
  /// Called from [_onGpsPosition] during active navigation.  When the truck is
  /// within [_arrivalThresholdMeters] of the current leg's destination, the
  /// active leg index is advanced.  When all legs are complete the normal
  /// [_checkArrival] flow handles the final destination.
  void _checkLegArrival(LatLng current) {
    if (_tripLegs.isEmpty) return;
    if (_activeLegIndex >= _tripLegs.length - 1) return;

    final activeLeg = _tripLegs[_activeLegIndex];
    final dist = _distanceBetween(current, activeLeg.toPosition);

    if (dist <= _arrivalThresholdMeters) {
      setState(() {
        _activeLegIndex++;
      });
    }
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

  // ── Closest-truck-stops-ahead helpers ─────────────────────────────────────

  /// Returns the great-circle distance in **miles** between two coordinates
  /// using the Haversine formula.
  double _distanceMiles(
      double lat1, double lng1, double lat2, double lng2) {
    const r = 3958.8; // Earth's radius in miles
    final dLat = (lat2 - lat1) * math.pi / 180.0;
    final dLng = (lng2 - lng1) * math.pi / 180.0;
    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(lat1 * math.pi / 180.0) *
            math.cos(lat2 * math.pi / 180.0) *
            math.sin(dLng / 2) *
            math.sin(dLng / 2);
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  /// Finds the index of the [RoutePoint] in [routePoints] closest to the
  /// given coordinate.  Searches the **entire** list (unlike [_nearestRouteIndex]
  /// which starts from [_truckIndex]) so it works correctly for arbitrary POIs.
  int _findNearestRouteIndexForPoi(
      double lat, double lng, List<RoutePoint> routePoints) {
    double minDist = double.infinity;
    int minIdx = 0;
    for (int i = 0; i < routePoints.length; i++) {
      final d =
          _distanceMiles(lat, lng, routePoints[i].lat, routePoints[i].lng);
      if (d < minDist) {
        minDist = d;
        minIdx = i;
      }
    }
    return minIdx;
  }

  /// Sums the segment-by-segment route distance in **miles** between two
  /// indices in [points].  Returns 0 when [endIndex] ≤ [startIndex].
  double _routeDistanceMilesBetweenIndices(
      List<RoutePoint> points, int startIndex, int endIndex) {
    if (endIndex <= startIndex) return 0.0;
    double total = 0.0;
    for (int i = startIndex; i < endIndex; i++) {
      total += _distanceMiles(
        points[i].lat, points[i].lng,
        points[i + 1].lat, points[i + 1].lng,
      );
    }
    return total;
  }

  /// Returns `true` when [poi] is within [maxDistanceMiles] of **any** point
  /// in [routePoints], meaning it is on or very close to the active route.
  bool _isPoiNearRoute(
    TruckStopPoi poi,
    List<RoutePoint> routePoints, {
    double maxDistanceMiles = 2.0,
  }) {
    for (final pt in routePoints) {
      if (_distanceMiles(poi.latitude, poi.longitude, pt.lat, pt.lng) <=
          maxDistanceMiles) {
        return true;
      }
    }
    return false;
  }

  /// Returns up to 2 [AheadTruckStop] entries representing the nearest truck
  /// stops **ahead** of the driver on the active route, sorted by route miles.
  ///
  /// A stop is considered "ahead" when its nearest route index is strictly
  /// greater than the driver's nearest route index.  Stops closer than
  /// 0.2 miles (virtually passed) are excluded.  Stops farther than
  /// [maxOffRouteMiles] from the route polyline are also excluded.
  List<AheadTruckStop> _getClosestTruckStopsAheadOnRoute({
    required double driverLat,
    required double driverLng,
    required List<RoutePoint> routePoints,
    required List<TruckStopPoi> truckStops,
    double maxOffRouteMiles = 2.0,
  }) {
    if (routePoints.isEmpty) return const [];

    final driverIdx =
        _findNearestRouteIndexForPoi(driverLat, driverLng, routePoints);

    final List<AheadTruckStop> ahead = [];
    for (final poi in truckStops) {
      if (!_isPoiNearRoute(poi, routePoints,
          maxDistanceMiles: maxOffRouteMiles)) {
        continue;
      }
      final poiIdx =
          _findNearestRouteIndexForPoi(poi.latitude, poi.longitude, routePoints);
      if (poiIdx < driverIdx) continue; // behind the driver on the route

      final routeMilesAhead =
          _routeDistanceMilesBetweenIndices(routePoints, driverIdx, poiIdx);
      if (routeMilesAhead < 0.2) continue; // virtually passed

      ahead.add(AheadTruckStop(
        poi: poi,
        routeMilesAhead: routeMilesAhead,
        nearestRouteIndex: poiIdx,
      ));
    }

    ahead.sort((a, b) => a.routeMilesAhead.compareTo(b.routeMilesAhead));
    return ahead.take(2).toList();
  }

  /// Refreshes [_closestTruckStopsAhead] using the current driver position,
  /// active route polyline, and truck stop list.
  ///
  /// Uses [_loadedPois] (loaded from `assets/locations.json`) as the primary
  /// data source so the panel works for any route.  Falls back to [_truckStops]
  /// (mock data) when [_loadedPois] has not yet been populated.
  ///
  /// No-ops (and clears the list) when not navigating, when there is no
  /// driver position, or when route / stop data is unavailable.
  void _refreshClosestTruckStopsAhead() {
    final bool hasStopData = _loadedPois.isNotEmpty || _truckStops.isNotEmpty;
    if (!_isNavigating ||
        _truckPosition == null ||
        _routePoints.isEmpty ||
        !hasStopData) {
      if (_closestTruckStopsAhead.isNotEmpty) {
        setState(() => _closestTruckStopsAhead = const []);
      }
      return;
    }

    // Convert existing LatLng route to RoutePoint list.
    final routePts = _routePoints
        .map((p) => RoutePoint(lat: p.latitude, lng: p.longitude))
        .toList(growable: false);

    // Build the TruckStopPoi list: prefer _loadedPois (locations.json) over
    // the mock _truckStops so the panel is populated for any route geography.
    final List<TruckStopPoi> pois;
    if (_loadedPois.isNotEmpty) {
      pois = _loadedPois.map((p) => TruckStopPoi(
        id: p.id,
        name: p.name,
        brand: p.icon,
        logoName: p.icon,
        latitude: p.lat,
        longitude: p.lng,
        locationName: '${p.city}, ${p.stateOrProvince}',
      )).toList(growable: false);
    } else {
      // Convert TruckStop list to TruckStopPoi list, deriving logoName from
      // the assetLogo path (e.g. 'assets/logo_brand_markers/pilot.png' → 'pilot').
      pois = _truckStops.map((s) {
        String logoName;
        if (s.assetLogo != null) {
          final path = s.assetLogo!;
          final slashIdx = path.lastIndexOf('/');
          final dotIdx = path.lastIndexOf('.');
          final start = slashIdx >= 0 ? slashIdx + 1 : 0;
          final end = dotIdx > start ? dotIdx : path.length;
          logoName = start < end ? path.substring(start, end) : s.brand;
        } else {
          logoName = s.icon ?? s.brand.toLowerCase();
        }
        return TruckStopPoi(
          id: s.id,
          name: s.name,
          brand: s.brand,
          logoName: logoName,
          latitude: s.position.latitude,
          longitude: s.position.longitude,
          locationName: s.address,
        );
      }).toList(growable: false);
    }

    final updated = _getClosestTruckStopsAheadOnRoute(
      driverLat: _truckPosition!.latitude,
      driverLng: _truckPosition!.longitude,
      routePoints: routePts,
      truckStops: pois,
    );
    setState(() => _closestTruckStopsAhead = updated);
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

  /// Returns `true` when none of the [routePoints] pass within
  /// [_restrictionProximityThresholdMeters] of a restricted zone in
  /// [_restrictedZones].
  bool _isTruckSafe(List<LatLng> routePoints) {
    for (final zone in _restrictedZones) {
      final zonePt =
          LatLng(zone['lat']! as double, zone['lng']! as double);
      for (final pt in routePoints) {
        if (_distanceBetween(pt, zonePt) <= _restrictionProximityThresholdMeters) return false;
      }
    }
    return true;
  }

  // ── Truck restriction logic ────────────────────────────────────────────────

  /// Returns `true` when the truck's current profile would violate [r].
  ///
  /// Comparison rules per [RestrictionType]:
  ///   • [RestrictionType.lowBridge]        — truck height > bridge clearance
  ///   • [RestrictionType.weightLimit]      — truck weight > posted limit
  ///   • [RestrictionType.lengthLimit]      — truck length > posted limit
  ///   • [RestrictionType.noTruckRoad]      — always a violation for CMVs
  ///   • [RestrictionType.hazmatRestriction] — violation only when [_hasHazmat]
  bool _violatesRestriction(TruckRestriction r) {
    switch (r.type) {
      case RestrictionType.lowBridge:
        return r.limitValue != null && _truckHeightFt > r.limitValue!;
      case RestrictionType.weightLimit:
        return r.limitValue != null && _truckWeightTons > r.limitValue!;
      case RestrictionType.lengthLimit:
        return r.limitValue != null && _truckLengthFt > r.limitValue!;
      case RestrictionType.noTruckRoad:
        // Commercial motor vehicles are always prohibited on no-truck roads.
        return true;
      case RestrictionType.hazmatRestriction:
        return _hasHazmat;
    }
  }

  /// Returns the subset of [_restrictions] that are both:
  ///   1. Violated by the current truck profile (per [_violatesRestriction]).
  ///   2. Within [proximityMeters] of any point on [routePoints].
  ///
  /// Used after route loading to decide whether to warn or block the route.
  List<TruckRestriction> _evaluateRouteRestrictions(
    List<LatLng> routePoints, {
    double proximityMeters = 300.0,
  }) {
    final violations = <TruckRestriction>[];
    for (final r in _restrictions) {
      if (!_violatesRestriction(r)) continue;
      for (final pt in routePoints) {
        if (_distanceBetween(pt, r.position) <= proximityMeters) {
          violations.add(r);
          break; // already confirmed within range — skip remaining route pts
        }
      }
    }
    return violations;
  }

  /// Returns the first [TruckRestriction] on [routePoints] that the current
  /// truck profile violates, or `null` when the route is restriction-free.
  ///
  /// Iterates route points in order and stops at the first violated restriction
  /// within [proximityMeters], matching the driver's forward-progress order.
  TruckRestriction? _firstRouteViolation(
    List<LatLng> routePoints, {
    double proximityMeters = 300.0,
  }) {
    for (final pt in routePoints) {
      for (final r in _restrictions) {
        if (!_violatesRestriction(r)) continue;
        if (_distanceBetween(pt, r.position) <= proximityMeters) {
          return r;
        }
      }
    }
    return null;
  }

  /// Builds an offset "avoid waypoint" approximately 200 m perpendicular to
  /// the restriction [r] so that the routing API is nudged away from it.
  ///
  /// The offset alternates east/west per [attemptNumber] so successive retries
  /// try different lateral directions before giving up.
  LatLng _buildAvoidPoint(TruckRestriction r, {int attemptNumber = 0}) {
    // ~200 m in degrees latitude (independent of longitude).
    const double offsetDeg = 0.0018;
    // Vary offset direction per attempt:
    //   even attempts  → positive lat, alternating lng sign (NE / NW)
    //   odd attempts   → negative lat, alternating lng sign (SE / SW)
    final latOffset = (attemptNumber.isEven) ? offsetDeg : -offsetDeg;
    final lngOffset = (attemptNumber % 3 == 0) ? offsetDeg : -offsetDeg;
    return LatLng(
      r.position.latitude + latOffset,
      r.position.longitude + lngOffset,
    );
  }

  /// Fetches a route from [origin] to [destination] via the Mapbox Directions
  /// API.  When [viaPoint] is provided the coordinates are injected as a
  /// shaping point between origin and destination, guiding the route away from
  /// a restriction.
  ///
  /// Returns a [RouteResult] containing the decoded polyline points, parsed
  /// turn-by-turn steps, distance in miles, and duration in seconds.
  /// Returns `null` on error or when no routes are returned.
  Future<RouteResult?> _fetchRouteFromApi(
    LatLng origin,
    LatLng destination, {
    LatLng? viaPoint,
  }) async {
    try {
      final StringBuffer coords = StringBuffer()
        ..write('${origin.longitude},${origin.latitude}');
      if (viaPoint != null) {
        coords.write(';${viaPoint.longitude},${viaPoint.latitude}');
      }
      coords.write(';${destination.longitude},${destination.latitude}');

      final url = 'https://api.mapbox.com/directions/v5/mapbox/driving-traffic/'
          '${coords.toString()}'
          '?overview=full'
          '&geometries=polyline6'
          '&steps=true'
          '&alternatives=false'
          '&exclude=ferry'
          '&access_token=$_mapboxToken';

      final res = await http.get(Uri.parse(url)).timeout(
        const Duration(seconds: 10),
      );
      final data = jsonDecode(res.body);
      final routes = data['routes'] as List?;
      if (routes == null || routes.isEmpty) return null;
      final route = routes[0] as Map<String, dynamic>;
      final decoded = _decodePolyline6(route['geometry'] as String);
      final points = _simplifyRoute(decoded);
      final steps = _extractAllSteps(route);
      final distanceMiles = (route['distance'] as num).toDouble() / 1609.34;
      final durationSeconds = (route['duration'] as num).toInt();
      return RouteResult(
        points: points,
        steps: steps,
        distanceMiles: distanceMiles,
        durationSeconds: durationSeconds,
      );
    } catch (e) {
      print('_fetchRouteFromApi error: $e');
      return null;
    }
  }

  /// Attempts up to [_maxRestrictionReroutes] times to build a route that
  /// avoids the first violated truck restriction on the current route.
  ///
  /// Each attempt computes a new avoid waypoint offset via [_buildAvoidPoint]
  /// and requests a fresh route via [_fetchRouteFromApi].  If a clean route is
  /// found it becomes the current route and the UI is updated.  If no safe
  /// route is found after all attempts [_showNoSafeRouteDialog] is called.
  Future<void> _smartRerouteAroundRestrictions() async {
    if (_isRestrictionRerouting) return; // guard against re-entrant calls
    setState(() {
      _isRestrictionRerouting = true;
      _restrictionRerouteAttempts = 0;
    });

    if (_truckPosition == null) {
      setState(() => _isRestrictionRerouting = false);
      return;
    }
    final origin = _truckPosition!;
    final dest = _selectedDestination ?? _destination;

    List<LatLng> candidatePoints = _routePoints;

    while (_restrictionRerouteAttempts < _maxRestrictionReroutes) {
      final violation = _firstRouteViolation(candidatePoints);
      if (violation == null) {
        // Route is safe — apply it if it differs from what is already shown.
        if (candidatePoints != _routePoints) {
          setState(() {
            _routePoints = candidatePoints.toSet().toList();
          });
        }
        break;
      }

      setState(() => _restrictionRerouteAttempts++);
      final avoidPt = _buildAvoidPoint(
        violation,
        attemptNumber: _restrictionRerouteAttempts - 1,
      );

      final result = await _fetchRouteFromApi(origin, dest, viaPoint: avoidPt);
      if (result == null || result.points.isEmpty) {
        // API call failed — stop retrying.
        break;
      }
      candidatePoints = result.points;
    }

    // Final check after all attempts.
    final stillViolated = _firstRouteViolation(candidatePoints) != null;
    if (stillViolated) {
      // Apply the best candidate we found (even if imperfect) so the driver
      // has a route, then warn them.
      if (candidatePoints.isNotEmpty && candidatePoints != _routePoints) {
        setState(() {
          _routePoints = candidatePoints.toSet().toList();
        });
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showNoSafeRouteDialog();
      });
    }

    if (mounted) setState(() => _isRestrictionRerouting = false);
  }

  /// Shows an [AlertDialog] warning the driver that no restriction-free route
  /// could be found after the maximum number of smart rerouting attempts.
  void _showNoSafeRouteDialog() {
    if (!mounted) return;
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: Colors.orange, size: 28),
            SizedBox(width: 8),
            Text('No Safe Route Found'),
          ],
        ),
        content: const Text(
          'Unable to find a route that avoids all truck restrictions for your '
          'current vehicle profile after multiple attempts.\n\n'
          'Proceed with caution and verify restrictions before driving.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Understood'),
          ),
        ],
      ),
    );
  }

  /// Builds the rerouting-progress banner shown as a top overlay while
  /// [_isRestrictionRerouting] is `true`.
  ///
  /// Displays the current attempt number out of [_maxRestrictionReroutes] so
  /// the driver knows the app is actively working on a safer route.
  Widget _buildRestrictionRerouteBanner() {
    return Positioned(
      top: 8,
      left: 16,
      right: 16,
      child: Material(
        elevation: 6,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.deepOrange.shade700,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Finding safe route… '
                  '(attempt $_restrictionRerouteAttempts/$_maxRestrictionReroutes)',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 14,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Shows a modal bottom sheet listing all [violations] on the current route.
  ///
  /// Each violation is displayed with its restriction type icon, name, limit
  /// value (if applicable), and description.  A "Continue Anyway" button
  /// allows the driver to acknowledge and proceed; "Get Safe Route" triggers
  /// a re-fetch requesting an alternative route.
  void _showRestrictionViolationsSheet(List<TruckRestriction> violations) {
    if (!mounted) return;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.55,
          minChildSize: 0.35,
          maxChildSize: 0.85,
          builder: (_, scrollController) {
            return Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ── Sheet handle ────────────────────────────────────────
                  Center(
                    child: Container(
                      width: 36,
                      height: 4,
                      margin: const EdgeInsets.only(bottom: 14),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade300,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  // ── Header ───────────────────────────────────────────────
                  Row(
                    children: [
                      const Icon(Icons.warning_amber,
                          color: Colors.red, size: 28),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Route Restriction Warning',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: Colors.red,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${violations.length} violation${violations.length == 1 ? '' : 's'} detected on this route.',
                    style: const TextStyle(
                        fontSize: 13, color: Colors.black54),
                  ),
                  const SizedBox(height: 14),
                  // ── Violations list ──────────────────────────────────────
                  Flexible(
                    child: ListView.separated(
                      controller: scrollController,
                      shrinkWrap: true,
                      itemCount: violations.length,
                      separatorBuilder: (_, __) =>
                          const Divider(height: 1),
                      itemBuilder: (_, i) {
                        final v = violations[i];
                        return _buildViolationTile(v);
                      },
                    ),
                  ),
                  const SizedBox(height: 16),
                  // ── Action buttons ───────────────────────────────────────
                  Row(
                    children: [
                      // "Get Safe Route" fetches an alternative route.
                      Expanded(
                        child: OutlinedButton.icon(
                          icon: const Icon(Icons.alt_route),
                          label: const Text('Get Safe Route'),
                          style: OutlinedButton.styleFrom(
                            padding:
                                const EdgeInsets.symmetric(vertical: 12),
                            side: const BorderSide(color: Colors.blue),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                          ),
                          onPressed: () {
                            Navigator.of(ctx).pop();
                            fetchRoute(alternative: true);
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      // "Continue Anyway" dismisses the sheet.
                      Expanded(
                        child: ElevatedButton.icon(
                          icon: const Icon(Icons.arrow_forward),
                          label: const Text('Continue Anyway'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.red,
                            foregroundColor: Colors.white,
                            padding:
                                const EdgeInsets.symmetric(vertical: 12),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                          ),
                          onPressed: () => Navigator.of(ctx).pop(),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  /// Builds a single list tile for a [TruckRestriction] violation entry
  /// inside the restriction violations bottom sheet.
  Widget _buildViolationTile(TruckRestriction v) {
    final style = _restrictionStyle(v.type);
    final String limitText = _formatLimitText(v.limitValue, v.limitUnit,
        prefix: ' — limit: ');

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(vertical: 4),
      leading: CircleAvatar(
        backgroundColor: style.color.withOpacity(0.15),
        child: Icon(style.icon, color: style.color, size: 22),
      ),
      title: Text(
        v.name,
        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
      subtitle: Text(
        '${style.label}$limitText\n${v.description}',
        style: const TextStyle(fontSize: 12, height: 1.4),
      ),
      isThreeLine: true,
    );
  }

  /// Returns the visual style (icon, colour, label) for a [RestrictionType].
  ///
  /// Centralises the type-to-style mapping so [_buildViolationTile],
  /// [_buildRestrictionMarkers], and [_buildRestrictionAlertCard] all use
  /// identical styling without duplication.
  ({IconData icon, Color color, String label}) _restrictionStyle(
      RestrictionType type) {
    switch (type) {
      case RestrictionType.lowBridge:
        return (
          icon: Icons.height,
          color: Colors.orange.shade800,
          label: 'Low Bridge',
        );
      case RestrictionType.weightLimit:
        return (
          icon: Icons.monitor_weight,
          color: Colors.red.shade700,
          label: 'Weight Limit',
        );
      case RestrictionType.lengthLimit:
        return (
          icon: Icons.straighten,
          color: Colors.deepOrange.shade700,
          label: 'Length Limit',
        );
      case RestrictionType.noTruckRoad:
        return (
          icon: Icons.no_crash,
          color: Colors.red.shade900,
          label: 'No Trucks',
        );
      case RestrictionType.hazmatRestriction:
        return (
          icon: Icons.local_fire_department,
          color: Colors.purple.shade800,
          label: 'Hazmat Zone',
        );
    }
  }

  /// Formats a restriction limit as a display string, or returns an empty
  /// string when [limitValue] or [limitUnit] is null.
  ///
  /// [prefix] is prepended when the result is non-empty (default: empty).
  /// [decimals] controls the number of decimal places (default: 1).
  String _formatLimitText(
    double? limitValue,
    String? limitUnit, {
    String prefix = '',
    int decimals = 1,
  }) {
    if (limitValue == null || limitUnit == null) return '';
    return '$prefix${limitValue.toStringAsFixed(decimals)} $limitUnit';
  }

  /// Builds map [Marker]s for all [_restrictions], colour-coded by type.
  ///
  /// Restriction markers use a red-tinted palette with distinctive icons so
  /// drivers can tell them apart from truck stops (blue) and POIs (orange /
  /// purple / indigo) at a glance.  Tapping a marker shows a brief info card.
  List<Marker> _buildRestrictionMarkers() {
    return _restrictions.map((r) {
      final style = _restrictionStyle(r.type);

      return Marker(
        point: r.position,
        width: 40,
        height: 40,
        alignment: Alignment.center,
        child: GestureDetector(
          onTap: () => _showRestrictionInfoDialog(r),
          child: Container(
            decoration: BoxDecoration(
              color: style.color,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.3),
                  blurRadius: 4,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Icon(style.icon, color: Colors.white, size: 22),
          ),
        ),
      );
    }).toList();
  }

  /// Shows an [AlertDialog] with details about a tapped restriction [r].
  void _showRestrictionInfoDialog(TruckRestriction r) {
    if (!mounted) return;
    final bool violates = _violatesRestriction(r);
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          r.name,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(r.description,
                style: const TextStyle(fontSize: 14)),
            if (r.limitValue != null && r.limitUnit != null) ...[
              const SizedBox(height: 8),
              Text(
                'Limit:${_formatLimitText(r.limitValue, r.limitUnit, prefix: ' ')}',
                style: const TextStyle(
                    fontSize: 14, fontWeight: FontWeight.w600),
              ),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(
                  violates
                      ? Icons.warning_amber
                      : Icons.check_circle_outline,
                  color: violates ? Colors.red : Colors.green,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Text(
                  violates
                      ? 'Your truck exceeds this restriction'
                      : 'Your truck meets this restriction',
                  style: TextStyle(
                    fontSize: 13,
                    color: violates ? Colors.red : Colors.green,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  /// Checks whether the truck is within 800 m of any restriction that it
  /// violates and updates [_restrictionAhead].
  ///
  /// The first unshown violated restriction within range triggers a TTS alert
  /// and sets [_restrictionAhead] so [_buildRestrictionAlertCard] can render
  /// a prominent in-route warning banner.  Each restriction id is added to
  /// [_restrictionAlertShown] after the first alert to prevent repeated
  /// announcements for the same point.
  void _checkRestrictionAheadAlert(LatLng currentPosition) {
    const double alertRadiusMeters = 800.0;
    for (final r in _restrictions) {
      if (!_violatesRestriction(r)) continue;
      final double dist = _distanceBetween(currentPosition, r.position);
      if (dist <= alertRadiusMeters) {
        if (!_restrictionAlertShown.contains(r.id)) {
          _restrictionAlertShown.add(r.id);
          final String ttsMsg = _restrictionTtsMessage(r);
          _speak(ttsMsg);
        }
        if (mounted && _restrictionAhead?.id != r.id) {
          setState(() => _restrictionAhead = r);
        }
        return; // show one alert at a time
      }
    }
    // No restriction within range — clear the alert card.
    if (mounted && _restrictionAhead != null) {
      setState(() => _restrictionAhead = null);
    }
  }

  /// Generates a concise TTS alert message for [r] based on its type and
  /// the driver's truck profile.
  String _restrictionTtsMessage(TruckRestriction r) {
    switch (r.type) {
      case RestrictionType.lowBridge:
        return 'Warning: low bridge ahead. '
            'Clearance ${r.limitValue?.toStringAsFixed(1) ?? "unknown"} feet. '
            'Your truck is ${_truckHeightFt.toStringAsFixed(1)} feet tall.';
      case RestrictionType.weightLimit:
        return 'Warning: weight-restricted road ahead. '
            'Limit ${r.limitValue?.toStringAsFixed(0) ?? "unknown"} tons.';
      case RestrictionType.lengthLimit:
        return 'Warning: length-restricted road ahead. '
            'Maximum ${r.limitValue?.toStringAsFixed(0) ?? "unknown"} feet.';
      case RestrictionType.noTruckRoad:
        return 'Warning: trucks are prohibited on the upcoming road. '
            'Please use an alternate route.';
      case RestrictionType.hazmatRestriction:
        return 'Warning: hazardous materials are restricted in this corridor.';
    }
  }

  /// Builds the in-route restriction alert card shown at the top of the map
  /// when [_restrictionAhead] is non-null.
  ///
  /// The card is colour-coded by restriction type and shows the restriction
  /// name, type label, and limit value so the driver has full context at a
  /// glance.  A dismiss button clears [_restrictionAhead] so the card hides.
  Widget _buildRestrictionAlertCard() {
    final r = _restrictionAhead!;
    final style = _restrictionStyle(r.type);
    final String limitText =
        _formatLimitText(r.limitValue, r.limitUnit, prefix: ' — ');

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 0),
      child: Container(
        padding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: style.color,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.3),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            Icon(style.icon, color: Colors.white, size: 28),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    r.name,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      height: 1.2,
                    ),
                    maxLines: 1,
                          ),
                  Text(
                    '${style.label}$limitText · Approaching',
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 12,
                      height: 1.3,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            GestureDetector(
              onTap: () => setState(() => _restrictionAhead = null),
              child: const Icon(Icons.close, color: Colors.white70, size: 20),
            ),
          ],
        ),
      ),
    );
  }

  // ── Warning sign methods ──────────────────────────────────────────────────

  /// Returns `true` when [sign] is within [_warningProximityMeters] of any
  /// segment of [routePoints].
  ///
  /// Uses the spherical cross-track distance formula (via [_crossTrackDistance])
  /// so that the check is accurate anywhere on the globe.  Falls back to a
  /// simple point-to-point check for route polylines shorter than 2 points.
  bool _isWarningNearRoute(WarningSign sign, List<LatLng> routePoints) {
    if (routePoints.isEmpty) return false;
    final signPoint = LatLng(sign.lat, sign.lng);
    if (routePoints.length == 1) {
      return _distanceBetween(signPoint, routePoints.first) <=
          _warningProximityMeters;
    }
    for (int i = 0; i < routePoints.length - 1; i++) {
      final d = _crossTrackDistance(signPoint, routePoints[i], routePoints[i + 1]);
      if (d <= _warningProximityMeters) return true;
    }
    return false;
  }

  /// Checks whether the truck is within [_warningAlertRadiusMeters] of any
  /// [WarningSign] on the active route and updates [_warningAhead].
  ///
  /// High-severity warnings are prioritised over medium/low ones.  The first
  /// unshown warning within range fires a TTS announcement; each sign id is
  /// added to [_warningAlertShown] after the first announcement to prevent
  /// repeated alerts for the same sign.  Only one banner is shown at a time.
  void _checkWarningAheadAlert(LatLng currentPosition) {
    WarningSign? best;
    double bestDist = double.infinity;

    for (final sign in _warningSigns) {
      // Only show warnings that are actually close to the current route.
      if (_routePoints.isNotEmpty &&
          !_isWarningNearRoute(sign, _routePoints)) {
        continue;
      }
      final double dist =
          _distanceBetween(currentPosition, LatLng(sign.lat, sign.lng));
      if (dist > _warningAlertRadiusMeters) continue;

      // Prefer high severity, then nearest.
      final bool isBetter = best == null ||
          (_severityRank(sign.severity) > _severityRank(best.severity)) ||
          (_severityRank(sign.severity) == _severityRank(best.severity) &&
              dist < bestDist);
      if (isBetter) {
        best = sign;
        bestDist = dist;
      }
    }

    if (best != null) {
      // Fire TTS only once per sign per session.
      if (!_warningAlertShown.contains(best.id)) {
        _warningAlertShown.add(best.id);
        _speak('Warning: ${best.title} ahead. ${best.message ?? ''}');
      }
      if (mounted && _warningAhead?.id != best.id) {
        setState(() => _warningAhead = best);
      }
    } else {
      if (mounted && _warningAhead != null) {
        setState(() => _warningAhead = null);
      }
    }
  }

  /// Returns a numeric rank for [severity] so signs can be prioritised.
  int _severityRank(String severity) {
    switch (severity) {
      case 'high':
        return 2;
      case 'medium':
        return 1;
      default:
        return 0;
    }
  }

  /// Builds coloured [Marker]s for warning signs relevant to the active route.
  ///
  /// Only signs within [_warningDisplayBufferMeters] (~10 miles) of the active
  /// route polyline are shown, so that unrelated West-Coast (or any far-off)
  /// warnings do not clutter the map.  When no route is active, no markers are
  /// returned.  During navigation, signs behind [_truckIndex] on the route are
  /// additionally suppressed so only ahead-of-position hazards remain visible.
  ///
  /// Markers are colour-coded by severity (high=red, medium=orange, low=blue)
  /// using [WarningConfig.colorForSeverity], overriding the type colour for
  /// immediate severity recognition at a glance.  The type icon from
  /// [WarningConfig.styleFor] is always shown inside the badge.  Tapping a
  /// marker shows a brief info dialog via [_showWarningInfoDialog].
  List<Marker> _buildWarningMarkers() {
    // No active route — hide all warning markers.
    if (_routePoints.isEmpty) {
      debugPrint('[POI/Alert Filter] Warning markers: route not set – hiding all warning markers.');
      return const [];
    }

    // Single-pass filter: for each sign find the nearest route point index and
    // its distance in one loop.  This lets us simultaneously check proximity
    // (is the sign within the 10-mile display buffer?) and, during navigation,
    // whether the sign is ahead of or behind the truck — without a second
    // O(signs × route_points) scan.
    final List<WarningSign> signsToDisplay = [];
    for (final sign in _warningSigns) {
      final signPt = LatLng(sign.lat, sign.lng);
      double bestDist = double.infinity;
      int bestIdx = 0;
      for (int i = 0; i < _routePoints.length; i++) {
        final d = _distanceBetween(signPt, _routePoints[i]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      // Skip signs farther than the display buffer from the route.
      if (bestDist > _warningDisplayBufferMeters) continue;

      // During active navigation suppress signs behind the truck's current
      // route index so only ahead-of-position hazards remain visible.
      if (_isNavigating && _truckIndex > 0 && bestIdx < _truckIndex) continue;

      signsToDisplay.add(sign);
    }

    debugPrint(
      '[POI/Alert Filter] Warning markers: ${signsToDisplay.length}/'
      '${_warningSigns.length} shown '
      '(within ${(_warningDisplayBufferMeters / 1609.34).toStringAsFixed(0)} miles of route'
      '${_isNavigating ? ", ahead of position" : ""}).',
    );

    return signsToDisplay.map((sign) {
      final style = WarningConfig.styleFor(sign.type);
      final Color badgeColor = WarningConfig.colorForSeverity(sign.severity);

      return Marker(
        point: LatLng(sign.lat, sign.lng),
        width: 40,
        height: 40,
        alignment: Alignment.center,
        child: GestureDetector(
          onTap: () => _showWarningInfoDialog(sign),
          child: Container(
            decoration: BoxDecoration(
              color: badgeColor,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.3),
                  blurRadius: 4,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Icon(style.icon, color: Colors.white, size: 22),
          ),
        ),
      );
    }).toList();
  }

  /// Shows an [AlertDialog] with the details of a tapped [sign].
  void _showWarningInfoDialog(WarningSign sign) {
    if (!mounted) return;
    final style = WarningConfig.styleFor(sign.type);
    final Color badgeColor = WarningConfig.colorForSeverity(sign.severity);
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            Icon(style.icon, color: badgeColor, size: 22),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                sign.title,
                style:
                    const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (sign.message != null)
              Text(sign.message!,
                  style: const TextStyle(fontSize: 14)),
            const SizedBox(height: 8),
            Row(
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: badgeColor,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    sign.severity.toUpperCase(),
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.bold),
                  ),
                ),
                const SizedBox(width: 8),
                Text(style.label,
                    style: const TextStyle(
                        fontSize: 12, color: Colors.grey)),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  /// Builds the top alert banner shown when [_warningAhead] is non-null.
  ///
  /// Colour is determined by severity (high=red, medium=orange, low=blue)
  /// so the driver can assess urgency at a glance.  A dismiss button clears
  /// [_warningAhead] so the banner hides until the next proximity trigger.
  Widget _buildWarningAlertBanner() {
    final sign = _warningAhead!;
    final style = WarningConfig.styleFor(sign.type);
    final Color bannerColor = WarningConfig.colorForSeverity(sign.severity);

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 0),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: bannerColor,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.3),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            Icon(style.icon, color: Colors.white, size: 28),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    sign.title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      height: 1.2,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    '${style.label} · Ahead',
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 12,
                      height: 1.3,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            GestureDetector(
              onTap: () => setState(() => _warningAhead = null),
              child: const Icon(Icons.close, color: Colors.white70, size: 20),
            ),
          ],
        ),
      ),
    );
  }

  // ── Ahead-on-route weigh station logic ──────────────────────────────────────

  /// Returns `true` when [poi] is within [_weighStationProximityMeters] of any
  /// segment of [routePoints].
  ///
  /// Uses the same spherical cross-track formula as [_isWarningNearRoute] so
  /// results are accurate at any latitude.  Falls back to a simple point check
  /// for single-point polylines.
  bool _isWeighStationNearRoute(WeighStationPoi poi, List<LatLng> routePoints) {
    if (routePoints.isEmpty) return false;
    if (routePoints.length == 1) {
      return _distanceBetween(poi.position, routePoints.first) <=
          _weighStationProximityMeters;
    }
    for (int i = 0; i < routePoints.length - 1; i++) {
      final d =
          _crossTrackDistance(poi.position, routePoints[i], routePoints[i + 1]);
      if (d <= _weighStationProximityMeters) return true;
    }
    return false;
  }

  /// Finds the nearest route-point index for [poi] by scanning [_routePoints].
  ///
  /// Only considers route points at or after [startIndex] so that stations
  /// behind the truck are naturally excluded.  Returns -1 when no point is
  /// found within [_weighStationProximityMeters].
  int _nearestRouteIndexForPoi(WeighStationPoi poi, int startIndex) {
    double best = double.infinity;
    int bestIdx = -1;
    for (int i = startIndex; i < _routePoints.length; i++) {
      final d = _distanceBetween(poi.position, _routePoints[i]);
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    }
    return (best <= _weighStationProximityMeters) ? bestIdx : -1;
  }

  /// Returns the next 1–2 weigh stations that are ahead of the truck on the
  /// active route, sorted by ascending route distance.
  ///
  /// A station is considered "ahead" when its nearest route-point index is
  /// strictly greater than [_truckIndex] AND the station is within
  /// [_weighStationProximityMeters] of the route polyline.  Route miles are
  /// approximated by summing Haversine segment lengths from [_truckIndex] to
  /// the station's nearest route point.
  List<AheadWeighStation> _getClosestWeighStationsAheadOnRoute() {
    if (_routePoints.isEmpty) return const [];

    // Derive WeighStationPoi entries from existing MapPoi data so there is a
    // single source of truth for weigh-station coordinates.
    final weighPois = _mapPois
        .where((p) => p.type == PoiType.weighStation)
        .map((p) => WeighStationPoi.fromMapPoi(p))
        .toList();

    final List<AheadWeighStation> candidates = [];

    for (final poi in weighPois) {
      // Skip stations not near the route at all.
      if (!_isWeighStationNearRoute(poi, _routePoints)) continue;

      // Find nearest route point strictly ahead of current truck position.
      final idx = _nearestRouteIndexForPoi(poi, _truckIndex + 1);
      if (idx < 0) continue; // station is behind or off-route

      // Compute approximate route miles from truck to this station.
      double meters = 0.0;
      for (int i = _truckIndex; i < idx && i + 1 < _routePoints.length; i++) {
        meters += _distanceBetween(_routePoints[i], _routePoints[i + 1]);
      }
      final double miles = meters / _metersPerMile;

      candidates.add(AheadWeighStation(
        poi: poi,
        milesAhead: miles,
        routeIndex: idx,
      ));
    }

    // Sort ascending by route miles and return the single closest station.
    // Only one upcoming weigh station is highlighted at a time so the driver
    // focuses on the very next one ahead before seeing the one after it.
    candidates.sort((a, b) => a.milesAhead.compareTo(b.milesAhead));
    return candidates.take(1).toList();
  }

  /// Recomputes [_closestWeighStationsAhead] from the current truck position
  /// and triggers a rebuild so the [ClosestWeighStationsRow] updates in place.
  ///
  /// Called on every GPS fix when [_isNavigating] is true (see
  /// [_onGpsPosition]).  The computation is O(n·m) in the number of weigh
  /// stations × route points, which is fast enough for real-time updates given
  /// the small dataset sizes involved.
  void _refreshClosestWeighStationsAhead() {
    final next = _getClosestWeighStationsAheadOnRoute();
    // Avoid a redundant rebuild if the list content hasn't changed.
    if (next.length == _closestWeighStationsAhead.length &&
        next.every((s) => _closestWeighStationsAhead
            .any((existing) => existing.poi.id == s.poi.id &&
                (existing.milesAhead - s.milesAhead).abs() < 0.05))) {
      return;
    }
    setState(() => _closestWeighStationsAhead = next);
  }

  /// Builds and stores the list of [UpcomingAlertItem]s shown in the
  /// top-right overlay chips during active navigation.
  ///
  /// Sources alerts from:
  ///   - [_closestTruckStopsAhead] → [UpcomingAlertType.truckStop]
  ///   - [_closestWeighStationsAhead] → [UpcomingAlertType.weighStation]
  ///   - [_navAlerts] wind/advisory entries → [UpcomingAlertType.wind]
  ///   - [_navAlerts] restriction entries → [UpcomingAlertType.restriction]
  ///
  /// Filters to only include alerts with a known positive distance ahead,
  /// sorts by ascending distance, and caps the list at 3 entries so the
  /// overlay stays compact.  Passed alerts (distance ≤ 0) are excluded so
  /// chips disappear naturally as the driver moves past them.
  ///
  /// Call [_refreshUpcomingAlerts] on every GPS fix while navigating.
  /// To disable this feature entirely, remove the call site in
  /// [_onGpsPosition] and the widget reference in the Stack overlay.
  void _refreshUpcomingAlerts() {
    if (!_isNavigating) {
      if (_upcomingAlerts.isNotEmpty) {
        setState(() => _upcomingAlerts = const []);
      }
      return;
    }

    final List<UpcomingAlertItem> fresh = [];

    // ── Truck stops ahead ────────────────────────────────────────────────────
    for (final s in _closestTruckStopsAhead) {
      if (s.routeMilesAhead > 0) {
        fresh.add(UpcomingAlertItem(
          type: UpcomingAlertType.truckStop,
          label: s.poi.name,
          distanceMiles: s.routeMilesAhead,
        ));
      }
    }

    // ── Weigh stations ahead ─────────────────────────────────────────────────
    for (final w in _closestWeighStationsAhead) {
      if (w.milesAhead > 0) {
        fresh.add(UpcomingAlertItem(
          type: UpcomingAlertType.weighStation,
          label: w.poi.name,
          distanceMiles: w.milesAhead,
        ));
      }
    }

    // ── Wind / weather advisories from _navAlerts ────────────────────────────
    for (final a in _navAlerts) {
      if (a.isDismissed) continue;
      if (a.type == AlertType.windAdvisory ||
          a.type == AlertType.highWind ||
          a.type == AlertType.weather) {
        final dist = a.distanceMiles ?? 0.0;
        if (dist > 0) {
          fresh.add(UpcomingAlertItem(
            type: UpcomingAlertType.wind,
            label: a.title,
            distanceMiles: dist,
          ));
        }
      }
    }

    // ── Restriction advisories from _navAlerts ───────────────────────────────
    for (final a in _navAlerts) {
      if (a.isDismissed) continue;
      if (a.type == AlertType.restrictionDistance ||
          a.type == AlertType.lowBridge ||
          a.type == AlertType.hazmat) {
        final dist = a.distanceMiles ?? 0.0;
        if (dist > 0) {
          fresh.add(UpcomingAlertItem(
            type: UpcomingAlertType.restriction,
            label: a.title,
            distanceMiles: dist,
          ));
        }
      }
    }

    // Sort by ascending distance so the closest alert appears first.
    fresh.sort((a, b) => a.distanceMiles.compareTo(b.distanceMiles));

    // Cap at 3 to keep the overlay compact and readable.
    final capped = fresh.take(3).toList();

    // Skip redundant rebuilds when content hasn't changed.
    if (capped.length == _upcomingAlerts.length &&
        _listsEqualUpcomingAlerts(capped, _upcomingAlerts)) {
      return;
    }

    setState(() => _upcomingAlerts = capped);
  }

  /// Returns true when [a] and [b] contain identical [UpcomingAlertItem]s in
  /// the same order.  Used by [_refreshUpcomingAlerts] to skip needless rebuilds.
  bool _listsEqualUpcomingAlerts(
      List<UpcomingAlertItem> a, List<UpcomingAlertItem> b) {
    if (a.length != b.length) return false;
    for (int i = 0; i < a.length; i++) {
      if (a[i].type != b[i].type ||
          a[i].label != b[i].label ||
          // 0.05 mi (~264 ft) threshold: small enough to catch meaningful
          // position changes, large enough to suppress spurious rebuilds.
          (a[i].distanceMiles - b[i].distanceMiles).abs() >= 0.05) {
        return false;
      }
    }
    return true;
  }

  /// Builds the chip showing the single closest upcoming weigh station ahead
  /// of the driver on the active route.  Displayed in the navigation overlay
  /// above the bottom trip strip so the driver can always see the next station
  /// with its icon and distance in miles.
  ///
  /// Automatically updates as the driver moves: once the current station is
  /// passed (dropped from [_closestWeighStationsAhead]) the next one ahead is
  /// shown immediately.  Returns [SizedBox.shrink] when there are no weigh
  /// stations ahead so the widget takes up no space in the tree.
  Widget _buildClosestWeighStationsRow() {
    if (!_isNavigating || _closestWeighStationsAhead.isEmpty) {
      return const SizedBox.shrink();
    }
    return Positioned(
      // Position above the bottom trip strip (bottom ~18 + height ~52 + gap 8).
      bottom: 86,
      left: 16,
      right: 16,
      child: ClosestWeighStationsRow(
        stations: _closestWeighStationsAhead,
      ),
    );
  }

  ///
  /// When [fromPosition] is provided (e.g. during off-route rerouting), the
  /// route is requested from that live GPS position instead of the default
  /// origin.  The destination always remains [_destination].
  ///
  /// When [alternative] is `true` the second route returned by Mapbox is used
  /// instead of the primary one, allowing the caller to avoid a route that
  /// fails the [_isTruckSafe] check.  In pre-navigation mode all returned
  /// routes are surfaced as selectable [RouteOption] cards; in active
  /// navigation / rerouting mode the single best route is used directly.
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
      // Use the live GPS position as origin; fall back to the provided
      // fromPosition (e.g. during rerouting).  If neither is available,
      // abort and show an error — never fall back to a hardcoded location.
      final from = fromPosition ?? _truckPosition;
      if (from == null) {
        setState(() {
          _isLoading = false;
          _error = 'GPS location unavailable. Please wait for a location fix.';
        });
        _isLoadingRoute = false;
        return;
      }
      // Use the user-selected destination when available; fall back to the
      // default destination (Winnemucca, NV) for the demo route.
      final dest = _selectedDestination ?? _destination;
      final url =
          "https://api.mapbox.com/directions/v5/mapbox/driving-traffic/"
          "${from.longitude},${from.latitude};${dest.longitude},${dest.latitude}"
          "?overview=full"
          "&geometries=polyline6"
          "&steps=true"
          "&alternatives=true"
          "&exclude=ferry"
          "&access_token=$_mapboxToken";

      final res = await http.get(Uri.parse(url)).timeout(
        const Duration(seconds: 10),
      );
      print("MAPBOX RESPONSE: ${res.body}");

      final data = jsonDecode(res.body);
      final routes = data["routes"] as List;

      // ── PRE-NAVIGATION: build all route alternatives ───────────────────────
      // When navigation has not yet started (route preview / selection mode),
      // parse every returned route into a RouteOption card so the driver can
      // pick the best option before committing.  The auto-selected default is
      // the first route with zero truck-restriction violations; if all have
      // violations, route 0 is selected.
      if (!_isNavigating && routes.isNotEmpty) {
        const routeLabels = ['Recommended', 'Fastest', 'Alternative'];
        final newOptions = <RouteOption>[];
        for (int ri = 0; ri < routes.length; ri++) {
          final r = routes[ri] as Map<String, dynamic>;
          final decoded = _decodePolyline6(r["geometry"] as String);
          final pts = _simplifyRoute(decoded);
          final steps = _extractAllSteps(r);
          final distMi = (r["distance"] as num).toDouble() / 1609.34;
          final durSec = (r["duration"] as num).toInt();
          final restrictions = _evaluateRouteRestrictions(pts);
          final rFuel = _countFuelStopsForRoute(pts);
          final rWeigh = _countWeighStationsForRoute(pts);
          final label = ri < routeLabels.length
              ? routeLabels[ri]
              : 'Alternative ${ri + 1}';
          newOptions.add(RouteOption(
            id: 'route_$ri',
            label: label,
            points: pts,
            steps: steps,
            distanceMiles: distMi,
            durationSeconds: durSec,
            restrictionCount: restrictions.length,
            fuelStopCount: rFuel,
            weighStationCount: rWeigh,
            routeData: {
              "distanceMiles": distMi.round(),
              "etaMinutes": (durSec / 60).round(),
              "turnByTurn":
                  steps.map((s) => {'instruction': s.instruction}).toList(),
            },
          ));
        }

        // Prefer the first restriction-free option as the default selection.
        int defaultIdx = 0;
        for (int i = 0; i < newOptions.length; i++) {
          if (newOptions[i].restrictionCount == 0) {
            defaultIdx = i;
            break;
          }
        }

        final selectedOpt = newOptions[defaultIdx];
        final newPoints = selectedOpt.points.toSet().toList();

        setState(() {
          _routeOptions = newOptions;
          _selectedRouteOptionIndex = defaultIdx;
          _navSteps = selectedOpt.steps;
          _currentStepIndex = 0;
          _routeData = selectedOpt.routeData;
          // Clean replacement – never use addAll() here.
          _routePoints = newPoints;
          _isLoading = false;
        });

        print("Route points count: ${_routePoints.length}");
        if (selectedOpt.steps.isNotEmpty) {
          _speak(selectedOpt.steps.first.instruction);
        }

        // Filter POIs to only those within 10 km of the previewed route so
        // the map isn't cluttered with globally-distant stops.
        setState(() => _truckStops =
            _filterStopsNearRoute(_mockTruckStops, newPoints));
        _fitCameraToRoute(newPoints);
        _updateRouteViolationWarnings();
        // Seed trip progress with the full-route distance and duration so
        // the bottom strip shows correct values before navigation starts.
        _updateTripProgressFromRoute(
          selectedOpt.distanceMiles,
          selectedOpt.durationSeconds,
        );
        // Smart rerouting is skipped in pre-navigation mode — the driver can
        // choose a cleaner route from the alternatives panel instead.
        return;
      }

      // ── ACTIVE NAVIGATION / REROUTING ─────────────────────────────────────
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

      // ── Build RouteOption list from all returned alternatives ───────────────
      // Labels are assigned in order: recommended, fastest, fuel-saver.
      // For each alternative, decode points and compute per-route counts so
      // the driver can compare alternatives in the bottom sheet.
      const routeLabels = ['Recommended', 'Fastest', 'Fuel Saver'];
      final options = <RouteOption>[];
      for (int i = 0; i < routes.length; i++) {
        final r = routes[i] as Map<String, dynamic>;
        final rDecoded = _decodePolyline6(r["geometry"] as String);
        final rPoints = _simplifyRoute(rDecoded).toSet().toList();
        final rSteps = _extractAllSteps(r);
        final rMiles = (r["distance"] as num) / 1609.34;
        final rSeconds = (r["duration"] as num).toInt();
        final rRestrictions = _evaluateRouteRestrictions(rPoints).length;
        final rFuel = _countFuelStopsForRoute(rPoints);
        final rWeigh = _countWeighStationsForRoute(rPoints);
        options.add(RouteOption(
          id: 'route_$i',
          label: i < routeLabels.length ? routeLabels[i] : 'Route ${i + 1}',
          points: rPoints,
          steps: rSteps,
          distanceMiles: rMiles,
          durationSeconds: rSeconds,
          restrictionCount: rRestrictions,
          fuelStopCount: rFuel,
          weighStationCount: rWeigh,
          routeData: {
            "distanceMiles": rMiles.round(),
            "etaMinutes": (rSeconds / 60).round(),
            "turnByTurn": rSteps
                .map((s) => {'instruction': s.instruction})
                .toList(),
          },
        ));
      }

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
        _routeOptions = options;
        _selectedRouteOptionIndex = routeIndex;
        _isLoading = false;
      });

      // Log the final route point count for debugging route-duplication issues.
      print("Route points count: ${_routePoints.length}");

      // Speak the first instruction when the route is (re-)loaded.
      if (allSteps.isNotEmpty) {
        _speak(allSteps.first.instruction);
      }

      // ── Filter truck stop POIs near the active route ──────────────────────
      // Re-filter dynamically whenever the route changes (reroute, alternative
      // selected, etc.) so only stops within 10 km of the new polyline are
      // shown.  The list is sorted by proximity to the driver and capped at 50
      // for rendering performance.
      setState(() {
        _truckStops = _filterStopsNearRoute(_mockTruckStops, newPoints);
      });

      // ── Evaluate truck restrictions along the new route ────────────────────
      // Use smart rerouting to attempt to find a restriction-free route before
      // falling back to the violations sheet.  After every route build
      // (destination, off-route reroute, alternative, etc.) this triggers an
      // automatic avoid-point retry cycle up to _maxRestrictionReroutes times.
      final violations = _evaluateRouteRestrictions(newPoints);
      if (violations.isNotEmpty) {
        // Attempt smart rerouting in the background; the banner widget reflects
        // progress while _isRestrictionRerouting is true.
        _smartRerouteAroundRestrictions();
      }

      _fitCameraToRoute(newPoints);
      // Only start the route animation (and GPS tracking) when the user has
      // already opted in by pressing "Start Navigation".  This covers rerouting
      // during an active trip.  For a fresh route build the driver first sees a
      // preview and must press the "Start Navigation" button to begin the trip.
      if (_isNavigating) {
        _startRouteAnimation();
      }

      // After the route is loaded, update the route violation warnings panel
      // so the driver sees any low-bridge or weight-limit conflicts in the info
      // panel (in addition to the TruckRestriction violation sheet above).
      _updateRouteViolationWarnings();
      // Refresh trip progress with the new route's full distance and duration
      // so miles-remaining, drive-time, and ETA all reflect the new route.
      _updateTripProgressFromRoute(
        (route['distance'] as num).toDouble() / 1609.34,
        (route['duration'] as num).toInt(),
      );
    } catch (e) {
      print('Mapbox error: $e');
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    } finally {
      // Always release the loading guard so future fetchRoute() calls succeed.
      _isLoadingRoute = false;
    }
  }

  // ── Destination selection ─────────────────────────────────────────────────

  /// Starts navigation to [_selectedDestination].
  ///
  /// Resets arrival state, clears prior violations, then fetches a fresh
  /// route from the current position (or default origin) to the selected
  /// destination.  Should only be called once [_selectedDestination] has been
  /// set by either [_showDestinationSearch] or [_onMapLongPress].
  Future<void> _startRouteToSelectedDestination() async {
    if (_selectedDestination == null) return;
    // Reset all prior navigation/trip state before starting a new session.
    _clearActiveRoute();
    await fetchRoute();
  }

  /// Switches the active route preview to the option at [index] in
  /// [_routeOptions].
  ///
  /// Updates [_selectedRouteOptionIndex], [_routePoints], [_navSteps],
  /// [_routeData], and [_truckStops] so the map polyline, turn-by-turn steps,
  /// and truck stop markers all reflect the newly selected alternative.
  void _applyRouteOption(int index) {
    if (index < 0 || index >= _routeOptions.length) return;
    final opt = _routeOptions[index];
    final List<LatLng> newPoints = opt.points.toSet().toList();
    setState(() {
      _selectedRouteOptionIndex = index;
      _routePoints = newPoints;
      _navSteps = opt.steps;
      _currentStepIndex = 0;
      _routeData = opt.routeData;
      // Re-filter POIs for the newly selected route alternative so only stops
      // within 10 km of this specific polyline are displayed.
      _truckStops = _filterStopsNearRoute(_mockTruckStops, newPoints);
    });
    _fitCameraToRoute(_routePoints);
    _updateRouteViolationWarnings();
    // Keep trip-progress strip in sync with the newly selected route option.
    _updateTripProgressFromRoute(opt.distanceMiles, opt.durationSeconds);
  }

  /// Opens a modal bottom sheet listing all available [_routeOptions] so the
  /// driver can compare alternatives before committing to a route.
  ///
  /// Each option is shown as a card with: label, distance, ETA, restriction
  /// count, fuel stops, and weigh stations — all as info chips.  Tapping a
  /// card applies that route option and dismisses the sheet.
  void _showRouteOptionsBottomSheet() {
    if (_routeOptions.isEmpty) return;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            return Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
              ),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Drag handle
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      margin: const EdgeInsets.only(bottom: 12),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade300,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const Text(
                    'Choose Your Route',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                      color: Colors.black87,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  ..._routeOptions.asMap().entries.map((entry) {
                    final i = entry.key;
                    final opt = entry.value;
                    final isSelected = i == _selectedRouteOptionIndex;
                    final etaH = opt.durationSeconds ~/ 3600;
                    final etaM = (opt.durationSeconds % 3600) ~/ 60;
                    final etaLabel =
                        etaH > 0 ? '${etaH}h ${etaM}m' : '${etaM}m';
                    return GestureDetector(
                      onTap: () {
                        _applyRouteOption(i);
                        Navigator.of(ctx).pop();
                      },
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 180),
                        margin: const EdgeInsets.only(bottom: 10),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? Colors.blue.shade50
                              : Colors.grey.shade50,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: isSelected
                                ? Colors.blue.shade600
                                : Colors.grey.shade200,
                            width: isSelected ? 2 : 1,
                          ),
                        ),
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(
                                  opt.label,
                                  style: TextStyle(
                                    fontSize: 15,
                                    fontWeight: FontWeight.bold,
                                    color: isSelected
                                        ? Colors.blue.shade800
                                        : Colors.black87,
                                  ),
                                ),
                                if (isSelected) ...[
                                  const SizedBox(width: 8),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 2),
                                    decoration: BoxDecoration(
                                      color: Colors.blue.shade600,
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    child: const Text(
                                      'Selected',
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontSize: 11,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: [
                                _routeChip(
                                  '🚚',
                                  '${opt.distanceMiles.toStringAsFixed(0)} mi',
                                ),
                                _routeChip('⏱', etaLabel),
                                _routeChip(
                                  '⚠️',
                                  '${opt.restrictionCount} restrictions',
                                  color: opt.restrictionCount > 0
                                      ? Colors.red.shade50
                                      : null,
                                  borderColor: opt.restrictionCount > 0
                                      ? Colors.red.shade200
                                      : null,
                                  textColor: opt.restrictionCount > 0
                                      ? Colors.red.shade700
                                      : null,
                                ),
                                _routeChip(
                                    '⛽', '${opt.fuelStopCount} fuel stops'),
                                _routeChip(
                                    '⚖️',
                                    '${opt.weighStationCount} weigh stations'),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                ],
              ),
            );
          },
        );
      },
    );
  }

  /// Builds a small info chip for use inside the route options bottom sheet.
  Widget _routeChip(
    String emoji,
    String label, {
    Color? color,
    Color? borderColor,
    Color? textColor,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color ?? Colors.grey.shade100,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: borderColor ?? Colors.grey.shade300),
      ),
      child: Text(
        '$emoji $label',
        style: TextStyle(
          fontSize: 12,
          color: textColor ?? Colors.black87,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  /// Updates [_routeViolations] with human-readable warning strings by checking
  /// [_routePoints] against [_restrictedZones].
  ///
  /// Called automatically by [fetchRoute] after a route is loaded so that
  /// restriction checks always run against an existing route geometry (never
  /// before a route exists, per spec).
  void _updateRouteViolationWarnings() {
    if (_routePoints.isEmpty) return;
    final violations = <String>[];
    for (final zone in _restrictedZones) {
      final zonePt = LatLng(zone['lat']! as double, zone['lng']! as double);
      bool hit = false;
      for (final pt in _routePoints) {
        if (_distanceBetween(pt, zonePt) <= _restrictionProximityThresholdMeters) {
          hit = true;
          break;
        }
      }
      if (hit) {
        final type = zone['type'] as String;
        final limit = zone['limit_value'] as double;
        if (type == 'low_bridge') {
          violations.add(
              'Low bridge (${limit.toStringAsFixed(1)} ft clearance) near route');
        } else if (type == 'weight_limit') {
          violations.add(
              'Weight limit (${limit.toStringAsFixed(0)} tons) near route');
        } else {
          violations.add('Truck restriction ($type) near route');
        }
      }
    }
    setState(() {
      _routeViolations = violations;
    });
  }

  // ── Route color-coding helpers ─────────────────────────────────────────────

  /// Builds a list of red-overlay polyline segments for the selected route's
  /// restricted points.
  ///
  /// Returns a list of short [LatLng] pairs, each covering one route point
  /// (and the next if available) that falls within restriction proximity.
  /// Used by the [PolylineLayer] to draw red overlays over dangerous segments.
  List<List<LatLng>> _buildRestrictionSegments(List<LatLng> routePoints) {
    final segments = <List<LatLng>>[];
    if (routePoints.isEmpty) return segments;
    final threshold =
        _restrictionProximityThresholdMeters * _restrictionSegmentThresholdMultiplier;
    for (int i = 0; i < routePoints.length; i++) {
      final pt = routePoints[i];
      bool isRestricted = false;
      for (final r in _restrictions) {
        if (!_violatesRestriction(r)) continue;
        if (_distanceBetween(pt, r.position) <= threshold) {
          isRestricted = true;
          break;
        }
      }
      // Also check _restrictedZones
      if (!isRestricted) {
        for (final zone in _restrictedZones) {
          final zonePt =
              LatLng(zone['lat']! as double, zone['lng']! as double);
          if (_distanceBetween(pt, zonePt) <= threshold) {
            isRestricted = true;
            break;
          }
        }
      }
      if (isRestricted) {
        final next = (i + 1 < routePoints.length) ? routePoints[i + 1] : pt;
        segments.add([pt, next]);
      }
    }
    return segments;
  }

  /// Shows a modal bottom sheet with a Mapbox geocoding search field.
  ///
  /// The driver types a destination query; results are fetched from the
  /// Mapbox Geocoding v5 API and displayed as tappable list tiles.  On
  /// selection, [_selectedDestination] and [_selectedDestinationName] are
  /// updated and [_startRouteToSelectedDestination] is called.
  Future<void> _showDestinationSearch() async {
    final controller = TextEditingController();
    List<Map<String, dynamic>> results = [];
    // Track the destination before the sheet opened so we can detect changes.
    final prevDestination = _selectedDestination;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
                left: 16,
                right: 16,
                top: 20,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // ── Search field ─────────────────────────────────────────
                  TextField(
                    controller: controller,
                    autofocus: true,
                    decoration: InputDecoration(
                      hintText: 'Search destination...',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: IconButton(
                        icon: const Icon(Icons.send),
                        onPressed: () async {
                          final q = controller.text.trim();
                          if (q.isEmpty) return;
                          final r = await _geocodeAddress(q);
                          setModalState(() => results = r);
                        },
                      ),
                      border: const OutlineInputBorder(),
                    ),
                    onSubmitted: (q) async {
                      if (q.trim().isEmpty) return;
                      final r = await _geocodeAddress(q.trim());
                      setModalState(() => results = r);
                    },
                  ),
                  const SizedBox(height: 8),
                  // ── Geocoding results ────────────────────────────────────
                  if (results.isNotEmpty)
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 260),
                      child: ListView(
                        shrinkWrap: true,
                        children: results
                            .map(
                              (r) => ListTile(
                                leading: const Icon(Icons.place),
                                title: Text(r['name'] as String),
                                subtitle: Text(r['place'] as String? ?? ''),
                                onTap: () {
                                  setState(() {
                                    _selectedDestination =
                                        r['position'] as LatLng;
                                    _selectedDestinationName =
                                        r['name'] as String;
                                  });
                                  Navigator.of(ctx).pop();
                                },
                              ),
                            )
                            .toList(),
                      ),
                    ),
                  if (results.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Text(
                        'Type a destination and press Search or ↵',
                        style: TextStyle(color: Colors.grey),
                      ),
                    ),
                ],
              ),
            );
          },
        );
      },
    );

    // Start routing only when a *new* destination was chosen in this session.
    if (_selectedDestination != null &&
        _selectedDestination != prevDestination) {
      await _startRouteToSelectedDestination();
    }
  }

  /// Queries the Mapbox Geocoding v5 API for [query] and returns up to 5
  /// results as maps with keys 'name', 'place', and 'position' (LatLng).
  Future<List<Map<String, dynamic>>> _geocodeAddress(String query) async {
    try {
      final encoded = Uri.encodeComponent(query);
      final url =
          'https://api.mapbox.com/geocoding/v5/mapbox.places/$encoded.json'
          '?types=address,place,poi'
          '&limit=5'
          '&access_token=$_mapboxToken';
      final res = await http.get(Uri.parse(url));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final features = (data['features'] as List?) ?? const [];
      return features.map<Map<String, dynamic>>((dynamic f) {
        final props = f as Map<String, dynamic>;
        final coords = (props['geometry'] as Map<String, dynamic>)['coordinates']
            as List;
        final name = props['text'] as String? ?? '';
        final place = props['place_name'] as String? ?? '';
        return {
          'name': name,
          'place': place,
          'position': LatLng(
            (coords[1] as num).toDouble(),
            (coords[0] as num).toDouble(),
          ),
        };
      }).toList();
    } catch (e) {
      // Log the error so developers can diagnose API or network failures.
      // The empty list return lets the search sheet show "no results" gracefully.
      print('Geocoding error for "$query": $e');
      return [];
    }
  }

  /// Handles a long-press on the map to immediately set a destination and
  /// start routing to the tapped coordinate.
  ///
  /// The destination name is set to the coordinate string so the driver has
  /// immediate visual feedback while a geocoding lookup could be added later.
  void _onMapLongPress(LatLng point) {
    setState(() {
      _selectedDestination = point;
      _selectedDestinationName =
          '${point.latitude.toStringAsFixed(4)}, '
          '${point.longitude.toStringAsFixed(4)}';
    });
    _startRouteToSelectedDestination();
  }

  // ── Inline search bar logic ───────────────────────────────────────────────

  /// Called from [TextField.onChanged] to debounce geocoding requests.
  ///
  /// Cancels any pending debounce timer and schedules a new one for 350 ms.
  /// This prevents excessive API calls on every keystroke while still feeling
  /// responsive to the user.  When the timer fires, [_searchPlaces] is called
  /// with the current query value.
  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    final q = value.trim();
    if (q.isEmpty) {
      setState(() {
        _searchResults = const [];
        _isSearching = false;
      });
      return;
    }
    setState(() => _isSearching = true);
    _searchDebounce = Timer(
      const Duration(milliseconds: 350),
      () => _searchPlaces(q),
    );
  }

  /// Executes a geocoding request for [query] and populates
  /// [_searchResults] with up to 5 [PlaceSuggestion] objects.
  ///
  /// Sets [_isSearching] while the request is in flight so the search bar can
  /// show a loading indicator.  Clears results and stops the spinner on any
  /// error, letting the UI degrade gracefully without a hard crash.
  Future<void> _searchPlaces(String query) async {
    final q = query.trim();
    if (q.isEmpty) {
      setState(() {
        _searchResults = const [];
        _isSearching = false;
      });
      return;
    }
    await _executeSearch(q);
  }

  /// Immediately fires a geocoding request for [q] without any debounce delay.
  ///
  /// Called directly from [TextField.onSubmitted] so results appear as soon as
  /// the user presses the keyboard "done"/"search" button.
  Future<void> _executeSearch(String q) async {
    if (!mounted || q.isEmpty) return;
    setState(() => _isSearching = true);
    try {
      final encoded = Uri.encodeComponent(q);
      final url =
          'https://api.mapbox.com/geocoding/v5/mapbox.places/$encoded.json'
          '?types=address,place,poi'
          '&limit=5'
          '&access_token=$_mapboxToken';
      final res = await http.get(Uri.parse(url));
      if (res.statusCode != 200) {
        // Log non-200 responses (e.g. 401 bad token, 429 rate limit) to aid
        // debugging without surfacing raw HTTP details to the end user.
        print('Geocoding HTTP ${res.statusCode} for "$q": ${res.body}');
        if (mounted) setState(() => _isSearching = false);
        return;
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final features = (data['features'] as List?) ?? const [];
      final suggestions = <PlaceSuggestion>[];
      for (final dynamic f in features) {
        try {
          final props = f as Map<String, dynamic>;
          final geometry = props['geometry'] as Map<String, dynamic>?;
          final coords = geometry?['coordinates'] as List?;
          if (coords == null || coords.length < 2) continue;
          suggestions.add(PlaceSuggestion(
            name: props['text'] as String? ?? '',
            placeName: props['place_name'] as String? ?? '',
            position: LatLng(
              (coords[1] as num).toDouble(),
              (coords[0] as num).toDouble(),
            ),
          ));
        } catch (_) {
          // Skip malformed features rather than aborting the whole batch.
        }
      }
      if (mounted) {
        setState(() {
          _searchResults = suggestions;
          _isSearching = false;
        });
      }
    } catch (e) {
      // Log the error so developers can diagnose network or parsing failures.
      print('Geocoding error for "$q": $e');
      if (mounted) {
        setState(() {
          _searchResults = const [];
          _isSearching = false;
        });
      }
    }
  }

  /// Called when the driver taps a [PlaceSuggestion] in the search results.
  ///
  /// Pans the camera to the chosen location, sets it as the selected
  /// destination, and clears the search bar and results list so the map is
  /// unobstructed.  Route building is left to the explicit "Start Route"
  /// button so the driver can review the destination pin before committing.
  void _selectDestinationFromSearch(PlaceSuggestion suggestion) {
    setState(() {
      _selectedDestination = suggestion.position;
      _selectedDestinationName = suggestion.name.isNotEmpty
          ? suggestion.name
          : suggestion.placeName;
      _searchResults = const [];
      _isSearching = false;
    });
    _searchController.clear();
    if (_mapReady) {
      _mapController.move(suggestion.position, 13.0);
    }
  }

  /// Builds the inline search bar that floats at the top of the map.
  ///
  /// Displays a [TextField] with a search icon prefix, a [CircularProgressIndicator]
  /// while geocoding is in flight, and a clear button once text has been entered.
  /// The suffix icon uses a [ValueListenableBuilder] so it updates immediately
  /// on every keystroke without waiting for a setState call.
  Widget _buildSearchBar() {
    return Positioned(
      top: 8,
      left: 12,
      right: 12,
      child: Material(
        elevation: 4,
        borderRadius: BorderRadius.circular(12),
        child: ValueListenableBuilder<TextEditingValue>(
          valueListenable: _searchController,
          builder: (_, value, __) {
            return TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Search destination...',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _isSearching
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : value.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear),
                            onPressed: () {
                              _searchController.clear();
                              setState(() => _searchResults = const []);
                            },
                          )
                        : null,
                filled: true,
                fillColor: Colors.white,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
              onChanged: _onSearchChanged,
              onSubmitted: (q) {
                // Cancel any pending debounce and execute the search immediately.
                _searchDebounce?.cancel();
                _executeSearch(q.trim());
              },
            );
          },
        ),
      ),
    );
  }
  /// Builds the search results overlay below the search bar.
  ///
  /// Shows a loading spinner while [_isSearching] is true, a "No results
  /// found" message when the search completed with an empty list, or a
  /// scrollable [ListView] of [ListTile]s for each [PlaceSuggestion].
  /// Returns [SizedBox.shrink] when there is nothing to display.
  /// Tapping a tile calls [_selectDestinationFromSearch] to set the
  /// destination and dismiss the list.
  Widget _buildSearchResults() {
    final hasText = _searchController.text.trim().isNotEmpty;
    if (!hasText && !_isSearching && _searchResults.isEmpty) {
      return const SizedBox.shrink();
    }

    Widget content;
    if (_isSearching) {
      content = const Padding(
        padding: EdgeInsets.symmetric(vertical: 20),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    } else if (_searchResults.isEmpty) {
      content = const Padding(
        padding: EdgeInsets.symmetric(vertical: 16, horizontal: 16),
        child: Text(
          'No results found',
          style: TextStyle(color: Colors.grey),
        ),
      );
    } else {
      content = ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 260),
        child: ListView.separated(
          shrinkWrap: true,
          padding: EdgeInsets.zero,
          itemCount: _searchResults.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (_, i) {
            final s = _searchResults[i];
            return ListTile(
              leading: const Icon(Icons.location_on_outlined),
              title: Text(
                s.name.isNotEmpty ? s.name : s.placeName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: s.placeName.isNotEmpty && s.name != s.placeName
                  ? Text(
                      s.placeName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    )
                  : null,
              onTap: () => _selectDestinationFromSearch(s),
            );
          },
        ),
      );
    }

    return Positioned(
      top: 68,
      left: 12,
      right: 12,
      child: Material(
        elevation: 8,
        borderRadius: BorderRadius.circular(12),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: Container(
            color: Colors.white,
            child: content,
          ),
        ),
      ),
    );
  }

  /// Builds the "Start Route" button shown when a destination has been selected
  /// but no route has been built yet.
  ///
  /// Tapping calls [_startRouteToSelectedDestination].  While [_isBuildingRoute]
  /// is true the button shows a spinner so the driver knows the request is
  /// in flight.
  Widget _buildStartRouteButton() {
    return Positioned(
      bottom: 120,
      left: 16,
      right: 16,
      child: ElevatedButton.icon(
        style: ElevatedButton.styleFrom(
          backgroundColor: Colors.deepOrange,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          elevation: 6,
        ),
        icon: _isBuildingRoute
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: Colors.white),
              )
            : const Icon(Icons.directions),
        label: Text(
          _isBuildingRoute ? 'Building route…' : 'Start Route',
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
        ),
        onPressed: _isBuildingRoute
            ? null
            : () async {
                setState(() => _isBuildingRoute = true);
                await _startRouteToSelectedDestination();
                if (mounted) setState(() => _isBuildingRoute = false);
              },
      ),
    );
  }

  /// Builds the bottom navigation actions panel shown when a route has been
  /// built during preview but the user has not yet started the navigation
  /// session.
  ///
  /// When multiple route alternatives are available, an outlined
  /// "See Route Details" button is shown above the "Start Navigation" button
  /// so the driver can compare alternatives — distance, ETA, restrictions,
  /// fuel stops, and weigh stations — via [_showRouteOptionsBottomSheet] before
  /// committing to a route.
  ///
  /// Tapping "Start Navigation" calls [_startNavigation] to begin GPS tracking
  /// and trip stats.  Hidden once [_isNavigating] is true.
  Widget _buildStartNavigationButton() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_routeOptions.length > 1) ...[
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.blue.shade700,
              side: BorderSide(color: Colors.blue.shade600, width: 1.5),
              padding: const EdgeInsets.symmetric(vertical: 12),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              backgroundColor: Colors.white.withOpacity(0.95),
            ),
            icon: const Icon(Icons.compare_arrows, size: 20),
            label: Text(
              'See Route Details (${_routeOptions.length} options)',
              style: const TextStyle(
                  fontSize: 14, fontWeight: FontWeight.w600),
            ),
            onPressed: _showRouteOptionsBottomSheet,
          ),
          const SizedBox(height: 8),
        ],
        Row(
          children: [
            Expanded(
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  elevation: 6,
                ),
                icon: const Icon(Icons.navigation),
                label: const Text(
                  'Start Navigation',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                onPressed: _startNavigation,
              ),
            ),
            if (_routeViolations.isNotEmpty) ...[
              const SizedBox(width: 10),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.orange,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  elevation: 6,
                ),
                icon: const Icon(Icons.alt_route),
                label: const Text(
                  'Optimize for Truck',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                ),
                onPressed:
                    _isRestrictionRerouting ? null : _smartRerouteAroundRestrictions,
              ),
            ],
          ],
        ),
      ],
    );
  }

  // ── Leg breakdown UI helpers ───────────────────────────────────────────────

  /// Formats [seconds] into a human-readable duration string such as
  /// "1h 24m" or "38m".
  String _formatDuration(int seconds) {
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    return h > 0 ? '${h}h ${m}m' : '${m}m';
  }

  /// Displays a card showing the current active leg during navigation.
  ///
  /// Shows: leg counter, from → to names, distance and duration, and a
  /// colour-coded restriction warning.  Hidden when no legs exist or
  /// navigation has not started.
  Widget _buildCurrentLegCard() {
    if (_tripLegs.isEmpty || !_isNavigating) {
      return const SizedBox.shrink();
    }
    if (_activeLegIndex >= _tripLegs.length) return const SizedBox.shrink();
    final leg = _tripLegs[_activeLegIndex];
    return Positioned(
      left: 16,
      right: 16,
      bottom: 250,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.12),
              blurRadius: 10,
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Leg ${_activeLegIndex + 1} of ${_tripLegs.length}',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 8),
            Text('${leg.fromName} → ${leg.toName}'),
            const SizedBox(height: 6),
            Text(
              '${leg.distanceMiles.toStringAsFixed(0)} mi • ${_formatDuration(leg.durationSeconds)}',
            ),
            const SizedBox(height: 6),
            Text(
              leg.restrictionCount == 0
                  ? 'No known restrictions'
                  : '${leg.restrictionCount} restriction warning(s)',
              style: TextStyle(
                color:
                    leg.restrictionCount == 0 ? Colors.green : Colors.red,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Shows a modal bottom sheet listing all trip legs with their from/to
  /// names, distance, duration, and restriction count.  The active leg is
  /// highlighted in green.
  void _showLegBreakdownSheet() {
    if (_tripLegs.isEmpty) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (_) {
        return Padding(
          padding: const EdgeInsets.all(20),
          child: ListView(
            shrinkWrap: true,
            children: [
              const Text(
                'Trip Legs',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 14),
              ...List.generate(_tripLegs.length, (index) {
                final leg = _tripLegs[index];
                final active = index == _activeLegIndex;
                return Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color:
                        active ? Colors.green.shade50 : Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: active
                          ? Colors.green
                          : Colors.grey.shade300,
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Leg ${index + 1}',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text('${leg.fromName} → ${leg.toName}'),
                      const SizedBox(height: 6),
                      Text(
                        '${leg.distanceMiles.toStringAsFixed(0)} mi • ${_formatDuration(leg.durationSeconds)}',
                      ),
                      const SizedBox(height: 6),
                      Text(
                        leg.restrictionCount == 0
                            ? 'No restrictions'
                            : '${leg.restrictionCount} restriction warning(s)',
                        style: TextStyle(
                          color: leg.restrictionCount == 0
                              ? Colors.green
                              : Colors.red,
                        ),
                      ),
                    ],
                  ),
                );
              }),
            ],
          ),
        );
      },
    );
  }

  /// Builds a mini FAB that opens the leg breakdown sheet during navigation.
  ///
  /// Hidden when there are no legs or navigation has not started.
  Widget _buildLegBreakdownButton() {
    if (_tripLegs.isEmpty || !_isNavigating) {
      return const SizedBox.shrink();
    }
    return Positioned(
      right: 16,
      bottom: 320,
      child: FloatingActionButton(
        mini: true,
        heroTag: 'leg_breakdown',
        backgroundColor: Colors.white,
        onPressed: _showLegBreakdownSheet,
        child: const Icon(Icons.list_alt, color: Colors.black),
      ),
    );
  }
  ///
  /// [emoji] is a leading emoji icon, [label] is the category name, and
  /// [value] is the computed display string.  [valueColor] may override the
  /// default text colour for warnings.
  Widget _previewRow(
    String emoji,
    String label,
    String value, {
    Color? valueColor,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Text(emoji, style: const TextStyle(fontSize: 16)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 13,
                color: Colors.black87,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.bold,
              color: valueColor ?? Colors.black87,
            ),
          ),
        ],
      ),
    );
  }

  // ── Route alternatives helpers ─────────────────────────────────────────────

  /// Builds the route stats summary section of the preview panel.
  Widget _buildPreviewIntelligencePanel() {
    final distanceMiles =
        (_routeData?['distanceMiles'] as num?)?.toInt() ?? 0;
    final etaMinutes =
        (_routeData?['etaMinutes'] as num?)?.toInt() ?? 0;
    final etaHours = etaMinutes ~/ 60;
    final etaMins = etaMinutes % 60;
    final etaLabel = etaHours > 0 ? '${etaHours}h ${etaMins}m' : '${etaMins}m';

    // Fuel stops: truck stops near the route that are actual fuel providers
    // (exclude rest-area and weigh-station brands which don't sell diesel).
    final fuelStops = _truckStops
        .where((s) => s.brand != 'Rest Area' && s.brand != 'Weigh Station')
        .length;

    // Weigh stations: map POIs of weighStation type.
    final weighStations = _mapPois
        .where((p) => p.type == PoiType.weighStation)
        .length;

    final restrictionCount = _selectedRouteOptionIndex < _routeOptions.length
        ? _routeOptions[_selectedRouteOptionIndex].restrictionCount
        : _routeViolations.length;
    final hasRestrictions = restrictionCount > 0;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(
            color: Color(0x29000000),
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'Route Preview',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: Colors.black87,
            ),
          ),
          const SizedBox(height: 8),
          _previewRow('🚚', 'Distance:', '$distanceMiles mi'),
          _previewRow('⏱', 'ETA:', etaLabel),
          _previewRow('⛽', 'Fuel Stops:', '$fuelStops'),
          _previewRow('⚖️', 'Weigh Stations:', '$weighStations'),
          _previewRow(
            '⚠️',
            'Restrictions:',
            '$restrictionCount',
            valueColor: hasRestrictions ? Colors.red : null,
          ),
          if (_weatherRisk != null)
            _previewRow('🌧', 'Weather Risk:', _weatherRisk!),
          if (hasRestrictions) ...[
            const SizedBox(height: 6),
            const Text(
              '⚠️ Route has truck restrictions.',
              style: TextStyle(
                fontSize: 13,
                color: Colors.red,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// Builds the route alternatives selection card shown in preview mode.
  ///
  /// Displays each available route option as a tappable card with its label,
  /// distance, ETA, and restriction count.  The selected option is highlighted
  /// in blue; others are shown with a grey border.
  Widget _buildRouteAlternativesCard() {
    if (_routeOptions.length < 2) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(
            color: Color(0x29000000),
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'Route Options',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: Colors.black87,
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            height: 80,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _routeOptions.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final opt = _routeOptions[i];
                final isSelected = i == _selectedRouteOptionIndex;
                final distMi = opt.distanceMiles.toStringAsFixed(0);
                final etaMins = opt.durationSeconds ~/ 60;
                final etaH = etaMins ~/ 60;
                final etaM = etaMins % 60;
                final etaLabel = etaH > 0 ? '${etaH}h ${etaM}m' : '${etaM}m';
                return GestureDetector(
                  onTap: () => _applyRouteOption(i),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    width: 110,
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? Colors.blue.shade50
                          : Colors.grey.shade50,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: isSelected
                            ? Colors.blue.shade600
                            : Colors.grey.shade300,
                        width: isSelected ? 2 : 1,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          opt.label,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                            color: isSelected
                                ? Colors.blue.shade700
                                : Colors.black87,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          '$distMi mi · $etaLabel',
                          style: const TextStyle(
                              fontSize: 11, color: Colors.black54),
                        ),
                        Row(
                          children: [
                            Icon(
                              opt.restrictionCount > 0
                                  ? Icons.warning_amber_rounded
                                  : Icons.check_circle_outline,
                              size: 12,
                              color: opt.restrictionCount > 0
                                  ? Colors.red
                                  : Colors.green,
                            ),
                            const SizedBox(width: 3),
                            Text(
                              opt.restrictionCount > 0
                                  ? '${opt.restrictionCount} restrict.'
                                  : 'Clear',
                              style: TextStyle(
                                fontSize: 10,
                                color: opt.restrictionCount > 0
                                    ? Colors.red
                                    : Colors.green.shade700,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  /// Builds the mini map legend explaining route colour coding.
  ///
  /// Positioned in the top-right of the map below the search bar so it does
  /// not overlap with the search field or the navigation banner.
  Widget _buildMapLegend() {
    return Positioned(
      top: 68,
      right: 12,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.92),
          borderRadius: BorderRadius.circular(10),
          boxShadow: const [
            BoxShadow(
              color: Color(0x29000000),
              blurRadius: 8,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            _legendRow(Colors.blue, 'Selected route'),
            const SizedBox(height: 4),
            _legendRow(Colors.grey.shade400, 'Alternative'),
            const SizedBox(height: 4),
            _legendRow(Colors.red, 'Restriction'),
          ],
        ),
      ),
    );
  }

  /// Builds a single row for [_buildMapLegend] with a colour swatch and label.
  Widget _legendRow(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 20,
          height: 4,
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: 6),
        Text(
          label,
          style: const TextStyle(fontSize: 11, color: Colors.black87),
        ),
      ],
    );
  }

  // ── Production Mapbox map widget ──────────────────────────────────────────

  /// Holds a reference to the Mapbox map once [_onMapCreated] fires.
  /// Used by [_setupPoiCluster] to add sources and layers after the style loads.
  mbx.MapboxMap? _mapboxMap;

  /// Called by [MapWidget] once the native Mapbox map is fully initialised.
  ///
  /// Stores the [mapboxMap] reference so that [_onStyleLoaded] can use it to
  /// add POI sources and layers once the style finishes loading.
  void _onMapCreated(mbx.MapboxMap mapboxMap) {
    _mapboxMap = mapboxMap;
  }

  /// Called by [MapWidget] once the Mapbox style has finished loading.
  ///
  /// Triggers [_setupPoiCluster] to register icons and add the clustered POI
  /// source and layers to the map style.
  void _onStyleLoaded(mbx.StyleLoadedEventData _) {
    _setupPoiCluster();
  }

  /// Sets up the clustered POI GeoJSON source and Mapbox style layers.
  ///
  /// Called from [_onStyleLoaded] after the Mapbox style finishes loading.
  /// Loads [PoiItem]s from `assets/locations.json`, converts them to GeoJSON,
  /// registers all PNG icons from `assets/logo_brand_markers/`, then adds four
  /// objects to the Mapbox style:
  ///
  ///   - `poi-source`       — clustered GeoJSON source
  ///   - `poi-clusters`     — circle layer for grouped cluster rings
  ///   - `poi-cluster-count`— symbol layer with `{point_count}` text labels
  ///   - `poi-unclustered`  — symbol layer using each POI's icon image
  ///
  /// Every entry in `locations.json` is converted to a GeoJSON feature
  /// without any proximity or category filtering, so all truck stops appear
  /// as markers wherever the user browses the map.
  ///
  /// All rendering is done via Mapbox style layers — no Flutter widget markers
  /// are created, keeping performance O(1) regardless of POI count.
  Future<void> _setupPoiCluster() async {
    final mbx.MapboxMap? map = _mapboxMap;
    if (map == null) return;
    try {
      // Guard against duplicate setup when the style reloads.
      if (await map.style.styleSourceExists('poi-source')) return;

      // 1. Load every POI from locations.json and register all PNG icons.
      final List<PoiItem> pois = await loadAllPois();

      // Store the full POI list so _refreshClosestTruckStopsAhead can use it
      // as the primary data source for the navigation overlay strip.
      if (mounted) setState(() => _loadedPois = pois);

      // ── Audit: name + icon for every POI ─────────────────────────────────
      // Prints every loaded POI's name and normalised Mapbox icon ID so you can
      // cross-check the JSON `"icon"` field against the files bundled in
      // assets/logo_brand_markers/.  If a marker is missing, its icon ID will
      // not appear in the [registerPoiIcons] success log.
      //
      // To match a missing icon:
      //   1. Find the icon ID printed here (e.g. "hotel_default").
      //   2. Check that a PNG matching the original JSON icon value exists in
      //      assets/logo_brand_markers/ (e.g. "hotel_default.png").
      //   3. If not, add or rename the PNG, then rebuild.
      //
      // Note: this loop logs one line per POI entry, which may produce many
      // lines for large datasets — it is intentional for a full audit pass.
      // TODO(production): Remove this per-POI loop before releasing.
      debugPrint('[POI Audit] ${pois.length} POI(s) loaded from locations.json:');
      for (var i = 0; i < pois.length; i++) {
        final p = pois[i];
        debugPrint('[POI Audit]   [$i] name="${p.name}"  icon="${p.icon}"');
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Diagnostic logging — verify dataset coverage ──────────────────────
      // Expected coordinate ranges for full USA / Canada coverage:
      //   Latitude  : 24 – 83 °N  (southern US tip → northern Canada)
      //   Longitude : –168 – –52 °W  (Alaska west coast → Newfoundland east)
      //
      // Browse mode: ALL POIs are passed to the GeoJSON source so every entry
      //   appears on the clustered map with no distance filtering applied.
      // Navigation mode: _getClosestTruckStopsAheadOnRoute handles route-aware
      //   proximity filtering for the ahead-strip; the POI layer still shows
      //   all POIs for spatial context.
      //   // Navigation-only distance filter (retained for reference):
      //   //   pois = pois.where((p) {
      //   //     final distMeters = geo.Geolocator.distanceBetween(
      //   //       driverLat, driverLng, p.lat, p.lng);
      //   //     return distMeters / 1609.34 <= 50.0;
      //   //   }).toList();
      debugPrint('POI dataset loaded: ${pois.length} total entries.');
      if (pois.isNotEmpty) {
        final int previewCount = math.min(20, pois.length);
        for (var i = 0; i < previewCount; i++) {
          final p = pois[i];
          debugPrint('  POI[$i] ${p.name}  (${p.lat}, ${p.lng})');
        }
        final double minLat = pois.map((p) => p.lat).reduce(math.min);
        final double maxLat = pois.map((p) => p.lat).reduce(math.max);
        final double minLng = pois.map((p) => p.lng).reduce(math.min);
        final double maxLng = pois.map((p) => p.lng).reduce(math.max);
        debugPrint(
          'Coordinate spread — '
          'lat: ${minLat.toStringAsFixed(4)} – ${maxLat.toStringAsFixed(4)}, '
          'lng: ${minLng.toStringAsFixed(4)} – ${maxLng.toStringAsFixed(4)}',
        );
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Audit: unique icon IDs + file-existence check ─────────────────────
      // TODO(production): Remove this call before releasing.
      await auditPoiIconAssets(pois);
      // ─────────────────────────────────────────────────────────────────────

      await registerPoiIcons(map.style);

      // 2. Add the clustered GeoJSON source (inline FeatureCollection).
      final Map<String, dynamic> geoJson = poisToGeoJson(pois);
      await map.style.addStyleSource(
        'poi-source',
        jsonEncode({
          'type': 'geojson',
          'data': geoJson,
          'cluster': true,
          'clusterMaxZoom': 14,
          'clusterRadius': 50,
        }),
      );

      // 3. Cluster circle layer — colour steps by group size.
      await map.style.addStyleLayer(
        jsonEncode({
          'id': 'poi-clusters',
          'type': 'circle',
          'source': 'poi-source',
          'filter': ['has', 'point_count'],
          'paint': {
            'circle-color': [
              'step',
              ['get', 'point_count'],
              '#3B82F6', // blue  — small clusters (< 10)
              10,
              '#F59E0B', // amber — medium clusters (10–29)
              30,
              '#EF4444', // red   — large clusters (≥ 30)
            ],
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              18,
              10,
              24,
              30,
              30,
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        }),
        null,
      );

      // 4. Cluster count text label layer.
      await map.style.addStyleLayer(
        jsonEncode({
          'id': 'poi-cluster-count',
          'type': 'symbol',
          'source': 'poi-source',
          'filter': ['has', 'point_count'],
          'layout': {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 13,
          },
          'paint': {
            'text-color': '#ffffff',
          },
        }),
        null,
      );

      // 5. Unclustered individual POI icon layer.
      //    Use a coalesce expression so that POIs whose icon was not bundled
      //    as a PNG in assets/logo_brand_markers/ still render with the generic
      //    truck_parking fallback icon instead of silently disappearing.
      await map.style.addStyleLayer(
        jsonEncode({
          'id': 'poi-unclustered',
          'type': 'symbol',
          'source': 'poi-source',
          'filter': ['!', ['has', 'point_count']],
          'layout': {
            'icon-image': [
              'coalesce',
              ['image', ['get', 'icon']],
              ['image', 'truck_parking'],
            ],
            'icon-size': 0.6,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          },
        }),
        null,
      );
    } catch (e) {
      // POI cluster setup failed — map remains usable without the POI overlay.
      debugPrint('TruckMapScreen: _setupPoiCluster failed: $e');
    }
  }

  /// Returns a full-screen [MapWidget] using the Mapbox Maps Flutter SDK.
  Widget _buildMap() {
    return Positioned.fill(
      child: mbx.MapWidget(
        key: const ValueKey("mapWidget"),
        styleUri: mbx.MapboxStyles.MAPBOX_STREETS,
        onMapCreated: _onMapCreated,
        onStyleLoadedListener: _onStyleLoaded,
      ),
    );
  }

  /// Builds the combined preview bottom panel: alternatives card, route stats,
  /// and the Start Navigation / Optimize buttons.
  ///
  /// Replaces the previous separate Positioned widgets for the intelligence
  /// panel and start button, providing a unified layout that avoids overlap.
  Widget _buildPreviewBottomPanel() {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildRouteAlternativesCard(),
              if (_routeOptions.length >= 2) const SizedBox(height: 8),
              _buildPreviewIntelligencePanel(),
              const SizedBox(height: 8),
              _buildStartNavigationButton(),
            ],
          ),
        ),
      ),
    );
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
      // No leg data; return empty so the caller handles missing steps gracefully.
      return [];
    }
    final steps = legs[0]['steps'] as List?;
    if (steps == null || steps.isEmpty) {
      // No step data; return empty so the caller handles missing steps gracefully.
      return [];
    }
    return steps.map<_NavStep>((dynamic s) {
      final step = s as Map<String, dynamic>;
      final maneuver = step['maneuver'] as Map<String, dynamic>?;
      final instruction = maneuver?['instruction'] as String? ?? 'Continue';
      // Mapbox maneuver locations are [lng, lat] arrays.
      final loc = maneuver?['location'] as List?;
      final lat = loc != null && loc.length >= 2
          ? (loc[1] as num).toDouble()
          : _truckPosition?.latitude ?? 0.0;
      final lng = loc != null && loc.length >= 2
          ? (loc[0] as num).toDouble()
          : _truckPosition?.longitude ?? 0.0;
      // 'modifier' encodes turn direction: 'left', 'right', 'straight', etc.
      final modifier = maneuver?['modifier'] as String? ?? 'straight';
      // 'type' encodes maneuver category: 'turn', 'merge', 'fork', etc.
      final maneuverType = maneuver?['type'] as String? ?? '';
      // Step distance in metres from the Mapbox response.
      final distanceMeters = (step['distance'] as num?)?.toDouble() ?? 0.0;
      // Road name for this step (e.g. "US-95", "Wells Ave").
      final stepName = (step['name'] as String?) ?? '';
      return _NavStep(
        instruction,
        LatLng(lat, lng),
        maneuver: modifier,
        type: maneuverType,
        distanceMeters: distanceMeters,
        name: stepName,
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

  /// Formats a distance in metres as a human-readable miles string for the
  /// road info card, e.g. "33.6 mi".
  String _formatDistanceMiles(double meters) {
    final miles = meters / 1609.344;
    if (miles < 0.1) return '< 0.1 mi';
    if (miles < 10.0) return '${miles.toStringAsFixed(1)} mi';
    return '${miles.toStringAsFixed(0)} mi';
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
                    // Clear all navigation/trip state and return to idle mode.
                    if (mounted) {
                      _clearActiveRoute();
                      setState(() {
                        _selectedDestination = null;
                        _selectedDestinationName = null;
                      });
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

  // ── Road Guidance Banner ───────────────────────────────────────────────────

  /// Maps a Mapbox maneuver modifier string to the nearest [ManeuverType].
  ManeuverType _maneuverTypeFromModifier(String modifier) {
    switch (modifier.toLowerCase()) {
      case 'left':
      case 'turn-left':
        return ManeuverType.turnLeft;
      case 'slight left':
        return ManeuverType.keepLeft;
      case 'sharp left':
        return ManeuverType.turnLeft;
      case 'right':
      case 'turn-right':
        return ManeuverType.turnRight;
      case 'slight right':
        return ManeuverType.keepRight;
      case 'sharp right':
        return ManeuverType.turnRight;
      case 'uturn':
      case 'u-turn':
        return ManeuverType.uTurn;
      case 'merge':
        return ManeuverType.merge;
      case 'fork left':
        return ManeuverType.forkLeft;
      case 'fork right':
        return ManeuverType.forkRight;
      case 'ramp':
        return ManeuverType.ramp;
      case 'exit right':
        return ManeuverType.exitRight;
      case 'exit left':
        return ManeuverType.exitLeft;
      case 'keep left':
        return ManeuverType.keepLeft;
      case 'keep right':
        return ManeuverType.keepRight;
      case 'straight':
      case 'continue':
      default:
        return ManeuverType.continueStraight;
    }
  }

  /// Builds a [ManeuverInfo] from the current navigation state so the
  /// [RoadGuidanceBanner] can be rendered with live data.
  ///
  /// Road chip data (current/next road) is derived from the destination name
  /// when available; lane hint and exit number are not yet provided by the
  /// backend and default to null.
  ManeuverInfo _buildCurrentManeuverInfo() {
    final safeIndex = _currentStepIndex.clamp(0, _navSteps.length - 1);
    final step = _navSteps[safeIndex];
    final distance = _distanceToNextStep();

    // The Mapbox Directions API response as currently parsed does not expose
    // structured road-number data per step.  We use the destination name as
    // the best available label for the current-road chip.  Future work can
    // parse the step's `ref` field from the raw Directions JSON to populate
    // an actual route number (e.g. "I-10") and RouteType.
    final destName = _selectedDestinationName ?? '';
    final currentRoad = RoadInfo(
      routeNumber: destName.isNotEmpty ? destName : 'En Route',
      routeType: RouteType.localRoad,
    );

    return ManeuverInfo(
      instruction: _formatInstruction(step.instruction),
      maneuverType: _maneuverTypeFromModifier(step.maneuver),
      distanceMeters: distance,
      currentRoad: currentRoad,
    );
  }

  /// Builds the [RoadGuidanceBanner] overlay shown when [_isNavigating] is
  /// true.  The banner floats at the top of the map with safe-area padding so
  /// it never overlaps the device status bar.
  Widget _buildRoadGuidanceBanner() {
    if (_navSteps.isEmpty) return const SizedBox.shrink();
    return Positioned(
      top: 16,
      left: 0,
      right: 0,
      child: RoadGuidanceBanner(maneuver: _buildCurrentManeuverInfo()),
    );
  }

  // ── Lane-guidance visibility helpers ──────────────────────────────────────

  /// Returns true when [maneuverType] is one of the maneuver categories that
  /// benefit from lane guidance (turns, ramps, merges, forks, exits, and
  /// roundabouts).  Returns false for straight driving and for null input so
  /// that the guidance panel stays hidden during normal cruise mode.
  bool _maneuverNeedsLaneGuidance(String? maneuverType) {
    if (maneuverType == null) return false;

    // Canonical set of maneuver types that require driver lane awareness.
    const supported = {
      'turn',
      'exit',
      'fork',
      'merge',
      'ramp',
      'roundabout',
      'off ramp',
      'on ramp',
    };

    return supported.contains(maneuverType.toLowerCase());
  }

  /// Returns true when lane guidance should be visible to the driver.
  ///
  /// Two conditions must both be satisfied:
  ///  1. [step] is non-null and its [maneuverType] is one that needs lane
  ///     guidance (delegated to [_maneuverNeedsLaneGuidance]).
  ///  2. The driver is close enough to the maneuver:
  ///     - Highway maneuvers (exits, ramps): show within 1.2 miles so the
  ///       driver has extra time to change lanes on a multi-lane road.
  ///     - City / surface-road maneuvers: show within 0.8 miles to avoid
  ///       cluttering the display during normal urban driving.
  bool _shouldShowLaneGuidance(UpcomingManeuverStep? step) {
    if (step == null || !_maneuverNeedsLaneGuidance(step.maneuverType)) {
      return false;
    }
    // Use a wider look-ahead threshold on highways so the driver has more
    // time to position correctly before a high-speed exit or merge.
    final double threshold = step.isHighwayManeuver ? 1.2 : 0.8;
    return step.distanceMiles <= threshold;
  }

  /// Updates the upcoming-maneuver state and triggers a UI rebuild.
  ///
  /// Call this whenever the navigation engine advances to a new route step or
  /// reports a fresh distance-to-maneuver measurement so that
  /// [_shouldShowLaneGuidance] always operates on current data.
  ///
  /// [lanes] may be supplied directly from the route SDK; when omitted or
  /// empty the method falls back to a four-lane sample array so the panel
  /// always has data to display.
  void _updateUpcomingManeuver({
    required String? maneuverType,
    required double distanceMiles,
    bool isHighwayManeuver = false,
    String? roadName,
    List<LaneInfo>? lanes,
  }) {
    // Fall back to sample lane data when the SDK does not provide lane info.
    final List<LaneInfo> resolvedLanes =
        (lanes != null && lanes.isNotEmpty)
            ? lanes
            : const [
                LaneInfo(directions: [LaneDirection.left],       isRecommended: false),
                LaneInfo(directions: [LaneDirection.straight],   isRecommended: true),
                LaneInfo(directions: [LaneDirection.straight],   isRecommended: true),
                LaneInfo(directions: [LaneDirection.right],      isRecommended: false),
              ];
    setState(() {
      _nextManeuverType              = maneuverType;
      _distanceToNextManeuverMiles   = distanceMiles;
      _isHighwayManeuver             = isHighwayManeuver;
      _upcomingManeuverStep = UpcomingManeuverStep(
        maneuverType:       maneuverType,
        distanceMiles:      distanceMiles,
        isHighwayManeuver:  isHighwayManeuver,
        roadName:           roadName,
        lanes:              resolvedLanes,
      );
    });
  }

  // ── Dynamic lane guidance helpers ─────────────────────────────────────────

  // ── Top instruction card helpers ─────────────────────────────────────────

  /// Maps a [ManeuverVisualType] to the best matching [IconData].
  ///
  /// Used by [_buildCompactTopInstructionCard] to render the maneuver icon.
  IconData _maneuverVisualIcon(ManeuverVisualType type) {
    switch (type) {
      case ManeuverVisualType.straight:    return Icons.arrow_upward;
      case ManeuverVisualType.left:        return Icons.turn_left;
      case ManeuverVisualType.slightLeft:  return Icons.turn_slight_left;
      case ManeuverVisualType.right:       return Icons.turn_right;
      case ManeuverVisualType.slightRight: return Icons.turn_slight_right;
      case ManeuverVisualType.uTurnLeft:   return Icons.u_turn_left;
      case ManeuverVisualType.uTurnRight:  return Icons.u_turn_right;
      case ManeuverVisualType.merge:       return Icons.merge;
      case ManeuverVisualType.exit:        return Icons.exit_to_app;
      case ManeuverVisualType.forkLeft:
        // call_split is used for both fork directions; the left/right
        // distinction is communicated by the primary text label.
        return Icons.call_split;
      case ManeuverVisualType.forkRight:
        return Icons.call_split;
      case ManeuverVisualType.roundabout:  return Icons.roundabout_left;
    }
  }

  /// Formats [miles] into a human-readable distance string for the top card.
  ///
  /// Distances below 1 mile are shown in feet; all others in miles with one
  /// decimal place.  (This differs from [_formatDistanceMiles] which accepts
  /// metres.)
  String _formatMilesDisplay(double miles) {
    if (miles >= 1) return '${miles.toStringAsFixed(1)} mi';
    final feet = miles * 5280;
    return '${feet.round()} ft';
  }

  /// Returns true when [name] is not a usable road name (null, empty, or
  /// the generic "Unnamed road" placeholder that Mapbox sometimes emits).
  bool _isBadRoadName(String? name) {
    if (name == null) return true;
    final t = name.trim().toLowerCase();
    return t.isEmpty || t == 'unnamed road';
  }

  /// Returns the best road name to display given several candidates, or an
  /// empty string when none of the candidates is usable.
  ///
  /// Priority order: [roadName] → [nextRoadName] → [currentRoadName] →
  /// [highwayName].
  String _resolveDisplayRoadName({
    String? roadName,
    String? nextRoadName,
    String? currentRoadName,
    String? highwayName,
  }) {
    if (!_isBadRoadName(roadName))        return roadName!.trim();
    if (!_isBadRoadName(nextRoadName))    return nextRoadName!.trim();
    if (!_isBadRoadName(currentRoadName)) return currentRoadName!.trim();
    if (!_isBadRoadName(highwayName))     return highwayName!.trim();
    return '';
  }

  /// Returns the short action-verb phrase for [maneuverType] + [modifier].
  ///
  /// For example: ("turn", "left") → "Turn left onto",
  ///              ("merge", null) → "Merge onto".
  String _buildPrimaryInstructionText(String? maneuverType, String? modifier) {
    final type = (maneuverType ?? '').toLowerCase();
    final mod  = (modifier   ?? '').toLowerCase();

    if (type == 'depart') return 'Head out';
    if (type == 'continue' || type == 'new name') return 'Continue on';
    if (type == 'merge') return 'Merge onto';
    if (type == 'fork') {
      return mod.contains('left') ? 'Keep left for' : 'Keep right for';
    }
    if (type == 'off ramp' || type == 'exit') return 'Take exit to';
    if (type == 'on ramp'  || type == 'ramp') return 'Take ramp to';
    if (type == 'roundabout') return 'Enter roundabout for';
    if (type == 'turn') {
      if (mod.contains('slight left'))  return 'Bear left onto';
      if (mod.contains('slight right')) return 'Bear right onto';
      if (mod.contains('left'))         return 'Turn left onto';
      if (mod.contains('right'))        return 'Turn right onto';
    }
    return 'Continue ahead';
  }

  /// Maps a Mapbox maneuver type + modifier pair to a [ManeuverVisualType].
  ///
  /// Covers all common Mapbox maneuver type strings and falls back to
  /// [ManeuverVisualType.straight] for unknown combinations.
  ManeuverVisualType _mapStepToVisualType(
      String? maneuverType, String? modifier) {
    final type = (maneuverType ?? '').toLowerCase();
    final mod  = (modifier     ?? '').toLowerCase();

    if (type == 'merge') return ManeuverVisualType.merge;
    if (type == 'exit' || type == 'off ramp') return ManeuverVisualType.exit;
    if (type == 'roundabout') return ManeuverVisualType.roundabout;
    if (type == 'fork') {
      return mod.contains('left')
          ? ManeuverVisualType.forkLeft
          : ManeuverVisualType.forkRight;
    }
    if (type == 'turn') {
      if (mod.contains('uturn') && mod.contains('left'))  return ManeuverVisualType.uTurnLeft;
      if (mod.contains('uturn') && mod.contains('right')) return ManeuverVisualType.uTurnRight;
      if (mod.contains('slight left'))  return ManeuverVisualType.slightLeft;
      if (mod.contains('slight right')) return ManeuverVisualType.slightRight;
      if (mod.contains('left'))         return ManeuverVisualType.left;
      if (mod.contains('right'))        return ManeuverVisualType.right;
    }
    return ManeuverVisualType.straight;
  }

  /// Updates [_topInstructionData] from the current navigation step values
  /// and triggers a UI rebuild.
  ///
  /// Call this whenever the route advances to a new step (see
  /// [_checkStepAdvancement]) or navigation starts so the top card always
  /// reflects the upcoming maneuver.
  ///
  /// Supply real SDK values for [maneuverType], [modifier], [roadName], and
  /// [distanceMiles].  The optional [currentRoadName], [nextRoadName], and
  /// [highwayName] parameters feed [_resolveDisplayRoadName] so the card
  /// never falls back to "Unnamed road".
  void _updateTopInstructionFromNavigationStep({
    required String? maneuverType,
    required String? modifier,
    required String? roadName,
    required double distanceMiles,
    String? currentRoadName,
    String? nextRoadName,
    String? highwayName,
  }) {
    final displayRoadName = _resolveDisplayRoadName(
      roadName:        roadName,
      nextRoadName:    nextRoadName,
      currentRoadName: currentRoadName,
      highwayName:     highwayName,
    );

    final primary = _buildPrimaryInstructionText(maneuverType, modifier);

    setState(() {
      _topInstructionData = TopInstructionData(
        visualType:     _mapStepToVisualType(maneuverType, modifier),
        primaryText:    primary,
        roadName:       displayRoadName.isEmpty ? primary : displayRoadName,
        distanceMiles:  distanceMiles,
        bottomChipText: displayRoadName.isEmpty ? null : displayRoadName,
        shieldText: _extractHighwayShield(displayRoadName.isEmpty ? (roadName ?? '') : displayRoadName),
      );

      // Populate secondary "Then" card from the next navigation step.
      final nextIdx = _currentStepIndex + 1;
      if (nextIdx < _navSteps.length) {
        final next = _navSteps[nextIdx];
        final nextRoad = next.name.isNotEmpty ? next.name : next.instruction;
        _secondaryInstructionData = TopInstructionData(
          visualType:    _mapStepToVisualType(next.type, next.maneuver),
          primaryText:   next.instruction,
          roadName:      nextRoad,
          distanceMiles: next.distanceMeters / _metersPerMile,
          shieldText:    _extractHighwayShield(nextRoad),
        );
      } else {
        _secondaryInstructionData = null;
      }
    });
  }

  /// Maps a [LaneDirection] value to the [IconData] that best represents it.
  IconData _laneDirectionIcon(LaneDirection direction) {
    switch (direction) {
      case LaneDirection.left:        return Icons.turn_left;
      case LaneDirection.slightLeft:  return Icons.turn_slight_left;
      case LaneDirection.straight:    return Icons.straight;
      case LaneDirection.slightRight: return Icons.turn_slight_right;
      case LaneDirection.right:       return Icons.turn_right;
      case LaneDirection.uTurn:       return Icons.u_turn_left;
    }
  }

  /// Builds a single lane tile for the dynamic lane guidance panel.
  ///
  /// Recommended lanes ([LaneInfo.isRecommended] == true) receive a blue
  /// background and a white border so they stand out immediately; non-
  /// recommended lanes use a dark-grey background.
  Widget _buildLaneBox(LaneInfo lane) {
    const Color recommendedColor = Color(0xFF1565C0); // blue 800
    const Color normalColor      = Color(0xFF37474F); // blue-grey 800
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 4),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: lane.isRecommended ? recommendedColor : normalColor,
        borderRadius: BorderRadius.circular(10),
        border: lane.isRecommended
            ? Border.all(color: Colors.blueAccent, width: 2)
            : Border.all(color: Colors.white24, width: 1),
        boxShadow: lane.isRecommended
            ? [
                BoxShadow(
                  color: Colors.blue.withOpacity(0.4),
                  blurRadius: 8,
                  spreadRadius: 1,
                ),
              ]
            : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: lane.directions
            .map((d) => Icon(_laneDirectionIcon(d), color: Colors.white, size: 26))
            .toList(),
      ),
    );
  }

  /// Builds the complete dynamic lane guidance panel for [step].
  ///
  /// Renders one [_buildLaneBox] per lane inside a pill-shaped dark container.
  /// Returns [SizedBox.shrink] when the step carries no lane data.
  Widget _buildDynamicLaneAssist(UpcomingManeuverStep step) {
    if (step.lanes.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.85),
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
            color: Colors.black45,
            blurRadius: 10,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: step.lanes.map(_buildLaneBox).toList(),
      ),
    );
  }

  // ── Lane guidance panel ────────────────────────────────────────────────────

  /// Builds the GPS-style lane guidance panel shown during active navigation.
  ///
  /// The panel is centred just below the compact next-step card (top: 118)
  /// and wrapped in an [AnimatedSwitcher] so it fades in and out smoothly.
  ///
  /// Visibility is controlled entirely by [_shouldShowLaneGuidance]: lane
  /// guidance is shown only when:
  ///  - Navigation is active ([_isNavigating] == true).
  ///  - The upcoming maneuver type requires lane awareness.
  ///  - The driver is within the distance threshold for that maneuver type.
  ///
  /// Returns [SizedBox.shrink] at zero cost when not navigating or when the
  /// maneuver/distance conditions are not met.
  Widget _buildLaneGuidance() {
    if (!_isNavigating) return const SizedBox.shrink();

    final bool visible = _shouldShowLaneGuidance(_upcomingManeuverStep);

    return Positioned(
      // top: 118 positions lane guidance below the compact next-step card
      // (~90 px tall) with a small gap, keeping it clear of the top nav card.
      top: 118,
      left: 0,
      right: 0,
      child: Center(
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 250),
          // Use a fade transition for a polished appearance/disappearance.
          transitionBuilder: (child, animation) =>
              FadeTransition(opacity: animation, child: child),
          child: (visible && _upcomingManeuverStep != null)
              ? SafeArea(
                  bottom: false,
                  key: const ValueKey('laneGuidanceOn'),
                  child: _buildDynamicLaneAssist(_upcomingManeuverStep!),
                )
              : const SizedBox.shrink(key: ValueKey('laneGuidanceOff')),
        ),
      ),
    );
  }

  // ── Floating Dashboard Panel ───────────────────────────────────────────────

  /// Builds the collapsible floating dashboard panel shown in the idle/planning
  /// state (no destination selected, no route loaded, not navigating).
  ///
  /// Collapsed: shows a destination-hint prompt and HOS drive-time remaining
  /// with an expand chevron.
  /// Expanded: also shows HOS and Fuel summary cards plus quick-action chips.
  ///
  /// Hidden during active navigation ([_isNavigating] == true) so the driver's
  /// view is not cluttered during a live trip.
  Widget _buildFloatingDashboard() {
    final driveMinLeft =
        (_intelligence['driveMinutesLeft'] as num?)?.toInt() ?? 0;
    final hosH = driveMinLeft ~/ 60;
    final hosM = driveMinLeft % 60;
    final hosLabel = hosH > 0 ? '${hosH}h ${hosM}m' : '${hosM}m';

    return Positioned(
      left: 16,
      right: 16,
      bottom: 16,
      child: SafeArea(
        top: false,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.97),
            borderRadius: BorderRadius.circular(28),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.13),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // ── Header row: hint text + chevron ──────────────────────────
              GestureDetector(
                onTap: () =>
                    setState(() => _panelExpanded = !_panelExpanded),
                child: Row(
                  children: [
                    const Icon(Icons.map_outlined,
                        size: 22, color: Color(0xFF6C52A6)),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Text(
                        'Search or long-press map to set destination',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: Colors.black87,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Icon(
                      _panelExpanded
                          ? Icons.keyboard_arrow_down
                          : Icons.keyboard_arrow_up,
                      size: 26,
                      color: Colors.black54,
                    ),
                  ],
                ),
              ),
              // ── Summary row: HOS remaining ────────────────────────────────
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.access_time_outlined,
                      size: 16, color: Colors.black54),
                  const SizedBox(width: 4),
                  Text(
                    'HOS: $hosLabel remaining',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: Colors.black54,
                    ),
                  ),
                ],
              ),
              // ── Expanded section: cards + quick actions ───────────────────
              if (_panelExpanded) ...[
                const SizedBox(height: 18),
                Row(
                  children: [
                    Expanded(
                      child: _dashboardInfoCard(
                        title: 'HOS',
                        value: hosLabel,
                        subtitle: 'Drive time left',
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _dashboardInfoCard(
                        title: 'Fuel',
                        value: '--',
                        subtitle: 'Connect ELD for data',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Text(
                  'Quick Actions',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: Colors.black.withOpacity(0.85),
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _dashboardActionChip(Icons.search, 'New Trip'),
                    _dashboardActionChip(
                        Icons.bookmark_outline, 'Saved Trips'),
                    _dashboardActionChip(
                        Icons.description_outlined, 'Documents'),
                    _dashboardActionChip(Icons.star_border, 'Favorites'),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// Builds a compact summary card used inside [_buildFloatingDashboard].
  Widget _dashboardInfoCard({
    required String title,
    required String value,
    required String subtitle,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF5F2FA),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: Colors.black87,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: Colors.black87,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: const TextStyle(
              fontSize: 12,
              color: Colors.black54,
            ),
          ),
        ],
      ),
    );
  }

  /// Builds a quick-action chip used inside [_buildFloatingDashboard].
  ///
  /// Tapping the chip provides ink-splash feedback.  The [onTap] callback
  /// is optional; when omitted the chip is still visually interactive.
  Widget _dashboardActionChip(IconData icon, String label,
      {VoidCallback? onTap}) {
    return Material(
      color: const Color(0xFFF0E9F9),
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 18, color: const Color(0xFF6C52A6)),
              const SizedBox(width: 6),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF6C52A6),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  /// Builds the 2-closest-ahead truck stops row shown during active navigation.
  ///
  /// Returns [SizedBox.shrink] when not navigating or when the list is empty.
  /// Positioned just above the bottom trip strip so it is always visible.
  Widget _buildClosestTruckStopsRow() {
    if (!_isNavigating || _closestTruckStopsAhead.isEmpty) {
      return const SizedBox.shrink();
    }
    // When the weigh-station row is also visible, shift the truck-stop chips
    // above it so the two panels do not overlap.  The weigh-station panel
    // (header ~20 px + card ~70 px) sits at bottom: 86, placing its top edge
    // at ~176 px; adding an 8 px gap gives bottom: 184.  When there are no
    // weigh stations the chips sit just above the trip strip at bottom: 88.
    final double bottomOffset =
        _closestWeighStationsAhead.isNotEmpty
            ? _kTruckStopRowBottomWithWeighStations
            : _kTruckStopRowBottomDefault;
    return Positioned(
      left: 0,
      right: 0,
      bottom: bottomOffset,
      child: ClosestTruckStopsRow(stops: _closestTruckStopsAhead),
    );
  }

  /// Builds a GPS-style road name + distance info card shown during active
  /// navigation.  The card floats below the [RoadGuidanceBanner] and displays:
  ///   • An up-arrow icon for visual context.
  ///   • "Stay on" label + the current road name from the Mapbox step.
  ///   • Distance to the next maneuver in miles.
  ///   • The next road name in a compact chip below the distance.
  ///
  /// Only rendered when [_isNavigating] is true and [_navSteps] is non-empty.
  Widget _buildRoadInfoCard() {
    if (_navSteps.isEmpty) return const SizedBox.shrink();
    final safeIndex = _currentStepIndex.clamp(0, _navSteps.length - 1);
    final currentStep = _navSteps[safeIndex];
    final hasNextStep = safeIndex + 1 < _navSteps.length;
    final nextStep = hasNextStep ? _navSteps[safeIndex + 1] : null;

    final String currentRoad = currentStep.name.isNotEmpty
        ? currentStep.name
        : 'En Route';
    final String distanceLabel = _formatDistanceMiles(_distanceToNextStep());
    final String nextRoad = nextStep != null && nextStep.name.isNotEmpty
        ? nextStep.name
        : '';

    return Positioned(
      // Positioned below the RoadGuidanceBanner (~170 px tall) with a small gap.
      top: _kRoadInfoCardTopOffset,
      left: 16,
      right: 16,
      child: SafeArea(
        bottom: false,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.black.withOpacity(0.95),
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(
                color: Colors.black45,
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // ── Arrow icon ──────────────────────────────────────────────────
              Container(
                width: 50,
                height: 50,
                decoration: BoxDecoration(
                  color: Colors.white12,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.arrow_upward,
                  color: Colors.white,
                  size: 28,
                ),
              ),
              const SizedBox(width: 12),
              // ── Road + distance info ────────────────────────────────────────
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text(
                      'Stay on',
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: 2),
                    // Current road name
                    Text(
                      currentRoad,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    // Distance to next maneuver in miles
                    Text(
                      distanceLabel,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (nextRoad.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      // Next road chip
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white24,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Text(
                          nextRoad,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Mini alert row builder ─────────────────────────────────────────────────
  Widget _buildMiniAlertRow() {
    return Positioned(
      top: 110,
      left: 16,
      right: 16,
      child: MiniAlertRow(
        alerts: _navAlerts,
        onNext: () {
          // Cycle to next un-dismissed alert (future: scroll the main card).
        },
      ),
    );
  }

  // ── Main navigation alert card builder ────────────────────────────────────
  Widget _buildMainAlertCard() {
    final active = _navAlerts.where((a) => !a.isDismissed).toList();
    if (active.isEmpty) return const SizedBox.shrink();
    final primary = active.first;

    return Positioned(
      left: 16,
      right: 16,
      bottom: 110,
      child: MainNavigationAlertCard(
        alert: primary,
        tripInfo: _tripProgressInfo,
        // Live GPS speed and limit from _TruckMapScreenState.
        // _currentSpeedMps is set by _onGpsPosition on every GPS fix;
        // _speedLimitMph is derived from the active route segment.
        // Passing them as parameters keeps MainNavigationAlertCard stateless
        // and testable without a real GPS stream.
        currentSpeedMps: _currentSpeedMps,
        speedLimitMph: _speedLimitMph,
        onDismiss: () {
          setState(() {
            final idx = _navAlerts.indexWhere((a) => a.id == primary.id);
            if (idx != -1) {
              _navAlerts[idx] = _navAlerts[idx].copyWith(isDismissed: true);
            }
          });
        },
        onToggleExpand: () {
          setState(() {
            final idx = _navAlerts.indexWhere((a) => a.id == primary.id);
            if (idx != -1) {
              _navAlerts[idx] = _navAlerts[idx]
                  .copyWith(isExpanded: !_navAlerts[idx].isExpanded);
            }
          });
        },
      ),
    );
  }

  /// Builds the custom wind advisory card shown at the bottom of the map
  /// during active navigation.
  ///
  /// Returns a plain [Container] (not [Positioned]); the caller wraps it in
  /// a [Positioned] at `left: 16, right: 110, bottom: 92`.  The card is only
  /// shown when [_isNavigating] is true and [_showWindAlert] is true.
  Widget _buildWindAlert() {
    final accent = const Color(0xFFFF7A00);

    return Container(
      height: 84,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.84),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: accent.withOpacity(0.9),
          width: 1.3,
        ),
        boxShadow: [
          BoxShadow(
            color: accent.withOpacity(0.14),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
          BoxShadow(
            color: Colors.black.withOpacity(0.18),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: accent.withOpacity(0.14),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.air,
              color: accent,
              size: 22,
            ),
          ),
          const SizedBox(width: 10),
          const Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Wind Advisory',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                SizedBox(height: 4),
                Text(
                  'Gusts up to 60 mph',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white70,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: accent.withOpacity(0.16),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              _formatChipDistance(12.0),
              style: TextStyle(
                color: accent,
                fontSize: 13,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: () {
              setState(() {
                _showWindAlert = false;
              });
            },
            child: Container(
              width: 30,
              height: 30,
              decoration: const BoxDecoration(
                color: Colors.white10,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.close,
                color: Colors.white70,
                size: 18,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Builds the "Stop Navigation" button overlay shown only while [_isNavigating].
  ///
  /// Provides a full-width, pill-shaped "Stop Navigation" button so the driver
  /// can end the active trip and return to the planning UI.  Positioned at the
  /// bottom of the screen with SafeArea padding to remain accessible on all
  /// devices.
  Widget _buildStopButton() {
    return Container(
      height: 52,
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.86),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(
          color: const Color(0xFFD94A4A).withOpacity(0.9),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.18),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(26),
          onTap: _stopNavigation,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                const Icon(
                  Icons.stop_circle_outlined,
                  color: Color(0xFFD94A4A),
                  size: 22,
                ),
                const SizedBox(width: 10),
                const Expanded(
                  child: Text(
                    'Stop Navigation',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(width: 22),
              ],
            ),
          ),
        ),
      ),
    );
  }

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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      // AppBar is hidden during active navigation so the full screen is used
      // for the map and turn-by-turn components.
      appBar: _isNavigating ? null : AppBar(
        // Show destination name in the title when one is selected.
        title: _selectedDestinationName != null
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('Semitrack NEW',
                      style: TextStyle(fontSize: 14, color: Colors.white70)),
                  Text(
                    _selectedDestinationName!,
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.bold),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              )
            : const Text('Semitrack NEW'),
        actions: [
          // ── Destination search button ──────────────────────────────────
          // Opens the geocoding search sheet so the driver can type a
          // destination address or place name before starting navigation.
          IconButton(
            tooltip: 'Search destination',
            icon: const Icon(Icons.search),
            onPressed: _showDestinationSearch,
          ),
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
                      // Switch to navigation mode: zoom close to truck and
                      // re-engage camera follow.
                      _onRecenterPressed();
                    } else if (!_navigationMode && _routePoints.isNotEmpty && _mapReady) {
                      // Switch to overview mode: fit the full route.
                      _setOverviewCamera();
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
                    initialCenter: _truckPosition ?? const LatLng(39.5, -98.35),
                    initialZoom: 6,
                    onMapReady: () {
                      _mapReady = true;
                      // Do NOT auto-start a route here.  Navigation only begins
                      // after the user picks a destination and taps "Start Route".
                    },
                    // Long-press on map sets the tapped coordinate as the new
                    // destination and immediately starts routing.
                    onLongPress: (tapPosition, point) {
                      _onMapLongPress(point);
                    },
                    // Gesture detection: switch to free mode when the user
                    // manually interacts with the map (drag / pinch / rotate).
                    // Auto-return to follow mode after 8 s of idle.
                    onMapEvent: (MapEvent event) {
                      if (event.source != MapEventSource.mapController) {
                        if (event is MapEventMoveStart) {
                          _onMapGestureStarted();
                        } else if (event is MapEventMoveEnd) {
                          _onMapGestureEnded();
                        } else if (event is MapEventScrollWheelZoom) {
                          // Scroll wheel has no separate start event, so
                          // switch to free mode and reset the idle timer.
                          _onMapGestureStarted();
                          _onMapGestureEnded();
                        }
                      }
                    },
                  ),
                  children: [
                    TileLayer(
                      // When a MAPBOX_TOKEN is provided (via --dart-define),
                      // use Mapbox Streets or Satellite tiles depending on
                      // _isSatelliteView. Restrict the token to your app's
                      // bundle ID in the Mapbox dashboard to limit its
                      // exposure. Falls back to OpenStreetMap otherwise.
                      urlTemplate: _mapboxToken.isNotEmpty
                          ? _isSatelliteView
                              ? 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}'
                                  '?access_token=$_mapboxToken'
                              : 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}'
                                  '?access_token=$_mapboxToken'
                          : _isSatelliteView
                              ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                              : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.semitrack.mobile',
                    ),
                    PolylineLayer(
                      polylines: [
                        // ── Alternative routes (gray, behind selected) ──────
                        for (int i = 0; i < _routeOptions.length; i++)
                          if (i != _selectedRouteOptionIndex &&
                              _routeOptions[i].points.isNotEmpty)
                            Polyline(
                              points: _routeOptions[i].points,
                              strokeWidth: 6,
                              color: Colors.grey.shade400,
                              strokeJoin: StrokeJoin.round,
                              strokeCap: StrokeCap.round,
                            ),
                        // ── Selected route: outline + bright blue active line ──
                        if (_routePoints.isNotEmpty)
                          Polyline(
                            points: _routePoints,
                            strokeWidth: 16,
                            color: Colors.white.withOpacity(0.3),
                            strokeJoin: StrokeJoin.round,
                            strokeCap: StrokeCap.round,
                          ),
                        if (_routePoints.isNotEmpty)
                          Polyline(
                            points: _routePoints,
                            strokeWidth: 13,
                            color: const Color(0xFF1E90FF),
                            strokeJoin: StrokeJoin.round,
                            strokeCap: StrokeCap.round,
                          ),
                        // ── Restriction overlays on selected route (red) ────
                        for (final seg in _buildRestrictionSegments(_routePoints))
                          Polyline(
                            points: seg,
                            strokeWidth: 11,
                            color: Colors.red.withOpacity(0.85),
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
                // ── Navigation banner ─────────────────────────────────────
                // Shown in route-preview / arrival state (not during active
                // turn-by-turn navigation – the compact next-step card takes
                // that role to keep the top zone minimal).
                if (!_isNavigating && (_hasActiveDestination || _isArrived) && _navSteps.isNotEmpty)
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    child: _buildNavBanner(),
                  ),
                // ── Lane guidance panel ───────────────────────────────────
                // GPS-style lane indicator tiles shown below the navigation
                // banner during active navigation.  Returns SizedBox.shrink()
                // when not navigating, so it is zero-cost outside nav mode.
                _buildLaneGuidance(),
                // ── Inline search bar ─────────────────────────────────────
                // Hidden during active turn-by-turn navigation so it does not
                // overlap the navigation banner.  Visible at all other times
                // so the driver can search a destination without opening a
                // modal sheet.
                if (!_isNavigating && !_hasActiveDestination && !_isArrived)
                  _buildSearchBar(),
                // ── Search results overlay ────────────────────────────────
                // _buildSearchResults returns SizedBox.shrink() when there is
                // nothing to show, so the condition here is simply the same
                // guard used for the search bar itself.
                if (!_isNavigating && !_hasActiveDestination && !_isArrived)
                  _buildSearchResults(),
                // ── Floating dashboard panel ───────────────────────────────
                // Shown in the idle state (no destination selected, no route,
                // not navigating) as a collapsible planning and status panel.
                // Hidden once the driver picks a destination, starts a route,
                // or begins active navigation so it never overlaps planning UI.
                if (!_isNavigating &&
                    !_isArrived &&
                    !_isLoading &&
                    _routePoints.isEmpty &&
                    _selectedDestination == null)
                  _buildFloatingDashboard(),
                // ── Destination hint banner ───────────────────────────────
                // Shown when no destination is selected and no route is loaded,
                // prompting the driver to pick a destination to start navigation.
                if (_selectedDestination == null && !_hasActiveDestination && !_isLoading)
                  Positioned(
                    bottom: 80,
                    left: 16,
                    right: 16,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 10),
                      decoration: BoxDecoration(
                        color: Colors.black87,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.touch_app, color: Colors.white70, size: 18),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Long-press map or use search bar to set destination',
                              style: TextStyle(
                                  color: Colors.white, fontSize: 13),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                // ── Start Route button ─────────────────────────────────────
                // Shown when a destination has been selected (via search or
                // long-press) but no route has been built yet.
                // Gives the driver an explicit confirmation step before routing begins.
                if (_selectedDestination != null &&
                    !_hasActiveDestination &&
                    !_isLoading &&
                    _routePoints.isEmpty)
                  _buildStartRouteButton(),
                // ── Preview bottom panel ────────────────────────────────────
                // Shown while the route is built but navigation has not yet
                // started.  Includes route alternatives cards, route stats
                // summary, and the Start Navigation / Optimize buttons.
                // ── Planning UI: hidden once navigation starts ─────────────
                // Preview bottom panel + map legend are only shown in the
                // route-preview state (_isNavigating == false).
                if (_routePoints.isNotEmpty &&
                    !_isNavigating &&
                    !_isLoading)
                  _buildPreviewBottomPanel(),
                if (_routePoints.isNotEmpty && !_isNavigating && !_isLoading)
                  _buildMapLegend(),
                // ── Restriction ahead alert card ──────────────────────────
                // Shown just below the nav banner when the truck is within
                // 800 m of a restriction it violates, providing a prominent
                // in-route warning with type icon and limit details.
                // Only rendered during an active navigation session.
                if (_hasActiveDestination && _restrictionAhead != null)
                  Positioned(
                    // Compact top nav card is ~90 px; use a consistent offset
                    // whether navigating or in preview mode.
                    top: _isNavigating ? 100 : (_navSteps.isNotEmpty ? 90 : 68),
                    left: 0,
                    right: 0,
                    child: _buildRestrictionAlertCard(),
                  ),
                // ── Warning popup stack ───────────────────────────────────
                // Stacked top-right cards for road-hazard warning signs along
                // the active route.  Only visible during active navigation.
                // Positioned at top:220 on the right so it does not conflict
                // with the compact right-side alert stack (top:120).
                if (_isNavigating)
                  Positioned(
                    top: 220,
                    right: 8,
                    child: WarningPopupStack(manager: _warningManager),
                  ),
                // ── Warning sign alert banner ─────────────────────────────
                // Shown when a truck safety warning sign is within
                // _warningAlertRadiusMeters of the truck's position on the
                // active route.  Colour-coded by severity (red/orange/blue).
                if (_hasActiveDestination && _warningAhead != null)
                  Positioned(
                    top: () {
                      int offset = _isNavigating
                          ? 100
                          : (_navSteps.isNotEmpty ? 90 : 68);
                      if (_restrictionAhead != null) offset += 64;
                      return offset.toDouble();
                    }(),
                    left: 0,
                    right: 0,
                    child: _buildWarningAlertBanner(),
                  ),
                // ── Active leg card ───────────────────────────────────────
                // Shows the current leg (from → to, miles, duration,
                // restriction count) when navigating a multi-stop trip.
                _buildCurrentLegCard(),
                // ── Leg breakdown FAB ─────────────────────────────────────
                // Opens the full trip leg breakdown sheet during navigation.
                _buildLegBreakdownButton(),
                // ── Smart restriction rerouting progress banner ───────────
                // Shown as an overlay at the top of the map while an
                // automatic avoid-restriction reroute is in progress.
                if (_hasActiveDestination && _isRestrictionRerouting)
                  _buildRestrictionRerouteBanner(),
                // ── Recenter FAB ──────────────────────────────────────────
                // Always visible in the bottom-right corner.
                // Icon and tooltip change based on follow state:
                //   navigation  = camera is actively following the truck
                //   my_location = user has panned away; tap to re-centre
                // Tapping re-enables camera follow (recenter).
                // Long-pressing switches to overview mode (full-route view).
                Positioned(
                  bottom: 16,
                  right: 16,
                  child: GestureDetector(
                    onLongPress: _setOverviewCamera,
                    child: FloatingActionButton.small(
                      tooltip: _followTruck ? 'Following truck' : 'Recenter on truck',
                      onPressed: _onRecenterPressed,
                      child: Icon(
                        _cameraMode == NavigationCameraMode.overview
                            ? Icons.map_outlined
                            : _followTruck
                                ? Icons.navigation
                                : Icons.my_location,
                      ),
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
                // once navigation has started with an active destination so the
                // panel never appears in plain GPS-tracking mode.
                // Hidden during active navigation so the map is unobstructed.
                if (!_isNavigating && _hasActiveDestination && _tripStartTime != null)
                  _buildTripStatsPanel(),
                // ── POI toggle FAB ────────────────────────────────────────
                // Hidden during navigation so the Stop Navigation button can
                // occupy the same bottom-left slot without overlap.
                if (!_isNavigating)
                  Positioned(
                    bottom: 24,
                    left: 16,
                    child: FloatingActionButton.small(
                      heroTag: 'poi_toggle',
                      tooltip: _showTruckStops
                          ? 'Hide truck stops'
                          : 'Show truck stops',
                      backgroundColor: _showTruckStops
                          ? Colors.blue.shade700
                          : Colors.grey.shade700,
                      onPressed: () {
                        setState(() => _showTruckStops = !_showTruckStops);
                      },
                      child: Icon(
                        _showTruckStops
                            ? Icons.local_gas_station
                            : Icons.local_gas_station_outlined,
                        color: Colors.white,
                      ),
                    ),
                  ),
                // ── Zone 1 (top-left): primary maneuver card ──────────────
                // GPS-style dark card: maneuver icon, distance, highway shield
                // pill (if applicable), and road name.
                if (_isNavigating && _topInstructionData != null)
                  Positioned(
                    top: 16,
                    left: 16,
                    child: SafeArea(
                      bottom: false,
                      child: _buildPrimaryManeuverCard(_topInstructionData!),
                    ),
                  ),
                // ── Zone 1b (top-left, below primary): "Then" card ────────
                // Small secondary chip showing the step after the current one.
                if (_isNavigating && _secondaryInstructionData != null)
                  Positioned(
                    top: 112,
                    left: 16,
                    child: SafeArea(
                      bottom: false,
                      child: _buildSecondaryThenCard(_secondaryInstructionData!),
                    ),
                  ),
                // ── Zone 1a (top-right): compass / re-centre button ────────
                // Round dark button at the top-right corner.
                _buildSmallCompassButton(),
                // ── Zone 1c (top-right, below compass): satellite toggle ───
                // Toggles between street and satellite tile layers.
                _buildSatelliteToggle(),
                // ── Zone 3 (right side): alert stack (hidden during nav) ───
                // Hidden during active navigation to keep overlays minimal.
                if (!_isNavigating) _buildRightSideAlertStack(),
                // ── Zone 3a (top-right): upcoming route alert chips ────────
                // Hidden during active navigation to keep overlays minimal.
                if (!_isNavigating) _buildRightSideUpcomingAlerts(),
                // ── Zone 4 (bottom center-right): compact speed panel ──────
                // Compact dark speed indicator using truck speed limit.
                if (_isNavigating)
                  Positioned(
                    right: 120,
                    bottom: 18,
                    child: SafeArea(
                      top: false,
                      child: _buildCompactSpeedPanel(),
                    ),
                  ),
                // ── Zone 5b (bottom-center): closest truck stops ahead ────
                // Horizontally scrollable row showing up to 2 upcoming truck
                // stops on the active route with their icon, brand name, and
                // distance from the driver.  The first stop shows an
                // "Approaching" badge when it is within 3 miles.
                // Positioned just above the bottom trip strip.
                _buildClosestTruckStopsRow(),
                // ── Zone 5 (bottom-left): trip summary strip ──────────────
                // Dark translucent card with remaining mi, time, ETA,
                // More button, and compact Stop icon.
                if (_isNavigating)
                  Positioned(
                    left: 16,
                    bottom: 18,
                    child: SafeArea(
                      top: false,
                      child: _buildBottomTripStrip(),
                    ),
                  ),
                // ── Zone 6 (bottom, above strip): next weigh station ──────
                // Chip showing the single closest upcoming weigh station with
                // its icon and miles to go.  Automatically advances to the
                // next station once the driver passes the current one.
                // Only visible during active navigation when a station exists.
                _buildClosestWeighStationsRow(),
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
          // Hidden during active navigation (_isNavigating) so Route Summary,
          // Drive Intelligence, and other planning cards do not block the map.
          if (!_isNavigating && (_hasActiveDestination || _isArrived) && _routeData != null)
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

        // ── Route Restriction Violations ─────────────────────────────
        // Populated by _updateRouteViolationWarnings() after the route loads.
        // Shows low-bridge / weight-limit warnings encountered on the route.
        if (_routeViolations.isNotEmpty)
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            color: Colors.red.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(
                    children: [
                      Icon(Icons.report_problem, color: Colors.red, size: 20),
                      SizedBox(width: 8),
                      Text(
                        'Route Restrictions',
                        style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                            color: Colors.red),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  for (final v in _routeViolations)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.error_outline,
                              size: 16, color: Colors.red),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              v,
                              style: const TextStyle(fontSize: 14),
                            ),
                          ),
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

  // ── Compact navigation overlay widgets ────────────────────────────────────
  //
  // The ten methods below provide production-quality, GPS-style overlay
  // widgets for TruckMapScreen.  They are intentionally part of
  // _TruckMapScreenState so they can read live state fields directly without
  // requiring extra wiring.
  //
  // ⚠️  DEVELOPER NOTE — REPLACE STATIC DEMO DATA BEFORE SHIPPING:
  //   Several values are hard-coded for demo/preview purposes.  Search for
  //   the string "TODO(live-data)" in this file to find every location where
  //   a static value should be replaced with a live data source.
  //   For example:
  //     • Next-step distance  → derive from _distanceToNextStep() / _navSteps
  //     • Trip ETA / arrival  → compute from _tripProgressInfo
  //     • Speed limit         → read _speedLimitMph
  //     • Service chips list  → populate from _closestTruckStopsAhead
  //     • Alert list          → populate from _navAlerts

  // ── GPS-style navigation overlay widgets ────────────────────────────────────

  /// Extracts a short highway shield label from [roadName] if it matches a
  /// known highway pattern (e.g. "I-5" → "5", "US-95" → "95", "CA-88" → "88").
  ///
  /// Returns `null` when [roadName] is not a recognisable highway reference.
  ///
  /// To support additional state/country prefixes, extend the alternation in
  /// the pattern (e.g. add `|TX-|NY-`).
  String? _extractHighwayShield(String roadName) {
    // Supported prefixes: Interstate (I-), US routes (US-), and common state
    // highway abbreviations.  Add more prefixes here as needed.
    final r = RegExp(
        r'^(?:I-|US-|CA-|SR-|OR-|WA-|NV-|AZ-|TX-|FL-|Hwy\s*)(\d{1,3}[A-Z]?)$',
        caseSensitive: false);
    final m = r.firstMatch(roadName.trim());
    return m?.group(1);
  }

  /// Compact GPS-style primary maneuver card shown at the top-left of the map
  /// during active navigation.
  ///
  /// Displays:
  ///  • Maneuver direction icon tile.
  ///  • Distance to the next maneuver in large bold text.
  ///  • Green highway-shield pill when a shield label is available.
  ///  • Upcoming road name.
  Widget _buildPrimaryManeuverCard(TopInstructionData data) {
    final String? shield = data.shieldText ?? _extractHighwayShield(data.roadName);
    return Container(
      width: 270,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.84),
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(color: Colors.black54, blurRadius: 12, offset: Offset(0, 4)),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // ── Maneuver icon ────────────────────────────────────────────────
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: Colors.white12,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              _maneuverVisualIcon(data.visualType),
              color: Colors.white,
              size: 28,
            ),
          ),
          const SizedBox(width: 10),
          // ── Distance + road info ──────────────────────────────────────
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                // Distance to maneuver — prominent
                Text(
                  _formatMilesDisplay(data.distanceMiles),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    height: 1,
                  ),
                ),
                const SizedBox(height: 4),
                // Highway shield pill + road name row
                Row(
                  children: [
                    if (shield != null) ...[
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1A7340),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          shield,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const SizedBox(width: 5),
                    ],
                    Expanded(
                      child: Text(
                        data.roadName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Small secondary "Then" chip shown below [_buildPrimaryManeuverCard].
  ///
  /// Displays a "Then" label, the next maneuver icon, and the road name for
  /// the step after the current upcoming turn.
  Widget _buildSecondaryThenCard(TopInstructionData data) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.78),
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(color: Colors.black38, blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text(
            'Then',
            style: TextStyle(color: Colors.white54, fontSize: 12),
          ),
          const SizedBox(width: 6),
          Icon(
            _maneuverVisualIcon(data.visualType),
            color: Colors.white70,
            size: 18,
          ),
          const SizedBox(width: 4),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 160),
            child: Text(
              data.roadName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Colors.white70, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }

  /// Dark GPS-style bottom trip strip shown at the bottom-left during
  /// active navigation.
  ///
  /// Displays remaining miles, estimated drive time, and ETA in a compact
  /// dark translucent card.  Includes a "More" button to open the full leg
  /// breakdown sheet and a compact Stop icon to end navigation.
  Widget _buildBottomTripStrip() {
    final double milesLeft = _tripProgressInfo.milesRemaining;
    final Duration timeLeft = _tripProgressInfo.durationRemaining;
    final DateTime eta = _tripProgressInfo.etaLocal;

    final String milesStr = milesLeft < 10
        ? milesLeft.toStringAsFixed(1)
        : milesLeft.round().toString();

    final int totalMinutes = timeLeft.inMinutes;
    final String timeStr = totalMinutes >= 60
        ? '${totalMinutes ~/ 60}h ${totalMinutes % 60}m'
        : '${totalMinutes}m';

    final int h = eta.hour % 12 == 0 ? 12 : eta.hour % 12;
    final String etaStr =
        '$h:${eta.minute.toString().padLeft(2, '0')} ${eta.hour < 12 ? 'AM' : 'PM'}';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.84),
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
              color: Colors.black54, blurRadius: 10, offset: Offset(0, 3)),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _gpsStatCell('$milesStr mi', 'remaining'),
          _gpsStripDivider(),
          _gpsStatCell(timeStr, 'drive time'),
          _gpsStripDivider(),
          _gpsStatCell(etaStr, 'ETA'),
          const SizedBox(width: 8),
          // ── More button ──────────────────────────────────────────────
          GestureDetector(
            onTap: _showLegBreakdownSheet,
            child: Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: Colors.white12,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(
                Icons.more_horiz,
                color: Colors.white70,
                size: 16,
              ),
            ),
          ),
          const SizedBox(width: 8),
          // ── Stop icon ────────────────────────────────────────────────
          GestureDetector(
            onTap: _stopNavigation,
            child: Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFFD94A4A).withOpacity(0.85),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(
                Icons.stop_circle_outlined,
                color: Colors.white,
                size: 18,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Single stat cell for [_buildBottomTripStrip].
  Widget _gpsStatCell(String value, String label) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 14,
            fontWeight: FontWeight.w700,
            height: 1,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: const TextStyle(
            color: Colors.white54,
            fontSize: 10,
          ),
        ),
      ],
    );
  }

  /// Thin vertical divider between stat cells in [_buildBottomTripStrip].
  Widget _gpsStripDivider() {
    return Container(
      width: 1,
      height: 24,
      margin: const EdgeInsets.symmetric(horizontal: 8),
      color: Colors.white24,
    );
  }

  /// Compact speed / speed-limit panel shown near the bottom center-right
  /// during active navigation.
  ///
  /// Uses [_getTruckSpeedLimit] to display and enforce the truck-specific
  /// speed limit (e.g. 55 mph in California).  Speed text turns red when
  /// the driver exceeds the truck limit.
  Widget _buildCompactSpeedPanel() {
    final double speedMph =
        _currentSpeedMps >= 0 ? _currentSpeedMps * _mpsToMph : 0.0;
    final double lat = _truckPosition?.latitude ?? 0.0;
    final double lng = _truckPosition?.longitude ?? 0.0;
    final double truckLimit = _getTruckSpeedLimit(_speedLimitMph, lat, lng);
    final bool isOver = _currentSpeedMps >= 0 && speedMph > truckLimit;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.84),
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(
              color: Colors.black45, blurRadius: 8, offset: Offset(0, 3)),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── Current speed ─────────────────────────────────────────────
          Text(
            speedMph.round().toString(),
            style: TextStyle(
              color: isOver ? Colors.red : Colors.white,
              fontSize: 32,
              fontWeight: FontWeight.w800,
              height: 1,
            ),
          ),
          const Text(
            'mph',
            style: TextStyle(color: Colors.white54, fontSize: 11),
          ),
          const SizedBox(height: 6),
          // ── Truck speed-limit badge ───────────────────────────────────
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'LIMIT',
                  style: TextStyle(
                    color: Colors.black87,
                    fontSize: 8,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.8,
                  ),
                ),
                Text(
                  truckLimit.round().toString(),
                  style: const TextStyle(
                    color: Colors.black,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    height: 1,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Top instruction card UI ───────────────────────────────────────────────

  /// Compact, data-driven top navigation instruction card.
  ///
  /// Displays:
  ///  • A rounded icon tile with the maneuver direction icon.
  ///  • A short primary action label (e.g. "Turn left onto").
  ///  • The upcoming road name in large bold text.
  ///  • The distance to the maneuver ("in 1.2 mi" / "in 350 ft").
  ///  • An optional bottom chip (defaults to the road name).
  ///
  /// Only called when [_topInstructionData] is non-null and
  /// [_isNavigating] is true (see the overlay in [build]).
  Widget _buildCompactTopInstructionCard(TopInstructionData data) {
    return Container(
      width: 270,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.7),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Maneuver icon tile ─────────────────────────────────────────
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: Colors.white12,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              _maneuverVisualIcon(data.visualType),
              color: Colors.white,
              size: 26,
            ),
          ),
          const SizedBox(width: 10),
          // ── Text column ─────────────────────────────────────────────────
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Short action label, e.g. "Turn left onto"
                Text(
                  data.primaryText,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 2),
                // Upcoming road name — large and bold for at-a-glance reading
                Text(
                  data.roadName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                // Distance countdown to maneuver
                Text(
                  'in ${_formatMilesDisplay(data.distanceMiles)}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Compact GPS-style "next step" card positioned at the top-left of the map.
  ///
  /// Shows the maneuver icon, the upcoming road name, and the distance to the
  /// next turn.  Only visible while [_isNavigating] is true and there are
  /// remaining steps.
  ///
  /// Replace the hard-coded distance label with a call to
  /// [_distanceToNextStep] and format it for the driver display.
  /// TODO(live-data): replace '0.4 mi' with formatted _distanceToNextStep().
  Widget _buildCompactNextStepCard() {
    // Only show during active navigation with available steps.
    if (!_isNavigating || _navSteps.isEmpty) return const SizedBox.shrink();

    // Clamp index to avoid out-of-bounds access on step list changes.
    final int safeIndex =
        _currentStepIndex.clamp(0, _navSteps.length - 1);
    final _NavStep step = _navSteps[safeIndex];

    // Format the distance-to-next-step in a human-readable string.
    // TODO(live-data): replace this static label with real-time distance.
    final double distMeters = _distanceToNextStep();
    final String distLabel = distMeters < 160
        ? '${distMeters.round()} ft'
        : '${(distMeters * 0.000621371).toStringAsFixed(1)} mi';

    return Positioned(
      // top: 16 gives a comfortable gap from the status-bar SafeArea edge.
      top: 16,
      // left: 16 matches standard horizontal screen margin.
      left: 16,
      // right: 90 leaves room for the 48 px compass button + 16 px margin + gap.
      right: 90,
      child: SafeArea(
        bottom: false,
        child: Container(
          margin: EdgeInsets.zero, // top offset handled by Positioned.top
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            // Dark translucent background for GPS-navigation aesthetics.
            color: Colors.black.withOpacity(0.82),
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
            children: [
              // ── Maneuver direction icon ────────────────────────────────
              Icon(
                _maneuverIcon(step.maneuver),
                color: Colors.white,
                size: 28,
              ),
              const SizedBox(width: 10),
              // ── Road name + distance ───────────────────────────────────
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Primary: upcoming road name (or instruction fallback).
                    Text(
                      step.name.isNotEmpty ? step.name : step.instruction,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: Colors.white,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    // Secondary: distance until the maneuver.
                    Text(
                      'in $distLabel',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: Colors.white.withOpacity(0.75),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Round, dark/translucent compass widget positioned at the top-right of the
  /// map, always visible.
  ///
  /// The compass needle rotates to reflect the current map heading: the red
  /// half of the needle always points north and the white half points south.
  ///
  /// Tapping the button re-centres the camera to north-up and re-engages the
  /// camera-follow mode so the driver never loses their position.
  Widget _buildSmallCompassButton() {
    // Current map bearing (degrees clockwise from north that is "up" on screen).
    final double bearing = _mapReady ? _mapController.camera.rotation : 0.0;

    return Positioned(
      // top: 18 vertically aligns the compass button with the top nav card.
      top: 18,
      // right: 16 matches standard horizontal screen margin.
      right: 16,
      child: SafeArea(
        bottom: false,
        child: GestureDetector(
          onTap: _onRecenterPressed,
          child: Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: Colors.black.withOpacity(0.72),
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.30),
                  blurRadius: 8,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: AnimatedRotation(
              // Rotate the needle so the red tip always points north.
              // When bearing=0 (north-up) turns=0; bearing=90 (east-up) turns=-0.25.
              turns: -bearing / 360.0,
              duration: const Duration(milliseconds: 200),
              child: CustomPaint(
                size: const Size(48, 48),
                painter: _CompassNeedlePainter(),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Circular satellite-view toggle button positioned just below the compass.
  ///
  /// Shows a map/satellite icon and switches the tile layer between
  /// street-map and satellite imagery when tapped.
  Widget _buildSatelliteToggle() {
    return Positioned(
      // top: 74 = compass top(18) + compass height(48) + gap(8).
      top: 74,
      right: 16,
      child: SafeArea(
        bottom: false,
        child: GestureDetector(
          onTap: () => setState(() => _isSatelliteView = !_isSatelliteView),
          child: Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: _isSatelliteView
                  ? const Color(0xFFB71C1C).withOpacity(0.92)
                  : Colors.black.withOpacity(0.72),
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.30),
                  blurRadius: 8,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: const Center(
              child: Icon(
                Icons.satellite_alt,
                color: Colors.white,
                size: 24,
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Builds a stacked column of compact alert chips on the right side of the
  /// map, showing up to three active [NavigationAlert]s.
  ///
  /// Alerts are sourced from [_navAlerts].  Each chip is built by the private
  /// helper [_smallRightAlert].  Only visible during active navigation.
  ///
  /// TODO(live-data): [_navAlerts] is seeded with sample data; replace with
  /// a live alert feed (weather / traffic / restriction APIs).
  Widget _buildRightSideAlertStack() {
    if (!_isNavigating || _navAlerts.isEmpty) return const SizedBox.shrink();

    // Show at most 3 alerts to avoid cluttering the map viewport.
    final visibleAlerts = _navAlerts.take(3).toList();

    return Positioned(
      // right: 16 matches standard horizontal screen margin.
      right: 16,
      // top: 118 aligns with lane guidance row so alerts start at the same
      // vertical level, but won't overlap because the alert stack is right-anchored
      // and lane guidance is center-anchored (no right-side content conflict).
      top: 118,
      child: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            for (final alert in visibleAlerts) ...[
              _smallRightAlert(alert),
              // 10 px gap keeps chips visually separated without crowding.
              const SizedBox(height: 10),
            ],
          ],
        ),
      ),
    );
  }

  /// Builds a single compact alert chip for [_buildRightSideAlertStack].
  ///
  /// Displays the alert-type icon on the left and a short distance/label on
  /// the right, styled as a pill card with a coloured border.
  ///
  /// TODO(live-data): replace the fallback '–' distance with a real value
  /// derived from the alert's geographic position and the current truck location.
  Widget _smallRightAlert(NavigationAlert alert) {
    // Map alert type to a recognisable Material icon.
    IconData alertIcon;
    Color alertColor;
    switch (alert.type) {
      case AlertType.weighStation:
        alertIcon = Icons.monitor_weight_outlined;
        alertColor = const Color(0xFFF57C00); // amber
        break;
      case AlertType.construction:
        alertIcon = Icons.construction_outlined;
        alertColor = const Color(0xFFF9A825); // yellow
        break;
      case AlertType.lowBridge:
        alertIcon = Icons.height_outlined;
        alertColor = const Color(0xFFD32F2F); // red
        break;
      case AlertType.accident:
        alertIcon = Icons.warning_amber_outlined;
        alertColor = const Color(0xFFD32F2F);
        break;
      case AlertType.weather:
        alertIcon = Icons.cloud_outlined;
        alertColor = const Color(0xFF0288D1); // blue
        break;
      default:
        alertIcon = Icons.info_outlined;
        alertColor = const Color(0xFF6C52A6); // brand purple
    }

    // TODO(live-data): compute real distance to this alert from truck position.
    final String distText = alert.distanceMiles != null
        ? '${alert.distanceMiles!.toStringAsFixed(1)} mi'
        : '–';

    return Container(
      constraints: const BoxConstraints(maxWidth: 110),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.80),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: alertColor.withOpacity(0.8), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.25),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(alertIcon, color: alertColor, size: 16),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              distText,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: Colors.white,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  // ── Upcoming route alert chips (top-right overlay) ────────────────────────
  //
  // The three methods below implement the upcoming-alerts feature.  They are
  // self-contained; removing _buildRightSideUpcomingAlerts() from the Stack
  // overlay and _refreshUpcomingAlerts() from _onGpsPosition disables the
  // feature entirely without touching any other overlay.

  /// Returns the Material icon for an [UpcomingAlertType].
  IconData _upcomingAlertIcon(UpcomingAlertType type) {
    switch (type) {
      case UpcomingAlertType.wind:
        return Icons.air;
      case UpcomingAlertType.truckStop:
        return Icons.local_gas_station_outlined;
      case UpcomingAlertType.weighStation:
        return Icons.monitor_weight_outlined;
      case UpcomingAlertType.restriction:
        return Icons.do_not_disturb_on_outlined;
      case UpcomingAlertType.fuel:
        // Fuel-only stop: use a distinct icon from the full-service truckStop.
        return Icons.local_gas_station;
      case UpcomingAlertType.restArea:
        return Icons.hotel_outlined;
    }
  }

  /// Formats [distance] (in miles) for display in a compact chip.
  ///
  /// Returns a whole number (e.g. `"12 mi"`) when [distance] is an integer,
  /// or one decimal place (e.g. `"13.5 mi"`) otherwise.
  String _formatChipDistance(double distance) {
    if (distance % 1 == 0) {
      return '${distance.toInt()} mi';
    }
    return '${distance.toStringAsFixed(1)} mi';
  }

  /// Returns the accent colour for an [UpcomingAlertType].
  Color _upcomingAlertAccent(UpcomingAlertType type) {
    switch (type) {
      case UpcomingAlertType.wind:
        return const Color(0xFFFF7A00);
      case UpcomingAlertType.truckStop:
        return const Color(0xFF22C55E);
      case UpcomingAlertType.fuel:
        return const Color(0xFF22C55E);
      case UpcomingAlertType.weighStation:
        return const Color(0xFF14B8A6);
      case UpcomingAlertType.restriction:
        return const Color(0xFFEF4444);
      case UpcomingAlertType.restArea:
        return const Color(0xFF3B82F6);
    }
  }

  /// Returns the short GPS-style display label for an [UpcomingAlertType].
  String _upcomingAlertShortLabel(UpcomingAlertType type) {
    switch (type) {
      case UpcomingAlertType.wind:
        return 'Wind';
      case UpcomingAlertType.truckStop:
        return 'Stop';
      case UpcomingAlertType.fuel:
        return 'Fuel';
      case UpcomingAlertType.weighStation:
        return 'Weigh';
      case UpcomingAlertType.restriction:
        return 'Restriction';
      case UpcomingAlertType.restArea:
        return 'Rest';
    }
  }

  /// Builds a single upcoming-alert chip used in [_buildRightSideUpcomingAlerts].
  ///
  /// Each chip shows a coloured icon circle on the left, a short GPS-style
  /// label, and the formatted distance — all in a compact dark pill with a
  /// coloured border that matches the alert accent colour.
  Widget _buildUpcomingAlertChip(UpcomingAlertItem item) {
    final accent = _upcomingAlertAccent(item.type);
    final label = _upcomingAlertShortLabel(item.type);
    final distanceText = _formatChipDistance(item.distanceMiles);

    return Container(
      constraints: const BoxConstraints(
        minWidth: 112,
        maxWidth: 165,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.84),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: accent.withOpacity(0.95),
          width: 1.4,
        ),
        boxShadow: [
          BoxShadow(
            color: accent.withOpacity(0.18),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
          BoxShadow(
            color: Colors.black.withOpacity(0.18),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 22,
            height: 22,
            decoration: BoxDecoration(
              color: accent.withOpacity(0.14),
              shape: BoxShape.circle,
            ),
            child: Icon(
              _upcomingAlertIcon(item.type),
              color: accent,
              size: 14,
            ),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: RichText(
              overflow: TextOverflow.ellipsis,
              text: TextSpan(
                children: [
                  TextSpan(
                    text: '$label ',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  TextSpan(
                    text: distanceText,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Displays up to three upcoming-alert chips stacked vertically at the
  /// top-right of the map overlay during active navigation.
  ///
  /// Chips are right-aligned, sorted by ascending distance (closest first),
  /// and spaced 9 px apart for a compact yet readable display.  Passes through
  /// as [SizedBox.shrink] when navigation is inactive or no alerts are present.
  ///
  /// Positioned at top: 120, right: 16 so it sits just below the compass
  /// button and does not conflict with the top instruction card on the left.
  ///
  /// To disable this overlay: remove the [_buildRightSideUpcomingAlerts] call
  /// from the Stack in build() and the [_refreshUpcomingAlerts] call in
  /// [_onGpsPosition].
  Widget _buildRightSideUpcomingAlerts() {
    // Guard: only render during active navigation with alerts available.
    if (!_isNavigating || _upcomingAlerts.isEmpty) {
      return const SizedBox.shrink();
    }

    return Positioned(
      // top: 120 aligns with the compass button bottom edge + gap, ensuring
      // chips never overlap the instruction card at the top-left.
      top: 120,
      // right: 16 matches the standard horizontal screen margin.
      right: 16,
      child: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: _upcomingAlerts.take(3).map((item) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: _buildUpcomingAlertChip(item),
            );
          }).toList(),
        ),
      ),
    );
  }

  /// Horizontally scrollable row of compact service / truckstop chips shown
  /// at the bottom of the map during active navigation.
  ///
  /// Each chip is built by [_serviceChip].  Chips are sourced from
  /// [_closestTruckStopsAhead] — the list is already sorted by distance ahead
  /// and limited to the two closest stops.
  ///
  /// Only visible when navigating and at least one ahead-stop is available.
  ///
  /// TODO(live-data): [_closestTruckStopsAhead] is populated by
  /// [_refreshClosestTruckStops].  Ensure that method is called on every GPS
  /// update and that the POI dataset includes your desired service categories.
  Widget _buildBottomServiceChips() {
    if (!_isNavigating || _closestTruckStopsAhead.isEmpty) {
      return const SizedBox.shrink();
    }

    return Positioned(
      left: 0,
      right: 0,
      // Float above the main alert/trip strip area.
      bottom: 168,
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 52,
          child: ListView.builder(
            // Horizontal scroll so a long list stays accessible.
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            itemCount: _closestTruckStopsAhead.length,
            itemBuilder: (context, index) {
              final AheadTruckStop ahead = _closestTruckStopsAhead[index];
              return _serviceChip(ahead);
            },
          ),
        ),
      ),
    );
  }

  /// Builds a single service chip for [_buildBottomServiceChips].
  ///
  /// Displays the brand logo (or a fallback icon when the asset is not yet
  /// loaded), the brand name, and the route distance ahead formatted as miles.
  ///
  /// TODO(live-data): logo bytes come from [_brandIconBytes] which is populated
  /// in [_loadBrandIcons].  Ensure all desired logos are present in
  /// `assets/logos/` and listed in `pubspec.yaml`.
  Widget _serviceChip(AheadTruckStop ahead) {
    // Distance ahead formatted for compact display.
    final String milesText =
        ahead.routeMilesAhead < 10
            ? '${ahead.routeMilesAhead.toStringAsFixed(1)} mi'
            : '${ahead.routeMilesAhead.round()} mi';

    // Resolve the brand logo bytes (may be null if not yet loaded).
    final Uint8List? logoBytes =
        _brandIconBytes['assets/logo_brand_markers/${ahead.poi.logoName}.png'] ??
        _brandIconBytes['assets/logo_brand_markers/truck_parking.png'];

    return Container(
      margin: const EdgeInsets.only(right: 8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.14),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── Brand logo ───────────────────────────────────────────────
          if (logoBytes != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: Image.memory(
                logoBytes,
                width: 24,
                height: 24,
                fit: BoxFit.contain,
              ),
            )
          else
            const Icon(Icons.local_gas_station_outlined,
                size: 22, color: Color(0xFF6C52A6)),
          const SizedBox(width: 6),
          // ── Stop name + distance ─────────────────────────────────────
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                ahead.poi.name,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: Colors.black87,
                ),
              ),
              Text(
                milesText,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: Colors.black.withOpacity(0.50),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// Compact trip-stats strip anchored to the bottom of the screen.
  ///
  /// Shows three key values side-by-side:
  ///   • Miles remaining on the active route.
  ///   • Estimated drive time remaining.
  ///   • Projected arrival time.
  ///
  /// Only visible during active navigation.  An "expand" chevron on the right
  /// may be wired to open the full trip breakdown sheet.
  ///
  /// TODO(live-data): values are read from [_tripProgressInfo].  Ensure that
  /// [_updateTripProgress] is being called on each GPS tick so the strip stays
  /// current.
  Widget _buildCompactTripStrip() {
    if (!_isNavigating) return const SizedBox.shrink();

    // ── Derive display values from live trip progress ──────────────────────
    // TODO(live-data): _tripProgressInfo is updated by _updateTripProgress();
    // verify that it is called on every GPS fix.
    final double milesLeft = _tripProgressInfo.milesRemaining;
    final Duration timeLeft = _tripProgressInfo.durationRemaining;
    final DateTime eta = _tripProgressInfo.etaLocal;

    // Format miles remaining.
    final String milesStr = milesLeft < 10
        ? milesLeft.toStringAsFixed(1)
        : milesLeft.round().toString();

    // Format drive time remaining: "1 h 24 m" or "38 m".
    final int totalMinutes = timeLeft.inMinutes;
    final String timeStr = totalMinutes >= 60
        ? '${totalMinutes ~/ 60} h ${totalMinutes % 60} m'
        : '$totalMinutes m';

    // Format ETA as local hh:mm with AM/PM.
    final String etaStr =
        '${eta.hour % 12 == 0 ? 12 : eta.hour % 12}:${eta.minute.toString().padLeft(2, '0')} '
        '${eta.hour < 12 ? 'AM' : 'PM'}';

    return Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: SafeArea(
        top: false,
        child: Container(
          padding:
              const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.96),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.12),
                blurRadius: 10,
                offset: const Offset(0, -2),
              ),
            ],
          ),
          child: Row(
            children: [
              // ── Miles remaining ──────────────────────────────────────
              Expanded(
                child: _compactTripStat(
                  Icons.straighten_outlined,
                  '$milesStr mi',
                  'remaining',
                ),
              ),
              _tripStripDivider(),
              // ── Drive time remaining ─────────────────────────────────
              Expanded(
                child: _compactTripStat(
                  Icons.access_time_outlined,
                  timeStr,
                  'drive time',
                ),
              ),
              _tripStripDivider(),
              // ── Arrival time ─────────────────────────────────────────
              Expanded(
                child: _compactTripStat(
                  Icons.flag_outlined,
                  etaStr,
                  'arrival',
                ),
              ),
              // ── Expand / more button ─────────────────────────────────
              GestureDetector(
                // Wire to _showLegBreakdownSheet() to open the full trip
                // breakdown bottom sheet.
                onTap: _showLegBreakdownSheet,
                child: Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF0E9F9),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.keyboard_arrow_up,
                    size: 20,
                    color: Color(0xFF6C52A6),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Thin vertical divider used between stats in [_buildCompactTripStrip].
  Widget _tripStripDivider() {
    return Container(
      width: 1,
      height: 30,
      margin: const EdgeInsets.symmetric(horizontal: 8),
      color: Colors.black12,
    );
  }

  /// Single labelled stat cell used inside [_buildCompactTripStrip].
  Widget _compactTripStat(IconData icon, String value, String label) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 14, color: Colors.black45),
            const SizedBox(width: 4),
            Text(
              value,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: Colors.black87,
              ),
            ),
          ],
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: const TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w500,
            color: Colors.black45,
          ),
        ),
      ],
    );
  }

  /// Speed limit display box showing current speed and the active speed limit.
  ///
  /// [_currentSpeedMps] and [_speedLimitMph] are updated from the GPS stream
  /// via [_onGpsPosition].  The speed text turns red when the driver exceeds
  /// the limit.  Returns an empty widget when not navigating.
  Widget _buildSpeedLimitBox() {
    if (!_isNavigating) return const SizedBox.shrink();

    final double speedMph =
        _currentSpeedMps >= 0 ? _currentSpeedMps * _mpsToMph : 0.0;
    final int speedInt = speedMph.round();
    final int limitInt = _speedLimitMph.round();
    final bool isOverSpeed = _currentSpeedMps >= 0 && speedMph > _speedLimitMph;

    return Container(
      width: 82,
      height: 200,
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.9),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.22),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(height: 8),
          Text(
            '$speedInt',
            style: TextStyle(
              color: isOverSpeed ? Colors.red : Colors.white,
              fontSize: 42,
              fontWeight: FontWeight.w800,
              height: 1,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'mph',
            style: TextStyle(
              color: Colors.white,
              fontSize: 17,
              fontWeight: FontWeight.w500,
            ),
          ),
          const Spacer(),
          Container(
            width: 64,
            padding: const EdgeInsets.symmetric(vertical: 8),
            margin: const EdgeInsets.only(bottom: 14),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Column(
              children: [
                const Text(
                  'LIMIT',
                  style: TextStyle(
                    color: Colors.black87,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '$limitInt',
                  style: const TextStyle(
                    color: Colors.black,
                    fontSize: 34,
                    fontWeight: FontWeight.w800,
                    height: 1,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}


/// A single turn-by-turn navigation step, holding the driver instruction text,
/// the geographic location of the maneuver, the maneuver modifier (e.g.
/// 'left', 'right', 'straight'), the maneuver type (e.g. 'turn', 'merge'),
/// and the step distance in metres.
///
/// [maneuver] is the Mapbox `maneuver.modifier` value and drives the icon
/// displayed in the navigation banner.  [distanceMeters] is summed across
/// remaining steps to derive the remaining-distance label.
/// [type] is the Mapbox `maneuver.type` value (e.g. "turn", "merge", "fork")
/// and is used by [_mapStepToVisualType] to select the correct visual icon.
class _NavStep {
  const _NavStep(
    this.instruction,
    this.location, {
    this.maneuver = 'straight',
    this.type = '',
    this.distanceMeters = 0.0,
    this.name = '',
  });

  /// Human-readable turn instruction, e.g. "Turn left onto Main St".
  final String instruction;

  /// Geographic position of the maneuver waypoint.
  final LatLng location;

  /// Mapbox maneuver modifier: 'left', 'right', 'straight', 'slight left',
  /// 'sharp right', etc.  Used to select the icon shown in the nav banner.
  final String maneuver;

  /// Mapbox maneuver type: 'turn', 'merge', 'fork', 'exit', 'roundabout',
  /// 'depart', 'arrive', etc.  Used by [_mapStepToVisualType].
  final String type;

  /// Length of this step in metres, as reported by the Mapbox Directions API.
  final double distanceMeters;

  /// Road name for this step, e.g. "US-95" or "Wells Ave", from the Mapbox
  /// Directions API `name` field.
  final String name;
}

// ── Closest-truck-stops-ahead models ──────────────────────────────────────────

/// A single geographic point along a route polyline.
class RoutePoint {
  final double lat;
  final double lng;

  const RoutePoint({required this.lat, required this.lng});
}

/// A truck-stop point of interest used by the closest-stops-ahead system.
///
/// [name] is the full display name, e.g. "Pilot Travel Center - Portland".
/// [logoName] matches the filename stem under `assets/logo_brand_markers/` so
/// the chip widget can load it as `assets/logo_brand_markers/{logoName}.png`.
class TruckStopPoi {
  final String id;
  /// Full display name of the truck stop, e.g. "Pilot Travel Center - Portland".
  final String name;
  final String brand;
  final String logoName;
  final double latitude;
  final double longitude;
  final String? locationName;

  const TruckStopPoi({
    required this.id,
    required this.name,
    required this.brand,
    required this.logoName,
    required this.latitude,
    required this.longitude,
    this.locationName,
  });
}

/// A truck stop that is ahead of the driver on the active route, together
/// with the route-polyline distance to it (in miles) and the index of its
/// nearest route point.
class AheadTruckStop {
  final TruckStopPoi poi;
  final double routeMilesAhead;
  final int nearestRouteIndex;

  const AheadTruckStop({
    required this.poi,
    required this.routeMilesAhead,
    required this.nearestRouteIndex,
  });
}

// ── Closest-truck-stops-ahead widgets ─────────────────────────────────────────

/// A compact, logo-first chip showing a truck stop ahead on the active route.
///
/// Design principles:
/// • **No card/pill background** — the logo and text float directly over the
///   map so the chip is visually lightweight and never obscures road detail.
/// • **Unified logo size** (28 × 28 px) — all brand logos render at the same
///   dimensions for a consistent row regardless of the source PNG's intrinsic
///   size.  Use transparent PNGs in `assets/logos/` so no white square appears
///   behind the graphic.
/// • **High-contrast text with shadow** — white text + subtle black shadow
///   keeps the label readable over both light and dark map tiles.
/// • **Graceful fallback** — if the logo asset is missing, a standard
///   [Icons.local_gas_station] icon is shown at the same size.
/// • **Approaching badge** — when [isApproaching] is true, an amber
///   "Approaching" label is shown below the distance to alert the driver that
///   the stop is imminent.
///
/// Best practice: keep logo PNGs trimmed to edge-to-edge artwork with a
/// transparent background so `fit: BoxFit.contain` shows the full graphic.
class ClosestTruckStopChip extends StatelessWidget {
  /// Path to the brand logo asset, e.g. `'assets/logo_brand_markers/pilot.png'`.
  final String logoAsset;

  /// Formatted distance string, e.g. `'12 mi'` or `'3.4 mi'`.
  final String distanceText;

  /// Full display name of the truck stop shown after the distance label,
  /// e.g. `'Pilot Travel Center - Portland'`.
  final String? stopName;

  /// When true, an amber "Approaching" badge is shown below the distance text
  /// to alert the driver that this stop is within the approaching threshold.
  final bool isApproaching;

  const ClosestTruckStopChip({
    super.key,
    required this.logoAsset,
    required this.distanceText,
    this.stopName,
    this.isApproaching = false,
  });

  @override
  Widget build(BuildContext context) {
    // Shared text shadow for legibility over any map tile colour.
    const textShadow = Shadow(
      color: Colors.black54,
      blurRadius: 3,
      offset: Offset(0, 1),
    );

    return Padding(
      // Horizontal spacing between consecutive chips in the row.
      padding: const EdgeInsets.symmetric(horizontal: 4.0),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // ── Brand logo ───────────────────────────────────────────────────
          // 28 × 28 px with BoxFit.contain so the full graphic is visible.
          // Transparent PNGs render cleanly with no white background halo.
          Image.asset(
            logoAsset,
            width: 28,
            height: 28,
            fit: BoxFit.contain,
            // Fall back to a standard icon if the asset file is missing.
            errorBuilder: (_, __, ___) => const Icon(
              Icons.local_gas_station,
              size: 24,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: 6),
          // ── Distance label + optional approaching badge ──────────────────
          Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Distance row: value + optional stop name
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    distanceText,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 15,
                      color: Colors.white,
                      shadows: [textShadow],
                    ),
                  ),
                  // ── Optional stop name ─────────────────────────────────
                  if (stopName != null && stopName!.isNotEmpty) ...[
                    const SizedBox(width: 5),
                    Text(
                      stopName!,
                      style: const TextStyle(
                        fontWeight: FontWeight.w500,
                        fontSize: 13,
                        color: Colors.white,
                        shadows: [textShadow],
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
              // ── Approaching badge ──────────────────────────────────────
              // Only shown for the first upcoming stop when within the
              // approaching threshold (~3 miles).
              if (isApproaching)
                Container(
                  margin: const EdgeInsets.only(top: 2),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFF9800).withOpacity(0.90),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    'Approaching',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                      height: 1.3,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A horizontally scrollable row of up to 2 [ClosestTruckStopChip] widgets,
/// displayed during active navigation to show the nearest truck stops ahead.
///
/// The first stop shows an "Approaching" badge when it is within
/// [_approachingThresholdMiles] of the driver's current position.
class ClosestTruckStopsRow extends StatelessWidget {
  final List<AheadTruckStop> stops;

  /// Distance threshold in miles below which the next stop is considered
  /// "approaching" and receives the amber badge.
  static const double _approachingThresholdMiles = 3.0;

  const ClosestTruckStopsRow({super.key, required this.stops});

  @override
  Widget build(BuildContext context) {
    if (stops.isEmpty) return const SizedBox.shrink();
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: stops.indexed.map(((int, AheadTruckStop) entry) {
          final index = entry.$1;
          final stop = entry.$2;
          final miles = stop.routeMilesAhead;
          final distText = miles < 10
              ? '${miles.toStringAsFixed(1)} mi'
              : '${miles.round()} mi';
          // Only the first (closest) stop can show the approaching badge.
          final bool isApproaching =
              index == 0 && miles < _approachingThresholdMiles;
          return ClosestTruckStopChip(
            logoAsset: 'assets/logo_brand_markers/${stop.poi.logoName}.png',
            distanceText: distText,
            stopName: stop.poi.name,
            isApproaching: isApproaching,
          );
        }).toList(),
      ),
    );
  }
}

/// A truck-friendly point of interest along the route.
///
/// Represents fuel stops (Pilot, Love's, TA, Petro, Flying J) and rest areas.
/// [dieselPrice] and [address] are optional — not all data sources provide them.
///
/// Extend this model with additional fields (e.g. amenities, parking spots,
/// scale availability) as the app evolves to support richer POI types.
class TruckStop {
  const TruckStop({
    required this.id,
    required this.name,
    required this.brand,
    required this.position,
    this.address,
    this.dieselPrice,
    this.icon,
    this.assetLogo,
    this.description,
  });

  /// Unique identifier for this stop (used as the marker ID prefix).
  final String id;

  /// Display name of the truck stop, e.g. "Pilot Travel Center".
  final String name;

  /// Brand name, e.g. "Pilot", "Love's", "TA", "Petro", "Flying J", "Rest Area".
  final String brand;

  /// Geographic position of the stop on the map.
  final LatLng position;

  /// Street address or city/state summary, e.g. "Portland, OR".  Optional.
  final String? address;

  /// Current diesel price in USD per gallon.  Null when price is unavailable.
  final double? dieselPrice;

  /// Canonical brand icon key that matches a registered entry in
  /// [_TruckMapScreenState._brandIconBytes] (e.g. 'pilot', 'loves', 'ta').
  /// Mirrors the GeoJSON feature `properties["icon"]` used by a Mapbox
  /// SymbolLayer with `iconImage: ["get", "icon"]`.
  /// When null, [_TruckMapScreenState._normalizeTruckStopBrand] is used as
  /// a fallback so legacy or API-sourced stops still resolve correctly.
  final String? icon;

  /// Asset path to the brand logo PNG, e.g. 'assets/logo_brand_markers/pilot.png'.
  /// Used as the `iconImage` when registering the marker on the map —
  /// the flutter_map equivalent of Mapbox `style.addImage(id, bytes)`.
  /// When non-null, this path takes priority over [icon] for logo loading.
  final String? assetLogo;

  /// Short description shown in the info window / bottom sheet snippet,
  /// e.g. "Full-service truck stop with scales, showers & restaurant."
  /// When null the description row is omitted from the info sheet.
  final String? description;
}

// ── Map POI types, model, and sample data ─────────────────────────────────────

/// Classifies the kind of truck-relevant point of interest shown on the map.
enum PoiType {
  /// Commercial vehicle weigh station or portable scale site.
  weighStation,

  /// Police checkpoint, enforcement stop, or roving inspection unit.
  police,

  /// International or inter-state port of entry inspection facility.
  portOfEntry,
}

/// A map point of interest (POI) relevant to commercial truck drivers.
///
/// Used for weigh stations, police checkpoints, and ports of entry that are
/// rendered as coloured markers on the map and trigger proximity alerts.
class MapPoi {
  const MapPoi({
    required this.id,
    required this.position,
    required this.type,
    required this.name,
    required this.status,
  });

  /// Unique identifier — also used as the alert-deduplication key.
  final String id;

  /// Geographic coordinate of the POI.
  final LatLng position;

  /// Category of this POI (weigh station, police, or port of entry).
  final PoiType type;

  /// Human-readable name displayed in markers and alert dialogs.
  final String name;

  /// Operational status string, e.g. "Open", "Closed", "Bypass Required".
  final String status;
}

/// Sample [MapPoi] data used when no live feed is available.
///
/// Covers key locations along the Portland OR → Winnemucca NV corridor so
/// drivers see real-world-style alerts immediately after launch.  Replace or
/// augment this list with live API data as the backend matures.
const List<MapPoi> _sampleMapPois = [
  // ── Weigh stations ──────────────────────────────────────────────────────
  // Stations on the Portland OR → Winnemucca NV demo corridor (I-84 → US-95).
  MapPoi(
    id: 'ws_woodburn_or',
    position: LatLng(45.155, -122.856),
    type: PoiType.weighStation,
    name: 'Woodburn Weigh Station',
    status: 'Open',
  ),
  MapPoi(
    id: 'ws_cascade_locks_or',
    position: LatLng(45.670, -121.895),
    type: PoiType.weighStation,
    name: 'Cascade Locks Weigh Station',
    status: 'Open',
  ),
  MapPoi(
    id: 'ws_biggs_or',
    position: LatLng(45.665, -120.828),
    type: PoiType.weighStation,
    name: 'Biggs Junction Weigh Station',
    status: 'Open',
  ),
  MapPoi(
    id: 'ws_pendleton_or',
    position: LatLng(45.678, -118.790),
    type: PoiType.weighStation,
    name: 'Pendleton Weigh Station',
    status: 'Open',
  ),
  MapPoi(
    id: 'ws_ontario_or',
    position: LatLng(44.027, -116.975),
    type: PoiType.weighStation,
    name: 'Ontario Port of Entry',
    status: 'Open',
  ),
  MapPoi(
    id: 'ws_winnemucca_nv',
    position: LatLng(40.974, -117.730),
    type: PoiType.weighStation,
    name: 'Winnemucca Weigh Station',
    status: 'Open',
  ),
  MapPoi(
    id: 'ws_battle_mountain_nv',
    position: LatLng(40.641, -116.934),
    type: PoiType.weighStation,
    name: 'Battle Mountain Weigh Station',
    status: 'Open',
  ),
  MapPoi(
    id: 'ws_elko_nv',
    position: LatLng(40.831, -115.763),
    type: PoiType.weighStation,
    name: 'Elko Weigh Station',
    status: 'Open',
  ),
  MapPoi(
    id: 'ws_wells_nv',
    position: LatLng(41.113, -114.963),
    type: PoiType.weighStation,
    name: 'Wells Port of Entry',
    status: 'Open',
  ),
  MapPoi(
    id: 'ws_siskiyou_or',
    position: LatLng(42.065, -122.547),
    type: PoiType.weighStation,
    name: 'Siskiyou Summit Weigh Station',
    status: 'Open',
  ),
  MapPoi(
    id: 'ws_lovelock_nv',
    position: LatLng(40.179, -118.473),
    type: PoiType.weighStation,
    name: 'Lovelock Weigh Station',
    status: 'Open',
  ),
  // ── Police / enforcement ─────────────────────────────────────────────────
  MapPoi(
    id: 'police_grants_pass_or',
    position: LatLng(42.441, -123.329),
    type: PoiType.police,
    name: 'Grants Pass Enforcement Zone',
    status: 'Active',
  ),
  MapPoi(
    id: 'police_winnemucca_nv',
    position: LatLng(40.973, -117.735),
    type: PoiType.police,
    name: 'Winnemucca Truck Inspection',
    status: 'Active',
  ),
  // ── Port of entry ────────────────────────────────────────────────────────
  MapPoi(
    id: 'poe_oregon_california',
    position: LatLng(41.998, -122.512),
    type: PoiType.portOfEntry,
    name: 'Oregon / California Port of Entry',
    status: 'Open',
  ),
];

// ── Sample truck restriction data ─────────────────────────────────────────────

/// Sample [TruckRestriction] objects covering key restrictions along the
/// Portland OR → Winnemucca NV corridor.
///
/// Each entry is positioned at or near a real-world restriction type so that
/// drivers see meaningful warnings immediately after launch.  Coordinates are
/// placed at major highway points on the I-5 / I-80 corridor.  Replace or
/// augment this list with a live API feed as the backend matures.
const List<TruckRestriction> _sampleRestrictions = [
  // ── Low bridges ───────────────────────────────────────────────────────────
  TruckRestriction(
    id: 'bridge_portland_burnside',
    position: LatLng(45.523, -122.676),
    type: RestrictionType.lowBridge,
    name: 'Burnside Bridge – Portland',
    description: 'Historic bridge with reduced vertical clearance on approach roads.',
    limitValue: 12.8,
    limitUnit: 'ft',
  ),
  TruckRestriction(
    id: 'bridge_medford_or',
    position: LatLng(42.327, -122.874),
    type: RestrictionType.lowBridge,
    name: 'Medford Underpass',
    description: 'Railroad overpass on downtown connector route.',
    limitValue: 13.2,
    limitUnit: 'ft',
  ),
  // ── Weight limits ─────────────────────────────────────────────────────────
  TruckRestriction(
    id: 'weight_ashland_or',
    position: LatLng(42.195, -122.699),
    type: RestrictionType.weightLimit,
    name: 'Ashland Weight-Restricted Road',
    description: 'Local road with posted weight limit due to bridge condition.',
    limitValue: 36.0,
    limitUnit: 'tons',
  ),
  TruckRestriction(
    id: 'weight_winnemucca_nv',
    position: LatLng(40.973, -117.740),
    type: RestrictionType.weightLimit,
    name: 'Winnemucca Access Road',
    description: 'Seasonal weight limit in effect — reduced load bearing.',
    limitValue: 38.0,
    limitUnit: 'tons',
  ),
  // ── Length limits ─────────────────────────────────────────────────────────
  TruckRestriction(
    id: 'length_yreka_ca',
    position: LatLng(41.740, -122.636),
    type: RestrictionType.lengthLimit,
    name: 'Yreka Downtown Length Restriction',
    description: 'No vehicles over 65 ft on city centre streets.',
    limitValue: 65.0,
    limitUnit: 'ft',
  ),
  // ── No-truck roads ────────────────────────────────────────────────────────
  TruckRestriction(
    id: 'notruck_redding_ca',
    position: LatLng(40.587, -122.391),
    type: RestrictionType.noTruckRoad,
    name: 'Redding Residential No-Truck Zone',
    description: 'Residential street — commercial trucks prohibited by ordinance.',
  ),
  // ── Hazmat restrictions ───────────────────────────────────────────────────
  TruckRestriction(
    id: 'hazmat_grants_pass_or',
    position: LatLng(42.440, -123.330),
    type: RestrictionType.hazmatRestriction,
    name: 'Grants Pass Hazmat Corridor',
    description: 'Transportation of hazardous materials restricted through this zone.',
  ),
];

// ── Destination search model ──────────────────────────────────────────────────

/// A single place suggestion returned by the Mapbox Geocoding v5 API.
///
/// [name] is the short feature name (e.g. "Denver"), [placeName] is the full
/// formatted address, and [position] is the geographic coordinate used to place
/// a destination marker and pan the camera.
class PlaceSuggestion {
  const PlaceSuggestion({
    required this.name,
    required this.placeName,
    required this.position,
  });

  /// Short feature name, e.g. "Denver" or "Pilot Travel Center".
  final String name;

  /// Full Mapbox place_name string, e.g. "Denver, Colorado, United States".
  final String placeName;

  /// Geographic coordinate of the place.
  final LatLng position;
}

// ── Route alternatives model ──────────────────────────────────────────────────

/// Represents one route alternative returned by the Mapbox Directions API.
///
/// Holds all data needed to preview the route on the map and display key
/// truck-relevant metrics in the route comparison bottom sheet.
class RouteOption {
  const RouteOption({
    required this.id,
    required this.label,
    required this.points,
    required this.steps,
    required this.distanceMiles,
    required this.durationSeconds,
    required this.restrictionCount,
    required this.fuelStopCount,
    required this.weighStationCount,
    required this.routeData,
  });

  /// Unique identifier for this alternative, e.g. 'route_0'.
  final String id;

  /// Human-readable label shown in the bottom sheet, e.g. 'Recommended'.
  final String label;

  /// Decoded and simplified polyline points for map rendering.
  final List<LatLng> points;

  /// Turn-by-turn navigation steps for this route.
  final List<_NavStep> steps;

  /// Route length in miles.
  final double distanceMiles;

  /// Estimated travel time in seconds.
  final int durationSeconds;

  /// Number of truck restrictions along this route.
  final int restrictionCount;

  /// Number of fuel stops (non-rest-area truck stops) within 5 km of route.
  final int fuelStopCount;

  /// Number of weigh stations within 5 km of route.
  final int weighStationCount;

  /// Legacy route data map used by the route info panel and preview panel.
  final Map<String, dynamic> routeData;
}

// ── Multi-stop leg models ─────────────────────────────────────────────────────

/// Raw result returned by [_TruckMapScreenState._fetchRouteFromApi].
///
/// Contains everything needed to display a route on the map and for use in
/// either a [RouteOption] (pre-navigation selection) or a [TripLeg]
/// (per-segment breakdown during navigation).
class RouteResult {
  const RouteResult({
    required this.points,
    required this.steps,
    required this.distanceMiles,
    required this.durationSeconds,
  });

  /// Decoded, simplified polyline points.
  final List<LatLng> points;

  /// Turn-by-turn navigation steps.
  final List<_NavStep> steps;

  /// Route distance in miles.
  final double distanceMiles;

  /// Route travel time in seconds.
  final int durationSeconds;
}

/// A single leg of a multi-stop trip (e.g. origin → stop 1).
///
/// Built by [_TruckMapScreenState._buildMultiStopRoute] from the ordered list
/// of stops.  [_activeLegIndex] tracks which leg the driver is currently on
/// and advances automatically as each intermediate stop is reached.
class TripLeg {
  const TripLeg({
    required this.id,
    required this.fromName,
    required this.toName,
    required this.fromPosition,
    required this.toPosition,
    required this.points,
    required this.steps,
    required this.distanceMiles,
    required this.durationSeconds,
    required this.restrictionCount,
  });

  /// Stable identifier, e.g. `"leg_0"`, `"leg_1"`.
  final String id;

  /// Display name of the departure point (e.g. "Current Location" or stop name).
  final String fromName;

  /// Display name of the arrival point (the stop name).
  final String toName;

  /// Geographic coordinate of the departure point.
  final LatLng fromPosition;

  /// Geographic coordinate of the arrival point.
  final LatLng toPosition;

  /// Decoded, simplified polyline points for this leg.
  final List<LatLng> points;

  /// Turn-by-turn navigation steps for this leg.
  final List<_NavStep> steps;

  /// Leg distance in miles.
  final double distanceMiles;

  /// Leg travel time in seconds.
  final int durationSeconds;

  /// Number of truck-restriction violations found along this leg's route.
  final int restrictionCount;
}

/// A named waypoint used when building a multi-stop route via
/// [_TruckMapScreenState._buildMultiStopRoute].
class _StopEntry {
  const _StopEntry({required this.name, required this.position});

  /// Display name of the stop (shown in the leg card and breakdown sheet).
  final String name;

  /// Geographic coordinate of the stop.
  final LatLng position;
}

// ── Navigation alert system ────────────────────────────────────────────────────

enum AlertType {
  /// Issued advisory warning about wind conditions along the route.
  windAdvisory,
  fuelDistance,
  restrictionDistance,
  weather,
  lowBridge,
  construction,
  accident,
  roadClosure,
  hazmat,
  /// A designated high-wind geographic area (e.g. a canyon or pass).
  highWind,
  steepGrade,
  /// A weigh station along or near the route requiring compliance stop.
  weighStation,
}

enum AlertSeverity {
  low,
  medium,
  high,
}

class NavigationAlert {
  final String id;
  final AlertType type;
  final AlertSeverity severity;
  final String title;
  final String? subtitle;
  final String? message;
  final double? distanceMiles;
  final Duration? timeRemaining;
  final DateTime? etaLocal;
  final String? roadName;
  final String? suggestedAction;
  final bool isExpanded;
  final bool isDismissed;

  const NavigationAlert({
    required this.id,
    required this.type,
    required this.severity,
    required this.title,
    this.subtitle,
    this.message,
    this.distanceMiles,
    this.timeRemaining,
    this.etaLocal,
    this.roadName,
    this.suggestedAction,
    this.isExpanded = false,
    this.isDismissed = false,
  });

  NavigationAlert copyWith({
    bool? isExpanded,
    bool? isDismissed,
  }) {
    return NavigationAlert(
      id: id,
      type: type,
      severity: severity,
      title: title,
      subtitle: subtitle,
      message: message,
      distanceMiles: distanceMiles,
      timeRemaining: timeRemaining,
      etaLocal: etaLocal,
      roadName: roadName,
      suggestedAction: suggestedAction,
      isExpanded: isExpanded ?? this.isExpanded,
      isDismissed: isDismissed ?? this.isDismissed,
    );
  }
}

class TripProgressInfo {
  final double milesRemaining;
  final Duration durationRemaining;
  final DateTime etaLocal;
  final String timezoneLabel;

  const TripProgressInfo({
    required this.milesRemaining,
    required this.durationRemaining,
    required this.etaLocal,
    required this.timezoneLabel,
  });
}

// ── Navigation alert utility functions ────────────────────────────────────────

String _fmtMiles(double miles) => '${miles.toStringAsFixed(0)} mi';

String _fmtDuration(Duration duration) {
  final h = duration.inHours;
  final m = duration.inMinutes % 60;
  if (h > 0) return '${h}h ${m}m';
  return '${m}m';
}

/// Formats [dt] as a 12-hour AM/PM clock string.
///
/// [dt] is expected to already be in the device's local timezone (use
/// [DateTime.now] or [DateTime.toLocal] before passing in).
/// The [TripProgressInfo.timezoneLabel] field is used as the display-only
/// timezone hint shown alongside this value in [TripSummaryStrip].
String _fmtEta(DateTime dt) {
  final hour = dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour);
  final minute = dt.minute.toString().padLeft(2, '0');
  final period = dt.hour >= 12 ? 'PM' : 'AM';
  return '$hour:$minute $period';
}

Color _alertSeverityColor(AlertSeverity severity) {
  switch (severity) {
    case AlertSeverity.low:
      return Colors.green;
    case AlertSeverity.medium:
      return Colors.orange;
    case AlertSeverity.high:
      return Colors.red;
  }
}

IconData _alertTypeIcon(AlertType type) {
  switch (type) {
    case AlertType.windAdvisory:
    case AlertType.highWind:
      return Icons.air;
    case AlertType.fuelDistance:
      return Icons.local_gas_station;
    case AlertType.restrictionDistance:
    case AlertType.lowBridge:
    case AlertType.hazmat:
      return Icons.warning_amber_rounded;
    case AlertType.weather:
      return Icons.cloud;
    case AlertType.construction:
      return Icons.construction;
    case AlertType.accident:
      return Icons.car_crash;
    case AlertType.roadClosure:
      return Icons.block;
    case AlertType.steepGrade:
      return Icons.trending_down;
    // Weigh station: use the scale icon to represent a compliance checkpoint.
    case AlertType.weighStation:
      return Icons.scale;
  }
}

// ── MiniAlertChip ──────────────────────────────────────────────────────────────

class MiniAlertChip extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color iconColor;
  final VoidCallback? onTap;

  const MiniAlertChip({
    super.key,
    required this.icon,
    required this.text,
    this.iconColor = Colors.red,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final chip = Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.12),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: iconColor, size: 18),
          const SizedBox(width: 6),
          Text(
            text,
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 14,
              color: Colors.black87,
            ),
          ),
        ],
      ),
    );
    if (onTap == null) return chip;
    return GestureDetector(onTap: onTap, child: chip);
  }
}

// ── MiniAlertRow ───────────────────────────────────────────────────────────────

class MiniAlertRow extends StatelessWidget {
  final List<NavigationAlert> alerts;
  final VoidCallback? onNext;

  const MiniAlertRow({
    super.key,
    required this.alerts,
    this.onNext,
  });

  @override
  Widget build(BuildContext context) {
    final visible = alerts.where((a) => !a.isDismissed).toList();
    if (visible.isEmpty) return const SizedBox.shrink();

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          ...visible.map(
            (a) => Padding(
              padding: const EdgeInsets.only(right: 8),
              child: MiniAlertChip(
                icon: _alertTypeIcon(a.type),
                text: a.distanceMiles != null
                    ? _fmtMiles(a.distanceMiles!)
                    : a.title,
                iconColor: _alertSeverityColor(a.severity),
              ),
            ),
          ),
          MiniAlertChip(
            icon: Icons.chevron_right,
            text: 'Next',
            iconColor: Colors.blueGrey,
            onTap: onNext,
          ),
        ],
      ),
    );
  }
}

// ── MainNavigationAlertCard ────────────────────────────────────────────────────

class MainNavigationAlertCard extends StatelessWidget {
  final NavigationAlert alert;
  final TripProgressInfo? tripInfo;
  final VoidCallback? onDismiss;
  final VoidCallback? onToggleExpand;

  // Live navigation data – passed from _TruckMapScreenState so this purely-
  // presentational widget remains stateless and testable without a GPS stream.
  //
  // currentSpeedMps: raw GPS speed in metres-per-second (-1 = no fix yet).
  // speedLimitMph:   posted speed limit for the current road segment in mph.
  // mpsToMph:        conversion constant; defaults to the standard 2.23694.
  //                  Override only when writing unit tests with custom units.
  final double currentSpeedMps;
  final double speedLimitMph;

  /// Conversion factor m/s → mph.  Exposed as a parameter so tests can
  /// substitute a different value without touching production logic.
  final double mpsToMph;

  const MainNavigationAlertCard({
    super.key,
    required this.alert,
    this.tripInfo,
    this.onDismiss,
    this.onToggleExpand,
    required this.currentSpeedMps,
    required this.speedLimitMph,
    this.mpsToMph = 2.23694,
  });

  @override
  Widget build(BuildContext context) {
    final color = _alertSeverityColor(alert.severity);
    final icon = _alertTypeIcon(alert.type);

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.15),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── Main alert row ──────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 10, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                // Severity-colored icon container
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, color: color, size: 24),
                ),
                const SizedBox(width: 12),
                // Title + subtitle
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        alert.title,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                          color: color,
                        ),
                      ),
                      if (alert.subtitle != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          alert.subtitle!,
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.black54,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                // Distance badge
                if (alert.distanceMiles != null)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      _fmtMiles(alert.distanceMiles!),
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: color,
                      ),
                    ),
                  ),
                const SizedBox(width: 6),
                // More / Collapse button
                GestureDetector(
                  onTap: onToggleExpand,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      alert.isExpanded ? 'Less' : 'More',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: Colors.black54,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                // Dismiss button
                GestureDetector(
                  onTap: onDismiss,
                  child: const Icon(
                    Icons.close,
                    size: 20,
                    color: Colors.black38,
                  ),
                ),
              ],
            ),
          ),
          // ── Expandable "More" panel ────────────────────────────────────
          AnimatedCrossFade(
            firstChild: const SizedBox.shrink(),
            secondChild: _buildMorePanel(color),
            crossFadeState: alert.isExpanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            duration: const Duration(milliseconds: 250),
          ),
          // ── Trip summary strip ─────────────────────────────────────────
          if (tripInfo != null) ...[
            const Divider(height: 1, thickness: 1, color: Color(0xFFF0F0F0)),
            TripSummaryStrip(tripInfo: tripInfo!),
          ],
          // ── Live speed strip ───────────────────────────────────────────────
          // currentSpeedMps and speedLimitMph are passed in by the parent
          // (_TruckMapScreenState) so this widget stays stateless.  Only shown
          // when a valid GPS fix has been received (currentSpeedMps >= 0).
          if (currentSpeedMps >= 0) ...[
            const Divider(height: 1, thickness: 1, color: Color(0xFFF0F0F0)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              child: Row(
                children: [
                  // Current speed – red when over the posted limit.
                  Text(
                    'Speed: ${(currentSpeedMps * mpsToMph).round()} mph',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: (currentSpeedMps * mpsToMph) > speedLimitMph
                          ? Colors.red
                          : Colors.black87,
                    ),
                  ),
                  const SizedBox(width: 12),
                  // Posted speed limit for the current road segment.
                  Text(
                    'Limit: ${speedLimitMph.round()} mph',
                    style: const TextStyle(
                      fontSize: 14,
                      color: Colors.black54,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildMorePanel(Color color) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Divider(height: 16, thickness: 1, color: Color(0xFFF0F0F0)),
          if (alert.roadName != null) ...[
            _moreRow(Icons.route, 'Road', alert.roadName!),
            const SizedBox(height: 6),
          ],
          if (alert.message != null) ...[
            _moreRow(Icons.info_outline, 'Details', alert.message!),
            const SizedBox(height: 6),
          ],
          if (alert.suggestedAction != null)
            _moreRow(Icons.directions, 'Action', alert.suggestedAction!),
        ],
      ),
    );
  }

  Widget _moreRow(IconData icon, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: Colors.black45),
        const SizedBox(width: 8),
        Expanded(
          child: RichText(
            text: TextSpan(
              style: const TextStyle(fontSize: 13, color: Colors.black87),
              children: [
                TextSpan(
                  text: '$label: ',
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                TextSpan(text: value),
              ],
            ),
          ),
        ),
      ],
    );
  }
}


// ── TripSummaryStrip ───────────────────────────────────────────────────────────

class TripSummaryStrip extends StatelessWidget {
  final TripProgressInfo tripInfo;

  const TripSummaryStrip({super.key, required this.tripInfo});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          _stat(Icons.straighten, _fmtMiles(tripInfo.milesRemaining), 'left'),
          _divider(),
          _stat(Icons.access_time, _fmtDuration(tripInfo.durationRemaining),
              'drive time'),
          _divider(),
          _stat(Icons.flag_outlined, _fmtEta(tripInfo.etaLocal),
              tripInfo.timezoneLabel),
        ],
      ),
    );
  }

  Widget _stat(IconData icon, String value, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: Colors.black45),
        const SizedBox(width: 6),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              value,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: Colors.black87,
              ),
            ),
            Text(
              label,
              style: const TextStyle(fontSize: 11, color: Colors.black45),
            ),
          ],
        ),
      ],
    );
  }

  Widget _divider() {
    return Container(
      width: 1,
      height: 28,
      color: const Color(0xFFE0E0E0),
    );
  }
}

// ── Sample truck safety warning sign data ─────────────────────────────────────

/// Sample [WarningSign] objects covering all 18 required truck safety warning
/// types along the Portland OR → Winnemucca NV corridor.
///
/// Coordinates are placed at realistic points on the I-5 / US-97 / I-80
/// corridor so drivers see real-world-style warnings immediately after launch.
/// Replace or augment this list with live API or backend data as the app matures.
const List<WarningSign> _sampleWarningSigns = [
  // ── Low bridge ────────────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_low_bridge_portland',
    type: WarningTypes.lowBridge,
    title: 'Low Bridge',
    lat: 45.518,
    lng: -122.680,
    severity: 'high',
    message: 'Clearance 12 ft 6 in — oversized loads prohibited.',
    icon: WarningTypes.lowBridge,
  ),
  // ── Weight restriction ────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_weight_ashland',
    type: WarningTypes.weightRestriction,
    title: 'Weight Restriction',
    lat: 42.198,
    lng: -122.703,
    severity: 'high',
    message: 'Maximum 36 tons — seasonal restriction in effect.',
    icon: WarningTypes.weightRestriction,
  ),
  // ── No trucks allowed ─────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_no_trucks_redding',
    type: WarningTypes.noTrucksAllowed,
    title: 'No Trucks Allowed',
    lat: 40.590,
    lng: -122.395,
    severity: 'high',
    message: 'Commercial vehicles prohibited. Use alternate route.',
    icon: WarningTypes.noTrucksAllowed,
  ),
  // ── Hazmat restriction ────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_hazmat_grants_pass',
    type: WarningTypes.hazmatRestriction,
    title: 'Hazmat Restriction',
    lat: 42.442,
    lng: -123.332,
    severity: 'high',
    message: 'Hazardous materials prohibited through this corridor.',
    icon: WarningTypes.hazmatRestriction,
  ),
  // ── Steep grade ───────────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_steep_grade_siskiyou',
    type: WarningTypes.steepGrade,
    title: 'Steep Grade',
    lat: 42.068,
    lng: -122.550,
    severity: 'medium',
    message: '6% grade for 4 miles — use lower gear.',
    icon: WarningTypes.steepGrade,
  ),
  // ── Sharp curve ───────────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_sharp_curve_yreka',
    type: WarningTypes.sharpCurve,
    title: 'Sharp Curve',
    lat: 41.743,
    lng: -122.638,
    severity: 'medium',
    message: 'Recommended speed 35 mph for oversized loads.',
    icon: WarningTypes.sharpCurve,
  ),
  // ── Runaway truck ramp ────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_runaway_ramp_i5',
    type: WarningTypes.runawayTruckRamp,
    title: 'Runaway Truck Ramp',
    lat: 42.050,
    lng: -122.540,
    severity: 'medium',
    message: 'Runaway ramp 1 mile ahead on right.',
    icon: WarningTypes.runawayTruckRamp,
  ),
  // ── Chain requirement ─────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_chains_cascade',
    type: WarningTypes.chainRequirement,
    title: 'Chain Requirement',
    lat: 44.980,
    lng: -121.710,
    severity: 'medium',
    message: 'Chains required on all vehicles during winter conditions.',
    icon: WarningTypes.chainRequirement,
  ),
  // ── High wind area ────────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_high_wind_OR_desert',
    type: WarningTypes.highWindArea,
    title: 'High Wind Area',
    lat: 43.045,
    lng: -119.030,
    severity: 'medium',
    message: 'High winds possible — high-profile vehicles use caution.',
    icon: WarningTypes.highWindArea,
  ),
  // ── Construction zone ─────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_construction_medford',
    type: WarningTypes.constructionZone,
    title: 'Construction Zone',
    lat: 42.330,
    lng: -122.876,
    severity: 'medium',
    message: 'Active construction — reduced lane width. Fines doubled.',
    icon: WarningTypes.constructionZone,
  ),
  // ── Accident ahead ────────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_accident_i5_or',
    type: WarningTypes.accidentAhead,
    title: 'Accident Ahead',
    lat: 44.056,
    lng: -123.096,
    severity: 'high',
    message: 'Multi-vehicle accident — expect delays. Right lane closed.',
    icon: WarningTypes.accidentAhead,
  ),
  // ── Lane closure ─────────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_lane_closure_woodburn',
    type: WarningTypes.laneClosure,
    title: 'Lane Closure',
    lat: 45.157,
    lng: -122.858,
    severity: 'medium',
    message: 'Right lane closed 2 miles ahead — merge left.',
    icon: WarningTypes.laneClosure,
  ),
  // ── Road closed ───────────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_road_closed_lovelock',
    type: WarningTypes.roadClosed,
    title: 'Road Closed',
    lat: 40.182,
    lng: -118.476,
    severity: 'high',
    message: 'Road closed due to flooding. Detour via US-95.',
    icon: WarningTypes.roadClosed,
  ),
  // ── Detour ────────────────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_detour_winnemucca',
    type: WarningTypes.detour,
    title: 'Detour',
    lat: 40.975,
    lng: -117.737,
    severity: 'low',
    message: 'Follow detour signs — bridge repair underway.',
    icon: WarningTypes.detour,
  ),
  // ── Weigh station ─────────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_weigh_station_woodburn',
    type: WarningTypes.weighStation,
    title: 'Weigh Station',
    lat: 45.154,
    lng: -122.854,
    severity: 'low',
    message: 'Weigh station ahead — all trucks must stop.',
    icon: WarningTypes.weighStation,
  ),
  // ── Brake check area ──────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_brake_check_siskiyou',
    type: WarningTypes.brakeCheckArea,
    title: 'Brake Check Area',
    lat: 42.060,
    lng: -122.543,
    severity: 'medium',
    message: 'Mandatory brake check before steep descent.',
    icon: WarningTypes.brakeCheckArea,
  ),
  // ── Rest area ─────────────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_rest_area_i80_nv',
    type: WarningTypes.restArea,
    title: 'Rest Area',
    lat: 40.460,
    lng: -118.780,
    severity: 'low',
    message: 'Rest area 1 mile ahead — truck parking available.',
    icon: WarningTypes.restArea,
  ),
  // ── Animal crossing ───────────────────────────────────────────────────────
  WarningSign(
    id: 'warn_animal_crossing_or',
    type: WarningTypes.animalCrossing,
    title: 'Animal Crossing',
    lat: 43.600,
    lng: -121.190,
    severity: 'low',
    message: 'Deer and elk crossing zone — reduce speed at night.',
    icon: WarningTypes.animalCrossing,
  ),
];

// ── WeighStationPoi model ──────────────────────────────────────────────────────

/// A weigh station point-of-interest enriched with logo asset information.
///
/// Wraps the core fields from [MapPoi] and adds [logoName] so UI widgets can
/// load the station's brand logo from `assets/logos/{logoName}.png`.
class WeighStationPoi {
  const WeighStationPoi({
    required this.id,
    required this.position,
    required this.name,
    required this.status,
    this.logoName = 'weigh_station',
  });

  /// Unique identifier — matches the source [MapPoi.id].
  final String id;

  /// Geographic coordinate of the weigh station.
  final LatLng position;

  /// Human-readable station name shown in chips and dialogs.
  final String name;

  /// Operational status string, e.g. "Open", "Closed", "Bypass Required".
  final String status;

  /// PNG filename (without `.png`) under `assets/logos/` used to display the
  /// station's logo.  Defaults to `'weigh_station'` when no branded logo exists.
  final String logoName;

  /// Constructs a [WeighStationPoi] from an existing [MapPoi] of type
  /// [PoiType.weighStation].  The [logoName] defaults to `'weigh_station'`.
  factory WeighStationPoi.fromMapPoi(MapPoi poi) {
    return WeighStationPoi(
      id: poi.id,
      position: poi.position,
      name: poi.name,
      status: poi.status,
    );
  }
}

// ── AheadWeighStation model ────────────────────────────────────────────────────

/// A weigh station that lies ahead of the truck on the active route, together
/// with pre-computed distance information.
///
/// Produced by [_TruckMapScreenState._getClosestWeighStationsAheadOnRoute] and
/// consumed by [ClosestWeighStationChip] / [ClosestWeighStationsRow].
class AheadWeighStation {
  const AheadWeighStation({
    required this.poi,
    required this.milesAhead,
    required this.routeIndex,
  });

  /// The weigh station POI data including its name and logo.
  final WeighStationPoi poi;

  /// Approximate route miles from the truck's current position to this station.
  final double milesAhead;

  /// Index into `_routePoints` of the nearest point to this station.
  /// Used internally to order stations and is not shown in the UI.
  final int routeIndex;
}

// ── ClosestWeighStationChip widget ────────────────────────────────────────────

/// A compact navigation chip displaying a single weigh station ahead on route.
///
/// Design principles:
/// • **Dark translucent card background** — always readable on any map tile.
/// • **Unified logo size** (28 × 28 px, [BoxFit.contain]) — consistent with
///   all other POI chips.  Use transparent PNGs so no white square appears.
/// • **Amber "Approaching" badge** — shown when the station is within
///   [_approachingThresholdMiles] miles so the driver has advance notice.
/// • **Graceful fallback** — [Icons.scale] shown when logo asset is missing.
///
/// **Usage:**
/// ```dart
/// ClosestWeighStationChip(station: aheadStation)
/// ```
class ClosestWeighStationChip extends StatelessWidget {
  final AheadWeighStation station;

  /// Distance in miles below which the "Approaching" badge is displayed.
  static const double _approachingThresholdMiles = 5.0;

  const ClosestWeighStationChip({super.key, required this.station});

  @override
  Widget build(BuildContext context) {
    final poi = station.poi;
    final miles = station.milesAhead;
    final bool isApproaching = miles < _approachingThresholdMiles;

    // Format distance: one decimal below 10 mi, rounded above.
    final String distLabel =
        miles < 10 ? '${miles.toStringAsFixed(1)} mi' : '${miles.round()} mi';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        // Dark translucent background ensures legibility on any map tile color.
        color: Colors.black.withOpacity(0.80),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isApproaching
              ? Colors.orange.withOpacity(0.85)
              : Colors.white24,
          width: isApproaching ? 1.5 : 1.0,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.35),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // ── Station logo ──────────────────────────────────────────────────
          // Loads `assets/logo_brand_markers/{logoName}.png` at 28 × 28 px
          // with BoxFit.contain so the full graphic is visible.  Transparent
          // PNGs render without a white background halo.  Falls back to a
          // scale icon when the asset file is missing.
          Image.asset(
            'assets/logo_brand_markers/${poi.logoName}.png',
            width: 28,
            height: 28,
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => const Icon(
              Icons.scale,
              color: Colors.orangeAccent,
              size: 24,
            ),
          ),
          const SizedBox(width: 8),
          // ── Name + distance + approaching badge ───────────────────────────
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              // Station name
              Text(
                poi.name,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  height: 1.2,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              // Distance in miles (orange for high visibility)
              Text(
                distLabel,
                style: const TextStyle(
                  color: Colors.orangeAccent,
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  height: 1.2,
                ),
              ),
              // Approaching badge — shown only when within threshold
              if (isApproaching)
                Container(
                  margin: const EdgeInsets.only(top: 2),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                  decoration: BoxDecoration(
                    color: Colors.orange.withOpacity(0.90),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    'Approaching',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                      height: 1.3,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

// ── ClosestWeighStationsRow widget ────────────────────────────────────────────

/// Displays the single closest upcoming weigh station ahead of the driver on
/// the active route as a [ClosestWeighStationChip].
///
/// Only one station is shown at a time so the driver's attention is focused on
/// the very next weigh station they must cross.  Once the driver passes it the
/// list is refreshed by [_refreshClosestWeighStationsAhead] and the next
/// station ahead appears automatically.
///
/// The row is automatically empty (zero size) when [stations] is empty.
///
/// **Usage:**
/// ```dart
/// ClosestWeighStationsRow(stations: _closestWeighStationsAhead)
/// ```
class ClosestWeighStationsRow extends StatelessWidget {
  final List<AheadWeighStation> stations;

  const ClosestWeighStationsRow({super.key, required this.stations});

  @override
  Widget build(BuildContext context) {
    if (stations.isEmpty) return const SizedBox.shrink();

    // Show only the first (closest) station — one at a time per spec.
    final station = stations.first;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // ── "WEIGH STATION AHEAD" header label ──────────────────────────────
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.scale,
                color: Colors.orangeAccent,
                size: 14,
              ),
              const SizedBox(width: 4),
              Text(
                'WEIGH STATION AHEAD',
                style: TextStyle(
                  color: Colors.white.withOpacity(0.90),
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.8,
                  shadows: const [
                    Shadow(
                      color: Colors.black54,
                      blurRadius: 3,
                      offset: Offset(0, 1),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        // ── Chip for the single next station ────────────────────────────────
        ClosestWeighStationChip(station: station),
      ],
    );
  }
}

// ── Upcoming alert models ─────────────────────────────────────────────────────

/// The category of an upcoming route alert displayed as a chip in the
/// top-right overlay during active navigation.
///
/// Add new cases here to support additional alert types; update
/// [_TruckMapScreenState._upcomingAlertIcon] and
/// [_TruckMapScreenState._upcomingAlertAccent] to provide an icon and colour.
enum UpcomingAlertType {
  /// Strong wind or weather advisory along the route.
  wind,
  /// Truck-stop / fuel + services ahead.
  truckStop,
  /// Weigh station ahead on the current route.
  weighStation,
  /// Height, weight, or hazmat restriction ahead.
  restriction,
  /// Fuel-only stop ahead (no full services).
  fuel,
  /// Rest area / travel plaza ahead.
  restArea,
}

/// A single upcoming alert item shown as a chip in the top-right overlay.
///
/// Created and sorted by [_TruckMapScreenState._refreshUpcomingAlerts];
/// consumed by [_TruckMapScreenState._buildUpcomingAlertChip].
class UpcomingAlertItem {
  /// The category of this alert, used to select the icon and accent colour.
  final UpcomingAlertType type;

  /// Short human-readable label (e.g. brand name or alert title).
  /// Not displayed directly in the chip but available for accessibility.
  final String label;

  /// Approximate route miles from the truck's current position to this alert.
  /// Alerts with [distanceMiles] ≤ 0 are excluded by [_refreshUpcomingAlerts].
  final double distanceMiles;

  const UpcomingAlertItem({
    required this.type,
    required this.label,
    required this.distanceMiles,
  });
}

// ── Compass needle painter ─────────────────────────────────────────────────────

/// Paints a red-and-white compass needle inside a 48 × 48 circle.
///
/// The upper half of the needle (pointing north) is painted red; the lower
/// half (pointing south) is painted white.  A small dark dot is drawn at the
/// centre.  Rotate the containing widget with [AnimatedRotation] to reflect
/// the current map heading.
class _CompassNeedlePainter extends CustomPainter {
  const _CompassNeedlePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final cx = size.width / 2;
    final cy = size.height / 2;
    final needleHalfLen = size.height * 0.36;
    final needleHalfWidth = size.width * 0.09;

    // ── North (red) half ────────────────────────────────────────────────────
    final redPaint = Paint()
      ..color = const Color(0xFFE53935)
      ..style = PaintingStyle.fill;

    final northPath = Path()
      ..moveTo(cx, cy - needleHalfLen)
      ..lineTo(cx - needleHalfWidth, cy)
      ..lineTo(cx + needleHalfWidth, cy)
      ..close();
    canvas.drawPath(northPath, redPaint);

    // ── South (white) half ──────────────────────────────────────────────────
    final whitePaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;

    final southPath = Path()
      ..moveTo(cx, cy + needleHalfLen)
      ..lineTo(cx - needleHalfWidth, cy)
      ..lineTo(cx + needleHalfWidth, cy)
      ..close();
    canvas.drawPath(southPath, whitePaint);

    // ── Centre dot ──────────────────────────────────────────────────────────
    canvas.drawCircle(
      Offset(cx, cy),
      needleHalfWidth * 0.7,
      Paint()..color = Colors.black87,
    );
  }

  @override
  bool shouldRepaint(_CompassNeedlePainter oldDelegate) => false;
}
