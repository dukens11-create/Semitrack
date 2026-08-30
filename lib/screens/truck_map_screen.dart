import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:mapbox_maps_flutter/mapbox_maps_flutter.dart' as mbx;
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart' as geo;
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart' hide Path;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:semitrack_mobile/models/truck_restriction.dart';
import 'package:semitrack_mobile/models/poi_item.dart';
import 'package:semitrack_mobile/models/poi.dart';
import 'package:semitrack_mobile/models/warning_config.dart';
import 'package:semitrack_mobile/models/warning_sign.dart';
import 'package:semitrack_mobile/models/nav_settings_model.dart';
import 'package:semitrack_mobile/models/navigation_maneuver.dart';
import 'package:semitrack_mobile/models/navigation_state.dart';
import 'package:semitrack_mobile/models/street_guidance.dart';
import 'package:semitrack_mobile/models/route_progress.dart';
import 'package:semitrack_mobile/models/live_road_data.dart';
import 'package:semitrack_mobile/screens/active_navigation_menu_screen.dart';
import 'package:semitrack_mobile/screens/nav_settings_screen.dart';
import 'package:semitrack_mobile/services/poi_service.dart';
import 'package:semitrack_mobile/services/native_navigation_service.dart';
import 'package:semitrack_mobile/services/warning_manager.dart';
import 'package:semitrack_mobile/services/voice_destination_service.dart';
import 'package:semitrack_mobile/widgets/road_guidance_banner.dart';
import 'package:semitrack_mobile/widgets/warning_popup_stack.dart';
import 'package:semitrack_mobile/utils/marker_widgets.dart'
    show buildGpsPinClusterMarker, buildGpsPinMarker;
import 'package:semitrack_mobile/utils/route_utils.dart' show getPOIsOnRoute;
import 'package:semitrack_mobile/utils/route_corridor.dart';
import 'package:semitrack_mobile/core/api_client.dart';
import 'package:semitrack_mobile/models/truck_profile.dart';
import 'package:semitrack_mobile/models/weigh_station.dart' as live_ws;
import 'package:semitrack_mobile/services/live_road_data_service.dart';
import 'package:semitrack_mobile/services/here_places_service.dart';
import 'package:semitrack_mobile/services/destination_time_zone_service.dart';
import 'package:semitrack_mobile/services/weigh_station_service.dart';
import 'package:semitrack_mobile/services/analytics_service.dart';
import 'package:semitrack_mobile/services/latest_request_coordinator.dart';
import 'package:semitrack_mobile/theme/semitrack_theme.dart';
import 'package:semitrack_mobile/utils/navigation_utils.dart' as nav_utils;
import 'package:semitrack_mobile/widgets/semitrack_ui.dart';

// ── Lane guidance models ───────────────────────────────────────────────────

/// The direction an individual lane arrow can point.
///
/// Used by [LaneInfo] to describe each lane's allowed movements.
enum LaneDirection { left, slightLeft, straight, slightRight, right, uTurn }

enum _LocationRecoveryAction { retry, enableServices, appSettings }

enum _RouteCalculationKind { backend, native, restriction }

class _RouteCalculationRequest {
  const _RouteCalculationRequest({
    required this.kind,
    required this.reason,
    required this.destination,
    this.origin,
    this.alternative = false,
  });

  final _RouteCalculationKind kind;
  final String reason;
  final LatLng destination;
  final LatLng? origin;
  final bool alternative;
}

/// Data for a single lane in the dynamic lane guidance panel.
///
/// [directions] lists the arrows shown on the lane marking.  Most lanes carry
/// a single direction, but shared lanes (e.g. straight-or-right) may carry
/// two.  [isRecommended] is true when the driver should use this lane to
/// follow the current route; recommended lanes are highlighted blue.
class LaneInfo {
  const LaneInfo({required this.directions, required this.isRecommended});

  final List<LaneDirection> directions;
  final bool isRecommended;
}

/// Snapshot of the upcoming navigation maneuver that drives the lane guidance
/// panel.
///
/// Created by [_TruckMapScreenState._updateUpcomingManeuver] from live native
/// guidance data and stored in
/// [_TruckMapScreenState._upcomingManeuverStep].
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

  /// Per-lane data for the dynamic lane guidance panel. Empty when the native
  /// provider does not supply lane data; recommendations are never invented.
  final List<LaneInfo> lanes;
}

// ── Junction-view and enhanced lane guidance models ────────────────────────

/// The direction a single arrow can point on a lane marker.
///
/// Used by [LaneGuidanceData] to describe the allowed movements for each lane
/// in the junction-view and enhanced lane-guidance overlays.
enum LaneArrowType {
  left,
  slightLeft,
  straight,
  slightRight,
  right,
  uTurn,
  none,
}

/// Visual description of a single lane as shown in the lane-guidance and
/// junction-view overlays.
///
/// [arrows] lists every arrow drawn on the lane marker — most lanes carry
/// one arrow, but shared lanes (e.g. straight-or-right) carry two.
/// [isActive] is true when the driver should use this lane to follow the route.
class LaneGuidanceData {
  const LaneGuidanceData({required this.arrows, required this.isActive});

  final List<LaneArrowType> arrows;
  final bool isActive;
}

/// Data snapshot driving the compact junction-view overlay.
///
/// Produced by [_TruckMapScreenState._buildJunctionViewSnapshot] and stored in
/// [_TruckMapScreenState._junctionViewData].  The overlay is rendered by
/// [_TruckMapScreenState._buildJunctionView].
class JunctionViewData {
  const JunctionViewData({
    required this.maneuverType,
    required this.incomingRoadName,
    required this.outgoingRoadName,
    required this.lanes,
    required this.distanceMiles,
  });

  /// Mapbox maneuver type string (e.g. "exit", "fork", "merge").
  final String maneuverType;

  /// Road name the driver is currently travelling on (may be empty).
  final String incomingRoadName;

  /// Road name at the upcoming junction (may be empty).
  final String outgoingRoadName;

  /// Per-lane display data for the junction-view panel.
  final List<LaneGuidanceData> lanes;

  /// Distance in miles to this junction from the driver's current position.
  final double distanceMiles;
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
    this.exitNumber,
    this.towardRoadName,
  });

  /// Icon category derived from maneuver type + modifier.
  final ManeuverVisualType visualType;

  /// Short action verb phrase, e.g. "Turn onto" or "Stay on".
  final String primaryText;

  /// Name of the road at the upcoming maneuver point.
  final String roadName;

  /// Distance in miles from the current position to the maneuver.
  final double distanceMiles;

  /// Optional label shown in the bottom chip (defaults to [roadName]).
  final String? bottomChipText;

  /// Optional exit number shown in the green chip (e.g. "13").
  final String? exitNumber;

  /// The next named street or route shown beneath the primary instruction.
  final String? towardRoadName;
}

// ── Exit Preview / Junction View model ───────────────────────────────────

/// Immutable data snapshot for the Exit Preview / Junction View card.
///
/// Populated by [_TruckMapScreenState._buildExitPreviewData] whenever the
/// driver is within 0.8 mi of an exit-type maneuver and cleared once the
/// maneuver is passed.
class ExitPreviewData {
  final double distanceMiles;
  final String roadName;
  final String? exitNumber;
  final ManeuverVisualType visualType;
  final bool show;

  const ExitPreviewData({
    required this.distanceMiles,
    required this.roadName,
    required this.exitNumber,
    required this.visualType,
    required this.show,
  });
}

/// Full-featured truck navigation screen.
///
/// Integrates a Mapbox map widget (via flutter_map), fetches a live truck
/// route from the backend, parses the returned GeoJSON geometry, and
/// displays dynamic ETA / distance / maneuver information together with the
/// Phase 5 intelligence overlay (driveMinutesLeft, weather, riskScore).
class TruckMapScreen extends StatefulWidget {
  const TruckMapScreen({super.key, required this.api});

  final ApiClient api;

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

class _TruckMapScreenState extends State<TruckMapScreen>
    with WidgetsBindingObserver {
  // Extra clearance for Android devices whose three-button navigation bar is
  // drawn over the Flutter surface instead of being reported as a safe-area
  // inset. Keep every bottom driving card on the same raised baseline.
  static const double _drivingBottomCardLift = 40.0;

  static const MethodChannel _screenAwakeChannel = MethodChannel(
    'com.semitrax/screen_awake',
  );

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
  static const double _offRouteThresholdMeters = 80.0;

  // ── Snap-to-route constants ────────────────────────────────────────────────
  /// Distance in metres within which the truck marker is snapped to the
  /// nearest point on the route polyline.  Below this threshold the visual
  /// marker position is the snapped point; above it the raw GPS fix is used
  /// (potential off-route condition) and [_checkOffRoute] handles rerouting.
  static const double _snapThresholdMeters = 40.0;

  /// Minimum seconds that must elapse between automatic reroutes to prevent
  /// rapid repeated API calls in areas with poor GPS accuracy.
  static const int _rerouteThrottleSeconds = 10;

  /// Minimum seconds the driver must be continuously off route before a
  /// reroute is triggered.  Prevents reacting to brief GPS excursions or noise.
  static const int _offRouteConfirmationSeconds = 5;

  // ── Trip statistics constants ─────────────────────────────────────────────
  /// Metres per mile conversion factor, used to convert GPS distances to miles.
  static const double _metersPerMile = 1609.34;

  // ── Speed monitoring constants ────────────────────────────────────────────
  /// Conversion factor: 1 m/s = 2.23694 mph.
  static const double _mpsToMph = 2.23694;

  /// Minimum seconds between "Slow down" TTS announcements when the driver
  /// is continuously exceeding the speed limit.  Prevents constant repetition.
  static const int _slowDownThrottleSeconds = 30;

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

  /// GPS fixes worse than this accuracy are not reliable enough to place a
  /// commercial vehicle on a specific road. Android's fused provider often
  /// reports 25–50 m while acquiring satellites, so the former 25 m cutoff
  /// incorrectly froze otherwise valid movement.
  static const double _poorAccuracyMeters = 65.0;

  /// Maximum distance (metres) a position jump can be when GPS accuracy is
  /// poor before the fix is discarded as noise.
  static const double _minPoorAccuracyJumpMeters = 25.0;

  /// Baseline distance (metres) allowed between consecutive fixes. The actual
  /// limit is expanded from elapsed time, reported speed, and accuracy so a
  /// delayed highway fix is not mistaken for a teleport.
  static const double _maxPositionJumpMeters = 160.0;

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

  /// Minimum seconds that must elapse between automatic directions (reroute)
  /// API calls.  Separate from [_rerouteThrottleSeconds] so the per-directions
  /// 5 s window is independent of the broader route-fetch guard.
  static const int _directionsThrottleSeconds = 5;

  // ── GPS watchdog constants ─────────────────────────────────────────────────
  /// Seconds of silence from the GPS stream before the fix is declared stale.
  /// If no position update arrives within this window the watchdog fires,
  /// marks the session as stale, resets speed to an unavailable state, and
  /// shows a GPS-signal-loss indicator in the UI.
  static const int _gpsStalenessThresholdSeconds = 20;

  /// Minimum interval between requests to restart Android's location updates
  /// after the watchdog detects a silent native stream.
  static const int _gpsRecoveryRetrySeconds = 30;

  /// Interval (seconds) at which the watchdog timer polls to check whether
  /// a fresh GPS fix has arrived within [_gpsStalenessThresholdSeconds].
  static const int _gpsWatchdogIntervalSeconds = 5;

  // ── Route restriction constants ────────────────────────────────────────────
  /// Radius in metres around each restricted zone within which a route point
  /// is considered to violate the restriction.  Used by
  /// [_updateRouteViolationWarnings] and [_isTruckSafe].
  static const double _restrictionProximityThresholdMeters = 100.0;

  /// Multiplier applied to [_restrictionProximityThresholdMeters] when
  /// building red-overlay polyline segments for the map preview.  The larger
  /// radius ensures the red overlay visually leads into the restricted zone.
  static const double _restrictionSegmentThresholdMultiplier = 3.0;

  // ── Loading / error ────────────────────────────────────────────────────────
  bool _isLoading = false;
  final LatestRequestCoordinator<_RouteCalculationRequest>
  _routeCalculationCoordinator =
      LatestRequestCoordinator<_RouteCalculationRequest>();
  String? _error;

  // ── Map ready state ────────────────────────────────────────────────────────
  bool _mapReady = false;

  // Camera updates are serialized and use latest-wins semantics. This avoids
  // overlapping native camera animations when GPS fixes arrive faster than an
  // earlier easeTo call can finish.
  bool _cameraUpdateInProgress = false;
  geo.Position? _pendingCameraPosition;
  int _cameraUpdateGeneration = 0;

  // Navigation survives short background/foreground transitions without
  // rebuilding the map or route. On resume the native location request and
  // last known navigation state are refreshed in place.
  AppLifecycleState _appLifecycleState = AppLifecycleState.resumed;
  bool _resumeRecoveryInProgress = false;

  // ── Full route response ────────────────────────────────────────────────────
  Map<String, dynamic>? _routeData;

  // ── Route totals – set when a route is fetched, used to compute remaining ──
  /// Total route distance in miles as returned by the Directions API.
  double _routeTotalDistanceMiles = 0.0;

  /// Total route duration in seconds as returned by the Directions API.
  int _routeTotalDurationSeconds = 0;

  // ── Map route points (from GeoJSON coordinates) ────────────────────────────
  List<LatLng> _routePoints = const [];

  /// Changes whenever the authoritative route geometry changes. Async POI,
  /// weigh-station, and road-data responses must match this revision before
  /// they are allowed to mutate route-specific map state.
  int _activeRouteRevision = 0;

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
  StreamSubscription<NativeNavigationState>? _nativeNavigationSubscription;
  bool _screenAwake = false;
  NativeNavigationPhase _nativeNavigationPhase = NativeNavigationPhase.idle;
  NativeNavigationStatus? _nativeNavigationStatus;
  bool _nativeNavigationStatusLoading = true;
  Timer? _animTimer; // kept for dispose / GPS-mode cancellation

  // Generation counter — incremented each time a new smooth animation is
  // started so that any in-flight async animation loop can self-cancel when
  // it detects a stale generation value.
  int _animGeneration = 0;
  // Generation counter for GPS-driven position interpolation — incremented on
  // each new GPS fix so any in-flight lerp can self-cancel when a newer fix
  // arrives before the previous animation completes.
  int _gpsInterpGeneration = 0;
  // True while the GPS stream is delivering real position fixes so that the
  // periodic animation timer defers to the GPS-driven updates.
  bool _gpsActive = false;

  // ── GPS watchdog state ────────────────────────────────────────────────────
  // The watchdog timer fires every [_gpsWatchdogIntervalSeconds] seconds and
  // checks whether a fresh fix arrived within [_gpsStalenessThresholdSeconds].
  // When the GPS stream goes silent (signal loss, permissions revoked, device
  // sleep) the watchdog marks the session stale, resets speed to -1.0, and
  // triggers a UI indicator so the driver knows the displayed speed is stale.
  Timer? _gpsWatchdogTimer;

  /// True when the GPS stream has not delivered a fix within the staleness
  /// threshold.  Cleared on the next successful [_onGpsPosition] call.
  bool _gpsStale = false;

  /// Wall-clock time of the most recently accepted GPS fix.  Updated at the
  /// start of [_onGpsPosition] (after passing the acceptance filter) so the
  /// watchdog can compute how long the stream has been silent.
  DateTime? _lastGpsFixTime;

  /// Last time the watchdog asked the native fused provider to restart.
  DateTime? _lastGpsRecoveryAttempt;

  /// Time at which Android location tracking successfully started. This lets
  /// the watchdog detect a cold start that never produces its first fix.
  DateTime? _gpsTrackingStartedAt;

  /// Prevents overlapping one-shot GPS requests when the driver taps Build
  /// truck route repeatedly while Android is still acquiring satellites.
  bool _isAcquiringGpsFix = false;
  _LocationRecoveryAction? _locationRecoveryAction;

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
  int? _halfMileAnnouncedStepIndex;
  int? _nearTurnAnnouncedStepIndex;

  /// Road matched to the latest live GPS position using the current HERE
  /// route's maneuver offsets. This is available in route preview as well as
  /// active navigation, unlike licensed turn-by-turn guidance state.
  String? _liveRoadName;
  int _liveRoadStepIndex = 0;

  // ── Flutter TTS engine for voice guidance ────────────────────────────────
  final FlutterTts _tts = FlutterTts();
  final VoiceDestinationService _voiceDestinationService =
      VoiceDestinationService();
  String? _lastNativeSpokenInstruction;

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

  /// Persistent navigation settings model.  Created once and passed into
  /// [NavSettingsScreen] so that toggle state survives page transitions.
  final NavSettingsModel _navSettings = NavSettingsModel();

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

  // ── Junction-view state ────────────────────────────────────────────────────
  /// Data for the compact junction-view card shown when the driver approaches
  /// a complex interchange, exit, fork, or merge.
  /// Null when junction view should not be visible.
  JunctionViewData? _junctionViewData;

  // ── Top instruction card state ─────────────────────────────────────────────
  /// Current data for the compact top navigation instruction card.
  /// Null until the first call to [_updateTopInstructionFromNavigationStep].
  /// Drives [_buildPrimaryManeuverCard].
  TopInstructionData? _topInstructionData;

  /// Data for the secondary "Then" maneuver card shown below the primary card.
  /// Set to the step after [_topInstructionData]'s step, null when no such step.
  TopInstructionData? _secondaryInstructionData;

  // ── Exit Preview / Junction View state ────────────────────────────────────
  /// Current exit preview card data.  Null when no exit is approaching or
  /// when navigation is not active.  Drives [_buildExitPreviewCard].
  ExitPreviewData? _exitPreviewData;

  // ── Navigation alert state ─────────────────────────────────────────────────
  // Alerts assembled from authenticated safety-provider corridor responses.
  late List<NavigationAlert> _navAlerts;

  // Route progress updated from authoritative native navigation events.
  late TripProgressInfo _tripProgressInfo;
  late final DestinationTimeZoneService _destinationTimeZoneService;
  late final AnalyticsService _analyticsService;
  DestinationTimeZone? _destinationTimeZone;
  LatLng? _destinationTimeZoneCoordinate;
  int _destinationTimeZoneRequestGeneration = 0;

  // ── Wind alert visibility state ────────────────────────────────────────────
  /// Controls whether the bottom wind advisory card is visible.
  /// Starts true so the card shows as soon as navigation begins; the driver
  /// can dismiss it with the close button.
  bool _showWindAlert = false;

  // ── Satellite view toggle ──────────────────────────────────────────────────
  /// When true the map tile layer switches to satellite imagery.
  bool _isSatelliteView = false;

  // ── Off-route rerouting lock (prevents re-entrant reroute calls) ──────────
  bool _isRerouting = false;

  /// Timestamp of the last automatic reroute, used to throttle rerouting
  /// frequency to at most one reroute every [_rerouteThrottleSeconds] seconds.
  DateTime? _lastRerouteTime;

  // ── Startup reroute suppression and GPS stability tracking ────────────────
  /// Timestamp when the current navigation session was started.  Used to
  /// suppress reroutes during the first 10 seconds of navigation so the app
  /// does not reroute on the initial GPS lock.
  DateTime? _navigationStartedAt;

  /// Timestamp of the last reroute triggered by off-route detection.  Used
  /// for the 10-second cooldown between consecutive reroutes.
  DateTime? _lastRerouteAt;

  /// Timestamp of when the driver was first detected to be more than
  /// [_offRouteThresholdMeters] from the route in the current off-route
  /// episode.  A reroute is only triggered once this has been set for at
  /// least 5 continuous seconds, preventing false positives from GPS drift.
  DateTime? _offRouteDetectedAt;

  /// True once a stable GPS fix (accuracy &lt; 30 m) has been received after
  /// navigation started.  Reroutes are suppressed until this becomes true.
  bool _hasStableFixForNavigation = false;

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

  /// Permanent safety gate for the retired direct Mapbox driving-route code.
  /// Mapbox's passenger-car profile must never be presented as truck-safe.
  bool _legacyPassengerRoutingDisabled = true;

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

  /// Receives hit-test results from the route polyline layer so a driver can
  /// select an alternative directly on the map instead of having to use the
  /// route cards. The hit value is the matching [_routeOptions] index.
  final LayerHitNotifier<int> _routeHitNotifier = ValueNotifier(null);

  /// Keeps route controls compact so most of the map remains available for
  /// panning and zooming. Drivers can expand the drawer to compare routes.
  bool _previewPanelExpanded = false;
  bool _routePreviewActive = false;

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
  // source so the navigation strip works for any route.
  List<PoiItem> _loadedPois = const [];

  // ── Route-only POI source state ──────────────────────────────────────────
  //
  // These fields are used by the throttled _refreshRoutePoiSourceIfNeeded()
  // system to decide whether the route-pois-source needs updating and to
  // record when the last update was performed.

  /// Wall-clock time of the most recent route-POI source refresh.  Null until
  /// the first refresh occurs.
  DateTime? _lastRoutePoiRefreshAt;

  /// Route-progress miles at the time of the last route-POI source refresh.
  /// Compared against [_currentRouteProgressMiles] to detect significant advance.
  double _lastRoutePoiRefreshMiles = 0.0;

  /// Current driver route-progress in miles, updated on every accepted GPS fix.
  /// Derived from the cumulative route-segment distance up to [_truckIndex].
  double _currentRouteProgressMiles = 0.0;

  /// Lightweight content hash of the last route-POI GeoJSON sent to Mapbox.
  /// A sorted, joined string of POI IDs; used to skip no-op source updates
  /// when the filtered POI list has not materially changed between refreshes.
  String _lastRoutePoiSourceHash = '';

  /// Invalidates older Mapbox source writes when several GPS/reroute refreshes
  /// overlap. The newest refresh is the only one allowed to update the source.
  int _routePoiRequestGeneration = 0;

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
  final List<MapPoi> _mapPois = <MapPoi>[];
  final Set<String> _poiAlertShown = {};

  // ── Reverse-geocoding cache ────────────────────────────────────────────────
  //
  // Keyed by "lat,lng" (6 decimal places).  A non-null value is the best
  // address string returned by the Mapbox reverse-geocoding API.  A stored
  // empty string means the lookup already failed (no address available).
  // This prevents redundant network requests for the same coordinate.
  final Map<String, String> _reverseGeocodeCache = {};

  // ── Ahead-on-route weigh stations ─────────────────────────────────────────
  //
  // Holds the next 1–2 weigh stations ahead of the truck on the current route,
  // sorted by ascending route miles.  Updated on every GPS fix while
  // _isNavigating is true via _refreshClosestWeighStationsAhead().
  List<AheadWeighStation> _closestWeighStationsAhead = const [];

  // ── Ahead-on-route rest areas ──────────────────────────────────────────────
  //
  // Holds the closest rest area ahead of the truck on the current route,
  // sorted by ascending route miles.  Updated on every GPS fix while
  // _isNavigating is true via _refreshClosestRestAreasAhead().
  List<AheadRestArea> _closestRestAreasAhead = const [];

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

  // Latest authenticated commercial parking/fuel snapshot for the active
  // route. These records are used only to enrich a tapped truck-stop card;
  // an unknown or stale provider value is never presented as availability.
  List<LiveParkingLocation> _liveParkingLocations = const [];
  List<LiveDieselStation> _liveDieselStations = const [];

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
  TruckProfile? _activeTruckProfile;
  late final WeighStationService _weighStationService;
  late final LiveRoadDataService _liveRoadDataService;
  late final HerePlacesService _herePlacesService;
  bool _isLoadingLivePois = false;
  LatLng? _lastLivePoiCenter;
  bool _isLoadingRouteWeighStations = false;
  bool _routeWeighStationsAvailable = false;

  // ── Truck restriction state ────────────────────────────────────────────────
  //
  // _restrictions is the list of point-based truck restrictions shown as map
  // markers and used for route-violation checks.  _restrictionAlertShown
  // deduplicates proximity alerts so the same restriction does not re-alert
  // during a session.  _restrictionAhead holds the nearest upcoming violation
  // so the in-route alert card can display its details.
  final List<TruckRestriction> _restrictions = <TruckRestriction>[];
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
  final List<WarningSign> _warningSigns = <WarningSign>[];
  final Set<String> _warningAlertShown = {};
  WarningSign? _warningAhead;

  // Provider-backed physical road controls. These are loaded around the
  // visible map/truck and never substituted for authoritative truck routing.
  List<RoadFeature> _roadFeatures = const [];
  final Set<String> _roadFeatureAlerted = <String>{};
  final Map<String, int> _roadFeatureRouteIndices = <String, int>{};
  final Map<String, double> _roadFeatureCrossTrackMeters = <String, double>{};
  final Map<String, double> _roadFeatureRouteOffsetsMeters = <String, double>{};
  List<double> _routeCumulativeMeters = const [];
  int _roadFeatureRouteSignature = 0;
  RoadFeature? _roadFeatureAhead;
  double? _roadFeatureAheadMeters;
  LatLng? _lastRoadFeatureCenter;
  DateTime? _lastRoadFeatureLoadedAt;
  Timer? _roadFeatureRefreshTimer;
  int _roadFeatureRequestGeneration = 0;

  static const double _roadFeatureMinZoom = 14.2;
  static const double _roadFeatureRouteCorridorMeters = 30.0;

  /// Radius in metres within which a warning sign is considered "on the route"
  /// for route-proximity detection.
  static const double _warningProximityMeters = 75.0;

  /// Radius in metres within which an ahead-on-route warning triggers the
  /// top alert banner (and TTS) for the driver.
  static const double _warningAlertRadiusMeters = 1000.0;

  /// Maximum cross-track distance (metres) for a weigh station to be
  /// considered "on" the active route and eligible for ahead-on-route display.
  /// 5 km gives reliable matches on straight highways while excluding parallel
  /// roads and facilities far from the route.
  static const double _weighStationProximityMeters = 5000.0;

  /// Maximum distance ahead (miles) at which a POI is surfaced in the
  /// chips/badges.  50 km ≈ 31.07 mi.  POIs farther ahead are hidden until
  /// the driver gets within this range.
  static const double _poiMaxAheadMiles = 31.07;

  /// A POI within this distance (miles) of the driver is considered "passed"
  /// and removed from the chips.  200 m ≈ 0.124 mi.
  static const double _poiPassedThresholdMiles = 0.124;

  /// Maximum distance ahead along the selected route for warning markers.
  /// Cross-track eligibility remains limited by [_warningProximityMeters].
  static const double _warningDisplayLookaheadMeters = 16093.0; // ≈ 10 miles

  /// Map zoom level below which warning markers are grouped into cluster badges
  /// to avoid clutter.  Above this threshold every eligible sign is shown
  /// individually.
  static const double _warningClusterZoomThreshold = 11.0;

  /// Distance buffer (metres) used when deciding which [MapPoi] markers
  /// (weigh stations, police, ports of entry) are shown on the map.
  /// Matches the truck-stop POI display buffer (~10 miles).
  static const double _poiDisplayBufferMeters = 16093.0; // ≈ 10 miles

  // ── Smart POI map-layer filtering constants ──────────────────────────────

  /// Maximum distance ahead (miles) to show map-layer POI markers while
  /// navigating (general POIs).  50 miles matches real truck-GPS standards.
  static const double _poiRouteMaxAheadMiles = 50.0;

  /// Extended look-ahead distance (miles) for high-priority safety POIs such
  /// as weigh stations while navigating.  100 miles lets drivers plan well
  /// ahead for mandatory inspection stops.
  static const double _poiWeighStationMaxAheadMiles = 100.0;

  /// Maximum radius (metres) for the nearby-POI filter when not navigating.
  /// 10 miles ≈ 16,093 m.
  static const double _poiNearbyRadiusMeters = 16093.0;

  /// Hard cap on the total number of map-layer POI markers rendered at once
  /// in navigation mode (GPS-professional range: 8–12).
  static const int _poiMaxMarkers = 12;

  /// When not navigating, cap the displayed POI count at this limit.
  static const int _poiNearbyMaxMarkers = 10;

  /// Minimum separation (metres) between two POI markers.  Any POI closer
  /// than this to an already-included higher-priority marker is skipped to
  /// prevent icon overlap (~200 m).
  static const double _poiOverlapMinMeters = 200.0;

  /// Map zoom level below which all POI map-layer markers are hidden.
  /// Set to 10.5 so broad views stay uncluttered.
  static const double _poiHideZoomThreshold = 10.5;

  /// Map zoom levels between [_poiHideZoomThreshold] and this threshold show
  /// cluster badges instead of individual POI icons.  Set to 13.5 to match
  /// professional GPS cluster-to-icon transition at street-level zoom.
  static const double _poiClusterZoomThreshold = 13.5;

  /// Route-corridor half-width (metres) used when checking whether a POI is
  /// close enough to the active route to be considered "ahead".
  static const double _poiRouteCorridorMeters = 2000.0;

  /// Minimum number of closest-ahead POIs that are always included even when
  /// the overlap-dedup pass would otherwise skip them.
  static const int _poiMinAheadForced = 3;

  /// Always keep this many truck stops ahead regardless of overlap/cap rules.
  /// Ensures drivers always see the next 2 truck stops ahead.
  static const int _poiMaxTruckStopsAheadForced = 2;

  /// Always keep this many weigh stations ahead regardless of overlap/cap.
  static const int _poiMaxWeighStationsAheadForced = 1;

  /// Always keep this many top safety POIs (rest areas, brake checks) ahead.
  static const int _poiMaxSafetyItemsAheadForced = 2;

  /// Maximum number of route-point indices to scan ahead of [_truckIndex]
  /// when searching for each POI's nearest route point.  Retained for
  /// reference; the route-corridor pass now uses [getPOIsOnRoute] which
  /// scans all provided route points without an artificial cap.
  static const int _poiRoutePointScanLimit = 2000;

  /// POI categories treated as safety-critical for the forced-ahead logic in
  /// [_getVisiblePoisForCurrentView].  Weigh stations are excluded here because
  /// they have their own dedicated forced slot ([_poiMaxWeighStationsAheadForced])
  /// and must not double-count into the safety quota.
  static const Set<String> _poiSafetyCategories = {
    'brake_check_area',
    'rest_area',
  };

  // ── Route-only POI source constants ─────────────────────────────────────

  /// Mapbox source ID for the navigation-only filtered POI GeoJSON source.
  static const String _routePoisSourceId = 'route-pois-source';

  /// Mapbox layer ID for the navigation-only POI symbol layer.
  static const String _routePoisLayerId = 'route-pois-layer';

  /// Minimum elapsed time between route-POI source refreshes during navigation.
  /// Forced refreshes (reroute, filter/settings change, nav start/stop) bypass
  /// this limit.
  static const Duration _routePoiMinRefreshInterval = Duration(seconds: 2);

  /// Minimum route-progress advance (miles) required before the route-POI
  /// source is refreshed on a normal GPS update.
  static const double _routePoiRefreshMilesThreshold = 0.2;

  /// Maximum number of high-priority POIs shown in the route-only layer.
  static const int _routePoiMaxCount = 10;

  /// Maximum truck stops surfaced in the route-only layer.
  static const int _routePoiTruckStopMax = 2;

  /// Maximum weigh stations surfaced in the route-only layer.
  static const int _routePoiWeighStationMax = 1;

  /// Maximum safety/service POIs (rest areas, brake check, port of entry)
  /// surfaced in the route-only layer.
  static const int _routePoiSafetyMax = 2;

  // ── Speed monitoring state ─────────────────────────────────────────────────
  /// Current truck speed in metres per second, sourced from the GPS stream.
  /// Negative (-1.0) when speed is unavailable (e.g. cold start or stationary).
  double _currentSpeedMps = -1.0;

  /// Estimated speed limit in mph for the current road segment.
  /// Posted speed limit in mph. Zero means the active provider has not supplied
  /// one; the UI must show unknown and must not infer an overspeed warning.
  double _speedLimitMph = 0.0;

  /// Timestamp of the last "Slow down" TTS announcement.  Used to throttle
  /// repeated announcements so the driver is not nagged every few seconds.
  DateTime? _lastSlowDownAnnouncementTime;

  // Provider-backed intelligence only. Missing HOS/weather/risk values remain
  // absent; SemiTrack does not estimate or fabricate legal ELD information.
  Map<String, dynamic> _intelligence = const {};
  bool _eldHosAvailable = false;
  Timer? _eldHosRefreshTimer;

  // ── Map controller ─────────────────────────────────────────────────────────
  final MapController _mapController = MapController();
  static const double _minimumMapZoom = 3.0;
  static const double _maximumMapZoom = 19.0;

  // ── Navigation vs overview mode ────────────────────────────────────────────
  // When true the camera stays close to the truck (navigation zoom 12.5–15).
  // When false the camera shows the full-route overview.
  bool _navigationMode = false;

  // ── Navigation camera mode ─────────────────────────────────────────────────
  // Primary mode driver for the GPS camera system.  All camera behaviour
  // (follow, overview, free/gesture) is derived from this field.
  NavigationCameraMode _cameraMode = NavigationCameraMode.follow;

  /// Prevents automatic close-follow after the driver explicitly requests a
  /// full-route overview. A new route or recenter tap clears the pin.
  bool _overviewPinnedByUser = false;

  // Convenience getter: true while the camera actively locks onto the truck.
  bool get _followTruck => _cameraMode == NavigationCameraMode.follow;

  // Last bearing accepted for camera rotation (smoothed to avoid jitter).
  double _lastKnownBearing = 0.0;

  // ── Real GPS camera state (smooth follow mode) ────────────────────────────
  // Current smoothed zoom level applied by _updateBestNavigationCamera.
  double _currentCameraZoom = 16.8;

  // Current smoothed pitch applied by _updateBestNavigationCamera.
  double _currentCameraPitch = 45.0;

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

  /// True while live GPS is being evaluated against an authenticated HERE
  /// truck route. This includes licensed native guidance and the online
  /// Explore/REST-assisted preview fallback, but never plain map browsing.
  bool get _isLiveRouteAssistanceActive =>
      _selectedDestination != null &&
      _routePoints.isNotEmpty &&
      (_isNavigating || _routePreviewActive);

  /// Controls the professional full-screen driving layout.
  ///
  /// This is intentionally separate from [_isNavigating]. The latter means a
  /// licensed native guidance engine is running, while HERE Explore route
  /// assistance is also a real, live driving session. Both must use the same
  /// uncluttered driving UI without implying that Explore is HERE Navigate.
  bool get _drivingUiActive => _isLiveRouteAssistanceActive && !_isArrived;

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
  // The full-screen destination sheet keeps a controller for the lifetime of
  // this screen. A modal route's Future completes when pop starts, before its
  // reverse animation and inherited widgets have fully deactivated. Disposing
  // a sheet-owned controller at that point can tear down the TextField during
  // the same frame and trigger framework lifecycle assertions.
  final TextEditingController _destinationSearchController =
      TextEditingController();
  List<PlaceSuggestion> _searchResults = const [];
  bool _isSearching = false;
  String? _searchError;
  Timer? _searchDebounce;
  bool _destinationSearchOpen = false;
  int _destinationSearchRequestGeneration = 0;

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

  // Duration (ms) for each Mapbox easeTo camera transition in follow mode.
  // 650 ms matches a typical GPS update interval and keeps the animation
  // fluid without overshooting when fixes arrive quickly.
  static const _navigationCameraAnimationDurationMs = 650;

  // ── Mapbox public tile access token ──────────────────────────────────────────
  static const _mapboxToken = String.fromEnvironment('MAPBOX_ACCESS_TOKEN');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    TruckMapScreen.isNavigatingNotifier.addListener(
      _handleNavigationScreenAwake,
    );
    _handleNavigationScreenAwake();
    _weighStationService = WeighStationService(widget.api);
    _liveRoadDataService = LiveRoadDataService(widget.api);
    _herePlacesService = HerePlacesService(widget.api);
    _destinationTimeZoneService = DestinationTimeZoneService(widget.api);
    _analyticsService = AnalyticsService(widget.api);
    unawaited(_refreshEldHos());
    _eldHosRefreshTimer = Timer.periodic(
      const Duration(minutes: 5),
      (_) => unawaited(_refreshEldHos()),
    );
    _navAlerts = <NavigationAlert>[];
    _tripProgressInfo = TripProgressInfo(
      milesRemaining: 0,
      durationRemaining: Duration.zero,
      etaLocal: DateTime.now(),
      timezoneLabel: DateTime.now().timeZoneName,
      arrivalDayOffset: 0,
    );
    _startGps();
    // Start empty; authoritative corridor warnings are loaded after routing.
    _warningManager = WarningManager(signs: const <WarningSign>[]);
    // On initial load there is no active route yet, so show all stops so the
    // map is useful before the driver sets a destination.  Once a route is
    // fetched, _truckStops is replaced by the filtered list.
    _truckStops = const <TruckStop>[];
    // Load all brand logo PNGs as raw bytes so that _buildTruckStopMarkers()
    // can render them via Image.memory() — equivalent to Mapbox addImage().
    _preloadBrandIcons();
    // Load all POIs from locations.json so _buildAllPoiMarkers() can display
    // every POI on the map without requiring the Mapbox style cluster setup.
    _loadPoisForMap();
    // Restore persisted POI category toggle state so driver preferences survive
    // app restarts.
    unawaited(_loadNavSettings());
    unawaited(_loadActiveTruckProfile());
    unawaited(_refreshNativeNavigationStatus());
    _nativeNavigationSubscription = NativeNavigationService.instance.states
        .listen(
          _onNativeNavigationState,
          onError: (Object error, StackTrace stackTrace) {
            debugPrint(
              '[Navigation] Native state stream error: $error\n$stackTrace',
            );
          },
          cancelOnError: false,
        );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _appLifecycleState = state;
    if (state == AppLifecycleState.resumed) {
      unawaited(_resumeNavigationAfterBackground());
      return;
    }

    // Do not tear down the active route or native foreground location service.
    // Only invalidate UI-bound work that must not complete against a paused or
    // detached map surface.
    _invalidateCameraUpdates();
    _gestureReturnTimer?.cancel();
    _gestureReturnTimer = null;
  }

  Future<void> _resumeNavigationAfterBackground() async {
    if (_resumeRecoveryInProgress || !mounted) return;
    _resumeRecoveryInProgress = true;
    try {
      await _refreshNativeNavigationStatus();
      if (!mounted || _appLifecycleState != AppLifecycleState.resumed) return;

      await _setNavigationScreenAwake(
        TruckMapScreen.isNavigatingNotifier.value,
      );
      if (!mounted || _appLifecycleState != AppLifecycleState.resumed) return;

      if (_gpsSubscription == null) {
        await _startGps();
      } else if (_isLiveRouteAssistanceActive) {
        await _restartNativeGpsUpdates();
      }
      if (!mounted || _appLifecycleState != AppLifecycleState.resumed) return;

      if (_isLiveRouteAssistanceActive) {
        _refreshRoutePoiSourceIfNeeded(force: true);
        final position = _lastAcceptedPosition;
        if (position != null && _cameraMode == NavigationCameraMode.follow) {
          await _updateBestNavigationCamera(position);
        }
      }
      debugPrint('[Navigation] Foreground state restored without route reset.');
    } on Object catch (error, stackTrace) {
      debugPrint(
        '[Navigation] Foreground recovery failed: $error\n$stackTrace',
      );
    } finally {
      _resumeRecoveryInProgress = false;
    }
  }

  void _invalidateCameraUpdates() {
    _cameraUpdateGeneration++;
    _pendingCameraPosition = null;
  }

  void _handleNavigationScreenAwake() {
    unawaited(
      _setNavigationScreenAwake(TruckMapScreen.isNavigatingNotifier.value),
    );
  }

  Future<void> _setNavigationScreenAwake(bool enabled) async {
    if (_screenAwake == enabled) return;
    _screenAwake = enabled;
    try {
      await _screenAwakeChannel.invokeMethod<void>('setKeepScreenOn', {
        'enabled': enabled,
      });
    } on MissingPluginException {
      // Non-Android builds do not currently expose this optional channel.
    } on PlatformException catch (error) {
      if (kDebugMode) {
        debugPrint('[Navigation] Screen-awake update failed: $error');
      }
    }
  }

  Future<void> _refreshNativeNavigationStatus() async {
    if (mounted) {
      setState(() => _nativeNavigationStatusLoading = true);
    }
    try {
      final status = await NativeNavigationService.instance.status();
      if (!mounted) return;
      setState(() {
        _nativeNavigationStatus = status;
        _nativeNavigationStatusLoading = false;
      });
    } catch (error) {
      if (kDebugMode) {
        debugPrint('[Navigation] Unable to read native status: $error');
      }
      if (!mounted) return;
      setState(() {
        _nativeNavigationStatus = null;
        _nativeNavigationStatusLoading = false;
      });
    }
  }

  Future<void> _loadActiveTruckProfile() async {
    try {
      final response = await widget.api.getJson('/trucks');
      final profiles = (response['items'] as List? ?? const [])
          .map((item) => TruckProfile.fromJson(item as Map<String, dynamic>))
          .toList(growable: false);
      if (profiles.isEmpty) {
        if (mounted) {
          setState(() {
            _error = 'Create and select a truck profile before routing.';
          });
        }
        return;
      }
      final profile =
          profiles.where((item) => item.isDefault).firstOrNull ??
          profiles.first;
      if (mounted) {
        setState(() {
          _activeTruckProfile = profile;
          _truckHeightFt = profile.heightFt;
          _truckWeightTons = profile.weightLbs / 2000;
          _truckLengthFt = profile.lengthFt;
          _hasHazmat = profile.hazmatEnabled;
        });
      }
      await NativeNavigationService.instance.setTruckProfile(
        NativeTruckProfile(
          heightMeters: profile.heightFt * 0.3048,
          widthMeters: profile.widthFt * 0.3048,
          lengthMeters: profile.lengthFt * 0.3048,
          grossWeightKg: profile.weightLbs * 0.45359237,
          axleCount: profile.axleCount,
          axleWeightsKg: profile.weightPerAxleLbs == null
              ? const []
              : List.filled(
                  profile.axleCount,
                  profile.weightPerAxleLbs! * 0.45359237,
                ),
          hazmatEnabled: profile.hazmatEnabled,
          hazmatClasses: profile.hazardousGoods,
          trailerType: profile.trailerType,
        ),
      );
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = 'Unable to load the active truck profile: $error';
        });
      }
    }
  }

  Future<void> _refreshLiveWeighStations() async {
    if (_routePoints.length < 2) return;
    final routeRevision = _activeRouteRevision;
    final route = List<LatLng>.unmodifiable(_routePoints);
    try {
      final upcoming = await _weighStationService.getUpcomingWeighStations(
        route: route,
        currentRouteOffsetMeters: 0,
        routeBearing: _truckBearing,
      );
      if (!mounted || routeRevision != _activeRouteRevision) {
        debugPrint(
          '[RouteData] Discarded stale weigh-station response '
          'revision=$routeRevision current=$_activeRouteRevision',
        );
        return;
      }
      setState(() {
        _mapPois.removeWhere(
          (poi) =>
              !poi.id.startsWith('here:') &&
              (poi.type == PoiType.weighStation ||
                  poi.type == PoiType.portOfEntry),
        );
        _mapPois.addAll(
          upcoming.map(
            (match) => MapPoi(
              id: match.station.id,
              position: match.station.position,
              type: match.station.type == live_ws.WeighStationType.portOfEntry
                  ? PoiType.portOfEntry
                  : PoiType.weighStation,
              name: match.station.name,
              status: match.station.status.name.toUpperCase(),
              weighStation: match.station,
            ),
          ),
        );
      });
      _refreshClosestWeighStationsAhead();
    } catch (error) {
      if (kDebugMode) {
        debugPrint('[WeighStations] Live corridor refresh failed: $error');
      }
    }
  }

  Future<void> _refreshEldHos() async {
    try {
      final response = await widget.api.getJson('/eld/hos/current');
      final items = (response['items'] as List? ?? const [])
          .cast<Map<String, dynamic>>();
      final current = items.where(
        (item) => item['remainingDriveSeconds'] is num,
      );
      if (!mounted) return;
      if (current.isEmpty) {
        setState(() => _eldHosAvailable = false);
        return;
      }
      final seconds = (current.first['remainingDriveSeconds'] as num).toInt();
      setState(() {
        _eldHosAvailable = true;
        _intelligence = {
          ..._intelligence,
          'driveMinutesLeft': (seconds / 60).floor(),
        };
      });
    } catch (_) {
      // Missing provider HOS remains unavailable; never fabricate it locally.
      if (mounted) setState(() => _eldHosAvailable = false);
    }
  }

  Future<void> _refreshLiveRoadData() async {
    if (_routePoints.length < 2) return;
    final routeRevision = _activeRouteRevision;
    final route = List<LatLng>.unmodifiable(_routePoints);
    late final DriverSafetySnapshot snapshot;
    try {
      snapshot = await _liveRoadDataService.loadCorridor(
        route: route,
        routeBearing: _truckBearing,
      );
    } catch (error) {
      if (kDebugMode) {
        debugPrint('[RouteData] Live-road refresh failed: $error');
      }
      return;
    }
    if (!mounted || routeRevision != _activeRouteRevision) {
      debugPrint(
        '[RouteData] Discarded stale live-road response '
        'revision=$routeRevision current=$_activeRouteRevision',
      );
      return;
    }
    final liveAlerts = <NavigationAlert>[];
    final liveWarningSigns = snapshot.events
        .map((event) {
          final type = switch (event.type) {
            'ROAD_CLOSURE' => WarningTypes.roadClosed,
            'CONSTRUCTION' => WarningTypes.constructionZone,
            'CRASH' || 'INCIDENT' => WarningTypes.accidentAhead,
            'HIGH_WIND' => WarningTypes.highWindArea,
            'CHAIN_RESTRICTION' ||
            'SNOW' ||
            'ICE' => WarningTypes.chainRequirement,
            'TRUCK_RESTRICTION' => WarningTypes.noTrucksAllowed,
            'MOUNTAIN_PASS' => WarningTypes.steepGrade,
            _ => WarningTypes.detour,
          };
          final severity = switch (event.severity) {
            'CRITICAL' || 'SEVERE' => 'high',
            'MODERATE' => 'medium',
            _ => 'low',
          };
          return WarningSign(
            id: 'dot-${event.provider}-${event.id}',
            type: type,
            title: event.title,
            lat: event.position.latitude,
            lng: event.position.longitude,
            severity: severity,
            message:
                '${event.provider}${event.description == null ? '' : ' • ${event.description}'}',
            icon: type,
          );
        })
        .toList(growable: false);
    for (final restriction in snapshot.restrictions) {
      if (!(restriction.authoritative ||
          (restriction.verified && restriction.confidence >= 0.7))) {
        continue;
      }
      liveAlerts.add(
        NavigationAlert(
          id: 'live-restriction-${restriction.id}',
          type: restriction.type == 'HEIGHT'
              ? AlertType.lowBridge
              : restriction.type == 'HAZMAT'
              ? AlertType.hazmat
              : AlertType.restrictionDistance,
          severity: AlertSeverity.high,
          title: restriction.type.replaceAll('_', ' '),
          subtitle: restriction.roadName,
          message:
              '${restriction.authoritative ? 'Authoritative' : 'Verified'} ${restriction.source} data • updated ${restriction.lastUpdated.toLocal()}',
          distanceMiles: restriction.routeDistanceAheadMeters / _metersPerMile,
          roadName: restriction.roadName,
          suggestedAction: 'Review restriction before continuing',
        ),
      );
    }
    for (final event in snapshot.events.where(
      (event) => event.severity == 'SEVERE' || event.severity == 'CRITICAL',
    )) {
      liveAlerts.add(
        NavigationAlert(
          id: 'live-event-${event.id}',
          type: switch (event.type) {
            'ROAD_CLOSURE' => AlertType.roadClosure,
            'CONSTRUCTION' => AlertType.construction,
            'CRASH' || 'INCIDENT' => AlertType.accident,
            'HIGH_WIND' => AlertType.highWind,
            _ => AlertType.weather,
          },
          severity: event.severity == 'CRITICAL'
              ? AlertSeverity.high
              : AlertSeverity.medium,
          title: event.title,
          subtitle: event.affectedRoad,
          message:
              '${event.provider} • updated ${event.lastUpdated.toLocal()}${event.description == null ? '' : ' • ${event.description}'}',
          distanceMiles: event.routeDistanceAheadMeters / _metersPerMile,
          roadName: event.affectedRoad,
          suggestedAction: event.type == 'ROAD_CLOSURE'
              ? 'Recalculate route'
              : 'Use caution ahead',
        ),
      );
    }
    for (final parking in snapshot.parking.take(2)) {
      final status = parking.availability.replaceAll('_', ' ');
      liveAlerts.add(
        NavigationAlert(
          id: 'live-parking-${parking.id}',
          type: AlertType.truckParking,
          severity: AlertSeverity.low,
          title: 'Truck parking: $status',
          subtitle: parking.name,
          message: parking.source == 'UNKNOWN'
              ? 'Availability unknown — no fresh provider or community report'
              : '${parking.source} • confidence ${(parking.confidence * 100).round()}%${parking.lastReportedAt == null ? '' : ' • updated ${parking.lastReportedAt!.toLocal()}'}',
          distanceMiles: parking.routeDistanceAheadMeters / _metersPerMile,
          suggestedAction: 'Review parking option ahead',
        ),
      );
    }
    final pricedFuel =
        snapshot.fuel
            .where((station) => station.cashPrice != null)
            .toList(growable: false)
          ..sort((a, b) => a.cashPrice!.compareTo(b.cashPrice!));
    for (final station in pricedFuel.take(2)) {
      liveAlerts.add(
        NavigationAlert(
          id: 'live-fuel-${station.id}',
          type: AlertType.fuelDistance,
          severity: AlertSeverity.low,
          title: 'Diesel \$${station.cashPrice!.toStringAsFixed(3)}/gal',
          subtitle: station.name,
          message:
              '${station.verified ? 'Verified' : 'Reported'} ${station.source ?? 'community'} price${station.observedAt == null ? '' : ' • updated ${station.observedAt!.toLocal()}'}',
          distanceMiles: station.routeDistanceAheadMeters / _metersPerMile,
          suggestedAction: 'Review fuel stop ahead',
        ),
      );
    }
    setState(() {
      _liveParkingLocations = snapshot.parking;
      _liveDieselStations = snapshot.fuel;
      _mapPois.removeWhere((poi) => poi.type == PoiType.camera511);
      _mapPois.addAll(
        snapshot.cameras.map(
          (camera) => MapPoi(
            id: camera.id,
            position: camera.position,
            type: PoiType.camera511,
            name: camera.name,
            status: 'Updated ${camera.lastUpdated.toLocal()}',
          ),
        ),
      );
      _navAlerts.removeWhere((alert) => alert.id.startsWith('live-'));
      _navAlerts.addAll(liveAlerts);
      _warningSigns
        ..clear()
        ..addAll(liveWarningSigns);
    });
    _refreshClosestTruckStopsAhead();
    _warningManager.replaceSigns(liveWarningSigns);
    if (snapshot.errors.isNotEmpty && kDebugMode) {
      debugPrint('[RoadSafety] ${snapshot.errors.join(' | ')}');
    }
  }

  Future<void> _reportWeighStationStatus(MapPoi poi) async {
    final position = _truckPosition;
    if (position == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('A GPS fix is required to report status.'),
        ),
      );
      return;
    }
    final status = await showModalBottomSheet<live_ws.WeighStationStatus>(
      context: context,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(poi.name, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              const Text(
                'Report only what you can currently observe. Reports expire automatically.',
              ),
              const SizedBox(height: 12),
              for (final item in const [
                (live_ws.WeighStationStatus.open, 'Open', Icons.check_circle),
                (live_ws.WeighStationStatus.closed, 'Closed', Icons.cancel),
                (
                  live_ws.WeighStationStatus.inspection,
                  'Inspection active',
                  Icons.policy,
                ),
              ])
                ListTile(
                  leading: Icon(item.$3),
                  title: Text(item.$2),
                  onTap: () => Navigator.pop(context, item.$1),
                ),
            ],
          ),
        ),
      ),
    );
    if (status == null) return;
    try {
      await _weighStationService.reportStatus(
        stationId: poi.id,
        status: status,
        reporterPosition: position,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Status report submitted for verification.'),
        ),
      );
      await _refreshLiveWeighStations();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not submit report: $error')),
      );
    }
  }

  /// Loads persisted [NavSettingsModel] state from [SharedPreferences].
  ///
  /// Called once from [initState].  A [setState] rebuild is requested after
  /// loading so that any restored category toggle changes take effect on the
  /// already-visible map.
  Future<void> _loadNavSettings() async {
    await _initTts();
    await _navSettings.loadFromPrefs();
    await _applyAudioSettings();
    if (mounted) setState(() {});
  }

  /// Loads every [PoiItem] from `assets/locations.json` into [_loadedPois] so
  /// that [_buildAllPoiMarkers] can render them as map markers.
  ///
  /// Called once from [initState]; the result is stored via [setState] so the
  /// marker layer rebuilds as soon as the data is ready.
  Future<void> _loadPoisForMap() async {
    try {
      final List<PoiItem> pois = await loadAllPois();
      if (mounted) {
        setState(() => _loadedPois = pois);
        debugPrint('[PoiMap] Loaded ${pois.length} POI(s) for map display.');
      }
    } catch (e) {
      debugPrint('[PoiMap] Failed to load POIs: $e');
    }
  }

  Future<List<PoiItem>> _safeSearchNearby(
    String category,
    LatLng center,
  ) async {
    try {
      return await _herePlacesService.searchNearby(
        category: category,
        center: center,
        radiusMeters: 100000,
        limit: 75,
      );
    } catch (error) {
      if (kDebugMode) {
        debugPrint('[HERE Places] $category search failed: $error');
      }
      return const [];
    }
  }

  void _mergeProviderPois(
    List<PoiItem> incoming, {
    Set<String> replaceCategories = const {},
  }) {
    if (!mounted) return;
    final byId = <String, PoiItem>{
      for (final poi in _loadedPois)
        if (!(poi.providerBacked && replaceCategories.contains(poi.category)))
          poi.id: poi,
    };
    for (final poi in incoming) {
      byId[poi.id] = poi;
    }
    setState(() {
      _loadedPois = byId.values.toList(growable: false);
      _mapPois.removeWhere(
        (poi) =>
            poi.id.startsWith('here:') &&
            (poi.type == PoiType.weighStation ||
                poi.type == PoiType.portOfEntry),
      );
      _mapPois.addAll(
        incoming
            .where((poi) => poi.category == 'weigh_station')
            .map(
              (poi) => MapPoi(
                id: poi.id,
                position: LatLng(poi.displayLat, poi.displayLng),
                type: PoiType.weighStation,
                name: poi.name,
                status: 'HERE PLACE',
              ),
            ),
      );
    });
  }

  Future<void> _refreshLiveNearbyPois(
    LatLng center, {
    bool force = false,
  }) async {
    if (_isLoadingLivePois) return;
    final lastCenter = _lastLivePoiCenter;
    if (!force &&
        lastCenter != null &&
        geo.Geolocator.distanceBetween(
              lastCenter.latitude,
              lastCenter.longitude,
              center.latitude,
              center.longitude,
            ) <
            40000) {
      return;
    }
    _isLoadingLivePois = true;
    try {
      final batches = await Future.wait([
        _safeSearchNearby('weigh_station', center),
        _safeSearchNearby('truck_stop', center),
        _safeSearchNearby('rest_area', center),
        _safeSearchNearby('truck_parking', center),
        _safeSearchNearby('truck_wash', center),
      ]);
      final places = batches.expand((batch) => batch).toList(growable: false);
      if (!mounted) return;
      _mergeProviderPois(
        places,
        replaceCategories: const {
          // Also clear passenger-oriented results that may have been loaded by
          // an older app build during this process lifetime.
          'fuel_stop',
          'walmart_store',
          'weigh_station',
          'truck_stop',
          'rest_area',
          'truck_parking',
          'truck_wash',
        },
      );
      _lastLivePoiCenter = center;
    } finally {
      _isLoadingLivePois = false;
    }
  }

  List<LatLng> _sampleRouteForPlaceSearch(
    List<LatLng> route, {
    int maxPoints = 500,
  }) {
    if (route.length <= maxPoints) return route;
    return List.generate(maxPoints, (index) {
      final sourceIndex = (index * (route.length - 1) / (maxPoints - 1))
          .round();
      return route[sourceIndex];
    }, growable: false);
  }

  Future<void> _refreshProviderWeighStationsForRoute() async {
    if (_routePoints.length < 2) return;
    final routeRevision = _activeRouteRevision;
    final route = List<LatLng>.unmodifiable(_routePoints);
    try {
      final stations = await _herePlacesService.searchAlongRoute(
        category: 'weigh_station',
        route: _sampleRouteForPlaceSearch(route),
        radiusMeters: 25000,
        maxResults: 200,
      );
      if (!mounted || routeRevision != _activeRouteRevision) {
        debugPrint(
          '[RouteData] Discarded stale provider weigh-station response '
          'revision=$routeRevision current=$_activeRouteRevision',
        );
        return;
      }
      _mergeProviderPois(stations, replaceCategories: const {'weigh_station'});
      if (!mounted || routeRevision != _activeRouteRevision) return;
      setState(() {
        _routeOptions = _routeOptions
            .map(
              (option) => option.copyWith(
                weighStationCount: _countWeighStationsForRoute(option.points),
              ),
            )
            .toList(growable: false);
        _isLoadingRouteWeighStations = false;
        _routeWeighStationsAvailable = true;
      });
      _refreshClosestWeighStationsAhead();
    } catch (error) {
      if (kDebugMode) {
        debugPrint('[HERE Places] route weigh-station search failed: $error');
      }
      if (mounted && routeRevision == _activeRouteRevision) {
        setState(() {
          _isLoadingRouteWeighStations = false;
          _routeWeighStationsAvailable = false;
        });
      }
    }
  }

  Future<void> _showLivePlaceCategory(String category, String title) async {
    final center = _truckPosition;
    if (center == null) {
      setState(() {
        _error = 'Waiting for your live GPS position before loading $title.';
      });
      return;
    }
    final normalizedTitle = title.toLowerCase();
    if (normalizedTitle.contains('fuel')) {
      unawaited(_analyticsService.recordEvent('FUEL_STOP_SEARCH'));
    } else if (category == 'truck_parking') {
      unawaited(_analyticsService.recordEvent('PARKING_SEARCH'));
    }
    // Category sheets are explicit searches. Keep them independent from the
    // automatic map feed so a destination such as Walmart can be searched
    // without becoming an ambient driving POI. Fuel searches intentionally use
    // the truck_stop category at the call site; generic gas stations are never
    // treated as commercial-truck fuel.
    final fetched = await _safeSearchNearby(category, center);
    if (!mounted) return;
    _mergeProviderPois(fetched, replaceCategories: {category});
    final places =
        _loadedPois
            .where(
              (poi) =>
                  poi.category == category &&
                  (poi.providerBacked || poi.verified),
            )
            .toList(growable: false)
          ..sort((a, b) {
            final aDistance = geo.Geolocator.distanceBetween(
              center.latitude,
              center.longitude,
              a.displayLat,
              a.displayLng,
            );
            final bDistance = geo.Geolocator.distanceBetween(
              center.latitude,
              center.longitude,
              b.displayLat,
              b.displayLng,
            );
            return aDistance.compareTo(bDistance);
          });

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(sheetContext).height * 0.62,
          child: Column(
            children: [
              ListTile(
                title: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                subtitle: Text(
                  places.isEmpty
                      ? 'No verified provider places found nearby'
                      : '${places.length} real HERE places near your live position',
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: places.isEmpty
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.all(24),
                          child: Text(
                            'No live results are available in this area. Approximate bundled locations are hidden.',
                            textAlign: TextAlign.center,
                          ),
                        ),
                      )
                    : ListView.separated(
                        itemCount: math.min(places.length, 75),
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (_, index) {
                          final place = places[index];
                          final miles =
                              geo.Geolocator.distanceBetween(
                                center.latitude,
                                center.longitude,
                                place.displayLat,
                                place.displayLng,
                              ) /
                              _metersPerMile;
                          return ListTile(
                            leading: const CircleAvatar(
                              child: Icon(Icons.place_rounded),
                            ),
                            title: Text(place.name),
                            subtitle: Text(
                              place.address.isNotEmpty
                                  ? place.address
                                  : [place.city, place.stateOrProvince]
                                        .where((part) => part.isNotEmpty)
                                        .join(', '),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: Text('${miles.toStringAsFixed(1)} mi'),
                            onTap: () async {
                              if (place.category == 'truck_stop') {
                                unawaited(
                                  _analyticsService.recordEvent(
                                    'TRUCK_STOP_SELECTED',
                                    entityId: place.id,
                                    label: place.name,
                                  ),
                                );
                              }
                              final suggestion = PlaceSuggestion(
                                name: place.name,
                                placeName: place.address.isNotEmpty
                                    ? place.address
                                    : [place.city, place.stateOrProvince]
                                          .where((part) => part.isNotEmpty)
                                          .join(', '),
                                position: LatLng(
                                  place.displayLat,
                                  place.displayLng,
                                ),
                              );
                              Navigator.of(sheetContext).pop();
                              await Future<void>.delayed(
                                const Duration(milliseconds: 220),
                              );
                              if (mounted) {
                                await _showDestinationDetails(suggestion);
                              }
                            },
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _invalidateCameraUpdates();
    _mapReady = false;
    _mapboxMap = null;
    _routeCalculationCoordinator.dispose();
    _roadFeatureRequestGeneration++;
    // Never leave AppShell in its full-screen driving layout after this map
    // screen has been removed (for example after signing out or hot restart).
    TruckMapScreen.isNavigatingNotifier.removeListener(
      _handleNavigationScreenAwake,
    );
    TruckMapScreen.isNavigatingNotifier.value = false;
    unawaited(_setNavigationScreenAwake(false));
    unawaited(_analyticsService.endNavigation(status: 'CANCELED'));
    _analyticsService.dispose();
    unawaited(_gpsSubscription?.cancel());
    unawaited(_nativeNavigationSubscription?.cancel());
    unawaited(
      NativeNavigationService.instance.stopNavigation().catchError((error) {
        if (kDebugMode) debugPrint('[Navigation] Dispose stop failed: $error');
      }),
    );
    unawaited(
      NativeNavigationService.instance.stop().catchError((error) {
        if (kDebugMode) debugPrint('[GPS] Dispose stop failed: $error');
      }),
    );
    _gpsWatchdogTimer?.cancel();
    _eldHosRefreshTimer?.cancel();
    _roadFeatureRefreshTimer?.cancel();
    _animTimer?.cancel();
    _gestureReturnTimer?.cancel();
    _animGeneration++; // cancel any in-flight smooth animation
    _gpsInterpGeneration++; // cancel any in-flight GPS position interpolation
    _tts.stop();
    unawaited(_voiceDestinationService.dispose());
    _searchController.dispose();
    // A bottom-sheet TextField can remain in its reverse transition for a
    // frame after the parent screen is removed. Delay controller teardown so
    // Flutter never deactivates an inherited dependency around a disposed
    // controller (framework.dart `_dependents.isEmpty`).
    if (_destinationSearchOpen) {
      _destinationSearchOpen = false;
      _destinationSearchRequestGeneration++;
      final controller = _destinationSearchController;
      Future<void>.delayed(
        const Duration(milliseconds: 500),
        controller.dispose,
      );
    } else {
      _destinationSearchController.dispose();
    }
    _searchDebounce?.cancel();
    _warningManager.dispose();
    _routeHitNotifier.dispose();
    super.dispose();
  }

  /// Applies authoritative route-progress events emitted by the native
  /// guidance provider. GPS fixes continue to arrive on the same bridge but
  /// are handled independently by [_onGpsPosition].
  void _onNativeNavigationState(NativeNavigationState state) {
    if (!mounted) return;

    final current = state.currentManeuver;
    final next = state.nextManeuver;
    setState(() {
      _nativeNavigationPhase = state.phase;
      final nativeRerouting = state.phase == NativeNavigationPhase.rerouting;
      final coordinatedRerouting = _routeCalculationCoordinator.inProgress;
      _isRerouting = nativeRerouting || coordinatedRerouting;
      if (nativeRerouting) {
        _navStatus = 'Rerouting...';
      } else if (!coordinatedRerouting) {
        _navStatus = null;
      }

      final distance = state.remainingDistanceMeters;
      final seconds = state.remainingDurationSeconds;
      if (distance != null && seconds != null) {
        final arrived = state.phase == NativeNavigationPhase.arrived;
        _tripProgressInfo = _createTripProgress(
          distance / _metersPerMile,
          Duration(seconds: seconds.round()),
          forceZero: arrived,
        );
      }

      if (state.phase == NativeNavigationPhase.navigating ||
          state.phase == NativeNavigationPhase.rerouting) {
        _isNavigating = true;
        _navigationActive = true;
        TruckMapScreen.isNavigatingNotifier.value = true;
      } else if (state.phase == NativeNavigationPhase.arrived) {
        _isNavigating = false;
        _navigationActive = false;
        _isArrived = true;
        TruckMapScreen.isNavigatingNotifier.value = false;
      }

      if (state.phase == NativeNavigationPhase.error) {
        _error = state.errorMessage ?? 'Native navigation failed safely.';
      }
    });

    if (current != null) {
      final distanceMiles = (current.distanceMeters ?? 0) / _metersPerMile;
      _updateTopInstructionFromNavigationStep(
        maneuverType: current.type,
        modifier: null,
        instruction: current.instruction,
        roadName: current.roadName,
        currentRoadName: state.roadName,
        nextRoadName: next?.roadName,
        distanceMiles: distanceMiles,
        exitNumber: current.exitNumber,
      );
      _updateUpcomingManeuver(
        maneuverType: current.type,
        distanceMiles: distanceMiles,
        isHighwayManeuver: _maneuverNeedsJunctionView(current.type),
        roadName: current.roadName,
        lanes: current.lanes.map(_nativeLane).toList(growable: false),
      );
      final instruction = current.instruction.trim();
      if ((state.phase == NativeNavigationPhase.navigating ||
              state.phase == NativeNavigationPhase.rerouting) &&
          instruction.isNotEmpty &&
          instruction != _lastNativeSpokenInstruction) {
        _lastNativeSpokenInstruction = instruction;
        unawaited(_speak(instruction));
      }
    }
  }

  LaneInfo _nativeLane(NavigationLane lane) => LaneInfo(
    directions: lane.directions
        .map(_nativeLaneDirection)
        .whereType<LaneDirection>()
        .toList(growable: false),
    isRecommended: lane.recommended,
  );

  LaneDirection? _nativeLaneDirection(String direction) {
    switch (direction.toLowerCase().replaceAll('_', '')) {
      case 'left':
        return LaneDirection.left;
      case 'slightleft':
        return LaneDirection.slightLeft;
      case 'straight':
        return LaneDirection.straight;
      case 'slightright':
        return LaneDirection.slightRight;
      case 'right':
        return LaneDirection.right;
      case 'uturn':
        return LaneDirection.uTurn;
      default:
        return null;
    }
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
    final AssetManifest manifest = await AssetManifest.loadFromAssetBundle(
      rootBundle,
    );
    final List<String> allPaths = manifest.listAssets();
    final List<String> logoPaths = allPaths
        .where(
          (s) =>
              s.startsWith('assets/logo_brand_markers/') && s.endsWith('.png'),
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
      point:
          _truckPosition ??
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
        // Top-down truck sprite.  When customTruckAvatar is enabled, attempt
        // to load 'assets/icons/truck_custom.png'; fall back to the standard
        // truck_top.png (and ultimately to a coloured icon) on error.
        child: Image.asset(
          _navSettings.customTruckAvatar
              ? 'assets/icons/truck_custom.png'
              : 'assets/icons/truck_top.png',
          width: 48,
          height: 48,
          errorBuilder: (_, __, ___) => Icon(
            Icons.local_shipping,
            size: 44,
            color: _navSettings.customTruckAvatar ? Colors.purple : Colors.blue,
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

  // ── Truck Stop POI methods ─────────────────────────────────────────────────

  /// Filters [allStops] to only those within [maxDistanceMeters] of any point
  /// on [routePoints].  Call this after a new route loads to refresh the POI
  /// overlay without showing every stop in the country.
  ///
  /// Uses [geo.Geolocator.distanceBetween] for GPS-grade accuracy.
  ///
  /// **Performance note:** This is an O(n×m) scan (n stops × m route points).
  /// When operating on thousands of entries, replace this
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
      debugPrint(
        '[POI/Alert Filter] Truck stop markers: route not set – hiding all stops.',
      );
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
        _truckPosition ??
        (routePoints.isNotEmpty ? routePoints.first : const LatLng(0, 0));
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
    final result = nearRoute.length > maxPOIs
        ? nearRoute.sublist(0, maxPOIs)
        : nearRoute;

    debugPrint(
      '[POI/Alert Filter] Truck stop markers: ${result.length}/${allStops.length} shown '
      '(within ${(maxDistanceMeters / 1609.34).toStringAsFixed(1)} miles of route).',
    );

    return result;
  }

  /// Returns the number of verified commercial truck stops within
  /// [maxDistanceMeters] of any point in [routePoints].
  int _countFuelStopsForRoute(
    List<LatLng> routePoints, {
    double maxDistanceMeters = 5000,
  }) {
    return _loadedPois.where((poi) {
      if (poi.category != 'truck_stop') return false;
      if (!(poi.providerBacked || poi.verified)) return false;
      for (final pt in routePoints) {
        final d = geo.Geolocator.distanceBetween(
          poi.displayLat,
          poi.displayLng,
          pt.latitude,
          pt.longitude,
        );
        if (d <= maxDistanceMeters) return true;
      }
      return false;
    }).length;
  }

  /// Returns the number of weigh-station [MapPoi]s within [maxDistanceMeters]
  /// of any point in [routePoints].
  int _countWeighStationsForRoute(
    List<LatLng> routePoints, {
    double maxDistanceMeters = 5000,
  }) {
    final stationPositions = <String, LatLng>{
      for (final poi in _mapPois)
        if (poi.type == PoiType.weighStation || poi.type == PoiType.portOfEntry)
          poi.id: poi.position,
      for (final poi in _loadedPois)
        if (poi.category == 'weigh_station')
          poi.id: LatLng(poi.displayLat, poi.displayLng),
    };
    return stationPositions.values.where((position) {
      for (final point in routePoints) {
        final distance = geo.Geolocator.distanceBetween(
          position.latitude,
          position.longitude,
          point.latitude,
          point.longitude,
        );
        if (distance <= maxDistanceMeters) return true;
      }
      return false;
    }).length;
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
    if (n.contains('road ranger') || n.contains('roadranger'))
      return 'roadranger';
    if (n.contains('am best') || n.contains('ambest')) return 'ambest';
    if (n.contains('sapp bros') || n.contains('sappbros')) return 'sappbros';

    // Canadian brands (check before generic 'petro' to avoid false match)
    if (n.contains('petro-canada') ||
        n.contains('petrocanada') ||
        n.contains('petro canada'))
      return 'petro-canada';
    if (n.contains('husky')) return 'husky';
    if (n.contains('esso')) return 'esso';
    if (n.contains('ultramar')) return 'ultramar';
    if (n.contains('irving')) return 'irving';

    // TA / Petro (must follow petro-canada check above)
    if (n == 'ta' ||
        n.startsWith('ta ') ||
        n.contains('travelcenters') ||
        n.contains('travel center') ||
        n.contains('ta petro'))
      return 'ta';
    if (n.contains('petro')) return 'petro';

    // Regional chains
    if (n.contains('kwik trip') || n.contains('kwiktrip')) return 'kwiktrip';
    if (n == 'qt' ||
        n.contains('quiktrip') ||
        n.contains('quicktrip') ||
        n.contains('quick trip'))
      return 'qt';
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
        n == 'weigh')
      return 'weigh';

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
    'pilot': 'assets/logo_brand_markers/pilot.png',
    'loves': 'assets/logo_brand_markers/loves.png',
    'ta': 'assets/logo_brand_markers/ta_truck_stop.png',
    'petro': 'assets/logo_brand_markers/petro_truck_stop.png',
    'flyingj': 'assets/logo_brand_markers/flying_j_truck_stop.png',
    'mobil': 'assets/logo_brand_markers/truck_parking.png',
    'chevron': 'assets/logo_brand_markers/truck_parking.png',
    'shell': 'assets/logo_brand_markers/truck_parking.png',
    'bp': 'assets/logo_brand_markers/truck_parking.png',
    'circlek': 'assets/logo_brand_markers/circle_truck_stop.png',
    'weigh': 'assets/logo_brand_markers/weight_station.png',
    'rest': 'assets/logo_brand_markers/rest_area.png',
    'roadranger': 'assets/logo_brand_markers/truck_parking.png',
    'ambest': 'assets/logo_brand_markers/truck_parking.png',
    'quicktrip': 'assets/logo_brand_markers/quicktrip_truck_stop.png',
    'esso': 'assets/logo_brand_markers/truck_parking.png',
    'petrocanada': 'assets/logo_brand_markers/petro_canada_truck_stop.png',
    // NOTE: 'walmart' is intentionally omitted here.
    // Walmart store locations are sourced exclusively from
    // assets/walmart-stores.json and rendered via the POI cluster layer
    // (_buildAllPoiMarkers / loadWalmartPois). Do NOT add Walmart to this map.
    'hotel': 'assets/logo_brand_markers/hotel_default.png',
    'restaurant': 'assets/logo_brand_markers/restaurant.png',
    'truckwash': 'assets/logo_brand_markers/commercial_vehicle_wash.png',
    'gym': 'assets/logo_brand_markers/gym.png',
    'maverik': 'assets/logo_brand_markers/truck_parking.png',
  };

  /// Builds the list of [Marker]s for each visible truck stop in [_truckStops].
  ///
  /// Returns an empty list when [_showTruckStops] is false so markers disappear
  /// immediately when the driver toggles the POI overlay off.
  ///
  /// If a stop's [TruckStop.assetLogo] has been loaded into [_brandIconBytes]
  /// it is used as the marker image; otherwise a fallback icon is shown so
  /// every stop is visible on the map.  Tapping a marker calls
  /// [_showTruckStopSheet].
  List<Marker> _buildTruckStopMarkers() {
    if (!_showTruckStops || _truckStops.isEmpty) return const [];

    final markers = <Marker>[];
    for (final stop in _truckStops) {
      final Uint8List? bytes = stop.assetLogo != null
          ? _brandIconBytes[stop.assetLogo]
          : null;

      // Use orange for truck-stop pins.
      // NOTE: Walmart store markers are NOT rendered here — they come
      // exclusively from assets/walmart-stores.json via loadWalmartPois() and
      // are displayed by the POI cluster layer (_buildAllPoiMarkers).
      final Color pinColor = Colors.orange.shade700;

      // Render every truck stop as a GPS teardrop-pin shape so they are
      // visually consistent with PoiItem-based markers built by
      // _buildAllPoiMarkers().  The brand logo PNG is embedded inside the
      // circular pin head when available; otherwise a fallback icon is shown.
      final Widget pinWidget = buildGpsPinMarker(
        pinColor: pinColor,
        imageBytes: bytes,
        fallbackIcon: Icons.local_gas_station,
        pinSize: _kPoiPinSize,
      );

      markers.add(
        Marker(
          point: stop.position,
          width: _kPoiPinSize,
          height: _kPoiPinSize,
          alignment: Alignment.topCenter,
          child: GestureDetector(
            onTap: () => _showTruckStopSheet(stop),
            child: pinWidget,
          ),
        ),
      );
    }
    return markers;
  }

  /// Builds [Marker]s for [MapPoi] entries of type [PoiType.weighStation].
  ///
  /// **Data source:** [_mapPois] is populated only from the authenticated
  /// safety API and the versioned official offline dataset. Unverified legacy
  /// `locations.json` weigh-station entries are excluded by [PoiService].
  ///
  /// **Marker placement:** Every marker is rendered at the POI's true stored
  /// [MapPoi.position] coordinate — never at a snapped or shifted route point.
  /// [_snapToNearestRoutePoint] is called only as a route-proximity filter:
  /// stations more than 500 m from the active route are skipped during
  /// navigation to reduce clutter.  The snapped coordinate is discarded and
  /// must not be used for display.
  ///
  /// The next upcoming weigh station during navigation is highlighted with an
  /// orange ring so it stands out from the others.
  List<Marker> _buildPoiMarkers() {
    // Hidden when the weigh-station layer is toggled off in nav settings.
    if (!_navSettings.viewWeighStation) return const [];

    // Avoid rendering a sourced station twice if it is also present in the
    // general POI layer.
    final bool realWeighStationsLoaded = _loadedPois.any(
      (p) => p.category == 'weigh_station',
    );
    if (realWeighStationsLoaded) return const [];

    const String weighStationAsset =
        'assets/logo_brand_markers/weight_station.png';
    final Uint8List? weighBytes = _brandIconBytes[weighStationAsset];

    if (weighBytes == null) {
      debugPrint(
        '[PoiMarkers] Weigh-station icon not loaded from "$weighStationAsset". '
        'Rendering all weigh-station POIs with fallback icon.',
      );
    }

    // Route-matched stations from the live/offline weigh repository.
    final List<MapPoi> weighStations = _mapPois
        .where((p) => p.type == PoiType.weighStation)
        .toList();

    // Determine which weigh station is the active next one during navigation
    // so it can be rendered with a distinct highlight ring.
    final String? nextStationId =
        (_isNavigating && _closestWeighStationsAhead.isNotEmpty)
        ? _closestWeighStationsAhead.first.poi.id
        : null;

    final List<Marker> markers = [];

    for (final poi in weighStations) {
      // Route-proximity filter only: skip stations that are more than 500 m
      // from the active route polyline (no active route = all skipped).
      // The snapped point is intentionally discarded — it must not be used
      // for rendering. Markers are always placed at the true stored coordinate.
      final bool isNearRoute = _snapToNearestRoutePoint(poi.position) != null;
      if (!isNearRoute) continue;

      final bool isNext = poi.id == nextStationId;
      // All markers use the same uniform pin size; the active-next station gets
      // an additional glow border to stand out from nearby weigh stations.
      final double size = _kPoiPinSize;

      // Always render at the true stored coordinate — never a snapped/shifted
      // route point. Route snapping is for filtering only (see above).
      final LatLng displayPoint = poi.position;

      // Validate whether this POI's stored coordinate passes sanity checks.
      final bool isSuspect = _isPoiLocationSuspect(poi.position);

      Widget pinWidget = buildGpsPinMarker(
        pinColor: isNext ? Colors.deepOrange : Colors.orange,
        imageBytes: weighBytes,
        fallbackIcon: Icons.scale,
        pinSize: size,
      );

      // Apply the suspect badge before adding the glow ring so the badge
      // stays in the top-right corner regardless of the ring decoration.
      pinWidget = _withSuspectBadge(pinWidget, suspect: isSuspect);

      // The next station uses the same silhouette in an orange highlight color;
      // keeping the outline uniform avoids the old circular halo mismatch.
      final double baseSize = size;

      // Label: only shown when the coordinate fails sanity / road-proximity
      // checks.  Non-suspect POIs render without a label — they are at their
      // true stored position and need no qualification.
      final Widget markerChild = isSuspect
          ? Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                pinWidget,
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 4,
                    vertical: 1,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.deepOrange.shade700,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Text(
                    'Suspect Location',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            )
          : pinWidget;

      markers.add(
        Marker(
          point: displayPoint,
          width: baseSize,
          height: isSuspect ? baseSize + _kPoiLabelHeight : baseSize,
          alignment: Alignment.topCenter,
          child: GestureDetector(
            onTap: () => _showPoiAlert(poi),
            child: markerChild,
          ),
        ),
      );
    }

    return markers;
  }

  /// Returns the accent [Color] used for GPS pin markers of the given POI
  /// [category].  Matches the color conventions used across the app:
  ///   • `truck_stop`           → blue   (fuel/parking)
  ///   • `weigh_station`        → orange (regulatory)
  ///   • `rest_area`            → green  (amenity/comfort)
  ///   • `gas_station`          → green  (fuel — bright green for quick ID)
  ///   • `fuel_stop`            → green  (fuel — alias for gas_station)
  ///   • `truck_parking`        → blue   (dedicated truck parking)
  ///   • `port_of_entry`        → purple (border crossing / regulatory)
  ///   • `brake_check_area`     → amber  (safety area)
  ///   • `hotel`                → indigo (lodging)
  ///   • `restaurant`           → red    (dining)
  ///   • `gym`                  → teal   (fitness)
  ///   • `commercial_vehicle`   → brown  (commercial services)
  ///   • anything else          → blue   (generic default)
  Color _poiCategoryColor(String category) {
    switch (category) {
      case 'weigh_station':
        return Colors.orange;
      case 'rest_area':
        return Colors.green.shade700;
      case 'gas_station':
      case 'fuel_stop':
        return Colors.green.shade600;
      case 'truck_parking':
        return Colors.blue.shade800;
      case 'port_of_entry':
        return Colors.purple.shade700;
      case 'brake_check_area':
        return Colors.amber.shade700;
      case 'hotel':
        return Colors.indigo.shade600;
      case 'restaurant':
        return Colors.red.shade700;
      case 'gym':
        return Colors.teal.shade700;
      case 'commercial_vehicle':
        return Colors.brown.shade600;
      case 'walmart_store':
        return const Color(0xFF0071CE); // Walmart brand blue
      default:
        return Colors.blue.shade700;
    }
  }

  /// Returns the [IconData] placed inside the GPS pin for the given POI
  /// [category] when no branded PNG is available.
  IconData _poiCategoryIcon(String category) {
    switch (category) {
      case 'weigh_station':
        return Icons.scale;
      case 'rest_area':
        return Icons.local_hotel;
      case 'gas_station':
      case 'fuel_stop':
        return Icons.local_gas_station;
      case 'truck_parking':
        return Icons.local_parking;
      case 'port_of_entry':
        return Icons.flag;
      case 'brake_check_area':
        return Icons.warning_amber_rounded;
      case 'hotel':
        return Icons.hotel;
      case 'restaurant':
        return Icons.restaurant;
      case 'gym':
        return Icons.fitness_center;
      case 'commercial_vehicle':
        return Icons.local_shipping;
      case 'walmart_store':
        return Icons.store;
      default:
        return Icons.local_shipping;
    }
  }

  // Uniform bounding-box size used for every GPS-pin POI marker so all types
  // appear at the same size on the map.
  // 66 logical pixels is the standard on-road POI size: large enough for
  // commercial brand marks to be recognized at a glance while driving.
  static const double _kPoiPinSize = 66.0;

  // Extra height added to a weigh-station marker's bounding box to accommodate
  // the "(approx)" / "Entrance Here" / "Suspect Location" label below the pin.
  static const double _kPoiLabelHeight = 18.0;

  // Maximum distance (metres) a POI may be from any active-route segment
  // before it is considered a "suspect location".  100 m is generous enough
  // to include truck stops and rest areas that sit just off the highway at an
  // exit ramp while still filtering coordinates that are genuinely in an open
  // field or parcel centre far from any road.
  static const double _kPoiRoadProximityMeters = 100.0;

  /// Builds a GPS teardrop-pin [Widget] for a POI, optionally embedding a
  /// branded logo image inside the pin head.
  ///
  /// All POI types (truck stop, hotel, restaurant, rest area, gym, commercial
  /// vehicle, and weight station) are rendered at the same fixed
  /// [_kPoiPinSize] × [_kPoiPinSize] bounding box so every marker is visually
  /// uniform on the map.  When [bytes] is non-null the decoded PNG is shown
  /// inside the white circular head; otherwise the fallback icon for [category]
  /// (determined by [_poiCategoryIcon]) is displayed inside the head.
  ///
  /// **Verified vs. approximate icon:**
  /// - [isVerified] `true`  → Both [PoiItem.entranceLat] and
  ///   [PoiItem.entranceLng] are set, meaning the marker is placed at the
  ///   confirmed truck-entrance GPS fix.  The pin uses the full category colour
  ///   (the **verifiedIcon** appearance).
  /// - [isVerified] `false` → One or both entrance coordinates are absent; the
  ///   marker falls back to the property-centre coordinate and is rendered in
  ///   grey (the **approximateIcon** appearance) to signal that the precise
  ///   entrance location has not yet been confirmed.
  Widget _buildGpsPinWidget(
    String category, {
    Uint8List? bytes,
    bool isVerified = true,
  }) {
    // Verified POIs use the category colour (verifiedIcon).
    // Approximate POIs use grey to signal an unconfirmed entrance location
    // (approximateIcon).
    final Color pinColor = isVerified
        ? _poiCategoryColor(category)
        : Colors.grey.shade500;
    return buildGpsPinMarker(
      pinColor: pinColor,
      imageBytes: bytes,
      fallbackIcon: _poiCategoryIcon(category),
      pinSize: _kPoiPinSize,
    );
  }

  /// Wraps [child] with a small orange warning-triangle badge in the top-right
  /// corner when [suspect] is `true`, visually indicating that the POI's map
  /// location could not be verified against a real road.  Returns [child]
  /// unchanged when [suspect] is `false`.
  Widget _withSuspectBadge(Widget child, {required bool suspect}) {
    if (!suspect) return child;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        child,
        Positioned(
          top: -4,
          right: -4,
          child: Container(
            width: 20,
            height: 20,
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.warning_amber_rounded,
              size: 16,
              color: Colors.deepOrange,
            ),
          ),
        ),
      ],
    );
  }

  /// Builds [Marker]s for every [PoiItem] in [_loadedPois] (from
  /// `assets/locations.json`).
  ///
  /// **Verified vs. approximate markers (data quality):** Every POI is shown
  /// on the driver's map regardless of whether entrance coordinates are
  /// present.  The [PoiItem.verified] flag and entrance coordinates determine
  /// the marker style:
  ///   • **verified marker** (category colour) — [PoiItem.verified] is `true`
  ///     and both [PoiItem.entranceLat] / [PoiItem.entranceLng] are set; the
  ///     marker is placed at the confirmed truck-entrance GPS fix.
  ///   • **approximate marker** (grey) — [PoiItem.verified] is `false` or
  ///     either entrance coordinate is absent; the marker uses the
  ///     property-centre coordinate ([PoiItem.lat]/[PoiItem.lng]) and is
  ///     displayed in grey to signal that the location is an estimate.  Data
  ///     editors can find these POIs via [_showApproxPoiAdminSheet] to add
  ///     precise entrance coordinates and set `verified=true`.
  ///
  /// Every POI — truck stop, hotel, restaurant, rest area, gym, commercial
  /// vehicle, and weight station — is rendered at a uniform size using the GPS
  /// teardrop-pin shape so all types look visually consistent.  Branded logo
  /// bytes are embedded in the pin head when available; otherwise a
  /// category-appropriate fallback icon is shown.
  ///
  /// **Location suspect validation:** Every displayed POI is evaluated by
  /// [_isPoiLocationSuspect].  POIs that fail are rendered with an orange
  /// warning-triangle badge and an orange "Suspect Location" label.
  ///
  /// Tapping a marker shows a dialog with the POI name.
  ///
  /// Smart filtering rules (GPS-app style):
  ///   • zoom < [_poiHideZoomThreshold] (10.5)   → no markers shown
  ///   • [_shouldUseClustersAtZoom] returns true  → cluster badges (zoom 10.5–13.5)
  ///   • [_shouldUseClustersAtZoom] returns false → individual markers
  ///
  /// POI selection (both modes):
  ///   • POIs are selected from the current map **viewport bounds** via
  ///     [_getVisiblePoisForCurrentView], so every POI on screen is included
  ///     regardless of the truck's GPS position.
  ///   • Overlap dedup: lower-priority markers within [_poiOverlapMinMeters] of a
  ///     higher-priority one are skipped (see [_limitAndDedupePois]).
  List<Marker> _buildAllPoiMarkers() {
    if (_loadedPois.isEmpty || !_showTruckStops) return const [];

    // ── Zoom gating ────────────────────────────────────────────────────────
    final double zoom = _mapReady ? _mapController.camera.zoom : 15.0;
    if (zoom < _poiHideZoomThreshold) return const [];

    // ── Filtered candidate list ────────────────────────────────────────────
    // Apply category-filter settings (Places Filter) so toggling a category
    // off in nav settings removes its markers here too.
    final List<PoiItem> filtered = _getFilteredPoisForDisplay();

    // ── Cluster mode: zoom 10.5–13.5 ──────────────────────────────────────
    // _shouldUseClustersAtZoom returns true at/below 13.5, so at exactly 13.5
    // the map shows clusters; above 13.5 it transitions to individual markers.
    // Use _shouldUseClustersAtZoom so the threshold is consistent everywhere.
    if (_shouldUseClustersAtZoom(zoom)) {
      return _buildPoiClusterMarkers(filtered);
    }

    // ── Individual markers: zoom > 13.5 ───────────────────────────────────
    final List<Marker> markers = [];
    int suspectCount = 0;

    for (final poi in filtered) {
      final String? assetKey = poi.icon.isNotEmpty
          ? 'assets/logo_brand_markers/${poi.icon}.png'
          : null;
      final Uint8List? bytes = assetKey != null
          ? _brandIconBytes[assetKey]
          : null;

      // A POI is "verified" when the verified flag is true AND both entrance
      // lat and lng are provided — i.e. the entrance GPS fix has been
      // confirmed against real road / satellite imagery.
      // Verified POIs get the category-colour verifiedIcon; those with
      // verified=false or missing entrance coordinates are rendered with a
      // grey approximateIcon.
      final bool isVerified =
          poi.verified && poi.entranceLat != null && poi.entranceLng != null;

      Widget pinWidget = _buildGpsPinWidget(
        poi.category,
        bytes: bytes,
        isVerified: isVerified,
      );

      final LatLng displayCoord = LatLng(poi.displayLat, poi.displayLng);
      final bool isSuspect = _isPoiLocationSuspect(
        displayCoord,
        poiLabel: '"${poi.name}" (id=${poi.id})',
      );
      if (isSuspect) suspectCount++;
      pinWidget = _withSuspectBadge(pinWidget, suspect: isSuspect);

      markers.add(
        Marker(
          point: displayCoord,
          width: _kPoiPinSize,
          height: _kPoiPinSize,
          alignment: Alignment.topCenter,
          child: GestureDetector(
            onTap: () => _showPoiInfoDialog(poi),
            child: pinWidget,
          ),
        ),
      );
    }

    debugPrint(
      '[POI] ${filtered.length} markers shown '
      '(zoom=${zoom.toStringAsFixed(1)}, '
      'navigating=$_isNavigating, suspect=$suspectCount).',
    );

    return markers;
  }

  /// Returns the smart-filtered set of [PoiItem]s to render on the map.
  ///
  /// Delegates to [_getVisiblePoisForCurrentView], which chooses between
  /// navigation mode (ahead-on-route, priority-sorted) and browse mode
  /// (nearby radius).  Category toggles from the driver's Places Filter are
  /// applied via [_applyPoiCategoryFilters] before the result is returned.
  List<PoiItem> _getFilteredPoisForDisplay() =>
      _applyPoiCategoryFilters(_getVisiblePoisForCurrentView());

  // ── POI category toggle helpers ──────────────────────────────────────────

  /// Returns `true` when [category] is enabled by the driver's Places Filter
  /// settings in [_navSettings].
  ///
  /// [category] values match the `category` field in `assets/locations.json`
  /// (e.g. `'truck_stop'`, `'weigh_station'`).
  bool _isPoiCategoryEnabled(String category) {
    switch (category.toLowerCase().trim()) {
      case 'truck_stop':
        return _navSettings.showTruckStops;
      case 'weigh_station':
        return _navSettings.showWeighStations;
      case 'rest_area':
        return _navSettings.showRestAreas;
      case 'brake_check_area':
        return _navSettings.showBrakeCheckAreas;
      case 'truck_parking':
        return _navSettings.showTruckParking;
      case 'commercial_vehicle_wash':
      case 'truck_wash':
        return _navSettings.showTruckWash;
      case 'port_of_entry':
        return _navSettings.showWeighStations;
      case 'weather_alert':
        return _navSettings.showWeatherAlerts;
      case 'warning_sign':
        return _navSettings.showWarningSigns;
      case 'tollbooth':
        return _navSettings.showTollbooths;
      case 'camera_511':
        return _navSettings.show511Cameras;
      default:
        // The driving map is commercial-vehicle-only. Unknown, generic fuel,
        // restaurant, hotel, and retail categories fail closed instead of
        // silently appearing as truck services. They remain available through
        // an explicit destination search.
        return false;
    }
  }

  /// Filters [pois] to only those whose category is currently enabled in the
  /// driver's Places Filter settings.
  ///
  /// Call this before any route-ahead or browse POI source build to ensure
  /// disabled categories are excluded everywhere.
  List<PoiItem> _applyPoiCategoryFilters(List<PoiItem> pois) {
    return pois
        .where((p) => _isPoiCategoryEnabled(p.category))
        .toList(growable: false);
  }

  /// Triggers an immediate map refresh so that changes to the Places Filter
  /// category toggles take effect without requiring an app restart.
  ///
  /// Call this whenever a category toggle changes (e.g. inside the
  /// [NavSettingsScreen.onChanged] callback).
  Future<void> _refreshAllPoiSourcesForSettingsChange() async {
    if (!mounted) return;
    setState(() {});
    debugPrint('[POI] Category toggle changed — refreshed all POI sources.');
  }

  // ── POI helper functions ────────────────────────────────────────────────

  /// Returns a priority score for [poi] that governs deduplication ordering.
  ///
  /// Higher-priority categories (weigh stations, truck stops) score higher.
  /// Verified POIs (entrance coords present) receive a +20 bonus to ensure
  /// they are always preferred over approximate entries at the same location.
  ///
  /// Rule: verified entrance-coordinate POIs always beat approximate ones.
  double _poiPriorityScore(PoiItem poi) {
    // Null-safe category normalisation.
    final String category = poi.category.toLowerCase().trim();
    // Verified = verified flag true and both entranceLat and entranceLng present.
    final double verified =
        (poi.verified && poi.entranceLat != null && poi.entranceLng != null)
        ? 1.0
        : 0.0;

    double base;
    switch (category) {
      case 'weigh_station':
        base = 100; // Mandatory compliance stop — highest priority.
        break;
      case 'truck_stop':
        base = 90; // Primary rest/fuel stop for truck drivers.
        break;
      case 'rest_area':
        base = 75; // DOT rest area — federally maintained.
        break;
      case 'brake_check_area':
        base = 72; // Safety-critical on mountain grades.
        break;
      case 'truck_parking':
        base = 68; // Dedicated truck parking.
        break;
      case 'walmart_store':
        base = 60; // Walmart Supercenter — shopping, parking, overnight.
        break;
      case 'restaurant':
        base = 55; // Restaurant — dining stop for drivers.
        break;
      case 'commercial_vehicle_wash':
        base = 50; // Useful but lower urgency.
        break;
      default:
        base = 40; // All other categories.
    }

    // Verified entrance coords add 20 so verified beats approximate for same
    // category — prevents approximate POIs from crowding out verified ones.
    return base + (verified * 20.0);
  }

  /// Returns `true` when [a] has a strictly higher priority score than [b].
  ///
  /// Use this to determine whether [a] should displace [b] when they are
  /// within [_poiOverlapMinMeters] of each other.  Also used internally by
  /// [_limitAndDedupePois] to establish the sort order before deduplication.
  bool _isHigherPriorityPoi(PoiItem a, PoiItem b) =>
      _poiPriorityScore(a) > _poiPriorityScore(b);

  /// Returns `true` when the given [zoom] level is in the cluster range.
  ///
  /// Rule: zoom ≤ [_poiClusterZoomThreshold] (13.5) → show cluster badges.
  ///       zoom >  13.5 → show individual POI icons.
  ///
  /// The Dart overlay rendering (not the Mapbox tile layers) uses this to
  /// branch between [_buildPoiClusterMarkers] and individual markers, so only
  /// one mode is active at a time — there is no ambiguity at exactly 13.5.
  ///
  /// Centralises the cluster/individual threshold so [_buildAllPoiMarkers]
  /// and [_setupPoiCluster] stay consistent.
  bool _shouldUseClustersAtZoom(double zoom) =>
      zoom <= _poiClusterZoomThreshold;

  /// Returns all POIs that lie ahead of the truck on the active route.
  ///
  /// Pre-filters [_loadedPois] to the route corridor ([_poiRouteCorridorMeters])
  /// ahead of [_truckIndex], then:
  ///   • skips POIs already passed (< [_poiPassedThresholdMiles])
  ///   • applies category-specific look-ahead caps:
  ///       - weigh_station: [_poiWeighStationMaxAheadMiles] (100 mi)
  ///       - all others: [_poiRouteMaxAheadMiles] (50 mi)
  ///
  /// Returns an empty list when not navigating or position is unavailable.
  List<PoiItem> _getRouteAheadPois() {
    final LatLng? pos = _truckPosition;
    if (!_isLiveRouteAssistanceActive || pos == null || _routePoints.isEmpty) {
      return const [];
    }

    // Slice route points from the truck's current index forward.
    final List<LatLng> aheadPoints = _routePoints.sublist(
      _truckIndex.clamp(0, _routePoints.length),
    );

    // Pre-filter to POIs near the route corridor.
    final List<PoiItem> corridorPois = getPOIsOnRoute(
      List<PoiItem>.from(_loadedPois),
      aheadPoints,
      proximityMeters: _poiRouteCorridorMeters,
    );

    // Apply distance caps per category and skip passed POIs.
    final List<_ScoredPoi> scored = [];
    for (final poi in corridorPois) {
      final double miles = _distanceMiles(
        pos.latitude,
        pos.longitude,
        poi.displayLat,
        poi.displayLng,
      );
      if (miles < _poiPassedThresholdMiles)
        continue; // Already passed (< 200 m).

      // Weigh stations / safety POIs look further ahead than general POIs.
      final String cat = poi.category.toLowerCase().trim();
      final double maxMiles = (cat == 'weigh_station')
          ? _poiWeighStationMaxAheadMiles
          : _poiRouteMaxAheadMiles;
      if (miles > maxMiles)
        continue; // Beyond look-ahead cap for this category.

      scored.add(_ScoredPoi(poi, miles));
    }

    // Sort closest first so forced-ahead selections pick the nearest entries.
    scored.sort((a, b) => a.distanceMiles.compareTo(b.distanceMiles));
    return scored.map((s) => s.poi).toList();
  }

  /// Deduplicates and limits [pois] to [_poiMaxMarkers] using priority scoring.
  ///
  /// Rules applied (GPS professional standard):
  ///   1. Sort by [_poiPriorityScore] descending so higher-priority POIs are
  ///      selected before lower-priority ones.
  ///   2. Skip any POI within [_poiOverlapMinMeters] of an already-included
  ///      higher-priority POI — prevents icon clutter.
  ///   3. Never show a lower-priority approximate POI when a verified POI of
  ///      the same category already occupies nearby space.
  ///   4. Cap total count at [_poiMaxMarkers].
  ///
  /// [maxCount] overrides [_poiMaxMarkers] when provided (e.g. for browse mode).
  /// [minDistanceMeters] overrides [_poiOverlapMinMeters] when provided.
  List<PoiItem> _limitAndDedupePois(
    List<PoiItem> pois, {
    int? maxCount,
    double? minDistanceMeters,
  }) {
    if (pois.isEmpty) return const [];
    final int cap = maxCount ?? _poiMaxMarkers;
    final double minDist = minDistanceMeters ?? _poiOverlapMinMeters;

    // Cache priority scores once before sorting to avoid recomputing them
    // multiple times during the sort (once per comparison for a and b).
    final Map<PoiItem, double> scores = {
      for (final poi in pois) poi: _poiPriorityScore(poi),
    };

    // Sort by cached score descending — uses _isHigherPriorityPoi semantics.
    final List<PoiItem> sorted = List<PoiItem>.from(pois)
      ..sort((a, b) => scores[b]!.compareTo(scores[a]!));

    final List<PoiItem> result = [];
    final List<LatLng> included = [];

    for (final poi in sorted) {
      if (result.length >= cap) break;
      final LatLng coord = LatLng(poi.displayLat, poi.displayLng);

      // Overlap check: skip this POI if it is too close to any already-included
      // marker.  Because the list is sorted by priority, any existing marker in
      // [included] is already of equal or higher priority — so this lower-
      // priority entry is correctly suppressed.
      bool tooClose = false;
      for (final LatLng existing in included) {
        if (geo.Geolocator.distanceBetween(
              coord.latitude,
              coord.longitude,
              existing.latitude,
              existing.longitude,
            ) <
            minDist) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      result.add(poi);
      included.add(coord);
    }

    return result;
  }

  /// Returns the POI list to render for the current view.
  ///
  /// Uses the current map **viewport bounds** so that every POI visible on
  /// screen is included — regardless of the truck's GPS position.  This
  /// ensures that all walmart_store (and any other category) entries are
  /// returned when the driver pans or zooms to their location, fixing the
  /// issue where only the 10 nearest POIs within a 10-mile radius were shown.
  ///
  /// When the map is not yet ready the full [_loadedPois] list is returned so
  /// that cluster badges are available immediately on first render.
  List<PoiItem> _getVisiblePoisForCurrentView() {
    if (_loadedPois.isEmpty) return const [];

    // ── Map-viewport filter ──────────────────────────────────────────────
    // Prefer the live camera bounds so any POI currently on screen is
    // included.  A small padding (15% of the visible span) pre-loads POIs
    // that are just outside the visible edge so they appear without a
    // noticeable pop-in as the driver pans.
    if (_mapReady) {
      final LatLngBounds bounds = _mapController.camera.visibleBounds;
      final double latPad = (bounds.north - bounds.south) * 0.15;
      final double lngPad = (bounds.east - bounds.west) * 0.15;

      final List<PoiItem> inView = _loadedPois.where((poi) {
        return poi.displayLat >= bounds.south - latPad &&
            poi.displayLat <= bounds.north + latPad &&
            poi.displayLng >= bounds.west - lngPad &&
            poi.displayLng <= bounds.east + lngPad;
      }).toList();

      debugPrint(
        '[POI/Filter] viewport: ${inView.length} POIs in view '
        '(total loaded: ${_loadedPois.length}).',
      );
      return inView;
    }

    // Fallback — map not yet initialised: return everything so cluster
    // badges are available on first render.
    debugPrint(
      '[POI/Filter] fallback: returning all ${_loadedPois.length} POIs.',
    );
    return List<PoiItem>.from(_loadedPois);
  }

  /// Builds outlined teardrop cluster pins for nearby POIs.
  ///
  /// Tapping a cluster zooms in far enough to reveal individual category pins.
  List<Marker> _buildPoiClusterMarkers(List<PoiItem> pois) {
    if (pois.isEmpty) return const [];

    const double bucketSize = 0.1;
    final Map<String, List<PoiItem>> clusters = {};
    for (final poi in pois) {
      final String key =
          '${(poi.displayLat / bucketSize).round()},'
          '${(poi.displayLng / bucketSize).round()}';
      clusters.putIfAbsent(key, () => []).add(poi);
    }

    return clusters.values.map((members) {
      final double lat =
          members.map((p) => p.displayLat).reduce((a, b) => a + b) /
          members.length;
      final double lng =
          members.map((p) => p.displayLng).reduce((a, b) => a + b) /
          members.length;
      final int count = members.length;

      return Marker(
        point: LatLng(lat, lng),
        width: _kPoiPinSize,
        height: _kPoiPinSize,
        alignment: Alignment.topCenter,
        child: GestureDetector(
          onTap: () {
            _mapController.move(
              LatLng(lat, lng),
              _poiClusterZoomThreshold + 0.5,
            );
          },
          child: buildGpsPinClusterMarker(count: count, pinSize: _kPoiPinSize),
        ),
      );
    }).toList();
  }

  /// Returns the subset of [_loadedPois] that are considered approximate /
  /// unverified — i.e. those where [PoiItem.verified] is `false` or either
  /// entrance coordinate is missing.
  ///
  /// Used by [_showApproxPoiAdminSheet] to populate the maintenance list.
  List<PoiItem> get _approxPois => _loadedPois
      .where(
        (p) => !p.verified || p.entranceLat == null || p.entranceLng == null,
      )
      .toList();

  /// Opens a bottom sheet listing all POIs that are currently shown on the
  /// driver's map with a grey approximateIcon due to missing precise entrance
  /// coordinates.
  ///
  /// This is a **maintenance / admin view** intended for data editors.  It
  /// shows each approximate POI's name, category, id, and stored coordinates
  /// so that the team can identify which entries need precise
  /// `entrance_lat`/`entrance_lng` values added to `assets/locations.json`
  /// to upgrade them to a verifiedIcon.
  void _showApproxPoiAdminSheet() {
    final approx = _approxPois;

    // Group by category for a cleaner presentation.
    final Map<String, List<PoiItem>> byCategory = {};
    for (final poi in approx) {
      byCategory.putIfAbsent(poi.category, () => []).add(poi);
    }
    final sortedCategories = byCategory.keys.toList()..sort();

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0F1923),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        maxChildSize: 0.92,
        minChildSize: 0.35,
        builder: (_, scrollCtrl) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // ── Header ──────────────────────────────────────────────────────
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 4),
              child: Row(
                children: [
                  const Icon(
                    Icons.warning_amber_rounded,
                    color: Colors.amber,
                    size: 22,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Approximate POIs (${approx.length})',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: Text(
                'These POIs are displayed on the map with a grey approximate '
                'marker because their entrance coordinates are missing or '
                'unverified (verified=false). Add entrance_lat / entrance_lng '
                'and set verified=true in assets/locations.json to upgrade '
                'them to a coloured verified marker at the confirmed '
                'truck-entrance GPS fix.',
                style: TextStyle(color: Colors.white70, fontSize: 12),
              ),
            ),
            const Divider(color: Color(0xFF253041), height: 1),
            // ── Grouped list ────────────────────────────────────────────────
            Expanded(
              child: ListView(
                controller: scrollCtrl,
                padding: const EdgeInsets.only(bottom: 24),
                children: [
                  for (final cat in sortedCategories) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 6),
                      child: Text(
                        '${cat.replaceAll('_', ' ').toUpperCase()} '
                        '(${byCategory[cat]!.length})',
                        style: const TextStyle(
                          color: Colors.amber,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.8,
                        ),
                      ),
                    ),
                    for (final poi in byCategory[cat]!)
                      ListTile(
                        dense: true,
                        leading: const Icon(
                          Icons.location_off,
                          color: Colors.orange,
                          size: 20,
                        ),
                        title: Text(
                          poi.name,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                          ),
                        ),
                        subtitle: Text(
                          'id: ${poi.id}  •  '
                          '${poi.lat.toStringAsFixed(6)}, '
                          '${poi.lng.toStringAsFixed(6)}',
                          style: const TextStyle(
                            color: Colors.white54,
                            fontSize: 11,
                          ),
                        ),
                      ),
                  ],
                  if (approx.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'All POIs have verified entrance coordinates. '
                        'Every marker uses the verifiedIcon (category colour).',
                        style: TextStyle(color: Colors.white70, fontSize: 13),
                        textAlign: TextAlign.center,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Builds [Marker]s for every [MapPoi] of type [PoiType.camera511].
  ///
  /// Only shown when the 511 Camera layer is enabled in nav settings.
  /// Returns an empty list when disabled, so no camera icons appear on the map.
  List<Marker> _buildCameraMarkers() {
    if (!_navSettings.view511Camera) return const [];
    final cameras = _mapPois.where((p) => p.type == PoiType.camera511).toList();
    return cameras.map((poi) {
      return Marker(
        point: poi.position,
        width: _kPoiPinSize,
        height: _kPoiPinSize,
        alignment: Alignment.topCenter,
        child: GestureDetector(
          onTap: () => _showPoiAlert(poi),
          child: buildGpsPinMarker(
            pinColor: const Color(0xFF1489C7),
            fallbackIcon: Icons.videocam,
            pinSize: _kPoiPinSize,
          ),
        ),
      );
    }).toList();
  }

  /// Shows a brief [AlertDialog] with the [poi] name when a map POI marker is
  /// tapped.
  void _showPoiInfoDialog(PoiItem poi) {
    if (!mounted) return;
    if (poi.category == 'weigh_station') {
      MapPoi? matched;
      for (final candidate in _mapPois) {
        if (candidate.type != PoiType.weighStation) continue;
        if (candidate.id == poi.id ||
            _distanceBetween(
                  candidate.position,
                  LatLng(poi.displayLat, poi.displayLng),
                ) <=
                1000) {
          matched = candidate;
          break;
        }
      }
      _showPoiAlert(
        matched ??
            MapPoi(
              id: poi.id,
              position: LatLng(poi.displayLat, poi.displayLng),
              type: PoiType.weighStation,
              name: poi.name,
              status: 'UNKNOWN',
            ),
      );
      return;
    }
    if (poi.category == 'rest_area') {
      _showRestAreaPoiSheet(poi);
      return;
    }
    final canReportLiveData = const {
      'truck_stop',
      'truck_parking',
      'rest_area',
      'gas_station',
      'fuel_stop',
    }.contains(poi.category);

    // Check cache first — if the result is already available, show the dialog
    // immediately without a loading indicator.
    final String cacheKey =
        '${poi.displayLat.toStringAsFixed(6)},${poi.displayLng.toStringAsFixed(6)}';
    final String? cached = _reverseGeocodeCache.containsKey(cacheKey)
        ? (_reverseGeocodeCache[cacheKey]!.isEmpty
              ? null
              : _reverseGeocodeCache[cacheKey])
        : null;

    if (_reverseGeocodeCache.containsKey(cacheKey)) {
      // Result already cached — show dialog without loading spinner.
      final String addressLabel = cached ?? 'Address unavailable';
      showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: Text(poi.name),
          content: Row(
            children: [
              const Icon(Icons.location_on, size: 18, color: Colors.grey),
              const SizedBox(width: 6),
              Expanded(
                child: Text(addressLabel, style: const TextStyle(fontSize: 14)),
              ),
            ],
          ),
          actions: [
            if (canReportLiveData)
              TextButton(
                onPressed: () {
                  Navigator.of(ctx).pop();
                  unawaited(_reportLivePoiData(poi));
                },
                child: const Text('Report Live Data'),
              ),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('OK'),
            ),
          ],
        ),
      );
      return;
    }

    // Not cached yet: show dialog with a loading indicator while the reverse-
    // geocoding request is in flight.  The dialog's content is replaced via
    // setState on a StatefulBuilder once the result arrives.
    showDialog<void>(
      context: context,
      builder: (ctx) {
        return _PoiAddressDialog(
          poiName: poi.name,
          geocodeFuture: _reverseGeocode(poi.displayLat, poi.displayLng),
          onReport: canReportLiveData
              ? () {
                  Navigator.of(ctx).pop();
                  unawaited(_reportLivePoiData(poi));
                }
              : null,
        );
      },
    );
  }

  Future<live_ws.WeighStationStatusSummary?> _loadWeighStationActivity(
    String stationId,
  ) async {
    try {
      return await _weighStationService.getStatus(stationId);
    } catch (_) {
      return null;
    }
  }

  void _showAheadWeighStationDetails(AheadWeighStation ahead) {
    _showPoiAlert(
      MapPoi(
        id: ahead.poi.id,
        position: ahead.poi.position,
        type: PoiType.weighStation,
        name: ahead.poi.name,
        status: ahead.poi.status,
        weighStation: ahead.poi.details,
      ),
    );
  }

  void _showAheadRestAreaDetails(AheadRestArea ahead) {
    _showRestAreaPoiSheet(ahead.poi.source, routeMilesAhead: ahead.milesAhead);
  }

  void _showRestAreaPoiSheet(PoiItem poi, {double? routeMilesAhead}) {
    LiveParkingLocation? liveParking;
    for (final candidate in _liveParkingLocations) {
      final sameId = candidate.id == poi.id;
      final nearby =
          _distanceBetween(
            candidate.position,
            LatLng(poi.displayLat, poi.displayLng),
          ) <=
          1500;
      if (sameId || nearby) {
        liveParking = candidate;
        break;
      }
    }
    final parking = liveParking;
    final addressFuture = poi.address.trim().isNotEmpty
        ? Future<String?>.value(poi.address.trim())
        : _reverseGeocode(poi.displayLat, poi.displayLng);

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: const Color(0xFFE7F2FF),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.park_rounded,
                      color: Color(0xFF0969E8),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          poi.name,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF122131),
                          ),
                        ),
                        if (routeMilesAhead != null)
                          Text(
                            '${_formatRemainingDistance(routeMilesAhead)} ahead',
                            style: const TextStyle(
                              color: Color(0xFF0969E8),
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              FutureBuilder<String?>(
                future: addressFuture,
                builder: (context, snapshot) => _truckStopDetailRow(
                  Icons.location_on_outlined,
                  snapshot.connectionState == ConnectionState.waiting
                      ? 'Loading address…'
                      : (snapshot.data ?? 'Address unavailable'),
                ),
              ),
              if ((poi.exitNumber ?? '').trim().isNotEmpty)
                _truckStopDetailRow(
                  Icons.exit_to_app_rounded,
                  'Exit ${poi.exitNumber}',
                ),
              _truckStopDetailRow(
                Icons.local_parking_rounded,
                parking == null || parking.availability == 'UNKNOWN'
                    ? 'Truck parking availability not reported'
                    : [
                        'Truck parking: ${parking.availability.replaceAll('_', ' ').toLowerCase()}',
                        if (parking.totalTruckSpaces != null)
                          '${parking.totalTruckSpaces} truck spaces',
                      ].join(' • '),
              ),
              _truckStopDetailRow(
                Icons.fact_check_outlined,
                parking == null || parking.source == 'UNKNOWN'
                    ? 'No verified live facility activity is available'
                    : 'Activity source: ${parking.source} • confidence ${(parking.confidence * 100).round()}%${parking.lastReportedAt == null ? '' : ' • updated ${parking.lastReportedAt!.toLocal()}'}',
              ),
              _truckStopDetailRow(
                Icons.wc_rounded,
                'Restrooms and amenity status are not reported by the current provider',
              ),
              _truckStopDetailRow(
                poi.verified ? Icons.verified_rounded : Icons.info_outline,
                poi.verified
                    ? 'Verified rest-area location'
                    : 'Rest-area entrance is not independently verified',
              ),
              _truckStopDetailRow(
                Icons.storage_rounded,
                'Source: ${poi.dataSource}',
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(sheetContext),
                      child: const Text('Close'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 2,
                    child: FilledButton.icon(
                      onPressed: () {
                        Navigator.pop(sheetContext);
                        unawaited(_reportLivePoiData(poi));
                      },
                      icon: const Icon(Icons.add_comment_outlined),
                      label: const Text('Report Live Data'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _reportLivePoiData(PoiItem poi) async {
    final position = _truckPosition;
    if (position == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('A GPS fix is required to report data.')),
      );
      return;
    }
    final supportsParking = const {
      'truck_stop',
      'truck_parking',
      'rest_area',
    }.contains(poi.category);
    final supportsFuel = const {
      'truck_stop',
      'gas_station',
      'fuel_stop',
    }.contains(poi.category);
    _PoiReportKind? kind;
    if (supportsParking && supportsFuel) {
      kind = await showModalBottomSheet<_PoiReportKind>(
        context: context,
        builder: (context) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.local_parking),
                title: const Text('Parking availability'),
                onTap: () => Navigator.pop(context, _PoiReportKind.parking),
              ),
              ListTile(
                leading: const Icon(Icons.local_gas_station),
                title: const Text('Diesel price'),
                onTap: () => Navigator.pop(context, _PoiReportKind.diesel),
              ),
            ],
          ),
        ),
      );
    } else if (supportsParking) {
      kind = _PoiReportKind.parking;
    } else if (supportsFuel) {
      kind = _PoiReportKind.diesel;
    }
    if (kind == null) return;
    try {
      if (kind == _PoiReportKind.parking) {
        final availability = await showModalBottomSheet<String>(
          context: context,
          builder: (context) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Text(
                    'Report only what you can currently observe. Availability reports expire automatically.',
                  ),
                ),
                for (final item in const [
                  ('PLENTY', 'Plenty of spaces'),
                  ('SOME', 'Some spaces'),
                  ('ALMOST_FULL', 'Almost full'),
                  ('FULL', 'Full'),
                ])
                  ListTile(
                    title: Text(item.$2),
                    onTap: () => Navigator.pop(context, item.$1),
                  ),
              ],
            ),
          ),
        );
        if (availability == null) return;
        await _liveRoadDataService.reportParking(
          locationId: poi.id,
          availability: availability,
          position: position,
        );
      } else {
        final controller = TextEditingController();
        final price = await showDialog<double>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Report diesel cash price'),
            content: TextField(
              controller: controller,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: const InputDecoration(
                prefixText: '\$',
                suffixText: 'per gallon',
                helperText: 'Enter the posted price you can currently see.',
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () {
                  final value = double.tryParse(controller.text.trim());
                  if (value != null && value >= 0.5 && value <= 25) {
                    Navigator.pop(context, value);
                  }
                },
                child: const Text('Submit'),
              ),
            ],
          ),
        );
        controller.dispose();
        if (price == null) return;
        await _liveRoadDataService.reportDieselPrice(
          stationId: poi.id,
          price: price,
          position: position,
        );
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Report submitted with source and freshness data.'),
        ),
      );
      unawaited(_refreshLiveRoadData());
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not submit report: $error')),
      );
    }
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
  /// The dialog displays the POI name, type label, status, and the exact
  /// street address from reverse geocoding.  If no precise street address is
  /// available, "Address unavailable" is shown instead.
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
      case PoiType.camera511:
        typeLabel = '511 Traffic Camera';
        typeIcon = Icons.videocam;
        typeColor = Colors.teal.shade700;
        break;
    }
    showDialog<void>(
      context: context,
      builder: (ctx) => _MapPoiAlertDialog(
        poi: poi,
        typeLabel: typeLabel,
        typeIcon: typeIcon,
        typeColor: typeColor,
        geocodeFuture: _reverseGeocode(
          poi.position.latitude,
          poi.position.longitude,
        ),
        activityFuture: poi.type == PoiType.weighStation
            ? _loadWeighStationActivity(poi.id)
            : null,
        onReportStatus: poi.type == PoiType.weighStation
            ? () {
                Navigator.of(ctx).pop();
                unawaited(_reportWeighStationStatus(poi));
              }
            : null,
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
  /// loaded from `assets/logos/`.  [_buildAllPoiMarkers] renders every POI
  /// from `assets/locations.json` with a brand logo or a fallback icon —
  /// no POI is omitted. [_buildPoiMarkers] adds sourced [MapPoi] weigh-station
  /// markers when a duplicate is not already present in the general POI layer.
  List<Marker> _buildMarkers() {
    return [
      if (_truckPosition != null || _routePoints.isNotEmpty)
        _buildTruckMarker(),
      if (_selectedDestination != null || _isArrived) _buildDestinationMarker(),
      // Every POI from locations.json — no filtering, with fallback icons.
      ..._buildAllPoiMarkers(),
      ..._buildTruckStopMarkers(),
      // Route-matched official/community-status weigh-station markers.
      ..._buildPoiMarkers(),
      // 511 camera markers (gated by view511Camera setting).
      ..._buildCameraMarkers(),
      ..._buildRestrictionMarkers(),
      // Provider-backed physical signs and traffic signals.
      ..._buildRoadFeatureMarkers(),
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
                    const Icon(
                      Icons.local_gas_station,
                      size: 18,
                      color: Colors.grey,
                    ),
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
                    const Icon(Icons.location_on, size: 18, color: Colors.grey),
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
                    const Icon(
                      Icons.info_outline,
                      size: 18,
                      color: Colors.grey,
                    ),
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
      bearing = nav_utils.normalizeBearing(_truckBearing);
      _lastKnownBearing = bearing;
    } else {
      bearing = nav_utils.normalizeBearing(_lastKnownBearing);
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
    _mapController.moveAndRotate(
      cameraTarget,
      stoppedZoom,
      nav_utils.normalizeBearing(_lastKnownBearing),
    );
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

  // ── Real GPS camera helpers ───────────────────────────────────────────────

  /// Returns the distance in miles to the next navigation step, sourced from
  /// the live instruction data. Returns null when no step data is available.
  double? _nextStepMilesForCamera() {
    final miles = _topInstructionData?.distanceMiles;
    if (miles == null) return null;
    return miles;
  }

  /// Returns the target zoom level for [speedMph] using commercial GPS stepped
  /// thresholds, with an automatic boost when a maneuver is imminent.
  ///
  /// - Parking/very slow → close zoom for exact-turn visibility.
  /// - City driving → medium zoom.
  /// - Highway → wider zoom so more road is visible ahead.
  /// - Near turns/exits → automatic zoom-in boost.
  double _bestTargetZoom(double speedMph, double? nextStepMiles) {
    double zoom;

    if (speedMph < 1.5) {
      zoom = 18.0;
    } else if (speedMph < 15) {
      zoom = 17.2;
    } else if (speedMph < 30) {
      zoom = 16.4;
    } else if (speedMph < 45) {
      zoom = 15.6;
    } else if (speedMph < 60) {
      zoom = 14.8;
    } else {
      zoom = 14.2;
    }

    // Boost zoom when a maneuver is close so the driver can see the turn clearly.
    if (nextStepMiles != null) {
      final feet = nextStepMiles * 5280;

      if (feet <= 500) {
        zoom += 1.2;
      } else if (nextStepMiles <= 0.2) {
        zoom += 0.9;
      } else if (nextStepMiles <= 0.5) {
        zoom += 0.5;
      }
    }

    return zoom.clamp(13.8, 18.4);
  }

  /// Returns the target camera pitch for [speedMph]:
  /// flatter when parked, increasingly tilted at higher speeds so more
  /// road is visible ahead (real-GPS feel).
  double _bestTargetPitch(double speedMph) {
    if (speedMph < 1.5) return 30.0;
    if (speedMph < 20) return 42.0;
    if (speedMph < 45) return 50.0;
    return 58.0;
  }

  /// Interpolates [current] toward [target] by [factor] (0–1).
  /// Used to smooth camera zoom, pitch, and bearing without sudden jumps.
  double _smoothValue(double current, double target, double factor) {
    return current + (target - current) * factor;
  }

  /// Updates the Mapbox and flutter_map cameras with smooth, speed-adaptive
  /// zoom, pitch, and bearing. Called on every GPS fix in follow mode.
  ///
  /// Behaviour overview:
  /// - Zoom adapts from close (parking) to wide (highway) with a boost near
  ///   upcoming turns so the driver can see them clearly, then smoothly
  ///   returns to the speed-appropriate level after the maneuver.
  /// - Pitch increases with speed, giving more road-ahead visibility on the
  ///   highway and a flatter view when stopped or creeping.
  /// - Bearing is smoothed from the last known value toward the GPS heading
  ///   only when speed is sufficient for a reliable heading (≥ 5 mph).
  /// - Bottom padding (320 px) keeps the truck in the lower third of the
  ///   screen, matching the framing of commercial GPS navigation.
  Future<void> _updateBestNavigationCamera(geo.Position pos) async {
    _pendingCameraPosition = pos;
    _cameraUpdateGeneration++;
    if (_cameraUpdateInProgress) return;

    _cameraUpdateInProgress = true;
    try {
      while (mounted && _pendingCameraPosition != null) {
        final nextPosition = _pendingCameraPosition!;
        _pendingCameraPosition = null;
        final updateGeneration = _cameraUpdateGeneration;
        await _applyBestNavigationCamera(nextPosition, updateGeneration);
      }
    } finally {
      _cameraUpdateInProgress = false;
    }
  }

  Future<void> _applyBestNavigationCamera(
    geo.Position pos,
    int updateGeneration,
  ) async {
    if (_cameraMode != NavigationCameraMode.follow ||
        _appLifecycleState != AppLifecycleState.resumed ||
        !mounted ||
        _isArrived) {
      return;
    }

    final speedMph = _speedMphFromMps(pos.speed);
    final nextStepMiles = _nextStepMilesForCamera();

    final targetZoom = _bestTargetZoom(speedMph, nextStepMiles);
    final targetPitch = _bestTargetPitch(speedMph);

    // Use a gentler smoothing factor at very low speeds for extra stability.
    final zoomFactor = speedMph < 10 ? 0.18 : 0.24;
    const pitchFactor = 0.20;
    const bearingFactor = 0.18;

    _currentCameraZoom = _smoothValue(
      _currentCameraZoom,
      targetZoom,
      zoomFactor,
    );
    _currentCameraPitch = _smoothValue(
      _currentCameraPitch,
      targetPitch,
      pitchFactor,
    );

    double bearing = nav_utils.normalizeBearing(_lastKnownBearing);
    // Only update bearing from GPS when the truck is moving fast enough to
    // produce a stable heading (≥ 5 mph).  Below this threshold, GPS heading
    // values are unreliable and may cause the map to spin erratically.
    // pos.heading < 0 indicates an unavailable heading fix; those are skipped.
    if (speedMph >= 5 && pos.heading >= 0) {
      _lastKnownBearing = nav_utils.interpolateBearing(
        _lastKnownBearing,
        nav_utils.normalizeBearing(pos.heading),
        bearingFactor,
      );
      bearing = _lastKnownBearing;
    }

    // ── Mapbox SDK camera (handles Mapbox-layer POI cluster map) ─────────
    // Bottom padding of 320 px keeps the truck in the lower third of the
    // screen so more road ahead is always visible — like a real GPS unit.
    final mbx.MapboxMap? map = _mapboxMap;
    if (map != null) {
      try {
        await map.easeTo(
          mbx.CameraOptions(
            center: mbx.Point(
              coordinates: mbx.Position(pos.longitude, pos.latitude),
            ),
            zoom: _currentCameraZoom,
            bearing: bearing,
            pitch: _currentCameraPitch,
            padding: mbx.MbxEdgeInsets(
              top: 100,
              left: 20,
              bottom: 320,
              right: 20,
            ),
          ),
          mbx.MapAnimationOptions(duration: 550, startDelay: 0),
        );
      } catch (error) {
        if (kDebugMode) debugPrint('[Camera] Mapbox update skipped: $error');
      }
    }

    // ── flutter_map camera (drives the visible navigation tile layer) ─────
    if (!mounted ||
        !_mapReady ||
        _isArrived ||
        _cameraMode != NavigationCameraMode.follow ||
        _appLifecycleState != AppLifecycleState.resumed ||
        updateGeneration != _cameraUpdateGeneration ||
        !identical(map, _mapboxMap)) {
      return;
    }
    final cameraTarget = LatLng(
      pos.latitude - _cameraLeadLatitude,
      pos.longitude,
    );
    _mapController.moveAndRotate(cameraTarget, _currentCameraZoom, bearing);
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
    final double bearing = speedMph >= _noRotateSpeedMph && pos.heading >= 0
        ? nav_utils.normalizeBearing(pos.heading)
        : nav_utils.normalizeBearing(_lastKnownBearing);
    if (speedMph >= _noRotateSpeedMph && pos.heading >= 0) {
      _lastKnownBearing = nav_utils.normalizeBearing(pos.heading);
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
    _invalidateCameraUpdates();
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
    _invalidateCameraUpdates();
    _gestureReturnTimer?.cancel();
    setState(() {
      _cameraMode = NavigationCameraMode.free;
      _lastManualMapInteractionAt = DateTime.now();
    });

    // Auto-return while the driver is actively following a truck route. The
    // gesture still gets an eight-second inspection window before GPS follow
    // resumes, matching professional navigation camera behaviour.
    if (_isLiveRouteAssistanceActive) {
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
      _enterFreeCameraMode();
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

    if (!_isLiveRouteAssistanceActive) return;
    _gestureReturnTimer?.cancel();
    _gestureReturnTimer = Timer(const Duration(seconds: 8), () {
      _maybeReturnToFollowMode();
    });
  }

  /// Returns to follow mode if enough idle time has elapsed and navigation
  /// is still active.
  ///
  /// Called by [_gestureReturnTimer] after 8 seconds and on every GPS fix
  /// via [_onGpsPosition] for redundancy.
  void _maybeReturnToFollowMode() {
    if (!mounted) return;
    if (!_isLiveRouteAssistanceActive) return;
    if (_cameraMode != NavigationCameraMode.free) return;
    if (_isUserInteractingWithMap) return;
    final last = _lastManualMapInteractionAt;
    if (last == null) return;
    if (DateTime.now().difference(last).inSeconds < 8) {
      return; // user interacted very recently; wait longer
    }
    _setFollowCameraFromCurrentPosition();
  }

  /// Handles the recenter button tap.
  ///
  /// - If in **free** mode: returns to follow mode and snaps camera to truck.
  /// - If already in **follow** mode: refreshes/snaps camera to truck.
  /// - If in **overview** mode: returns to follow mode.
  void _onRecenterPressed() {
    _gestureReturnTimer?.cancel();
    _gestureReturnTimer = null;
    setState(() {
      _overviewPinnedByUser = false;
      _cameraMode = NavigationCameraMode.follow;
    });
    _followTruckCamera();
  }

  /// Handles the recenter button long press: switches to route overview mode.
  void _onRecenterLongPressed() {
    _overviewPinnedByUser = true;
    _setOverviewCamera();
  }

  /// Activates **follow mode** from the last accepted GPS position.
  ///
  /// Used by [_buildRecenterButton] tap handler and [_maybeReturnToFollowMode]
  /// so that every return to follow snaps to the real last-known position.
  Future<void> _setFollowCameraFromCurrentPosition() async {
    if (_lastAcceptedPosition == null) return;
    setState(() {
      _overviewPinnedByUser = false;
      _cameraMode = NavigationCameraMode.follow;
    });
    await _updateBestNavigationCamera(_lastAcceptedPosition!);
  }

  /// Switches the camera to **free mode** and records the interaction time.
  ///
  /// Convenience wrapper used by gesture callbacks so the naming matches the
  /// user-facing camera-mode vocabulary.
  void _enterFreeCameraMode() {
    _setFreeCamera();
  }

  // ── Recenter and zoom button widgets ───────────────────────────────────────

  void _changeMapZoom(double delta) {
    if (!_mapReady) return;
    _enterFreeCameraMode();
    final camera = _mapController.camera;
    final nextZoom = (camera.zoom + delta)
        .clamp(_minimumMapZoom, _maximumMapZoom)
        .toDouble();
    _mapController.moveAndRotate(camera.center, nextZoom, camera.rotation);
    _scheduleRoadFeatureRefresh();
  }

  Widget _buildMapZoomControls() {
    return Semantics(
      container: true,
      label: 'Map zoom controls',
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: Material(
          color: Colors.white.withOpacity(0.94),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _mapZoomButton(
                icon: Icons.add_rounded,
                label: 'Zoom in',
                onPressed: () => _changeMapZoom(1),
              ),
              Container(width: 48, height: 1, color: Colors.black12),
              _mapZoomButton(
                icon: Icons.remove_rounded,
                label: 'Zoom out',
                onPressed: () => _changeMapZoom(-1),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _mapZoomButton({
    required IconData icon,
    required String label,
    required VoidCallback onPressed,
  }) {
    return Semantics(
      button: true,
      label: label,
      child: Tooltip(
        message: label,
        child: InkWell(
          onTap: onPressed,
          child: SizedBox(
            width: 48,
            height: 48,
            child: Icon(icon, size: 30, color: SemiTrackColors.navy),
          ),
        ),
      ),
    );
  }

  /// Builds the circular recenter button shown in the bottom-right corner.
  ///
  /// - **Tap**: snaps camera to the real GPS position and enters follow mode
  ///   ([_setFollowCameraFromCurrentPosition]).
  /// - **Long press**: switches to full-route overview ([_onRecenterLongPressed]).
  Widget _buildRecenterButton() {
    return GestureDetector(
      onTap: _setFollowCameraFromCurrentPosition,
      onLongPress: _onRecenterLongPressed,
      child: Container(
        width: 60,
        height: 60,
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.85),
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.2),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: const Icon(Icons.my_location, color: Colors.white, size: 32),
      ),
    );
  }

  // ── TTS initialisation ────────────────────────────────────────────────────

  Future<void> _initTts() async {
    try {
      await _tts.setAudioAttributesForNavigation();
      await _tts.awaitSpeakCompletion(false);
      await _tts.setLanguage('en-US');
      await _tts.setSpeechRate(0.5);
      await _tts.setVolume(1.0);
      await _tts.setPitch(1.0);
    } catch (error, stackTrace) {
      debugPrint('[Voice] TTS initialization failed: $error\n$stackTrace');
    }
  }

  /// Applies the current [_navSettings] audio configuration to the TTS engine.
  ///
  /// Called when settings change (via the [NavSettingsScreen.onChanged]
  /// callback) so voice package, pitch, and speech-rate updates are heard
  /// immediately on the next spoken instruction.
  Future<void> _applyAudioSettings() async {
    // Map voice-package name to a BCP-47 locale tag.
    final locale = switch (_navSettings.voicePackage) {
      'UK English' => 'en-GB',
      'Australian English' => 'en-AU',
      _ => 'en-US',
    };
    try {
      await _tts.setAudioAttributesForNavigation();
      await _tts.awaitSpeakCompletion(false);
      await _tts.setLanguage(locale);
      await _tts.setPitch(_navSettings.audioPitch);
      await _tts.setSpeechRate(_navSettings.audioSpeechRate);
      await _tts.setVolume(1.0);
    } catch (error, stackTrace) {
      // A missing/disabled Android TTS engine must never take down navigation.
      // The visible maneuver header remains available while the driver repairs
      // the device's speech-service configuration.
      debugPrint('[Voice] Unable to apply TTS settings: $error\n$stackTrace');
    }
    try {
      if (_navSettings.audioMode == 0) {
        await _tts.stop();
        await NativeNavigationService.instance.muteVoice();
      } else {
        await NativeNavigationService.instance.unmuteVoice();
      }
    } on NativeNavigationException catch (error) {
      if (kDebugMode) {
        debugPrint('[Navigation] Voice bridge deferred: $error');
      }
    }
  }

  /// Speaks [text] via the TTS engine if audio is not muted.
  ///
  /// Respects [_navSettings.audioMode]:
  ///  - 0 (Muted)      — silences all speech.
  ///  - 1 (Alert Only) — silences navigation turn-by-turn instructions; only
  ///                     safety alerts (see [_speakAlert]) are heard.
  ///  - 2 (Unmuted)    — speaks everything (default behaviour).
  ///
  /// This method is used for **navigation instructions** (turn-by-turn,
  /// rerouting, arrival).  Use [_speakAlert] for hazard / safety announcements.
  Future<void> _speak(String text) async {
    if (_navSettings.audioMode < 2) return; // Muted or Alert-Only: skip nav TTS
    final message = text.trim();
    if (message.isEmpty) return;
    try {
      await _tts.stop();
      await _tts.speak(message);
    } catch (error, stackTrace) {
      debugPrint('[Voice] Instruction playback failed: $error\n$stackTrace');
    }
  }

  /// Speaks a safety-critical [text] alert regardless of audio mode, unless
  /// the driver has explicitly chosen Muted.
  ///
  ///  - 0 (Muted)      — silenced.
  ///  - 1 (Alert Only) — **plays** this call (alerts allowed).
  ///  - 2 (Unmuted)    — plays (same as [_speak]).
  Future<void> _speakAlert(String text) async {
    if (_navSettings.audioMode == 0) return; // Muted: no audio at all
    final message = text.trim();
    if (message.isEmpty) return;
    try {
      await _tts.stop();
      await _tts.speak(message);
    } catch (error, stackTrace) {
      debugPrint('[Voice] Alert playback failed: $error\n$stackTrace');
    }
  }

  /// Quick mute control used by the map and navigation overlays.
  /// Alert-only remains available in the full navigation settings screen.
  Future<void> _toggleVoiceMute() async {
    final nextMode = _navSettings.audioMode == 0 ? 2 : 0;
    setState(() => _navSettings.audioMode = nextMode);
    await _navSettings.saveToPrefs();
    await _applyAudioSettings();
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(nextMode == 0 ? 'GPS voice muted' : 'GPS voice on'),
          duration: const Duration(seconds: 2),
          behavior: SnackBarBehavior.floating,
        ),
      );
    if (nextMode != 0) {
      unawaited(_speakAlert('GPS voice on'));
    }
  }

  Future<String?> _captureVoiceDestination() async {
    await _tts.stop();
    final transcript = ValueNotifier<String>('');
    BuildContext? listeningDialogContext;
    var dialogOpen = true;

    final dialogFuture = showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        listeningDialogContext = dialogContext;
        return PopScope(
          canPop: false,
          child: AlertDialog(
            icon: const Icon(
              Icons.mic_rounded,
              color: SemiTrackColors.orange,
              size: 42,
            ),
            title: const Text('Listening for destination'),
            content: ValueListenableBuilder<String>(
              valueListenable: transcript,
              builder: (_, heard, __) => Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const LinearProgressIndicator(),
                  const SizedBox(height: 18),
                  Text(
                    heard.isEmpty
                        ? 'Say an address, city, business, or truck stop.'
                        : heard,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: heard.isEmpty
                          ? Theme.of(dialogContext).colorScheme.onSurfaceVariant
                          : Theme.of(dialogContext).colorScheme.onSurface,
                      fontSize: 16,
                      fontWeight: heard.isEmpty
                          ? FontWeight.w500
                          : FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton.icon(
                onPressed: () {
                  unawaited(_voiceDestinationService.cancel());
                  if (dialogOpen && Navigator.of(dialogContext).canPop()) {
                    dialogOpen = false;
                    Navigator.of(dialogContext).pop();
                  }
                },
                icon: const Icon(Icons.close_rounded),
                label: const Text('Cancel'),
              ),
            ],
          ),
        );
      },
    );

    try {
      await Future<void>.delayed(const Duration(milliseconds: 180));
      return await _voiceDestinationService.listen(
        onTranscript: (heard) => transcript.value = heard,
      );
    } finally {
      final dialogContext = listeningDialogContext;
      if (dialogOpen &&
          dialogContext != null &&
          dialogContext.mounted &&
          Navigator.of(dialogContext).canPop()) {
        dialogOpen = false;
        Navigator.of(dialogContext).pop();
      }
      await dialogFuture;
      transcript.dispose();
    }
  }

  Future<void> _startVoiceDestinationSearch() async {
    if (_mapboxToken.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Destination search is not configured. Rebuild with the Mapbox public access token.',
          ),
        ),
      );
      return;
    }
    try {
      final query = await _captureVoiceDestination();
      if (!mounted || query == null || query.trim().isEmpty) return;
      await _showDestinationSearch(
        initialQuery: query.trim(),
        searchImmediately: true,
      );
    } on VoiceDestinationException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.message),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
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
  ///   1. Reject fixes that cannot locate the truck to a useful road corridor.
  ///   2. First qualifying fix is always accepted.
  ///   3. Ignore drift < [_minStoppedDriftMeters] when speed is below
  ///      [_stoppedSpeedMph] (vehicle is stopped).
  ///   4. Reject jumps that are impossible for the elapsed time, speed and
  ///      reported accuracy. This permits delayed high-speed fixes.
  ///   5. Accept immediately when speed ≥ [_stoppedSpeedMph] or distance
  ///      ≥ [_immediateAcceptDistanceMeters].
  ///   6. Require [_requiredCandidateFixCount] consistent candidate fixes
  ///      for a low-speed position shift.
  ///
  /// When a fix is rejected the caller holds [_truckPosition] at its current
  /// value, effectively keeping the last valid stable position on screen.
  bool _shouldAcceptPosition(geo.Position newPos) {
    // Accuracy may be -1 when Android cannot supply a value. Such a fix is not
    // safe for road matching; fixes up to 65 m are retained during acquisition
    // and replaced as the fused provider converges on GNSS accuracy.
    if (newPos.accuracy < 0 || newPos.accuracy > _poorAccuracyMeters) {
      return false;
    }

    final speedMph = _speedMphFromMps(newPos.speed);

    if (_lastAcceptedPosition == null) {
      _candidatePosition = null;
      _stableCandidateCount = 0;
      return true;
    }

    final distanceMeters = _distanceMetersBetween(
      _lastAcceptedPosition!,
      newPos,
    );
    final stopped = speedMph < _stoppedSpeedMph;

    // Ignore tiny drift when the vehicle is stopped.
    if (stopped && distanceMeters < _minStoppedDriftMeters) return false;

    // Reject only physically implausible jumps. The former fixed 80 m cap
    // discarded ordinary highway movement whenever Android delayed a callback.
    final elapsedSeconds = math.max(
      1.0,
      math.min(
        30.0,
        newPos.timestamp
                .difference(_lastAcceptedPosition!.timestamp)
                .inMilliseconds
                .abs() /
            1000.0,
      ),
    );
    final reportedSpeedMps = math.max(
      0.0,
      math.max(newPos.speed, _lastAcceptedPosition!.speed),
    );
    final accuracyAllowance =
        math.max(newPos.accuracy, _lastAcceptedPosition!.accuracy) * 2.0;
    final plausibleJumpMeters = math.max(
      _maxPositionJumpMeters,
      reportedSpeedMps * elapsedSeconds * 2.5 + accuracyAllowance + 35.0,
    );
    if (distanceMeters > plausibleJumpMeters) return false;

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

    final candidateDistance = _distanceMetersBetween(
      _candidatePosition!,
      newPos,
    );
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

  /// Returns an adaptive display weight for the new fix. Slow movement keeps
  /// more filtering to suppress parking-lot wander; highway movement follows
  /// the device quickly enough that the marker does not visibly lag behind.
  double _gpsSmoothingWeightFor(geo.Position position) {
    final speedMph = _speedMphFromMps(position.speed);
    double weight;
    if (speedMph >= 45) {
      weight = 0.88;
    } else if (speedMph >= 15) {
      weight = 0.76;
    } else if (speedMph >= 3) {
      weight = 0.62;
    } else {
      weight = 0.35;
    }
    if (position.accuracy > 30) weight *= 0.8;
    return weight.clamp(0.28, 0.9);
  }

  /// Returns `true` when route progress (nearest-point snapping) should
  /// advance for [pos].  Always returns `true` in [_isSimulationMode].
  ///
  /// When GPS speed is available (pos.speed >= 0) and below [_stoppedSpeedMph]
  /// the vehicle is considered stopped and progress is frozen to prevent
  /// spurious advancement from parked GPS drift.
  /// When GPS speed is unavailable (pos.speed < 0 — common on some devices),
  /// advancement is allowed based on position displacement alone so that the
  /// Head Out Card and trip strip still update as the driver moves.
  bool _shouldAdvanceRouteProgress(geo.Position pos) {
    if (_isSimulationMode) return true;
    if (_lastAcceptedPosition == null) return false;
    final displacement = _distanceMetersBetween(_lastAcceptedPosition!, pos);
    // Only block when speed data is valid AND confirms the vehicle is stopped.
    // A substantial displacement overrides a stale zero-speed sample.
    if (pos.speed >= 0 &&
        _speedMphFromMps(pos.speed) < _stoppedSpeedMph &&
        displacement < _immediateAcceptDistanceMeters) {
      return false;
    }
    return displacement >= _minRouteProgressDistanceMeters;
  }

  /// Advances [_truckIndex] to [nearestRouteIndex] only when movement is real.
  /// Position plausibility is already checked by [_shouldAcceptPosition]; a
  /// point-count cap is unsafe because long routes are intentionally simplified
  /// and legitimate fixes can span many route points.
  void _tryAdvanceRouteIndex(int nearestRouteIndex, geo.Position pos) {
    if (!_shouldAdvanceRouteProgress(pos)) return;
    if (nearestRouteIndex <= _truckIndex) return;
    _truckIndex = nearestRouteIndex;
  }

  /// Requests location permission and subscribes to the device GPS stream.
  ///
  /// Each position update snaps the truck marker to the nearest route point
  /// ahead of the current position, so the marker always follows the real
  /// device location when available.
  Future<void> _startGps() async {
    if (_gpsSubscription != null) {
      debugPrint('[GPS] Position stream already active.');
      return;
    }

    try {
      final serviceEnabled = await geo.Geolocator.isLocationServiceEnabled();
      debugPrint('[GPS] Location services enabled: $serviceEnabled');
      if (!serviceEnabled) {
        debugPrint('[GPS] Location service disabled — GPS stream not started.');
        return;
      }

      geo.LocationPermission permission =
          await geo.Geolocator.checkPermission();
      debugPrint('[GPS] Permission status before request: $permission');
      if (permission == geo.LocationPermission.denied) {
        permission = await geo.Geolocator.requestPermission();
        debugPrint('[GPS] Permission status after request: $permission');
        if (permission == geo.LocationPermission.denied) {
          debugPrint(
            '[GPS] Location permission denied — GPS stream not started.',
          );
          return;
        }
      }
      if (permission == geo.LocationPermission.deniedForever) {
        debugPrint('[GPS] Location permission permanently denied.');
        return;
      }

      debugPrint('[GPS] Starting native navigation location stream.');
      _gpsSubscription = NativeNavigationService.instance.fixes
          .map((fix) => fix.toPosition())
          .listen(
            _onGpsPosition,
            onError: (Object error, StackTrace stackTrace) {
              // Keep the stream/watchdog active; a subsequent fix callback resumes
              // normal updates automatically without resetting map/route state.
              debugPrint('[GPS] Position stream error: $error\n$stackTrace');
            },
            cancelOnError: false,
          );

      try {
        await NativeNavigationService.instance.start(
          intervalMs: 500,
          // Zero keeps the native fused stream alive while stopped. The Dart
          // drift filter still holds the marker steady without falsely declaring
          // that GPS was lost simply because the truck did not move one metre.
          distanceFilterMeters: 0,
        );
        _gpsTrackingStartedAt = DateTime.now();
      } on NativeNavigationException catch (error) {
        await _gpsSubscription?.cancel();
        _gpsSubscription = null;
        if (mounted) {
          setState(() {
            _gpsStale = true;
            _error = error.message;
          });
        }
        debugPrint('[GPS] Native navigation failed: $error');
        return;
      }

      _startGpsWatchdog();
    } catch (error, stack) {
      await _gpsSubscription?.cancel();
      _gpsSubscription = null;
      if (!mounted) return;
      setState(() {
        _gpsStale = true;
        _error = 'GPS could not start. Check location settings and try again.';
      });
      if (kDebugMode) {
        debugPrint('[GPS] Startup error: $error\n$stack');
      }
    }
  }

  /// Waits for an immediate navigation-grade location before route building.
  ///
  /// The continuous native stream remains the primary source. This one-shot
  /// request closes the cold-start gap where a driver can select a destination
  /// before Android has delivered the stream's first callback. A recent,
  /// accurate cached fix is accepted only when the live request times out.
  Future<LatLng?> _acquireRouteOrigin() async {
    if (_truckPosition != null) return _truckPosition;

    if (_isAcquiringGpsFix) {
      for (var attempt = 0; attempt < 40; attempt++) {
        await Future<void>.delayed(const Duration(milliseconds: 250));
        if (_truckPosition != null) return _truckPosition;
        if (!_isAcquiringGpsFix) break;
      }
      return _truckPosition;
    }

    _isAcquiringGpsFix = true;
    if (mounted) {
      setState(() {
        _error = 'Getting a precise GPS location…';
        _locationRecoveryAction = null;
      });
    }

    try {
      final serviceEnabled = await geo.Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        if (mounted) {
          setState(() {
            _error =
                'Location is turned off. Turn it on to build a route from your truck.';
            _locationRecoveryAction = _LocationRecoveryAction.enableServices;
          });
        }
        return null;
      }

      var permission = await geo.Geolocator.checkPermission();
      if (permission == geo.LocationPermission.denied) {
        permission = await geo.Geolocator.requestPermission();
      }
      if (permission == geo.LocationPermission.deniedForever) {
        if (mounted) {
          setState(() {
            _error =
                'Precise location is blocked. Allow it in SemiTrax app settings.';
            _locationRecoveryAction = _LocationRecoveryAction.appSettings;
          });
        }
        return null;
      }
      if (permission == geo.LocationPermission.denied) {
        if (mounted) {
          setState(() {
            _error =
                'Precise location permission is required to use your truck as the route origin.';
            _locationRecoveryAction = _LocationRecoveryAction.retry;
          });
        }
        return null;
      }

      // Ensure the foreground fused-location request is alive even when the
      // screen's initial start raced with the Android permission dialog.
      await NativeNavigationService.instance.start(
        intervalMs: 500,
        distanceFilterMeters: 0,
      );
      _gpsTrackingStartedAt ??= DateTime.now();
      _startGpsWatchdog();

      geo.Position? position;
      try {
        position = await geo.Geolocator.getCurrentPosition(
          locationSettings: const geo.LocationSettings(
            accuracy: geo.LocationAccuracy.bestForNavigation,
            timeLimit: Duration(seconds: 15),
          ),
        );
      } on TimeoutException {
        final cached = await geo.Geolocator.getLastKnownPosition();
        if (cached != null) {
          final age = DateTime.now().difference(cached.timestamp).abs();
          if (age <= const Duration(minutes: 2) &&
              cached.accuracy >= 0 &&
              cached.accuracy <= _poorAccuracyMeters) {
            position = cached;
          }
        }
      }

      if (position == null) {
        if (mounted) {
          setState(() {
            _error =
                'GPS is on but has no precise fix yet. Move near a window or outdoors, then retry.';
            _locationRecoveryAction = _LocationRecoveryAction.retry;
          });
        }
        return null;
      }

      _onGpsPosition(position);
      final accepted = _truckPosition;
      if (accepted == null) {
        if (mounted) {
          setState(() {
            _error =
                'GPS accuracy is ${position!.accuracy.toStringAsFixed(0)} m. Wait for a stronger signal, then retry.';
            _locationRecoveryAction = _LocationRecoveryAction.retry;
          });
        }
        return null;
      }

      if (mounted) {
        setState(() {
          _error = null;
          _locationRecoveryAction = null;
        });
      }
      return accepted;
    } on NativeNavigationException catch (error) {
      if (mounted) {
        setState(() {
          _error = error.message;
          _locationRecoveryAction = _LocationRecoveryAction.retry;
        });
      }
      return null;
    } on Object catch (error) {
      if (kDebugMode) debugPrint('[GPS] Immediate fix failed: $error');
      if (mounted) {
        setState(() {
          _error =
              'Unable to acquire GPS. Check precise location and try again.';
          _locationRecoveryAction = _LocationRecoveryAction.retry;
        });
      }
      return null;
    } finally {
      _isAcquiringGpsFix = false;
    }
  }

  Future<void> _handleLocationRecovery() async {
    final action = _locationRecoveryAction ?? _LocationRecoveryAction.retry;
    switch (action) {
      case _LocationRecoveryAction.enableServices:
        await geo.Geolocator.openLocationSettings();
        return;
      case _LocationRecoveryAction.appSettings:
        await geo.Geolocator.openAppSettings();
        return;
      case _LocationRecoveryAction.retry:
        if (_selectedDestination != null && !_isLoadingRoute) {
          await fetchRoute();
        } else {
          await _acquireRouteOrigin();
        }
    }
  }

  String get _locationRecoveryLabel => switch (_locationRecoveryAction) {
    _LocationRecoveryAction.enableServices => 'Turn on location',
    _LocationRecoveryAction.appSettings => 'Open settings',
    _ => 'Retry GPS',
  };

  /// Starts a periodic watchdog timer that detects GPS signal loss.
  ///
  /// The watchdog fires every [_gpsWatchdogIntervalSeconds] seconds and
  /// checks whether a fresh fix was received within the last
  /// [_gpsStalenessThresholdSeconds] seconds.  When the stream is silent
  /// longer than the threshold the session is marked stale:
  ///   • [_gpsStale] is set to `true` so the UI can show a signal-loss badge.
  ///   • [_currentSpeedMps] is reset to `-1.0` (unavailable) to prevent a
  ///     frozen speed value from misleading the driver.
  ///   • A diagnostic log entry is emitted with the time since the last fix.
  ///
  /// The watchdog clears [_gpsStale] and logs a recovery message as soon as
  /// [_onGpsPosition] is called again with a valid fix.
  void _startGpsWatchdog() {
    _gpsWatchdogTimer?.cancel();
    _gpsWatchdogTimer = Timer.periodic(
      Duration(seconds: _gpsWatchdogIntervalSeconds),
      (_) {
        if (!mounted) return;
        final now = DateTime.now();
        final lastFix = _lastGpsFixTime;
        final silenceReference = lastFix ?? _gpsTrackingStartedAt;
        if (silenceReference == null) return;
        final silentSeconds = now.difference(silenceReference).inSeconds;
        if (silentSeconds >= _gpsStalenessThresholdSeconds) {
          if (!_gpsStale) {
            debugPrint(
              '[GPS] ⚠ Signal unavailable — no fix for ${silentSeconds}s '
              '(threshold: ${_gpsStalenessThresholdSeconds}s). '
              'Last fix: ${lastFix ?? "none received"}. Resetting speed to unavailable.',
            );
            setState(() {
              _gpsStale = true;
              _currentSpeedMps =
                  -1.0; // reset: speed unknown during signal loss
            });
            unawaited(
              _speakAlert(
                'GPS signal lost. Position and speed may be out of date.',
              ),
            );
          } else {
            // Already stale — emit a periodic reminder for diagnostics.
            debugPrint('[GPS] ⚠ Still no fix — silent for ${silentSeconds}s.');
          }

          final lastRecovery = _lastGpsRecoveryAttempt;
          if (lastRecovery == null ||
              now.difference(lastRecovery).inSeconds >=
                  _gpsRecoveryRetrySeconds) {
            _lastGpsRecoveryAttempt = now;
            unawaited(_restartNativeGpsUpdates());
          }
        }
      },
    );
  }

  /// Reissues the native high-accuracy request after a genuinely silent
  /// stream. It does not recreate the EventChannel subscription or route state.
  Future<void> _restartNativeGpsUpdates() async {
    try {
      await NativeNavigationService.instance.start(
        intervalMs: 500,
        distanceFilterMeters: 0,
      );
      // Request one immediate navigation-grade fix as a recovery path. Android
      // can keep an EventChannel alive while the fused callback itself has gone
      // quiet after doze, process resume, or provider switching.
      final freshPosition = await geo.Geolocator.getCurrentPosition(
        locationSettings: const geo.LocationSettings(
          accuracy: geo.LocationAccuracy.bestForNavigation,
          timeLimit: Duration(seconds: 12),
        ),
      );
      if (mounted) _onGpsPosition(freshPosition);
      debugPrint('[GPS] Fused stream restarted and current fix refreshed.');
    } on Object catch (error) {
      debugPrint('[GPS] Fused-location recovery failed: $error');
    }
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
  ///
  /// After arrival, GPS updates still refresh the live position/speed UI so
  /// the map never appears frozen; only arrival-specific navigation logic is
  /// skipped by the `_hasActiveDestination && !_isArrived` guard below.
  void _onGpsPosition(geo.Position position) {
    if (!mounted) return;
    if (kDebugMode) {
      debugPrint(
        '[GPS] New update — '
        'lat=${position.latitude.toStringAsFixed(6)} '
        'lng=${position.longitude.toStringAsFixed(6)} '
        'accuracy=${position.accuracy.toStringAsFixed(1)}m '
        'speed=${position.speed.toStringAsFixed(1)}m/s '
        'heading=${position.heading.toStringAsFixed(1)}°',
      );
    }
    // Pause guard: skip all tracking updates while navigation is paused.
    if (_navigationPaused) return;

    // ── GPS watchdog: record fix arrival time and clear stale flag ────────
    // Must run before the acceptance filter so even rejected fixes (noise,
    // poor accuracy) reset the watchdog — the stream is still alive.
    //
    // Wall-clock time (DateTime.now()) is used intentionally rather than
    // position.timestamp, which reflects when the GPS chip computed the fix.
    // position.timestamp can be delayed by GNSS buffering, OS caching, or
    // Geolocator batching, and may even be null on some Android configurations.
    // The watchdog goal is to detect "has the app received any fix recently?"
    // not "when did the hardware last lock on to satellites?" — so measuring
    // the time each callback actually arrives at the application layer is the
    // correct approach.
    final fixArrivalTime = DateTime.now();
    final bool wasStale = _gpsStale;
    if (_gpsStale) {
      // GPS just recovered — log it and clear the stale state.
      final staleSince = _lastGpsFixTime;
      final gapSeconds = staleSince != null
          ? fixArrivalTime.difference(staleSince).inSeconds
          : null;
      debugPrint(
        '[GPS] ✅ Signal recovered after ${gapSeconds != null ? "${gapSeconds}s" : "unknown duration"}. '
        'accuracy=${position.accuracy.toStringAsFixed(1)}m '
        'speed=${position.speed.toStringAsFixed(1)}m/s',
      );
      if (mounted) setState(() => _gpsStale = false);
      unawaited(_speakAlert('GPS signal restored'));
    }
    _lastGpsFixTime = fixArrivalTime;

    // ── GPS drift / noise filter ───────────────────────────────────────────
    // Apply the position acceptance filter: ignores stopped drift, poor-
    // accuracy jitter, and low-speed fluctuations until confirmed stable.
    // This replaces the old hard 20 m accuracy cut-off with a richer logic
    // that handles all cases described in the GPS-drift spec.
    if (!_shouldAcceptPosition(position)) {
      debugPrint(
        '[GPS] Fix rejected by drift filter — '
        'accuracy=${position.accuracy.toStringAsFixed(1)}m '
        'speed=${position.speed.toStringAsFixed(1)}m/s '
        'lat=${position.latitude.toStringAsFixed(6)} '
        'lng=${position.longitude.toStringAsFixed(6)}',
      );
      return;
    }

    // Diagnostic log every accepted fix for easier field debugging.
    debugPrint(
      '[GPS] Fix accepted — '
      'accuracy=${position.accuracy.toStringAsFixed(1)}m '
      'speed=${(_speedMphFromMps(position.speed)).toStringAsFixed(1)}mph '
      'heading=${position.heading.toStringAsFixed(1)}° '
      'staleRecovered=$wasStale',
    );

    // Mark whether the vehicle is currently stopped for all downstream logic.
    _isStopped = _speedMphFromMps(position.speed) < _stoppedSpeedMph;
    _gpsActive = true;
    final gpsPoint = LatLng(position.latitude, position.longitude);
    unawaited(_refreshLiveNearbyPois(gpsPoint));
    if (_routePoints.isNotEmpty) {
      _scheduleRoadFeatureRefresh(center: gpsPoint, routeAware: true);
    }

    // ── Stable-fix detection for startup reroute suppression ─────────────
    // Mark a stable GPS fix once accuracy is within 30 m and speed data is
    // valid.  This allows the startup suppression to lift as soon as the
    // device has a solid lock.
    if (!_hasStableFixForNavigation &&
        _isLiveRouteAssistanceActive &&
        position.accuracy < 30.0 &&
        position.speed >= 0) {
      _hasStableFixForNavigation = true;
    }

    // ── Navigation-specific logic ─────────────────────────────────────────
    // The following checks only run when there is an active destination and
    // a live navigation session.  In plain GPS-tracking mode (no destination
    // selected) the truck marker and speed panel still update, but no
    // turn-by-turn, rerouting, TTS, or POI-alert behaviour fires.
    if (_isLiveRouteAssistanceActive && !_isArrived) {
      // Arrival detection: check proximity to destination first.
      // Always evaluated before step/off-route logic so arrival wins immediately.
      _checkArrival(gpsPoint);
      if (_isArrived)
        return; // arrival was just triggered — stop all processing

      // Leg arrival detection: advance active leg when driver reaches each stop.
      _checkLegArrival(gpsPoint);

      // Step advancement: keep the live street header aligned with the route.
      _checkStepAdvancement(gpsPoint);
      _maybeAnnounceUpcomingStreet(gpsPoint);

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

      // Physical traffic controls and mapped warning signs use route-progress
      // distance so parallel-road features do not notify the driver.
      _checkRoadFeatureApproachAlerts(gpsPoint);

      // Ahead-on-route weigh stations: refresh the closest 1–2 stations
      // ahead on the active route so the ClosestWeighStationsRow stays current.
      _refreshClosestWeighStationsAhead();

      // Ahead-on-route rest areas: refresh the closest rest area ahead on the
      // active route so the ClosestRestAreasRow stays current.
      _refreshClosestRestAreasAhead();

      // Trip statistics: update mileage and stopped time from live GPS.
      _updateTripStats(position);
    }

    // ── Update truck position and heading (tracking + navigation) ─────────
    // Snap to the nearest ahead-of-index route point for step/off-route logic
    // only when a route exists; otherwise keep the raw GPS fix for display.
    // Use _tryAdvanceRouteIndex instead of direct assignment to prevent GPS
    // noise teleports and fake progress while stopped.
    final previousRouteIndex = _truckIndex;
    int nearest = _truckIndex;
    if (_routePoints.isNotEmpty) {
      final candidate = _nearestRouteIndex(gpsPoint);
      _tryAdvanceRouteIndex(candidate, position);
      nearest = _truckIndex;
    }
    final liveRoadContext = _roadContextForRouteIndex(nearest);

    // Prefer the true device heading from GPS (heading ≥ 0 = valid fix).
    // Fall back to route-computed bearing when heading is unavailable (−1).
    // Suppress rotation when speed is below _noRotateSpeedMph to keep the
    // camera stable while the truck is slow or stopped.
    final double trueBearing;
    final double speedMph = _speedMphFromMps(position.speed);
    if (position.heading >= 0 && speedMph >= _noRotateSpeedMph) {
      // Real device compass heading — use directly for marker rotation.
      trueBearing = nav_utils.normalizeBearing(position.heading);
    } else if (_routePoints.isNotEmpty && nearest != previousRouteIndex) {
      // No GPS heading but route index changed: compute from route geometry.
      trueBearing = _bearingBetween(
        _routePoints[previousRouteIndex.clamp(0, _routePoints.length - 1)],
        _routePoints[nearest.clamp(0, _routePoints.length - 1)],
      );
    } else if (_routePoints.length > 1) {
      // When the nearest point has not changed, use the direction of the
      // current route segment instead of freezing an arbitrary old heading.
      final current = nearest.clamp(0, _routePoints.length - 1);
      final next = math.min(current + 1, _routePoints.length - 1);
      trueBearing = current == next
          ? _truckBearing
          : _bearingBetween(_routePoints[current], _routePoints[next]);
    } else {
      // Low speed, no GPS heading, or no index change: keep current bearing.
      trueBearing = _truckBearing;
    }

    // ── Speed update: read GPS speed and compute new speed limit estimate ────
    // pos.speed is in m/s; negative values mean the speed is unavailable.
    final double newSpeedMps = position.speed >= 0
        ? position.speed
        : _currentSpeedMps;
    final double carSpeedLimit = _estimateSpeedLimit();
    final double newSpeedLimit = _getTruckSpeedLimit(carSpeedLimit);

    // Capture the current truck position as the lerp start point before
    // updating any state.  Fall back to gpsPoint on the very first fix so
    // the marker appears at the real location immediately (no LatLng(0,0) jump).
    final interpFrom = _truckPosition ?? gpsPoint;
    // Invalidate any in-flight GPS interpolation so the stale loop exits and
    // the new animation takes over seamlessly.
    _gpsInterpGeneration++;
    final interpGen = _gpsInterpGeneration;

    // ── Smooth movement: interpolate toward the new fix to prevent jitter ─
    // Navigation checks above use the raw gpsPoint for accuracy; only the
    // displayed marker position is smoothed.
    final LatLng smoothedPoint;
    if (_lastAcceptedPosition != null && speedMph < _stoppedSpeedMph) {
      final smoothingWeight = _gpsSmoothingWeightFor(position);
      smoothedPoint = LatLng(
        _lastAcceptedPosition!.latitude * (1.0 - smoothingWeight) +
            gpsPoint.latitude * smoothingWeight,
        _lastAcceptedPosition!.longitude * (1.0 - smoothingWeight) +
            gpsPoint.longitude * smoothingWeight,
      );
    } else {
      smoothedPoint = gpsPoint;
    }

    // ── Snap-to-route: determine visual truck position ────────────────────
    // Real GPS is always used for distance calculations and off-route
    // detection above.  For visual rendering, snap the smoothed marker
    // position to the nearest point on the active route polyline when within
    // _snapThresholdMeters so the icon never appears off-road while the
    // driver is still close to the route.
    LatLng renderPosition = smoothedPoint;
    if (_routePoints.length >= 2) {
      final LatLng? snapped = _nearestPointOnPolyline(smoothedPoint);
      if (snapped != null) {
        final double distToRoute = geo.Geolocator.distanceBetween(
          smoothedPoint.latitude,
          smoothedPoint.longitude,
          snapped.latitude,
          snapped.longitude,
        );
        if (distToRoute < _snapThresholdMeters) {
          // Within snap threshold — place marker on the route line.
          renderPosition = snapped;
        }
        // If distToRoute >= _snapThresholdMeters the truck is potentially
        // off-route; _checkOffRoute (called above) handles the reroute.
      }
    }

    setState(() {
      // _truckPosition is NOT updated here — it is lerped smoothly to
      // renderPosition by _interpolateToGpsPosition below.
      // Use real device heading for accurate marker rotation.
      _truckBearing = nav_utils.normalizeBearing(trueBearing);
      // Persist updated speed and speed-limit for the PositionPanel overlay.
      _currentSpeedMps = newSpeedMps;
      _speedLimitMph = newSpeedLimit;
      if (liveRoadContext != null) {
        _liveRoadStepIndex = liveRoadContext.key;
        _liveRoadName = liveRoadContext.value;
      }
    });

    // GPS updates can jump past a maneuver without entering the 20 m proximity
    // circle. Route-index matching keeps the street header truthful in that case.
    final nativeGuidanceActive =
        _nativeNavigationPhase == NativeNavigationPhase.navigating ||
        _nativeNavigationPhase == NativeNavigationPhase.rerouting;
    if (_isLiveRouteAssistanceActive &&
        !nativeGuidanceActive &&
        liveRoadContext != null &&
        liveRoadContext.key > _currentStepIndex) {
      _activateNavigationStep(liveRoadContext.key, speak: false);
    }

    // Smoothly lerp the truck marker from its current rendered position to
    // the new GPS fix, preventing sudden jumps on each location update.
    _interpolateToGpsPosition(interpFrom, renderPosition, interpGen);

    // Record this fix as the last accepted position for the next filter cycle.
    _lastAcceptedPosition = position;

    // ── Over-speed announcement (navigation only, throttled) ──────────────
    // Only announce during active navigation and when speed data is available.
    if (_isLiveRouteAssistanceActive && newSpeedMps >= 0) {
      final double currentSpeedMph = newSpeedMps * _mpsToMph;
      if (newSpeedLimit > 0 && currentSpeedMph > newSpeedLimit) {
        final now = DateTime.now();
        // Throttle: announce at most once every [_slowDownThrottleSeconds] s.
        if (_lastSlowDownAnnouncementTime == null ||
            now.difference(_lastSlowDownAnnouncementTime!).inSeconds >=
                _slowDownThrottleSeconds) {
          _lastSlowDownAnnouncementTime = now;
          _speakAlert('Slow down');
        }
      }
    }

    // A continent-scale preview makes real movement look stationary. Once the
    // truck is genuinely moving, enter close follow unless the driver explicitly
    // pinned the overview with a long press on the recenter control.
    if (_routePoints.isNotEmpty &&
        speedMph >= _noRotateSpeedMph &&
        _cameraMode == NavigationCameraMode.overview &&
        !_overviewPinnedByUser) {
      _cameraMode = NavigationCameraMode.follow;
    }

    // Check whether to auto-return from free mode to follow mode (8 s idle).
    _maybeReturnToFollowMode();

    // Keep the camera centred on the truck while in follow mode.
    // _updateBestNavigationCamera handles speed-adaptive zoom, pitch, bearing
    // smoothing, and stable stopped behaviour in one place.
    if (_cameraMode == NavigationCameraMode.follow) {
      _updateBestNavigationCamera(position);
    }

    // Refresh the 2-closest-ahead truck stops row on every GPS fix during
    // active navigation so the UI stays in sync with the driver's position.
    if (_isLiveRouteAssistanceActive) {
      _refreshClosestTruckStopsAhead();
      // Refresh upcoming route alert chips (top-right overlay).
      // Remove the call below to disable the upcoming-alerts feature.
      _refreshUpcomingAlerts();
      // Recalculate remaining miles, drive time, and ETA so the bottom trip
      // strip and compact strip always reflect the true remaining distance
      // for the active route, even after reroutes or destination changes.
      _refreshTripProgress();
      // Refresh the exit preview card based on the current step and distance.
      _refreshExitPreview();
      // Throttled refresh of the route-only POI Mapbox source.  Only pushes a
      // new GeoJSON payload when the driver has advanced ≥ 0.2 miles, the
      // filtered POI list has changed, or at least 2 s have elapsed.
      _refreshRoutePoiSourceIfNeeded();
    }
  }

  /// Advances to the next step when the driver reaches its maneuver point.
  void _checkStepAdvancement(LatLng current) {
    if (_navSteps.isEmpty) return;
    // Do not advance steps unless the vehicle is actually moving. GPS noise
    // while stationary can otherwise advance a maneuver prematurely.
    if (_lastAcceptedPosition == null ||
        !_shouldAdvanceRouteProgress(_lastAcceptedPosition!)) {
      return;
    }
    final nextIdx = _currentStepIndex + 1;
    if (nextIdx >= _navSteps.length) return;
    final distanceMeters = _distanceBetween(
      current,
      _navSteps[nextIdx].location,
    );
    if (distanceMeters <= 20.0) _activateNavigationStep(nextIdx);
  }

  void _activateNavigationStep(int index, {bool speak = true}) {
    if (!mounted || index < 0 || index >= _navSteps.length) return;
    final step = _navSteps[index];
    setState(() {
      _currentStepIndex = index;
      _halfMileAnnouncedStepIndex = null;
      _nearTurnAnnouncedStepIndex = null;
    });
    _updateTopInstructionFromNavigationStep(
      maneuverType: step.type,
      modifier: step.maneuver,
      instruction: step.instruction,
      roadName: step.nextRoadName ?? step.name,
      currentRoadName: step.currentRoadName,
      nextRoadName: _nextNamedRoadAfter(index),
      distanceMiles: step.distanceMeters / _metersPerMile,
      exitNumber: step.exitNumber,
    );
    if (speak && step.instruction.trim().isNotEmpty) {
      unawaited(_speak(step.instruction));
    }
    _refreshExitPreview();
  }

  /// Announces the upcoming maneuver early enough for a commercial driver to
  /// prepare. Licensed native guidance remains authoritative when active.
  void _maybeAnnounceUpcomingStreet(LatLng current) {
    if (!_isLiveRouteAssistanceActive || _isStopped || _navSteps.isEmpty) {
      return;
    }
    final nativeGuidanceActive =
        _nativeNavigationPhase == NativeNavigationPhase.navigating ||
        _nativeNavigationPhase == NativeNavigationPhase.rerouting;
    if (nativeGuidanceActive) return;

    final targetIndex = _currentStepIndex + 1;
    if (targetIndex >= _navSteps.length) return;
    final target = _navSteps[targetIndex];
    final distanceMeters = _distanceBetween(current, target.location);
    final guidance = buildStreetGuidanceText(
      maneuverType: target.type,
      modifier: target.maneuver,
      instruction: target.instruction,
      roadName: target.nextRoadName ?? target.name,
      currentRoadName: target.currentRoadName,
      nextRoadName: _nextNamedRoadAfter(targetIndex),
    );
    final instruction = guidance.headline.trim().isEmpty
        ? target.instruction.trim()
        : guidance.headline.trim();
    if (instruction.isEmpty) return;

    if (distanceMeters <= 244 && _nearTurnAnnouncedStepIndex != targetIndex) {
      _nearTurnAnnouncedStepIndex = targetIndex;
      _halfMileAnnouncedStepIndex = targetIndex;
      unawaited(_speak('In 800 feet, $instruction'));
    } else if (distanceMeters <= 805 &&
        _halfMileAnnouncedStepIndex != targetIndex) {
      _halfMileAnnouncedStepIndex = targetIndex;
      unawaited(_speak('In half a mile, $instruction'));
    }
  }

  /// Detects whether [current] has strayed outside the accuracy-aware route
  /// corridor. When off-route, triggers a full truck-route recalculation from
  /// the current live GPS position to the original destination.
  ///
  /// Rerouting is not immediate: the driver must be more than
  /// the effective corridor from the route **continuously for at least
  /// 5 seconds** before a reroute is triggered.  Once on-route again the
  /// off-route timer is reset, so a brief GPS excursion never causes a reroute.
  ///
  /// Uses [geo.Geolocator.distanceBetween] for GPS-grade distance measurement and
  /// throttles reroutes to at most one every [_rerouteThrottleSeconds] seconds
  /// to prevent rapid repeated API calls in areas with poor GPS accuracy.
  /// Only reroutes when the vehicle is moving (_isStopped == false).
  void _checkOffRoute(LatLng current) {
    if (_routePoints.length < 2 || _routeCalculationCoordinator.inProgress) {
      return;
    }

    // Never reroute while stopped — GPS noise while parked can shift the
    // position outside the route corridor and trigger spurious reroutes.
    if (_isStopped) return;

    // Suppress reroutes during the first 10 seconds after navigation starts
    // and until a stable GPS fix is available.
    if (_isRerouteSuppressedAtStartup()) return;

    // Require the driver to be moving at more than 3 mph (≈1.34 m/s) before
    // considering a reroute to ignore GPS jitter while slow or stopped.
    if (_lastAcceptedPosition == null || _lastAcceptedPosition!.speed < 1.34) {
      _resetOffRouteState();
      return;
    }

    // Compute minimum distance from current position to the route polyline.
    // A precise fix uses a 50 m urban corridor so a parallel side road is
    // detected promptly. Poorer fixes widen the corridor, capped at the former
    // 80 m safety value, to avoid false reroutes caused by GPS uncertainty.
    final double minDist = _distanceToNearestRouteMeters(current);
    final double offRouteThreshold = _effectiveOffRouteThresholdMeters();

    if (minDist <= offRouteThreshold) {
      // Driver is back on or near the route — reset the off-route timer.
      _resetOffRouteState();
      return;
    }

    // The driver is outside the current route corridor. Record the time of the
    // first detection; subsequent fixes accumulate continuous off-route time.
    final now = DateTime.now();
    _offRouteDetectedAt ??= now;

    // Require at least 5 seconds of continuous off-route before rerouting to
    // avoid reacting to momentary GPS noise or brief deviations.
    if (now.difference(_offRouteDetectedAt!).inSeconds <
        _offRouteConfirmationSeconds)
      return;

    // Enforce 10-second cooldown (debounce) between consecutive reroutes.
    if (_lastRerouteAt != null &&
        now.difference(_lastRerouteAt!).inSeconds < _rerouteThrottleSeconds) {
      return;
    }

    // Additional API-rate guards: directions debounce and route-update check.
    if (!_canCallDirections()) return;
    if (!_canCallApi()) return;
    if (!_shouldUpdateRoute(current.latitude, current.longitude)) return;

    _lastRerouteTime = now;
    _lastRerouteAt = now;
    _offRouteDetectedAt = null;
    // Show rerouting status indicator and announce the change via TTS.
    setState(() => _navStatus = 'Recalculating truck route…');
    unawaited(_speakAlert('Off route. Recalculating the truck safe route.'));
    // Re-fetch the route from the current live position to the original
    // destination, then clear the rerouting lock and status indicator.
    _requestReroute(current, reason: 'off-route').then((completion) {
      if (mounted && completion == LatestRequestCompletion.completed) {
        // Force-refresh the route-POI source immediately after the reroute
        // completes so markers reflect the new route geometry without waiting
        // for the next GPS-update throttle window.
        _refreshRoutePoiSourceIfNeeded(force: true);
        if (_routePoints.isNotEmpty) {
          unawaited(_speakAlert('Truck route updated'));
        }
      }
    });
  }

  Future<LatestRequestCompletion> _requestReroute(
    LatLng origin, {
    required String reason,
  }) {
    final nativeGuidanceActive =
        _nativeNavigationStatus?.truckSafeGuidanceAvailable == true &&
        (_nativeNavigationPhase == NativeNavigationPhase.navigating ||
            _nativeNavigationPhase == NativeNavigationPhase.rerouting);
    return _submitRouteCalculation(
      _RouteCalculationRequest(
        kind: nativeGuidanceActive
            ? _RouteCalculationKind.native
            : _RouteCalculationKind.backend,
        reason: reason,
        destination: _selectedDestination ?? _destination,
        origin: origin,
      ),
    );
  }

  /// Returns true when rerouting should be suppressed because navigation just
  /// started (within the 10-second startup window) or the device has not yet
  /// received a stable GPS fix since navigation began.
  bool _isRerouteSuppressedAtStartup() {
    if (_navigationStartedAt == null) return true;
    final elapsed = DateTime.now().difference(_navigationStartedAt!);
    return elapsed.inSeconds < 10 || !_hasStableFixForNavigation;
  }

  /// Computes the minimum distance in metres from [pos] to the nearest point
  /// on the locally relevant route window. Using the same bounded match for
  /// snapping, progress, and off-route detection prevents contradictory state
  /// near crossings and parallel roads.
  double _distanceToNearestRouteMeters(LatLng pos) {
    return _matchActiveRoute(pos)?.crossTrackMeters ?? double.infinity;
  }

  /// Returns an off-route corridor that reflects the current GPS uncertainty.
  /// With a navigation-grade fix this is 50 m; lower-quality fixes gradually
  /// widen the corridor up to [_offRouteThresholdMeters].
  double _effectiveOffRouteThresholdMeters() {
    final accuracy = _lastAcceptedPosition?.accuracy ?? 0.0;
    if (!accuracy.isFinite || accuracy <= 0) {
      return _offRouteThresholdMeters;
    }
    return (accuracy * 1.5).clamp(50.0, _offRouteThresholdMeters);
  }

  RouteMatch? _matchActiveRoute(LatLng pos) {
    return matchRoutePosition(
      route: _routePoints,
      current: pos,
      currentRouteIndex: _truckIndex,
      backwardSegmentWindow: 3,
      forwardSegmentWindow: 36,
    );
  }

  /// Returns the projected point from the current bounded route match.
  LatLng? _nearestPointOnPolyline(LatLng pos) {
    return _matchActiveRoute(pos)?.projectedPoint;
  }

  /// Returns true when all conditions for triggering a reroute are met:
  /// the driver is moving faster than 3 mph and is more than
  /// [_offRouteThresholdMeters] from the nearest route point.
  bool _shouldTriggerReroute(LatLng pos) {
    if (_lastAcceptedPosition == null || _lastAcceptedPosition!.speed < 1.34) {
      return false;
    }
    return _distanceToNearestRouteMeters(pos) >
        _effectiveOffRouteThresholdMeters();
  }

  /// Resets the off-route detection timer so that a single on-route GPS fix
  /// cancels any pending reroute decision.
  void _resetOffRouteState() {
    _offRouteDetectedAt = null;
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
    _routeCalculationCoordinator.invalidate();
    _isLoadingRoute = false;
    _roadFeatureRequestGeneration++;
    _routePoiRequestGeneration++;
    unawaited(_analyticsService.endNavigation(status: 'CANCELED'));
    _animTimer?.cancel();
    _animGeneration++; // invalidate any in-flight smooth animation loop
    _tts.stop();
    setState(() {
      _activeRouteRevision++;
      _navigationActive = false;
      _navigationMode = false;
      _isNavigating = false;
      _isArrived = false;
      _cameraMode =
          NavigationCameraMode.free; // no active destination to follow
      _overviewPinnedByUser = false;
      _routePoints = const [];
      _navSteps = const [];
      _currentStepIndex = 0;
      _halfMileAnnouncedStepIndex = null;
      _nearTurnAnnouncedStepIndex = null;
      _lastNativeSpokenInstruction = null;
      _liveRoadName = null;
      _liveRoadStepIndex = 0;
      _routeData = null;
      _routeTotalDistanceMiles = 0.0;
      _routeTotalDurationSeconds = 0;
      _destinationTimeZone = null;
      _destinationTimeZoneCoordinate = null;
      _destinationTimeZoneRequestGeneration++;
      _tripProgressInfo = _createTripProgress(
        0,
        Duration.zero,
        forceZero: true,
      );
      _routeViolations = const [];
      _weatherRisk = null;
      _restrictionAhead = null;
      _navStatus = null;
      _isRerouting = false;
      _isRestrictionRerouting = false;
      _restrictionRerouteAttempts = 0;
      _warningAhead = null;
      _roadFeatureAhead = null;
      _roadFeatureAheadMeters = null;
      _roadFeatures = const [];
      _routeOptions = const [];
      _selectedRouteOptionIndex = 0;
      _previewPanelExpanded = false;
      _routePreviewActive = false;
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
      _closestWeighStationsAhead = const [];
      _closestRestAreasAhead = const [];
      _upcomingAlerts = const [];
      _topInstructionData = null;
      _secondaryInstructionData = null;
      _nativeNavigationPhase = NativeNavigationPhase.idle;
      _navigationPaused = false;
      // Reset GPS watchdog staleness so the stale indicator is cleared
      // between navigation sessions when the route is cancelled.
      _gpsStale = false;
    });
    _restrictionAlertShown.clear();
    _poiAlertShown.clear();
    // Reset warning manager so the next navigation session starts clean.
    _warningManager.reset();
    _warningAlertShown.clear();
    _roadFeatureAlerted.clear();
    _roadFeatureRouteIndices.clear();
    _roadFeatureCrossTrackMeters.clear();
    _roadFeatureRouteOffsetsMeters.clear();
    _routeCumulativeMeters = const [];
    _roadFeatureRouteSignature = 0;
    _lastRoadFeatureCenter = null;
    _lastRoadFeatureLoadedAt = null;
    _roadFeatureRefreshTimer?.cancel();
    // Reset route-POI tracking state so the next navigation session starts
    // with a clean slate and the first GPS fix triggers a fresh source push.
    _lastRoutePoiRefreshAt = null;
    _lastRoutePoiRefreshMiles = 0.0;
    _currentRouteProgressMiles = 0.0;
    _lastRoutePoiSourceHash = '';
    // Clear the route-only POI source so stale markers are removed from the
    // map immediately when the driver cancels navigation.
    _refreshRoutePoiSourceIfNeeded(force: true);
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

    _analyticsService.updateNavigationSnapshot(
      actualDistanceMiles: _milesDriven,
      actualDurationSeconds: _tripStartTime == null
          ? null
          : now.difference(_tripStartTime!).inSeconds,
    );

    // Trigger a UI rebuild so the trip-stats panel reflects the latest values.
    if (mounted) setState(() {});
  }

  // ── Trip progress helpers ──────────────────────────────────────────────────

  /// Returns smooth route distance from the driver's projected polyline
  /// position to the terminal point. This updates between route vertices rather
  /// than dropping only when [_truckIndex] changes.
  double _computeRemainingMilesOnRoute() {
    if (_routePoints.isEmpty) return 0;
    final current = _lastAcceptedPosition == null
        ? (_truckPosition ??
              _routePoints[_truckIndex.clamp(0, _routePoints.length - 1)])
        : LatLng(
            _lastAcceptedPosition!.latitude,
            _lastAcceptedPosition!.longitude,
          );
    return (_matchActiveRoute(current)?.remainingRouteMeters ?? 0) /
        _metersPerMile;
  }

  TripProgressInfo _createTripProgress(
    double milesRemaining,
    Duration durationRemaining, {
    bool forceZero = false,
  }) {
    final safeMiles = forceZero || !milesRemaining.isFinite
        ? 0.0
        : math.max(0.0, milesRemaining);
    final safeSeconds = forceZero
        ? 0
        : math.max(0, durationRemaining.inSeconds);
    final safeDuration = Duration(seconds: safeSeconds);
    final nowUtc = DateTime.now().toUtc();
    final arrivalInstant = nowUtc.add(safeDuration);
    final destinationZone = _destinationTimeZone;
    final arrivalTime = destinationZone == null
        ? arrivalInstant.toLocal()
        : destinationZone.localTimeAt(arrivalInstant);
    final label = destinationZone == null
        ? arrivalTime.timeZoneName
        : destinationZone.abbreviationAt(arrivalInstant);
    final dayOffset = destinationZone == null
        ? _calendarDayDifference(DateTime.now(), arrivalTime)
        : destinationZone.dayOffsetAt(arrivalInstant, now: nowUtc);
    return TripProgressInfo(
      milesRemaining: safeMiles,
      durationRemaining: safeDuration,
      etaLocal: arrivalTime,
      timezoneLabel: label,
      arrivalDayOffset: dayOffset,
    );
  }

  int _calendarDayDifference(DateTime start, DateTime end) {
    final startDay = DateTime.utc(start.year, start.month, start.day);
    final endDay = DateTime.utc(end.year, end.month, end.day);
    return endDay.difference(startDay).inDays;
  }

  Future<void> _resolveDestinationTimeZone(LatLng destination) async {
    final cached = _destinationTimeZoneCoordinate;
    if (_destinationTimeZone != null &&
        cached != null &&
        _distanceBetween(cached, destination) < 100) {
      return;
    }
    final generation = ++_destinationTimeZoneRequestGeneration;
    try {
      final zone = await _destinationTimeZoneService.resolve(
        latitude: destination.latitude,
        longitude: destination.longitude,
      );
      if (!mounted || generation != _destinationTimeZoneRequestGeneration) {
        return;
      }
      setState(() {
        _destinationTimeZone = zone;
        _destinationTimeZoneCoordinate = destination;
        _tripProgressInfo = _createTripProgress(
          _tripProgressInfo.milesRemaining,
          _tripProgressInfo.durationRemaining,
        );
      });
    } catch (error) {
      if (kDebugMode) {
        debugPrint('Destination time-zone lookup failed: $error');
      }
    }
  }

  /// Seeds live progress from the selected HERE route totals.
  void _updateTripProgressFromRoute(double distanceMiles, int durationSeconds) {
    _routeTotalDistanceMiles = math.max(0, distanceMiles);
    _routeTotalDurationSeconds = math.max(0, durationSeconds);
    if (!mounted) return;
    setState(() {
      _tripProgressInfo = _createTripProgress(
        _routeTotalDistanceMiles,
        Duration(seconds: _routeTotalDurationSeconds),
      );
    });
  }

  /// Recalculates fallback progress from real GPS movement. Licensed native
  /// guidance values remain authoritative whenever that engine is active.
  void _refreshTripProgress() {
    if (_isArrived) {
      if (mounted) {
        setState(() {
          _tripProgressInfo = _createTripProgress(
            0,
            Duration.zero,
            forceZero: true,
          );
        });
      }
      return;
    }
    final nativeGuidanceActive =
        _nativeNavigationPhase == NativeNavigationPhase.navigating ||
        _nativeNavigationPhase == NativeNavigationPhase.rerouting;
    if (nativeGuidanceActive ||
        _routePoints.isEmpty ||
        _routeTotalDistanceMiles <= 0) {
      return;
    }

    var remainingMiles = _computeRemainingMilesOnRoute()
        .clamp(0.0, _routeTotalDistanceMiles)
        .toDouble();
    final previousMiles = _tripProgressInfo.milesRemaining;
    if (previousMiles > 0) {
      remainingMiles = math.min(remainingMiles, previousMiles);
    }
    final ratio = (remainingMiles / _routeTotalDistanceMiles).clamp(0.0, 1.0);
    final remainingSeconds = (_routeTotalDurationSeconds * ratio).round();
    if (!mounted) return;
    setState(() {
      _tripProgressInfo = _createTripProgress(
        remainingMiles,
        Duration(seconds: remainingSeconds),
      );
    });
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
    final elapsedSeconds = DateTime.now().difference(_tripStartTime!).inSeconds;
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
    _analyticsService.updateNavigationSnapshot(
      actualDistanceMiles: _milesDriven,
      actualDurationSeconds: _tripStartTime == null
          ? null
          : DateTime.now().difference(_tripStartTime!).inSeconds,
    );
    unawaited(_analyticsService.endNavigation(status: 'COMPLETED'));
    setState(() {
      _isArrived = true;
      _isNavigating = false;
      _routePreviewActive = false;
      _navigationActive = false;
      _tripProgressInfo = _createTripProgress(
        0,
        Duration.zero,
        forceZero: true,
      );
      // Invalidate any in-flight smooth animation loop.
      _animGeneration++;
    });
    TruckMapScreen.isNavigatingNotifier.value = false;
    // Keep the GPS stream and watchdog alive after arrival so the live
    // location panel and map marker continue to reflect the latest device
    // position and still report stale-signal conditions.
    // Speak the arrival announcement (interrupts any in-progress TTS).
    _speakAlert('You have arrived at your destination');
    // Show the trip-complete sheet after the current frame is fully drawn.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _showArrivalSheet(context);
    });
  }

  /// Returns the index of the route point closest to [point], searching only
  /// inside the bounded route-match window to prevent crossing-road jumps.
  int _nearestRouteIndex(LatLng point) {
    return _matchActiveRoute(point)?.nearestRoutePointIndex ?? _truckIndex;
  }

  /// Finds the closest point without the forward-only progress constraint.
  /// Used to map HERE maneuver offsets onto the simplified preview polyline.
  int _nearestRouteIndexFromStart(LatLng point) {
    if (_routePoints.isEmpty) return 0;
    double minDist = double.infinity;
    int nearest = 0;
    for (int i = 0; i < _routePoints.length; i++) {
      final distance = _distanceBetween(point, _routePoints[i]);
      if (distance < minDist) {
        minDist = distance;
        nearest = i;
      }
    }
    return nearest;
  }

  /// Resolves the road segment containing [routeIndex] from HERE's ordered
  /// maneuver list. This exposes truthful route-road context during preview;
  /// it is not presented as native turn-by-turn guidance.
  MapEntry<int, String>? _roadContextForRouteIndex(int routeIndex) {
    if (_routePoints.isEmpty || _navSteps.isEmpty) return null;

    int activeStep = 0;
    int activeOffset = -1;
    for (int i = 0; i < _navSteps.length; i++) {
      final stepOffset = _nearestRouteIndexFromStart(_navSteps[i].location);
      if (stepOffset <= routeIndex + 2 && stepOffset >= activeOffset) {
        activeOffset = stepOffset;
        activeStep = i;
      }
    }

    String roadName = _roadNameForStep(_navSteps[activeStep]);
    if (roadName.isEmpty) {
      // HERE arrival/departure actions occasionally omit a road name. Prefer
      // the closest earlier named segment, then a near upcoming segment.
      for (int i = activeStep - 1; i >= 0 && roadName.isEmpty; i--) {
        roadName = _roadNameForStep(_navSteps[i]);
      }
      for (
        int i = activeStep + 1;
        i < _navSteps.length && roadName.isEmpty;
        i++
      ) {
        roadName = _roadNameForStep(_navSteps[i]);
      }
    }
    if (roadName.isEmpty) return null;
    return MapEntry(activeStep, roadName);
  }

  void _refreshLiveRoadContextFromCurrentPosition() {
    if (!mounted || _routePoints.isEmpty || _navSteps.isEmpty) return;
    final routeIndex = _truckPosition == null
        ? _truckIndex
        : _nearestRouteIndexFromStart(_truckPosition!);
    final context = _roadContextForRouteIndex(routeIndex);
    if (context == null) return;
    setState(() {
      _liveRoadStepIndex = context.key;
      _liveRoadName = context.value;
    });
  }

  String _roadNameForStep(_NavStep step) {
    for (final providerName in [
      step.nextRoadName,
      step.name,
      step.currentRoadName,
    ]) {
      final cleaned = providerName?.trim() ?? '';
      if (cleaned.isNotEmpty && cleaned.toLowerCase() != 'unnamed road') {
        return cleaned;
      }
    }
    final match = RegExp(
      r'\b(?:onto|on|toward)\s+(.+?)(?:\s+(?:toward|for)\b|$)',
      caseSensitive: false,
    ).firstMatch(step.instruction);
    return match?.group(1)?.replaceAll(RegExp(r'[.,;]+$'), '').trim() ?? '';
  }

  String? _nextNamedRoadAfter(int stepIndex) {
    for (int index = stepIndex + 1; index < _navSteps.length; index++) {
      final roadName = _roadNameForStep(_navSteps[index]);
      if (roadName.isNotEmpty) return roadName;
    }
    return null;
  }

  /// Returns the provider speed limit, or unknown until native guidance
  /// supplies one. Route-progress heuristics are unsafe for a truck driver.
  double _estimateSpeedLimit() {
    return _speedLimitMph;
  }

  /// Returns the truck-specific speed limit for the given position.
  ///
  /// Applies a truck-specific provider value. A state bounding box is not
  /// accurate enough to manufacture a posted limit for the current road.
  double _getTruckSpeedLimit(double carSpeedLimit) {
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
    _truckPosition = _routePoints.isNotEmpty ? _routePoints.first : null;

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
  Future<void> _startNavigation() async {
    if (_routePoints.isEmpty) return;
    try {
      final status = await NativeNavigationService.instance.status();
      if (mounted) {
        setState(() {
          _nativeNavigationStatus = status;
          _nativeNavigationStatusLoading = false;
        });
      }
      if (!status.truckSafeGuidanceAvailable) {
        throw const NativeNavigationException(
          'TRUCK_SAFE_NATIVE_ROUTING_UNAVAILABLE',
          'Turn-by-turn navigation requires HERE SDK Navigate access. The truck-safe route preview is still available.',
        );
      }
      final destination = _selectedDestination ?? _destination;
      await NativeNavigationService.instance.updateDestination(
        destination.latitude,
        destination.longitude,
      );
      await NativeNavigationService.instance.previewRoute();
      await NativeNavigationService.instance.startNavigation();
    } on NativeNavigationException catch (error) {
      if (mounted) {
        setState(() {
          _isNavigating = false;
          _navigationActive = false;
        });
        TruckMapScreen.isNavigatingNotifier.value = false;
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              content: Text(error.message),
              behavior: SnackBarBehavior.floating,
              duration: const Duration(seconds: 4),
            ),
          );
      }
      return;
    }
    setState(() {
      _isNavigating = true;
      _navigationStartedAt = DateTime.now();
      _lastRerouteAt = null;
      _offRouteDetectedAt = null;
      _hasStableFixForNavigation = false;
    });
    unawaited(
      _analyticsService.startNavigation(
        estimatedDriveMinutes: (_routeTotalDurationSeconds / 60).ceil(),
      ),
    );
    // Re-check permission/service state when navigation starts and ensure
    // the GPS stream is active (important after previous trips).
    unawaited(_startGps());
    // Notify AppShell (and any other listeners) that navigation is now active
    // so the bottom navigation bar is hidden during the driving session.
    TruckMapScreen.isNavigatingNotifier.value = true;
    // Immediately populate the closest weigh station so the chip is visible
    // as soon as the driver taps "Start Navigation" without waiting for the
    // first GPS fix.
    _refreshClosestWeighStationsAhead();
    // Immediately populate the two closest truck stops ahead so the row is
    // visible as soon as the driver taps "Start Navigation".
    _refreshClosestTruckStopsAhead();
    // Start the warning manager so it evaluates proximity on each GPS fix.
    _warningManager.startNavigation();
    _startRouteAnimation();
    // Force an immediate route-POI source push so navigation-relevant markers
    // appear on the map right when the driver taps "Start Navigation" without
    // waiting for the first GPS fix.
    _refreshRoutePoiSourceIfNeeded(force: true);

    // Seed the card only from a verified route step. Native guidance replaces
    // it through [_onNativeNavigationState] when that provider is active.
    if (_navSteps.isNotEmpty) {
      final first = _navSteps[0];
      _updateTopInstructionFromNavigationStep(
        maneuverType: first.type,
        modifier: first.maneuver,
        instruction: first.instruction,
        roadName: first.nextRoadName ?? first.name,
        currentRoadName: first.currentRoadName,
        nextRoadName: _nextNamedRoadAfter(0),
        distanceMiles: first.distanceMeters * 0.000621371,
        exitNumber: first.exitNumber,
      );
    }
  }

  /// Stops the active navigation session and returns to planning/idle UI.
  ///
  /// Delegates to [_clearActiveRoute] which resets all trip state, stops TTS,
  /// cancels the route animation, and resets [_isNavigating] to false.
  Future<void> _stopNavigation() async {
    _analyticsService.updateNavigationSnapshot(
      actualDistanceMiles: _milesDriven,
      actualDurationSeconds: _tripStartTime == null
          ? null
          : DateTime.now().difference(_tripStartTime!).inSeconds,
    );
    _clearActiveRoute();

    // Quitting navigation is a hard session boundary. Stop every producer of
    // navigation state instead of relying on the last native phase, because an
    // assisted preview also owns the foreground location service.
    _gpsWatchdogTimer?.cancel();
    _gpsWatchdogTimer = null;
    _gpsInterpGeneration++;
    final gpsSubscription = _gpsSubscription;
    _gpsSubscription = null;
    _gpsActive = false;
    if (gpsSubscription != null) {
      await gpsSubscription.cancel();
    }
    await _tts.stop();

    final nativeNavigation = NativeNavigationService.instance;
    Future<void> attemptShutdown(
      String operation,
      Future<void> Function() action,
    ) async {
      try {
        await action().timeout(const Duration(seconds: 4));
      } catch (error) {
        if (kDebugMode) {
          debugPrint('Native navigation $operation failed: $error');
        }
      }
    }

    // Keep these calls independent: route state must still be cleared if the
    // foreground-service stop reports a platform error (and vice versa).
    await attemptShutdown('stop', nativeNavigation.stopNavigation);
    await attemptShutdown('route cancellation', nativeNavigation.cancelRoute);
    await _setNavigationScreenAwake(false);
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

      builtLegs.add(
        TripLeg(
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
        ),
      );

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
      _halfMileAnnouncedStepIndex = null;
      _nearTurnAnnouncedStepIndex = null;
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
      await _moveTruckSmoothly(
        _routePoints[i],
        _routePoints[i + 1],
        generation,
      );
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
    LatLng from,
    LatLng to,
    int generation,
  ) async {
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

  /// Smoothly interpolates the truck marker from [from] to [to] in response
  /// to a new GPS fix, preventing sudden jumps on each location update.
  ///
  /// Uses linear interpolation over ~420 ms with 14 frame-sized steps. The
  /// native stream requests a 500 ms interval, so the marker reaches each real
  /// fix before the next fix arrives instead of remaining almost one sample
  /// behind the truck.
  ///
  /// The [generation] parameter allows early exit when a new GPS fix arrives
  /// before the current interpolation finishes; the stale animation stops and
  /// the newer one takes over seamlessly.
  Future<void> _interpolateToGpsPosition(
    LatLng from,
    LatLng to,
    int generation,
  ) async {
    const steps = 14;
    for (int step = 1; step <= steps; step++) {
      if (!mounted || _gpsInterpGeneration != generation) return;
      await Future.delayed(const Duration(milliseconds: 30));
      if (!mounted || _gpsInterpGeneration != generation) return;
      final pos = _interpolate(from, to, step / steps);
      setState(() {
        _truckPosition = pos;
      });
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
    final x =
        math.cos(lat1) * math.sin(lat2) -
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
  double _distanceMiles(double lat1, double lng1, double lat2, double lng2) {
    const r = 3958.8; // Earth's radius in miles
    final dLat = (lat2 - lat1) * math.pi / 180.0;
    final dLng = (lng2 - lng1) * math.pi / 180.0;
    final a =
        math.sin(dLat / 2) * math.sin(dLat / 2) +
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
    double lat,
    double lng,
    List<RoutePoint> routePoints,
  ) {
    double minDist = double.infinity;
    int minIdx = 0;
    for (int i = 0; i < routePoints.length; i++) {
      final d = _distanceMiles(
        lat,
        lng,
        routePoints[i].lat,
        routePoints[i].lng,
      );
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
    List<RoutePoint> points,
    int startIndex,
    int endIndex,
  ) {
    if (endIndex <= startIndex) return 0.0;
    double total = 0.0;
    for (int i = startIndex; i < endIndex; i++) {
      total += _distanceMiles(
        points[i].lat,
        points[i].lng,
        points[i + 1].lat,
        points[i + 1].lng,
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
  /// [_poiPassedThresholdMiles] (200 m) are excluded as virtually passed.
  /// Stops farther than [_poiMaxAheadMiles] (50 km) ahead are also excluded
  /// so only nearby upcoming stops are surfaced.  Stops farther than
  /// [maxOffRouteMiles] from the route polyline are excluded.
  List<AheadTruckStop> _getClosestTruckStopsAheadOnRoute({
    required double driverLat,
    required double driverLng,
    required List<RoutePoint> routePoints,
    required List<TruckStopPoi> truckStops,
    double maxOffRouteMiles = 2.0,
  }) {
    if (routePoints.isEmpty) return const [];

    final driverIdx = _findNearestRouteIndexForPoi(
      driverLat,
      driverLng,
      routePoints,
    );

    final List<AheadTruckStop> ahead = [];
    for (final poi in truckStops) {
      if (!_isPoiNearRoute(
        poi,
        routePoints,
        maxDistanceMiles: maxOffRouteMiles,
      )) {
        continue;
      }
      final poiIdx = _findNearestRouteIndexForPoi(
        poi.latitude,
        poi.longitude,
        routePoints,
      );
      if (poiIdx < driverIdx) continue; // behind the driver on the route

      final routeMilesAhead = _routeDistanceMilesBetweenIndices(
        routePoints,
        driverIdx,
        poiIdx,
      );
      if (routeMilesAhead < _poiPassedThresholdMiles)
        continue; // virtually passed (< 200 m)
      if (routeMilesAhead > _poiMaxAheadMiles)
        continue; // beyond 50 km ahead — skip

      ahead.add(
        AheadTruckStop(
          poi: poi,
          routeMilesAhead: routeMilesAhead,
          nearestRouteIndex: poiIdx,
        ),
      );
    }

    ahead.sort((a, b) => a.routeMilesAhead.compareTo(b.routeMilesAhead));

    // HERE/provider place feeds can return separate entrance records for the
    // same travel center. Keep the closest route match so drivers do not see
    // duplicate chips for one physical commercial truck stop.
    final List<AheadTruckStop> uniqueFacilities = [];
    for (final candidate in ahead) {
      final candidateLogo = candidate.poi.logoName.trim().toLowerCase();
      final candidateName = candidate.poi.name.trim().toLowerCase();
      final isDuplicate = uniqueFacilities.any((existing) {
        final existingLogo = existing.poi.logoName.trim().toLowerCase();
        final existingName = existing.poi.name.trim().toLowerCase();
        final sameFacilityIdentity =
            (candidateLogo != 'truck_parking' &&
                candidateLogo.isNotEmpty &&
                candidateLogo == existingLogo) ||
            candidateName == existingName;
        if (!sameFacilityIdentity) return false;
        return _distanceMiles(
              candidate.poi.latitude,
              candidate.poi.longitude,
              existing.poi.latitude,
              existing.poi.longitude,
            ) <=
            0.5;
      });
      if (!isDuplicate) uniqueFacilities.add(candidate);
      if (uniqueFacilities.length == 2) break;
    }
    return uniqueFacilities;
  }

  /// Refreshes [_closestTruckStopsAhead] using the current driver position,
  /// active route polyline, and truck stop list.
  ///
  /// Uses [_loadedPois] loaded from the app's maintained POI assets.
  ///
  /// No-ops (and clears the list) when not navigating, when there is no
  /// driver position, or when route / stop data is unavailable.
  void _refreshClosestTruckStopsAhead() {
    final bool hasStopData = _loadedPois.isNotEmpty;
    if (!_isLiveRouteAssistanceActive ||
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

    // Build directly from PoiItem so provider provenance and verified entrance
    // metadata are preserved in the driver-facing detail sheet.
    final List<TruckStopPoi> pois = _loadedPois
        .where((p) => p.category == 'truck_stop')
        .map((p) {
          final liveParking = _nearestLiveParking(p.displayLat, p.displayLng);
          final liveDiesel = _nearestLiveDiesel(p.displayLat, p.displayLng);
          return TruckStopPoi(
            id: p.id,
            name: p.name,
            brand: p.icon,
            logoName: p.icon,
            latitude: p.displayLat,
            longitude: p.displayLng,
            locationName: p.city.isNotEmpty
                ? '${p.city}, ${p.stateOrProvince}'
                : p.stateOrProvince,
            address: p.address,
            dataSource: p.dataSource,
            verified: p.verified,
            dieselPrice: liveDiesel?.cashPrice,
            parkingStatus:
                liveParking == null || liveParking.availability == 'UNKNOWN'
                ? null
                : liveParking.availability.replaceAll('_', ' ').toLowerCase(),
            truckParkingSpaces: liveParking?.totalTruckSpaces,
            exitNumber: p.exitNumber,
          );
        })
        .toList(growable: false);

    final raw = _getClosestTruckStopsAheadOnRoute(
      driverLat: _truckPosition!.latitude,
      driverLng: _truckPosition!.longitude,
      routePoints: routePts,
      truckStops: pois,
    );

    // Enrich each stop that lacks an exit number by finding the nearest
    // _NavStep with an exit number within 2 miles of the stop's location.
    final updated = raw.map((stop) {
      if (stop.poi.exitNumber != null) return stop;
      final exit = _findExitNumberNearLocation(
        stop.poi.latitude,
        stop.poi.longitude,
      );
      if (exit == null) return stop;
      final enriched = TruckStopPoi(
        id: stop.poi.id,
        name: stop.poi.name,
        brand: stop.poi.brand,
        logoName: stop.poi.logoName,
        latitude: stop.poi.latitude,
        longitude: stop.poi.longitude,
        locationName: stop.poi.locationName,
        address: stop.poi.address,
        dataSource: stop.poi.dataSource,
        verified: stop.poi.verified,
        openNow: stop.poi.openNow,
        openingHours: stop.poi.openingHours,
        dieselPrice: stop.poi.dieselPrice,
        defPrice: stop.poi.defPrice,
        parkingStatus: stop.poi.parkingStatus,
        truckParkingSpaces: stop.poi.truckParkingSpaces,
        amenities: stop.poi.amenities,
        exitNumber: exit,
      );
      return AheadTruckStop(
        poi: enriched,
        routeMilesAhead: stop.routeMilesAhead,
        nearestRouteIndex: stop.nearestRouteIndex,
      );
    }).toList();

    setState(() => _closestTruckStopsAhead = updated);
  }

  LiveParkingLocation? _nearestLiveParking(double latitude, double longitude) {
    LiveParkingLocation? closest;
    var closestMiles = 0.5;
    for (final parking in _liveParkingLocations) {
      final miles = _distanceMiles(
        latitude,
        longitude,
        parking.position.latitude,
        parking.position.longitude,
      );
      if (miles < closestMiles) {
        closest = parking;
        closestMiles = miles;
      }
    }
    return closest;
  }

  LiveDieselStation? _nearestLiveDiesel(double latitude, double longitude) {
    LiveDieselStation? closest;
    var closestMiles = 0.5;
    for (final station in _liveDieselStations) {
      final miles = _distanceMiles(
        latitude,
        longitude,
        station.position.latitude,
        station.position.longitude,
      );
      if (miles < closestMiles) {
        closest = station;
        closestMiles = miles;
      }
    }
    return closest;
  }

  /// Returns the exit number from the nearest [_NavStep] that has one and is
  /// within [maxMiles] of the given coordinate, or null when none qualifies.
  String? _findExitNumberNearLocation(
    double lat,
    double lng, {
    double maxMiles = 2.0,
  }) {
    String? best;
    double bestDist = double.infinity;
    for (final step in _navSteps) {
      if (step.exitNumber == null) continue;
      final d = _distanceMiles(
        lat,
        lng,
        step.location.latitude,
        step.location.longitude,
      );
      if (d < maxMiles && d < bestDist) {
        bestDist = d;
        best = step.exitNumber;
      }
    }
    return best;
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
    {
      'lat': 39.876,
      'lng': -119.234,
      'type': 'weight_limit',
      'limit_value': 40.0,
    },
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
      final zonePt = LatLng(zone['lat']! as double, zone['lng']! as double);
      for (final pt in routePoints) {
        if (_distanceBetween(pt, zonePt) <=
            _restrictionProximityThresholdMeters)
          return false;
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

  String _truckRouteFailureMessage(Object error) {
    if (error is TimeoutException) {
      return 'Truck routing timed out. Check the connection and try again.';
    }
    if (error is ApiException) {
      if (error.code == 'UNSAFE_ROUTE') return error.message;
      if (error.statusCode == 400 || error.statusCode == 422) {
        return 'HERE could not calculate this truck route. Check the truck profile and destination.';
      }
      if (error.statusCode >= 500) {
        return 'The truck-routing service is temporarily unavailable. Please try again.';
      }
      if (!error.message.contains('{') && !error.message.contains('\n')) {
        return error.message;
      }
    }
    return 'Unable to calculate a truck-safe route. Please try again.';
  }

  /// Parses the normalized truck-route response returned by the selected
  /// backend provider. Provider-specific fields remain behind the backend
  /// adapter so this screen never has to merge HERE and Trimble payloads.
  ///
  /// Returns a [RouteResult] containing the decoded polyline points, parsed
  /// turn-by-turn steps, distance in miles, and duration in seconds.
  /// Returns `null` on error or when no routes are returned.
  RouteResult? _parseProviderRouteResult(
    Map<String, dynamic> route, {
    String? inheritedProvider,
    List<RouteResult> alternatives = const [],
  }) {
    final provider = route['provider']?.toString().trim();
    final resolvedProvider = provider == null || provider.isEmpty
        ? (inheritedProvider?.trim().isNotEmpty == true
              ? inheritedProvider!.trim()
              : 'Unknown')
        : provider;
    final geometry = route['routeGeometry'] as List? ?? const [];
    final decoded = geometry
        .whereType<List>()
        .where((point) => point.length >= 2)
        .map(
          (point) => LatLng(
            (point[1] as num).toDouble(),
            (point[0] as num).toDouble(),
          ),
        )
        .toList(growable: false);
    if (decoded.length < 2) return null;

    final maneuverJson = route['turnByTurn'] as List? ?? const [];
    final steps = maneuverJson.indexed
        .where((entry) => entry.$2 is Map<String, dynamic>)
        .map((entry) {
          final index = entry.$1;
          final item = entry.$2 as Map<String, dynamic>;
          final offset = ((item['offset'] as num?)?.toInt() ?? index).clamp(
            0,
            decoded.length - 1,
          );
          return _NavStep(
            item['instruction']?.toString() ?? 'Continue',
            decoded[offset],
            maneuver: item['direction']?.toString() ?? 'straight',
            type: item['action']?.toString() ?? '',
            distanceMeters:
                ((item['distanceMiles'] as num?)?.toDouble() ?? 0) *
                _metersPerMile,
            name: item['roadName']?.toString() ?? '',
            exitNumber: item['exitNumber']?.toString(),
            currentRoadName: item['currentRoadName']?.toString(),
            nextRoadName: item['nextRoadName']?.toString(),
          );
        })
        .toList(growable: false);

    final rawNotices =
        (route['alerts'] as List?) ?? (route['notices'] as List?) ?? const [];
    final notices = rawNotices
        .map((item) {
          if (item is Map<String, dynamic>) {
            final code = item['code']?.toString();
            final title = item['title']?.toString();
            if (title != null && title.trim().isNotEmpty) {
              return code == null ? title : '$code: $title';
            }
            return code ?? '';
          }
          return item.toString();
        })
        .where((item) => item.trim().isNotEmpty)
        .toList(growable: false);

    return RouteResult(
      provider: resolvedProvider,
      points: _simplifyRoute(decoded),
      steps: steps,
      distanceMiles: (route['distanceMiles'] as num).toDouble(),
      durationSeconds: (route['durationSeconds'] as num).toInt(),
      providerNotices: notices,
      alternatives: alternatives,
    );
  }

  Future<RouteResult?> _fetchRouteFromApi(
    LatLng origin,
    LatLng destination, {
    LatLng? viaPoint,
  }) async {
    final profile = _activeTruckProfile;
    if (profile == null) {
      throw StateError('Select a truck profile before calculating a route.');
    }
    try {
      final truck = profile.toJson()
        ..remove('name')
        ..remove('isDefault');
      final route = await widget.api
          .postJson('/routing/truck-route', {
            'origin': {'lat': origin.latitude, 'lng': origin.longitude},
            'destination': {
              'lat': destination.latitude,
              'lng': destination.longitude,
            },
            if (viaPoint != null)
              'viaStops': [
                {'lat': viaPoint.latitude, 'lng': viaPoint.longitude},
              ],
            'truck': truck,
            'routeMode': 'fastest',
            'alternatives': 2,
          })
          .timeout(const Duration(seconds: 30));
      if (route['truckSafe'] != true || route['navigationAllowed'] != true) {
        throw const ApiException(
          409,
          'UNSAFE_ROUTE',
          'The provider did not return a truck-safe route.',
        );
      }

      final provider = route['provider']?.toString().trim();
      final alternatives = (route['alternatives'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(
            (candidate) => _parseProviderRouteResult(
              candidate,
              inheritedProvider: provider,
            ),
          )
          .whereType<RouteResult>()
          .toList(growable: false);
      final parsed = _parseProviderRouteResult(
        route,
        alternatives: alternatives,
      );
      if (parsed == null) {
        throw StateError(
          'The truck-routing provider returned incomplete route geometry.',
        );
      }
      return parsed;
    } catch (e) {
      if (kDebugMode) debugPrint('_fetchRouteFromApi error: $e');
      rethrow;
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
    final origin = _truckPosition;
    if (origin == null || _isRestrictionRerouting) return;
    await _submitRouteCalculation(
      _RouteCalculationRequest(
        kind: _RouteCalculationKind.restriction,
        reason: 'restriction-avoidance',
        destination: _selectedDestination ?? _destination,
        origin: origin,
      ),
    );
  }

  Future<void> _executeRestrictionRouteCalculation(
    _RouteCalculationRequest request,
    int requestId,
    bool Function() isCurrent,
  ) async {
    final origin = request.origin;
    if (origin == null || !mounted || !isCurrent()) return;

    setState(() {
      _isRestrictionRerouting = true;
      _restrictionRerouteAttempts = 0;
      _navStatus = 'Checking truck restrictions…';
    });

    RouteResult? bestResult;
    var candidatePoints = List<LatLng>.of(_routePoints);
    try {
      while (_restrictionRerouteAttempts < _maxRestrictionReroutes &&
          isCurrent()) {
        final violation = _firstRouteViolation(candidatePoints);
        if (violation == null) break;

        final attempt = _restrictionRerouteAttempts + 1;
        if (mounted && isCurrent()) {
          setState(() => _restrictionRerouteAttempts = attempt);
        }
        final avoidPoint = _buildAvoidPoint(
          violation,
          attemptNumber: attempt - 1,
        );
        final result = await _fetchRouteFromApi(
          origin,
          request.destination,
          viaPoint: avoidPoint,
        );
        if (!mounted || !isCurrent()) return;
        if (result == null || result.points.isEmpty) break;
        bestResult = result;
        candidatePoints = result.points;
      }

      if (!mounted || !isCurrent()) return;
      if (bestResult != null) {
        final results = <RouteResult>[bestResult, ...bestResult.alternatives];
        final options = _buildProviderRouteOptions(results);
        _applyAuthoritativeRouteResult(
          bestResult,
          options: options,
          selectedIndex: 0,
          preserveLiveSession: _isLiveRouteAssistanceActive,
        );
        _updateRouteViolationWarnings();
        _updateTripProgressFromRoute(
          bestResult.distanceMiles,
          bestResult.durationSeconds,
        );
        _refreshRoutePoiSourceIfNeeded(force: true);
        debugPrint(
          '[Reroute][$requestId] APPLIED restriction route '
          'provider=${bestResult.provider}',
        );
      }

      if (_firstRouteViolation(candidatePoints) != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && isCurrent()) _showNoSafeRouteDialog();
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _isRestrictionRerouting = false;
          if (isCurrent()) _navStatus = null;
        });
      }
    }
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
                      const Icon(
                        Icons.warning_amber,
                        color: Colors.red,
                        size: 28,
                      ),
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
                    style: const TextStyle(fontSize: 13, color: Colors.black54),
                  ),
                  const SizedBox(height: 14),
                  // ── Violations list ──────────────────────────────────────
                  Flexible(
                    child: ListView.separated(
                      controller: scrollController,
                      shrinkWrap: true,
                      itemCount: violations.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
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
                            padding: const EdgeInsets.symmetric(vertical: 12),
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
                            padding: const EdgeInsets.symmetric(vertical: 12),
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
    final String limitText = _formatLimitText(
      v.limitValue,
      v.limitUnit,
      prefix: ' — limit: ',
    );

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
    RestrictionType type,
  ) {
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
  /// Hidden when [NavSettingsModel.viewTruckRestrictions] is false.
  List<Marker> _buildRestrictionMarkers() {
    if (!_navSettings.viewTruckRestrictions) return const [];
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
            Text(r.description, style: const TextStyle(fontSize: 14)),
            if (r.limitValue != null && r.limitUnit != null) ...[
              const SizedBox(height: 8),
              Text(
                'Limit:${_formatLimitText(r.limitValue, r.limitUnit, prefix: ' ')}',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(
                  violates ? Icons.warning_amber : Icons.check_circle_outline,
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
          _speakAlert(ttsMsg);
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
    final String limitText = _formatLimitText(
      r.limitValue,
      r.limitUnit,
      prefix: ' — ',
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 0),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
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

  // ── Provider-backed road controls ─────────────────────────────────────────

  void _scheduleRoadFeatureRefresh({LatLng? center, bool routeAware = false}) {
    _roadFeatureRefreshTimer?.cancel();
    _roadFeatureRefreshTimer = Timer(const Duration(milliseconds: 450), () {
      unawaited(_refreshRoadFeatures(center: center, routeAware: routeAware));
    });
  }

  Future<void> _refreshRoadFeatures({
    LatLng? center,
    bool routeAware = false,
  }) async {
    if (!mounted) return;
    final double zoom = _mapReady ? _mapController.camera.zoom : 15.0;
    if (!routeAware && zoom < _roadFeatureMinZoom) return;

    final LatLng? requestCenter =
        center ?? (_mapReady ? _mapController.camera.center : _truckPosition);
    if (requestCenter == null) return;

    final double radiusMeters = routeAware
        ? 3500
        : zoom >= 17
        ? 900
        : zoom >= 16
        ? 1500
        : zoom >= 15
        ? 2600
        : 3200;
    final lastCenter = _lastRoadFeatureCenter;
    final lastLoaded = _lastRoadFeatureLoadedAt;
    if (lastCenter != null &&
        lastLoaded != null &&
        DateTime.now().difference(lastLoaded) < const Duration(minutes: 5) &&
        _distanceBetween(lastCenter, requestCenter) < radiusMeters * 0.28) {
      return;
    }

    final int generation = ++_roadFeatureRequestGeneration;
    try {
      final features = await _liveRoadDataService.loadRoadFeaturesNearby(
        center: requestCenter,
        radiusMeters: radiusMeters,
        limit: 300,
      );
      if (!mounted || generation != _roadFeatureRequestGeneration) return;
      final deduplicatedFeatures = _deduplicateRoadFeatures(features);
      setState(() {
        _roadFeatures = deduplicatedFeatures;
        _lastRoadFeatureCenter = requestCenter;
        _lastRoadFeatureLoadedAt = DateTime.now();
        _roadFeatureRouteSignature = 0;
        if (_roadFeatureAhead != null &&
            !deduplicatedFeatures.any(
              (feature) => feature.id == _roadFeatureAhead!.id,
            )) {
          _roadFeatureAhead = null;
          _roadFeatureAheadMeters = null;
        }
      });
      _ensureRoadFeatureRouteMatches();
    } catch (error) {
      // Do not create fallback coordinates. Existing markers remain until a
      // later provider refresh succeeds.
      debugPrint('[RoadFeatures] Provider refresh unavailable: $error');
    }
  }

  List<RoadFeature> _deduplicateRoadFeatures(List<RoadFeature> features) {
    final byId = <String, RoadFeature>{};
    final accepted = <RoadFeature>[];
    for (final feature in features) {
      if (byId.containsKey(feature.id)) continue;
      final spatialDuplicate = accepted.any(
        (other) =>
            other.kind == feature.kind &&
            _distanceBetween(other.position, feature.position) < 28,
      );
      if (spatialDuplicate) continue;
      byId[feature.id] = feature;
      accepted.add(feature);
    }
    return accepted;
  }

  void _ensureRoadFeatureRouteMatches() {
    if (_routePoints.isEmpty || _roadFeatures.isEmpty) {
      _roadFeatureRouteIndices.clear();
      _roadFeatureCrossTrackMeters.clear();
      _roadFeatureRouteOffsetsMeters.clear();
      _routeCumulativeMeters = const [];
      _roadFeatureRouteSignature = 0;
      return;
    }
    final first = _routePoints.first;
    final last = _routePoints.last;
    final signature = Object.hash(
      _routePoints.length,
      first.latitude,
      first.longitude,
      last.latitude,
      last.longitude,
      _selectedRouteOptionIndex,
      Object.hashAll(_roadFeatures.map((feature) => feature.id)),
    );
    if (signature == _roadFeatureRouteSignature &&
        _roadFeatureRouteIndices.length == _roadFeatures.length &&
        _roadFeatureRouteOffsetsMeters.length == _roadFeatures.length) {
      return;
    }

    final cumulative = List<double>.filled(_routePoints.length, 0);
    for (int i = 1; i < _routePoints.length; i++) {
      cumulative[i] =
          cumulative[i - 1] +
          _distanceBetween(_routePoints[i - 1], _routePoints[i]);
    }

    _roadFeatureRouteIndices.clear();
    _roadFeatureCrossTrackMeters.clear();
    _roadFeatureRouteOffsetsMeters.clear();
    for (final feature in _roadFeatures) {
      final projection = projectPointToRoute(feature.position, _routePoints);
      if (projection == null) continue;
      final nearestIndex =
          projection.segmentIndex + (projection.segmentFraction >= 0.5 ? 1 : 0);
      _roadFeatureRouteIndices[feature.id] = math.max(
        0,
        math.min(nearestIndex, _routePoints.length - 1),
      );
      _roadFeatureCrossTrackMeters[feature.id] = projection.distanceMeters;
      _roadFeatureRouteOffsetsMeters[feature.id] = projection.routeOffsetMeters;
    }
    _routeCumulativeMeters = cumulative;
    _roadFeatureRouteSignature = signature;
  }

  /// Road controls must sit very close to the selected route. Stop/yield signs
  /// use the tightest corridor so controls belonging to intersecting side roads
  /// are not presented as instructions for the driver's road.
  double _roadFeatureRouteCorridorFor(RoadFeature feature) {
    return switch (feature.kind) {
      'STOP_SIGN' || 'YIELD_SIGN' => 12.0,
      'TRAFFIC_SIGNAL' => 20.0,
      'SPEED_LIMIT' || 'ROAD_SIGN' || 'WARNING_SIGN' => 30.0,
      'RAILROAD_CROSSING' => 35.0,
      _ => _roadFeatureRouteCorridorMeters,
    };
  }

  double _roadFeatureTriggerMeters(RoadFeature feature) {
    switch (feature.kind) {
      case 'WARNING_SIGN':
      case 'RAILROAD_CROSSING':
        return 1609.344;
      case 'SPEED_LIMIT':
      case 'ROAD_SIGN':
        return 804.672;
      case 'TRAFFIC_SIGNAL':
        return 500;
      case 'STOP_SIGN':
      case 'YIELD_SIGN':
        return 402.336;
      default:
        return 500;
    }
  }

  void _checkRoadFeatureApproachAlerts(LatLng currentPosition) {
    if (!(_isNavigating || _routePreviewActive) ||
        _routePoints.length < 2 ||
        _roadFeatures.isEmpty) {
      if (_roadFeatureAhead != null && mounted) {
        setState(() {
          _roadFeatureAhead = null;
          _roadFeatureAheadMeters = null;
        });
      }
      return;
    }

    _ensureRoadFeatureRouteMatches();
    if (_routeCumulativeMeters.length != _routePoints.length) return;
    final currentProjection = projectPointToRoute(
      currentPosition,
      _routePoints,
    );
    if (currentProjection == null) return;
    final double currentOffset = currentProjection.routeOffsetMeters;
    RoadFeature? closest;
    double closestAhead = double.infinity;

    for (final feature in _roadFeatures) {
      final double? featureOffset = _roadFeatureRouteOffsetsMeters[feature.id];
      final double crossTrack =
          _roadFeatureCrossTrackMeters[feature.id] ?? double.infinity;
      if (featureOffset == null ||
          crossTrack > _roadFeatureRouteCorridorFor(feature)) {
        continue;
      }
      final double ahead = featureOffset - currentOffset;
      if (ahead < -45 || ahead > _roadFeatureTriggerMeters(feature)) continue;
      if (ahead < closestAhead) {
        closest = feature;
        closestAhead = ahead;
      }
    }

    if (closest == null) {
      if (_roadFeatureAhead != null && mounted) {
        setState(() {
          _roadFeatureAhead = null;
          _roadFeatureAheadMeters = null;
        });
      }
      return;
    }

    if (mounted) {
      setState(() {
        _roadFeatureAhead = closest;
        _roadFeatureAheadMeters = closestAhead.clamp(0, double.infinity);
      });
    }

    // Speak once while genuinely moving. If the truck is parked when the
    // feature first becomes visible, it remains eligible until movement starts.
    if (_currentSpeedMps >= 1.0 && _roadFeatureAlerted.add(closest.id)) {
      final distance = closestAhead < 305
          ? '${(closestAhead * 3.28084).round()} feet'
          : '${(closestAhead / 1609.344).toStringAsFixed(1)} miles';
      _speakAlert('${closest.title} ahead in $distance');
    }
  }

  List<Marker> _buildRoadFeatureMarkers() {
    if (!_navSettings.viewRoadSign ||
        !_mapReady ||
        !_isLiveRouteAssistanceActive ||
        _routePoints.length < 2) {
      return const [];
    }
    final zoom = _mapController.camera.zoom;
    if (zoom < _roadFeatureMinZoom) return const [];
    _ensureRoadFeatureRouteMatches();
    final currentProjection = projectPointToRoute(
      _truckPosition ?? _routePoints.first,
      _routePoints,
    );
    final currentOffset = currentProjection?.routeOffsetMeters ?? 0;

    final candidates = <RoadFeature>[];
    final candidateIds = <String>{};
    for (final feature in _roadFeatures) {
      if (!candidateIds.add(feature.id)) continue;
      final crossTrack =
          _roadFeatureCrossTrackMeters[feature.id] ?? double.infinity;
      final featureOffset = _roadFeatureRouteOffsetsMeters[feature.id];
      if (featureOffset == null ||
          crossTrack > _roadFeatureRouteCorridorFor(feature) ||
          featureOffset < currentOffset - 35) {
        continue;
      }
      candidates.add(feature);
    }

    // While driving, order controls by route progress and keep the display
    // focused on what the driver will encounter next. OpenStreetMap can expose
    // every stop sign around a four-way intersection; drawing all of them looks
    // like four simultaneous stops even though only one belongs to this route.
    candidates.sort((a, b) {
      final aOffset = _roadFeatureRouteOffsetsMeters[a.id] ?? double.infinity;
      final bOffset = _roadFeatureRouteOffsetsMeters[b.id] ?? double.infinity;
      return aOffset.compareTo(bOffset);
    });

    final markers = <Marker>[];
    final visibleByKind = <String, int>{};
    for (final feature in candidates) {
      final limit = switch (feature.kind) {
        'WARNING_SIGN' || 'ROAD_SIGN' => 2,
        _ => 1,
      };
      final visibleCount = visibleByKind[feature.kind] ?? 0;
      if (visibleCount >= limit) continue;
      if (markers.length >= 7) break;
      visibleByKind[feature.kind] = visibleCount + 1;
      markers.add(
        Marker(
          point: feature.position,
          width: 46,
          height: 46,
          alignment: Alignment.center,
          child: GestureDetector(
            key: ValueKey<String>('road-feature-${feature.id}'),
            onTap: () => _showRoadFeatureInfo(feature),
            child: _buildRoadFeatureMarker(feature),
          ),
        ),
      );
    }
    return markers;
  }

  Color _roadFeatureColor(RoadFeature feature) {
    switch (feature.kind) {
      case 'STOP_SIGN':
        return const Color(0xFFD32F2F);
      case 'YIELD_SIGN':
      case 'WARNING_SIGN':
      case 'RAILROAD_CROSSING':
        return const Color(0xFFFFB300);
      case 'TRAFFIC_SIGNAL':
        return const Color(0xFF111827);
      default:
        return const Color(0xFF1565C0);
    }
  }

  IconData _roadFeatureIcon(RoadFeature feature) {
    switch (feature.kind) {
      case 'TRAFFIC_SIGNAL':
        return Icons.traffic_rounded;
      case 'STOP_SIGN':
        return Icons.front_hand_rounded;
      case 'YIELD_SIGN':
        return Icons.change_history_rounded;
      case 'WARNING_SIGN':
        return Icons.warning_amber_rounded;
      case 'RAILROAD_CROSSING':
        return Icons.train_rounded;
      case 'SPEED_LIMIT':
        return Icons.speed_rounded;
      default:
        return Icons.signpost_rounded;
    }
  }

  Widget _buildRoadFeatureMarker(RoadFeature feature) {
    if (feature.kind == 'TRAFFIC_SIGNAL') {
      return Container(
        width: 38,
        height: 22,
        padding: const EdgeInsets.symmetric(horizontal: 4),
        decoration: BoxDecoration(
          color: const Color(0xFF111827),
          border: Border.all(color: Colors.white, width: 2),
          borderRadius: BorderRadius.circular(8),
          boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 5)],
        ),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            _SignalLamp(Color(0xFFE53935)),
            _SignalLamp(Color(0xFFFFC107)),
            _SignalLamp(Color(0xFF43A047)),
          ],
        ),
      );
    }
    if (feature.kind == 'STOP_SIGN') {
      return ClipPath(
        clipper: const _OctagonClipper(),
        child: Container(
          width: 42,
          height: 42,
          color: const Color(0xFFD32F2F),
          alignment: Alignment.center,
          child: const Text(
            'STOP',
            style: TextStyle(
              color: Colors.white,
              fontSize: 9,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      );
    }
    if (feature.kind == 'WARNING_SIGN') {
      return Transform.rotate(
        angle: math.pi / 4,
        child: Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: const Color(0xFFFFC400),
            border: Border.all(color: Colors.black, width: 2),
            borderRadius: BorderRadius.circular(3),
            boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 5)],
          ),
          child: Transform.rotate(
            angle: -math.pi / 4,
            child: const Icon(Icons.warning_amber_rounded, size: 19),
          ),
        ),
      );
    }
    if (feature.kind == 'YIELD_SIGN') {
      return Container(
        width: 40,
        height: 40,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
          border: Border.all(color: const Color(0xFFD32F2F), width: 3),
        ),
        child: const Icon(
          Icons.change_history_rounded,
          color: Color(0xFFD32F2F),
        ),
      );
    }
    if (feature.kind == 'SPEED_LIMIT') {
      return Container(
        width: 34,
        height: 42,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: Colors.black87, width: 2),
          borderRadius: BorderRadius.circular(4),
          boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 4)],
        ),
        child: Text(
          feature.value ?? 'SPEED',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w900),
        ),
      );
    }
    return Container(
      width: 38,
      height: 38,
      decoration: BoxDecoration(
        color: _roadFeatureColor(feature),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2),
        boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 5)],
      ),
      child: Icon(_roadFeatureIcon(feature), color: Colors.white, size: 23),
    );
  }

  void _showRoadFeatureInfo(RoadFeature feature) {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Row(
          children: [
            Icon(_roadFeatureIcon(feature), color: _roadFeatureColor(feature)),
            const SizedBox(width: 10),
            Expanded(child: Text(feature.title)),
          ],
        ),
        content: Text(
          '${feature.provider} mapped location'
          '${feature.value == null ? '' : '\nCode/value: ${feature.value}'}'
          '\n\nRoad-control locations are advisory map context. '
          'Truck restrictions continue to use authoritative HERE and DOT data.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _buildRoadFeatureAlertBanner() {
    final feature = _roadFeatureAhead!;
    final distanceMeters = _roadFeatureAheadMeters ?? 0;
    final distance = distanceMeters < 305
        ? '${(distanceMeters * 3.28084).round()} ft ahead'
        : '${(distanceMeters / 1609.344).toStringAsFixed(1)} mi ahead';
    final color = _roadFeatureColor(feature);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Semantics(
        button: true,
        label: '${feature.title}, $distance. Tap for details.',
        child: Material(
          color: const Color(0xFF142235),
          elevation: 5,
          shadowColor: Colors.black45,
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => _showRoadFeatureInfo(feature),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: color, width: 2),
              ),
              child: Row(
                children: [
                  Icon(_roadFeatureIcon(feature), color: color, size: 28),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          feature.title,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          '$distance • ${feature.provider} • Tap for details',
                          style: const TextStyle(
                            color: Colors.white70,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Dismiss warning',
                    visualDensity: VisualDensity.compact,
                    onPressed: () => setState(() {
                      _roadFeatureAlerted.add(feature.id);
                      _roadFeatureAhead = null;
                      _roadFeatureAheadMeters = null;
                    }),
                    icon: const Icon(
                      Icons.close,
                      color: Colors.white70,
                      size: 20,
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
  // ── Warning sign methods ──────────────────────────────────────────────────

  /// Checks whether the truck is within [_warningAlertRadiusMeters] of any
  /// [WarningSign] on the active route and updates [_warningAhead].
  ///
  /// High-severity warnings are prioritised over medium/low ones.  The first
  /// unshown warning within range fires a TTS announcement only when the sign
  /// type is in [WarningTypes.soundAlertTypes] (e.g. sharp curve, steep grade,
  /// low clearance, narrow bridge, railroad crossing, animal crossing); all
  /// other types receive a visual banner only.  Each sign id is added to
  /// [_warningAlertShown] after the first banner to prevent repeated alerts.
  /// Only one banner is shown at a time.
  void _checkWarningAheadAlert(LatLng currentPosition) {
    if (!_isLiveRouteAssistanceActive || _routePoints.length < 2) {
      if (mounted && _warningAhead != null) {
        setState(() => _warningAhead = null);
      }
      return;
    }

    final currentProjection = projectPointToRoute(
      currentPosition,
      _routePoints,
    );
    if (currentProjection == null) return;
    WarningSign? best;
    double bestDist = double.infinity;

    for (final sign in _warningSigns) {
      final projection = projectPointToRoute(
        LatLng(sign.lat, sign.lng),
        _routePoints,
      );
      if (projection == null ||
          projection.distanceMeters > _warningProximityMeters) {
        continue;
      }
      final double dist =
          projection.routeOffsetMeters - currentProjection.routeOffsetMeters;
      if (dist < -35 || dist > _warningAlertRadiusMeters) continue;

      // Prefer high severity, then nearest.
      final bool isBetter =
          best == null ||
          (_severityRank(sign.severity) > _severityRank(best.severity)) ||
          (_severityRank(sign.severity) == _severityRank(best.severity) &&
              dist < bestDist);
      if (isBetter) {
        best = sign;
        bestDist = dist;
      }
    }

    if (best != null) {
      // Fire TTS only once per sign per session, and only for sound-alert types.
      if (!_warningAlertShown.contains(best.id)) {
        _warningAlertShown.add(best.id);
        // Only speak for the most important warning sign types.
        if (WarningTypes.soundAlertTypes.contains(best.type)) {
          _speakAlert('Warning: ${best.title} ahead. ${best.message ?? ''}');
        }
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
  /// Each sign is drawn as an official-style yellow warning triangle with the
  /// type icon inside.  Emphasis scales with the driver's distance:
  ///   - > 2.0 mi  (highway) / > 1.0 mi  (city): preload — faint, small.
  ///   - ≤ 2.0 mi  (highway) / ≤ 1.0 mi  (city): low-emphasis — visible marker.
  ///   - ≤ 1.0 mi  (highway) / ≤ 0.5 mi  (city): normal — standard size.
  ///   - ≤ 0.5 mi  (highway) / ≤ 0.25 mi (city): highlighted — larger + shadow.
  ///   - ≤ 0.2 mi  (highway) / ≤ 0.1 mi  (city): urgent — maximum size + glow.
  ///
  /// At map zoom < [_warningClusterZoomThreshold], nearby signs are grouped
  /// into cluster badges to avoid marker clutter.  Above that zoom, every
  /// eligible sign is shown individually.
  ///
  /// Only signs inside the tight route corridor and no more than
  /// [_warningDisplayLookaheadMeters] ahead are shown. Nearby signs on other
  /// roads and signs already passed by the truck are suppressed.
  List<Marker> _buildWarningMarkers() {
    // No active selected route — hide all warning markers.
    if (!_isLiveRouteAssistanceActive || _routePoints.length < 2) {
      debugPrint(
        '[POI/Alert Filter] Warning markers: no active route – hiding all warning markers.',
      );
      return const [];
    }

    // Build the set of warning types that are currently hidden by settings.
    final Set<String> hiddenTypes = {};
    if (!_navSettings.viewTrafficCongestion) {
      hiddenTypes.add(WarningTypes.laneClosure);
    }
    if (!_navSettings.viewTrafficIncidents) {
      hiddenTypes.addAll([WarningTypes.accidentAhead, WarningTypes.roadClosed]);
    }
    if (!_navSettings.viewWeatherAlert) {
      hiddenTypes.addAll([
        WarningTypes.highWindArea,
        WarningTypes.chainRequirement,
      ]);
    }
    if (!_navSettings.viewWeighStation) {
      hiddenTypes.add(WarningTypes.weighStation);
    }
    if (!_navSettings.viewRoadSign) {
      hiddenTypes.addAll([
        WarningTypes.lowBridge,
        WarningTypes.weightRestriction,
        WarningTypes.noTrucksAllowed,
        WarningTypes.hazmatRestriction,
        WarningTypes.steepGrade,
        WarningTypes.sharpCurve,
        WarningTypes.brakeCheckArea,
        WarningTypes.constructionZone,
        WarningTypes.detour,
        WarningTypes.restArea,
        WarningTypes.animalCrossing,
        WarningTypes.narrowBridge,
        WarningTypes.railroadCrossing,
      ]);
    }
    if (!_navSettings.viewExit) {
      // runawayTruckRamp is an exit-specific hazard; detour is covered by
      // viewRoadSign so it is intentionally excluded here to avoid
      // double-hiding and confusing toggle semantics.
      hiddenTypes.add(WarningTypes.runawayTruckRamp);
    }

    final currentProjection = projectPointToRoute(
      _truckPosition ?? _routePoints.first,
      _routePoints,
    );
    final currentOffset = currentProjection?.routeOffsetMeters ?? 0;

    // Match every warning to the actual bounded route segments. The 10-mile
    // allowance is forward look-ahead along the route, never sideways distance.
    final List<WarningSign> signsToDisplay = [];
    for (final sign in _warningSigns) {
      // Skip types hidden by nav settings.
      if (hiddenTypes.contains(sign.type)) continue;
      final projection = projectPointToRoute(
        LatLng(sign.lat, sign.lng),
        _routePoints,
      );
      if (projection == null ||
          projection.distanceMeters > _warningProximityMeters) {
        continue;
      }
      final ahead = projection.routeOffsetMeters - currentOffset;
      if (ahead < -35 || ahead > _warningDisplayLookaheadMeters) continue;

      signsToDisplay.add(sign);
    }

    debugPrint(
      '[POI/Alert Filter] Warning markers: ${signsToDisplay.length}/'
      '${_warningSigns.length} shown '
      '(within ${_warningProximityMeters.toStringAsFixed(0)} m of the selected route, '
      'up to ${(_warningDisplayLookaheadMeters / 1609.34).toStringAsFixed(0)} miles ahead).',
    );

    // ── Cluster when zoomed out ──────────────────────────────────────────────
    final double currentZoom = _mapReady ? _mapController.camera.zoom : 15.0;
    if (currentZoom < _warningClusterZoomThreshold) {
      return _buildClusteredWarningMarkers(signsToDisplay);
    }

    // ── Individual markers ───────────────────────────────────────────────────
    return signsToDisplay.map((sign) {
      final style = WarningConfig.styleFor(sign.type);
      final _WarningEmphasis emphasis = _warningEmphasis(sign);

      return Marker(
        point: LatLng(sign.lat, sign.lng),
        width: emphasis.markerSize,
        height: emphasis.markerSize,
        alignment: Alignment.center,
        child: GestureDetector(
          onTap: () => _showWarningInfoDialog(sign),
          child: _buildYellowTriangleMarker(
            icon: style.icon,
            emphasis: emphasis,
          ),
        ),
      );
    }).toList();
  }

  /// Builds cluster badge [Marker]s when the map is zoomed out.
  ///
  /// Signs are grouped into ~11-km buckets (0.1 degree of lat/lng ≈ 11 km)
  /// and represented by a single yellow triangle badge showing the count.
  List<Marker> _buildClusteredWarningMarkers(List<WarningSign> signs) {
    const double bucketSize = 0.1; // 0.1 degree ≈ 11 km
    final Map<String, List<WarningSign>> clusters = {};
    for (final sign in signs) {
      final String key =
          '${(sign.lat / bucketSize).round()},${(sign.lng / bucketSize).round()}';
      clusters.putIfAbsent(key, () => []).add(sign);
    }

    return clusters.values.map((clusterSigns) {
      final double lat =
          clusterSigns.map((s) => s.lat).reduce((a, b) => a + b) /
          clusterSigns.length;
      final double lng =
          clusterSigns.map((s) => s.lng).reduce((a, b) => a + b) /
          clusterSigns.length;
      final int count = clusterSigns.length;

      return Marker(
        point: LatLng(lat, lng),
        width: 44,
        height: 44,
        alignment: Alignment.center,
        child: GestureDetector(
          onTap: () {
            // Tapping a cluster zooms into the cluster area so signs expand.
            _mapController.move(
              LatLng(lat, lng),
              _warningClusterZoomThreshold + 0.5,
            );
          },
          child: Stack(
            alignment: Alignment.center,
            children: [
              CustomPaint(
                size: const Size(44, 44),
                painter: _WarningTrianglePainter(opacity: 1.0, shadowBlur: 6),
              ),
              Positioned(
                bottom: 8,
                child: Text(
                  '$count',
                  style: const TextStyle(
                    color: Colors.black87,
                    fontSize: 13,
                    fontWeight: FontWeight.bold,
                    height: 1.0,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }).toList();
  }

  /// Returns the [_WarningEmphasis] level for [sign] based on the truck's
  /// current distance to it and the sign's road-type thresholds.
  ///
  /// Threshold values are sourced from [kHighwayWarningTriggers] and
  /// [kCityWarningTriggers] (both defined in warning_manager.dart) so the map
  /// marker emphasis is always consistent with the popup trigger distances.
  _WarningEmphasis _warningEmphasis(WarningSign sign) {
    if (_truckPosition == null) return _WarningEmphasis.visible;

    final double distMiles =
        _distanceBetween(_truckPosition!, LatLng(sign.lat, sign.lng)) /
        1609.344;

    final triggers = sign.roadType == 'city'
        ? kCityWarningTriggers
        : kHighwayWarningTriggers;

    if (distMiles > triggers[WarningTriggerStage.preload]!) {
      return _WarningEmphasis.preload;
    }
    if (distMiles > triggers[WarningTriggerStage.visible]!) {
      return _WarningEmphasis.lowEmphasis;
    }
    if (distMiles > triggers[WarningTriggerStage.highlighted]!) {
      return _WarningEmphasis.visible;
    }
    if (distMiles > triggers[WarningTriggerStage.urgent]!) {
      return _WarningEmphasis.highlighted;
    }
    return _WarningEmphasis.urgent;
  }

  /// Builds a single yellow-triangle warning-sign marker widget.
  ///
  /// The triangle mimics the official USA/Canada road warning sign appearance:
  /// bright yellow fill, black border, type icon centred inside.
  Widget _buildYellowTriangleMarker({
    required IconData icon,
    required _WarningEmphasis emphasis,
  }) {
    final double size = emphasis.markerSize;
    final double opacity = emphasis.opacity;
    final double shadowBlur = emphasis.shadowBlur;

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Yellow triangle background with black border.
          CustomPaint(
            size: Size(size, size),
            painter: _WarningTrianglePainter(
              opacity: opacity,
              shadowBlur: shadowBlur,
            ),
          ),
          // Type icon centred inside the North-American warning diamond.
          Opacity(
            opacity: opacity,
            child: Icon(icon, color: Colors.black87, size: size * 0.38),
          ),
          // Urgent: show a red glow ring for maximum emphasis.
          if (emphasis == _WarningEmphasis.urgent)
            Positioned.fill(
              child: IgnorePointer(
                child: CustomPaint(painter: _UrgentGlowPainter(size: size)),
              ),
            ),
        ],
      ),
    );
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
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (sign.message != null)
              Text(sign.message!, style: const TextStyle(fontSize: 14)),
            const SizedBox(height: 8),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: badgeColor,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    sign.severity.toUpperCase(),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  style.label,
                  style: const TextStyle(fontSize: 12, color: Colors.grey),
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

  // ── Route-proximity snap helper ─────────────────────────────────────────────

  /// Returns the nearest point on [_routePoints] within [maxDistanceMeters] of
  /// [position], or `null` when no route is active or no point is close enough.
  ///
  /// **Use for filtering and distance calculations only — never for marker
  /// placement.**  POI markers must always be rendered at their true stored
  /// coordinates ([MapPoi.position], [PoiItem.displayLat]/[displayLng], etc.).
  /// This helper is called as a proximity check to decide whether a POI is
  /// on/near the active route; the returned [LatLng] should be discarded after
  /// the null check and must not replace the POI's real coordinate.
  ///
  /// A 500 m radius is generous enough to include highway-side facilities while
  /// still excluding stations on a completely different road.
  LatLng? _snapToNearestRoutePoint(
    LatLng position, {
    double maxDistanceMeters = 500.0,
  }) {
    if (_routePoints.isEmpty) return null;
    double minDist = double.infinity;
    LatLng? nearest;
    for (final pt in _routePoints) {
      final d = _distanceBetween(position, pt);
      if (d < minDist) {
        minDist = d;
        nearest = pt;
        // Early exit: a match this close is already precise enough.
        if (minDist < 10.0) break;
      }
    }
    return (nearest != null && minDist <= maxDistanceMeters) ? nearest : null;
  }

  /// Returns `true` when [position] is considered a "suspect location" —
  /// meaning the coordinate fails basic sanity checks, falls outside the
  /// North America trucking corridor, is a suspiciously round placeholder
  /// value, or (when an active route is loaded) lies more than
  /// [_kPoiRoadProximityMeters] away from every route segment.
  ///
  /// When no route is active the method returns `false` for coordinates that
  /// pass the sanity checks — road-proximity cannot be evaluated without a
  /// reference polyline.
  ///
  /// Suspect POIs are visually flagged in [_buildPoiMarkers] and
  /// [_buildAllPoiMarkers] with an orange warning badge and label but are
  /// never hidden so drivers remain aware of them.
  ///
  /// **Diagnostics:** When a coordinate is flagged the method emits a
  /// `debugPrint` message tagged `[POI-SUSPECT]` so developers can grep the
  /// console to audit real data issues without any production overhead (Flutter
  /// strips `debugPrint` calls in release mode).
  bool _isPoiLocationSuspect(LatLng position, {String? poiLabel}) {
    final String label =
        poiLabel ?? '(${position.latitude}, ${position.longitude})';

    // ── 1. WGS-84 validity ────────────────────────────────────────────────────
    if (position.latitude.isNaN ||
        position.longitude.isNaN ||
        position.latitude.isInfinite ||
        position.longitude.isInfinite ||
        position.latitude < -90.0 ||
        position.latitude > 90.0 ||
        position.longitude < -180.0 ||
        position.longitude > 180.0) {
      debugPrint(
        '[POI-SUSPECT] $label — invalid WGS-84 coordinate '
        '(lat=${position.latitude}, lng=${position.longitude})',
      );
      return true;
    }

    // ── 2. North America trucking-corridor bounds ─────────────────────────────
    // The app serves the US / Canada / northern-Mexico trucking market.
    // Coordinates well outside this region are almost certainly data errors.
    const double kMinLat = 14.0; // Southern Mexico / Central America border
    const double kMaxLat = 72.0; // Northern Canada / Alaska
    const double kMinLng = -170.0; // Western Alaska
    const double kMaxLng = -50.0; // Eastern Canada coastline
    if (position.latitude < kMinLat ||
        position.latitude > kMaxLat ||
        position.longitude < kMinLng ||
        position.longitude > kMaxLng) {
      debugPrint(
        '[POI-SUSPECT] $label — outside North America corridor '
        '(lat=${position.latitude}, lng=${position.longitude})',
      );
      return true;
    }

    // ── 3. Suspiciously round placeholder coordinates ─────────────────────────
    // Integer-degree coordinates (e.g. 45.0, -90.0) are typical of missing or
    // placeholder data in GIS databases rather than a real facility location.
    // Requiring *both* lat and lng to be exact integers makes accidental
    // false-positives vanishingly unlikely — a real truck facility sitting
    // precisely on an integer lat/lng intersection is essentially impossible
    // in any commercial POI dataset.
    if (position.latitude == position.latitude.truncateToDouble() &&
        position.longitude == position.longitude.truncateToDouble()) {
      debugPrint(
        '[POI-SUSPECT] $label — round integer placeholder coordinates '
        '(lat=${position.latitude}, lng=${position.longitude})',
      );
      return true;
    }

    // ── 4. Road-proximity check (active route only) ───────────────────────────
    // When the driver is navigating, verify the POI is within
    // _kPoiRoadProximityMeters of the active route polyline.  The threshold
    // is generous (100 m) so truck stops and rest areas just off the highway
    // at exit ramps are not incorrectly flagged.  Only coordinates that are
    // genuinely in an open field or parcel centre — far from any paved road —
    // will fail this check.
    if (_routePoints.isNotEmpty) {
      double minDist = _routePoints.length == 1
          ? _distanceBetween(position, _routePoints.first)
          : double.infinity;
      for (int i = 0; i < _routePoints.length - 1; i++) {
        final d = _crossTrackDistance(
          position,
          _routePoints[i],
          _routePoints[i + 1],
        );
        if (d < minDist) minDist = d;
        // Early exit once well within threshold.
        if (minDist <= _kPoiRoadProximityMeters) break;
      }
      if (minDist > _kPoiRoadProximityMeters) {
        debugPrint(
          '[POI-SUSPECT] $label — ${minDist.toStringAsFixed(1)} m '
          'from active route (threshold: ${_kPoiRoadProximityMeters.toStringAsFixed(0)} m). '
          'Check lat=${position.latitude}, lng=${position.longitude} in source data.',
        );
        return true;
      }
      return false;
    }

    // No route active — cannot perform road-proximity check.
    return false;
  }

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
      final d = _crossTrackDistance(
        poi.position,
        routePoints[i],
        routePoints[i + 1],
      );
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
  /// **Data sources (merged):** official versioned offline assets and
  /// authenticated backend records that have already been route matched and
  /// copied into [_mapPois]. Legacy `locations.json` weigh entries are filtered
  /// by [PoiService] because they lack official source metadata.
  ///
  /// A station is considered "ahead" when its nearest route-point index is
  /// strictly greater than [_truckIndex] AND the station is within
  /// [_weighStationProximityMeters] of the route polyline.
  /// Stations closer than [_poiPassedThresholdMiles] (200 m) are treated as
  /// passed and excluded.  Stations farther than [_poiMaxAheadMiles] (50 km)
  /// ahead are also excluded.
  List<AheadWeighStation> _getClosestWeighStationsAheadOnRoute() {
    if (_routePoints.isEmpty) return const [];

    // Build a deduplicated list of WeighStationPoi entries.
    // Prefer _loadedPois (JSON dataset, USA + Canada) and fall back to / merge
    // with _mapPois for any legacy in-memory entries not in the JSON file.
    final Set<String> seenIds = {};
    final List<WeighStationPoi> weighPois = [];

    // Prefer authenticated/service-backed records because they preserve
    // official source metadata and live/community activity.
    for (final p in _mapPois) {
      if (p.type != PoiType.weighStation) continue;
      if (seenIds.contains(p.id)) continue;
      seenIds.add(p.id);
      weighPois.add(WeighStationPoi.fromMapPoi(p));
    }

    // Retain source-compatible bundled records that are not already present.
    // Never claim a station is open when no status source supplied that fact.
    for (final p in _loadedPois) {
      if (p.category != 'weigh_station') continue;
      if (seenIds.contains(p.id)) continue;
      seenIds.add(p.id);
      weighPois.add(
        WeighStationPoi(
          id: p.id,
          position: LatLng(p.displayLat, p.displayLng),
          name: p.name,
          status: 'UNKNOWN',
          logoName: p.icon.isNotEmpty ? p.icon : 'weight_station',
        ),
      );
    }

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

      if (miles < _poiPassedThresholdMiles) continue; // within 200 m — passed
      if (miles > _poiMaxAheadMiles) continue; // beyond 50 km ahead — skip

      candidates.add(
        AheadWeighStation(poi: poi, milesAhead: miles, routeIndex: idx),
      );
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
        next.every(
          (s) => _closestWeighStationsAhead.any(
            (existing) =>
                existing.poi.id == s.poi.id &&
                (existing.milesAhead - s.milesAhead).abs() < 0.05,
          ),
        )) {
      return;
    }
    setState(() => _closestWeighStationsAhead = next);
  }

  // ── Rest area ahead-on-route helpers ────────────────────────────────────────

  /// Returns `true` when [poi] is within [_weighStationProximityMeters] of any
  /// segment of [routePoints].
  bool _isRestAreaNearRoute(RestAreaPoi poi, List<LatLng> routePoints) {
    if (routePoints.isEmpty) return false;
    if (routePoints.length == 1) {
      return _distanceBetween(poi.position, routePoints.first) <=
          _weighStationProximityMeters;
    }
    for (int i = 0; i < routePoints.length - 1; i++) {
      final d = _crossTrackDistance(
        poi.position,
        routePoints[i],
        routePoints[i + 1],
      );
      if (d <= _weighStationProximityMeters) return true;
    }
    return false;
  }

  /// Finds the nearest route-point index for [poi] by scanning [_routePoints].
  ///
  /// Only considers route points at or after [startIndex] so that rest areas
  /// behind the truck are naturally excluded.  Returns -1 when no point is
  /// found within [_weighStationProximityMeters].
  int _nearestRouteIndexForRestAreaPoi(RestAreaPoi poi, int startIndex) {
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

  /// Returns the single closest rest area that is ahead of the truck on the
  /// active route.
  ///
  /// **Data source:** `_loadedPois` (from `assets/locations.json`) where
  /// `category == "rest_area"`.
  ///
  /// A rest area is considered "ahead" when its nearest route-point index is
  /// strictly greater than [_truckIndex] AND it is within
  /// [_weighStationProximityMeters] of the route polyline.
  /// Rest areas closer than [_poiPassedThresholdMiles] (200 m) are treated as
  /// passed and excluded.  Rest areas farther than [_poiMaxAheadMiles] (50 km)
  /// ahead are also excluded.
  List<AheadRestArea> _getClosestRestAreasAheadOnRoute() {
    if (_routePoints.isEmpty) return const [];

    final List<RestAreaPoi> restPois = [];
    for (final p in _loadedPois) {
      if (p.category != 'rest_area') continue;
      restPois.add(
        RestAreaPoi(
          id: p.id,
          position: LatLng(p.displayLat, p.displayLng),
          name: p.name,
          source: p,
        ),
      );
    }

    final List<AheadRestArea> candidates = [];

    for (final poi in restPois) {
      // Skip rest areas not near the route at all.
      if (!_isRestAreaNearRoute(poi, _routePoints)) continue;

      // Find nearest route point strictly ahead of current truck position.
      final idx = _nearestRouteIndexForRestAreaPoi(poi, _truckIndex + 1);
      if (idx < 0) continue; // rest area is behind or off-route

      // Compute approximate route miles from truck to this rest area.
      double meters = 0.0;
      for (int i = _truckIndex; i < idx && i + 1 < _routePoints.length; i++) {
        meters += _distanceBetween(_routePoints[i], _routePoints[i + 1]);
      }
      final double miles = meters / _metersPerMile;

      if (miles < _poiPassedThresholdMiles) continue; // within 200 m — passed
      if (miles > _poiMaxAheadMiles) continue; // beyond 50 km ahead — skip

      candidates.add(
        AheadRestArea(poi: poi, milesAhead: miles, routeIndex: idx),
      );
    }

    // Keep the two closest route-matched rest areas so drivers can compare
    // the immediate option with the next safe stopping opportunity.
    candidates.sort((a, b) => a.milesAhead.compareTo(b.milesAhead));
    return candidates.take(2).toList();
  }

  /// Recomputes [_closestRestAreasAhead] from the current truck position and
  /// triggers a rebuild so the [ClosestRestAreasRow] updates in place.
  ///
  /// Called on every GPS fix when [_isNavigating] is true (see
  /// [_onGpsPosition]).
  void _refreshClosestRestAreasAhead() {
    final next = _getClosestRestAreasAheadOnRoute();
    // Avoid a redundant rebuild if the list content hasn't changed.
    if (next.length == _closestRestAreasAhead.length &&
        next.every(
          (r) => _closestRestAreasAhead.any(
            (existing) =>
                existing.poi.id == r.poi.id &&
                (existing.milesAhead - r.milesAhead).abs() < 0.05,
          ),
        )) {
      return;
    }
    setState(() => _closestRestAreasAhead = next);
  }

  /// Builds and stores the list of [UpcomingAlertItem]s shown in the
  /// top-right overlay chips during active navigation.
  ///
  /// Sources alerts from:
  ///   - [_navAlerts] wind/advisory entries → [UpcomingAlertType.wind]
  ///   - [_navAlerts] restriction entries → [UpcomingAlertType.restriction]
  ///
  /// Weigh stations and rest areas use dedicated, tappable rails so their
  /// details remain accessible and are not duplicated in this hazard stack.
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
    if (!_isLiveRouteAssistanceActive) {
      if (_upcomingAlerts.isNotEmpty) {
        setState(() => _upcomingAlerts = const []);
      }
      return;
    }

    final List<UpcomingAlertItem> fresh = [];

    // ── Wind / weather advisories from _navAlerts ────────────────────────────
    for (final a in _navAlerts) {
      if (a.isDismissed) continue;
      if (a.type == AlertType.windAdvisory ||
          a.type == AlertType.highWind ||
          a.type == AlertType.weather) {
        final dist = a.distanceMiles ?? 0.0;
        if (dist > 0) {
          fresh.add(
            UpcomingAlertItem(
              type: UpcomingAlertType.wind,
              label: a.title,
              distanceMiles: dist,
              sourceAlertId: a.id,
            ),
          );
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
          fresh.add(
            UpcomingAlertItem(
              type: UpcomingAlertType.restriction,
              label: a.title,
              distanceMiles: dist,
              sourceAlertId: a.id,
            ),
          );
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
    List<UpcomingAlertItem> a,
    List<UpcomingAlertItem> b,
  ) {
    if (a.length != b.length) return false;
    for (int i = 0; i < a.length; i++) {
      if (a[i].type != b[i].type ||
          a[i].sourceAlertId != b[i].sourceAlertId ||
          a[i].label != b[i].label ||
          // 0.05 mi (~264 ft) threshold: small enough to catch meaningful
          // position changes, large enough to suppress spurious rebuilds.
          (a[i].distanceMiles - b[i].distanceMiles).abs() >= 0.05) {
        return false;
      }
    }
    return true;
  }

  /// Builds the closest weigh-station chip high on the left side of the map
  /// during active navigation.
  ///
  /// Returns [SizedBox.shrink] when:
  ///   - The weigh-station layer is disabled in nav settings.
  ///   - Navigation is not active.
  ///   - There are no weigh stations ahead on the current route.
  ///
  /// When a weigh station is ahead, the chip shows its live route miles and
  /// updates on every GPS fix via [_refreshClosestWeighStationsAhead].
  Widget _buildClosestWeighStationsRow() {
    // Hidden when the weigh-station layer is toggled off in nav settings.
    if (!_navSettings.viewWeighStation) return const SizedBox.shrink();
    // Hidden when not navigating or when no weigh stations are ahead on route.
    if (!_isLiveRouteAssistanceActive || _closestWeighStationsAhead.isEmpty) {
      return const SizedBox.shrink();
    }
    return Positioned(
      top: 218,
      left: 12,
      child: SafeArea(
        bottom: false,
        child: ClosestWeighStationsRow(
          stations: _closestWeighStationsAhead,
          onTap: _showAheadWeighStationDetails,
        ),
      ),
    );
  }

  /// Builds the closest rest-area chip shown on the right side of the map
  /// during active navigation.
  ///
  /// Returns [SizedBox.shrink] when:
  ///   - Navigation is not active.
  ///   - There are no rest areas ahead on the current route.
  ///
  /// When a rest area is ahead, the chip shows its live route miles and
  /// updates on every GPS fix via [_refreshClosestRestAreasAhead].
  Widget _buildClosestRestAreasRow() {
    // Hidden when not navigating or when no rest areas are ahead on route.
    if (!_isLiveRouteAssistanceActive || _closestRestAreasAhead.isEmpty) {
      return const SizedBox.shrink();
    }
    return Positioned(
      top: 280,
      left: 12,
      child: SafeArea(
        bottom: false,
        child: ClosestRestAreasRow(
          areas: _closestRestAreasAhead,
          onTap: _showAheadRestAreaDetails,
        ),
      ),
    );
  }

  ///
  /// When [fromPosition] is provided (e.g. during off-route rerouting), the
  /// route is requested from that live GPS position instead of the default
  /// Calculates the active route with the backend's selected authoritative
  /// truck provider. Passenger-car routes are never accepted for navigation.
  Future<void> fetchRoute({
    bool alternative = false,
    LatLng? fromPosition,
  }) async {
    final destination = _selectedDestination ?? _destination;
    await _submitRouteCalculation(
      _RouteCalculationRequest(
        kind: _RouteCalculationKind.backend,
        reason: fromPosition == null ? 'route-build' : 'route-replacement',
        destination: destination,
        origin: fromPosition,
        alternative: alternative,
      ),
    );
  }

  Future<LatestRequestCompletion> _submitRouteCalculation(
    _RouteCalculationRequest request,
  ) async {
    _isLoadingRoute = true;
    try {
      return await _routeCalculationCoordinator.submit(
        request,
        _executeRouteCalculation,
      );
    } catch (_) {
      return LatestRequestCompletion.failed;
    } finally {
      if (!_routeCalculationCoordinator.inProgress) {
        _isLoadingRoute = false;
      }
    }
  }

  Future<void> _executeRouteCalculation(
    _RouteCalculationRequest request,
    int requestId,
    bool Function() isCurrent,
  ) async {
    debugPrint(
      '[Reroute][$requestId] BEGIN reason=${request.reason} '
      'kind=${request.kind.name}',
    );
    try {
      switch (request.kind) {
        case _RouteCalculationKind.backend:
          await _executeBackendRouteCalculation(request, requestId, isCurrent);
        case _RouteCalculationKind.native:
          await _executeNativeRouteCalculation(requestId, isCurrent);
        case _RouteCalculationKind.restriction:
          await _executeRestrictionRouteCalculation(
            request,
            requestId,
            isCurrent,
          );
      }
      debugPrint(
        '[Reroute][$requestId] ${isCurrent() ? 'END' : 'STALE'} '
        'reason=${request.reason}',
      );
    } catch (error, stackTrace) {
      if (!isCurrent()) {
        debugPrint('[Reroute][$requestId] STALE_ERROR ignored: $error');
        return;
      }
      debugPrint('[Reroute][$requestId] ERROR: $error\n$stackTrace');
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _isLoadingRouteWeighStations = false;
        _navStatus = null;
        _error = _truckRouteFailureMessage(error);
      });
      rethrow;
    }
  }

  Future<void> _executeBackendRouteCalculation(
    _RouteCalculationRequest request,
    int requestId,
    bool Function() isCurrent,
  ) async {
    var origin = request.origin ?? _truckPosition;
    final replacingActiveRoute = _routePoints.length > 1;
    final preserveLiveSession =
        replacingActiveRoute && _isLiveRouteAssistanceActive;

    unawaited(_resolveDestinationTimeZone(request.destination));
    if (origin == null) {
      if (mounted && isCurrent()) {
        setState(() {
          _isLoading = true;
          _error = 'Getting a precise GPS location…';
          _locationRecoveryAction = null;
        });
      }
      origin = await _acquireRouteOrigin();
      if (!mounted || !isCurrent()) return;
      if (origin == null) {
        setState(() => _isLoading = false);
        return;
      }
    }

    if (mounted && isCurrent()) {
      setState(() {
        // Keep the active route and driving UI visible during replacement.
        _isLoading = !replacingActiveRoute;
        _navStatus = replacingActiveRoute ? 'Recalculating truck route…' : null;
        _error = null;
        _isLoadingRouteWeighStations = true;
        _routeWeighStationsAvailable = false;
      });
    }

    final primary = await _fetchRouteFromApi(origin, request.destination);
    if (!mounted || !isCurrent()) return;
    if (primary == null) {
      throw StateError('The truck-routing provider returned no usable route.');
    }

    final routeResults = <RouteResult>[primary, ...primary.alternatives];
    final selectedIndex = request.alternative && routeResults.length > 1
        ? 1
        : 0;
    final selected = routeResults[selectedIndex];
    final options = _buildProviderRouteOptions(routeResults);

    _applyAuthoritativeRouteResult(
      selected,
      options: options,
      selectedIndex: selectedIndex,
      preserveLiveSession: preserveLiveSession,
    );
    debugPrint(
      '[Reroute][$requestId] APPLIED provider=${selected.provider} '
      'points=${selected.points.length} maneuvers=${selected.steps.length}',
    );

    _refreshLiveRoadContextFromCurrentPosition();
    if (!replacingActiveRoute) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && isCurrent() && _routePoints.length > 1) {
          _fitCameraToRoute(_routePoints);
        }
      });
    }
    _updateRouteViolationWarnings();
    _updateTripProgressFromRoute(
      selected.distanceMiles,
      selected.durationSeconds,
    );
    unawaited(_refreshLiveWeighStations());
    unawaited(_refreshProviderWeighStationsForRoute());
    unawaited(_refreshLiveRoadData());
    _scheduleRoadFeatureRefresh(center: origin, routeAware: true);
    _refreshRoutePoiSourceIfNeeded(force: true);
    if (preserveLiveSession && _navSteps.isNotEmpty) {
      _activateNavigationStep(0, speak: false);
    }
  }

  Future<void> _executeNativeRouteCalculation(
    int requestId,
    bool Function() isCurrent,
  ) async {
    if (mounted && isCurrent()) {
      setState(() => _navStatus = 'Recalculating truck route…');
    }
    await NativeNavigationService.instance.recalculateRoute();
    if (!mounted || !isCurrent()) return;
    setState(() => _navStatus = null);
    debugPrint('[Reroute][$requestId] Native provider accepted recalculation.');
  }

  List<RouteOption> _buildProviderRouteOptions(List<RouteResult> results) {
    return results.indexed
        .map((entry) {
          final index = entry.$1;
          final candidate = entry.$2;
          final points = candidate.points.toSet().toList(growable: false);
          final candidateData = <String, dynamic>{
            'distance': candidate.distanceMiles * _metersPerMile,
            'distanceMiles': candidate.distanceMiles,
            'duration': candidate.durationSeconds,
            'etaMinutes': (candidate.durationSeconds / 60).ceil(),
            'provider': candidate.provider,
            'truckWarnings': candidate.providerNotices,
          };
          return RouteOption(
            id: '${candidate.provider.toLowerCase()}_truck_$index',
            label: index == 0 ? 'Recommended' : 'Alternative $index',
            points: points,
            steps: candidate.steps,
            distanceMiles: candidate.distanceMiles,
            durationSeconds: candidate.durationSeconds,
            restrictionCount: _evaluateRouteRestrictions(points).length,
            fuelStopCount: _countFuelStopsForRoute(points),
            weighStationCount: _countWeighStationsForRoute(points),
            routeData: candidateData,
          );
        })
        .toList(growable: false);
  }

  void _applyAuthoritativeRouteResult(
    RouteResult result, {
    required List<RouteOption> options,
    required int selectedIndex,
    required bool preserveLiveSession,
  }) {
    if (!mounted) return;
    final cleanPoints = result.points.toSet().toList(growable: false);
    setState(() {
      // Geometry, maneuvers, and every route-derived cache are swapped in one
      // frame. Permanent provider POIs and physical road features are retained.
      _activeRouteRevision++;
      _routePoiRequestGeneration++;
      _routePoints = cleanPoints;
      _navSteps = result.steps;
      _routeData = options[selectedIndex].routeData;
      _routeOptions = options;
      _selectedRouteOptionIndex = selectedIndex;
      _currentStepIndex = 0;
      _truckIndex = 0;
      _previewPanelExpanded = false;
      if (preserveLiveSession) {
        _navigationActive = true;
        _navigationMode = true;
      }
      _liveRoadName = null;
      _liveRoadStepIndex = 0;
      _truckStops = const <TruckStop>[];
      _closestTruckStopsAhead = const [];
      _closestWeighStationsAhead = const [];
      _closestRestAreasAhead = const [];
      _upcomingAlerts = const [];
      _roadFeatureAhead = null;
      _roadFeatureAheadMeters = null;
      _roadFeatureRouteSignature = 0;
      _roadFeatureRouteIndices.clear();
      _roadFeatureCrossTrackMeters.clear();
      _roadFeatureRouteOffsetsMeters.clear();
      _routeCumulativeMeters = const [];
      _isLoading = false;
      _navStatus = null;
      _error = null;
    });
  }

  /// origin.  The destination always remains [_destination].
  ///
  /// When [alternative] is `true` the second route returned by Mapbox is used
  /// instead of the primary one, allowing the caller to avoid a route that
  /// fails the [_isTruckSafe] check.  In pre-navigation mode all returned
  /// routes are surfaced as selectable [RouteOption] cards; in active
  /// navigation / rerouting mode the single best route is used directly.
  Future<void> _fetchLegacyPassengerRoute({
    bool alternative = false,
    LatLng? fromPosition,
  }) async {
    if (_legacyPassengerRoutingDisabled) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _error = 'Truck-safe routing unavailable';
          _routePoints = const [];
          _routeOptions = const [];
        });
      }
      return;
    }
    // Guard: prevent simultaneous or repeated API calls that would layer a new
    // route on top of the previous one, causing "spaghetti" polyline artefacts.
    if (_isLoadingRoute) {
      // Only emit diagnostics in debug builds – suppress in release/profile.
      if (kDebugMode)
        debugPrint("fetchRoute already in progress – skipping duplicate call");
      return;
    }
    _isLoadingRoute = true;
    if (kDebugMode)
      debugPrint("fetchRoute started (alternative: $alternative)");

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

      final res = await http
          .get(Uri.parse(url))
          .timeout(const Duration(seconds: 10));
      // Log the raw Mapbox response only in debug builds to avoid leaking
      // route data (which may contain user location) to production logs.
      if (kDebugMode) debugPrint("MAPBOX RESPONSE: ${res.body}");

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
          newOptions.add(
            RouteOption(
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
                "turnByTurn": steps
                    .map((s) => {'instruction': s.instruction})
                    .toList(),
              },
            ),
          );
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
          _halfMileAnnouncedStepIndex = null;
          _nearTurnAnnouncedStepIndex = null;
          _routeData = selectedOpt.routeData;
          // Clean replacement – never use addAll() here.
          _routePoints = newPoints;
          _isLoading = false;
        });

        if (kDebugMode)
          debugPrint("Route points count: ${_routePoints.length}");
        if (selectedOpt.steps.isNotEmpty) {
          _speak(selectedOpt.steps.first.instruction);
        }

        // Filter POIs to only those within 10 km of the previewed route so
        // the map isn't cluttered with globally-distant stops.
        setState(() => _truckStops = const <TruckStop>[]);
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
      final routeIndex = (alternative && routes.length > 1) ? 1 : 0;
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
        if (kDebugMode)
          debugPrint("Route is not truck-safe – fetching alternative route");
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
        options.add(
          RouteOption(
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
          ),
        );
      }

      setState(() {
        _navSteps = allSteps;
        _currentStepIndex = 0;
        _halfMileAnnouncedStepIndex = null;
        _nearTurnAnnouncedStepIndex = null;
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
      if (kDebugMode) debugPrint("Route points count: ${_routePoints.length}");

      // Speak the first instruction when the route is (re-)loaded.
      if (allSteps.isNotEmpty) {
        _speak(allSteps.first.instruction);
      }

      // ── Filter truck stop POIs near the active route ──────────────────────
      // Re-filter dynamically whenever the route changes (reroute, alternative
      // selected, etc.) so only stops within 10 km of the new polyline are
      // shown.  The list is sorted by proximity to the driver and capped at 50
      // for rendering performance.
      setState(() => _truckStops = const <TruckStop>[]);

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
      if (kDebugMode) debugPrint('Mapbox error: $e');
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
      _activeRouteRevision++;
      _routePoiRequestGeneration++;
      _selectedRouteOptionIndex = index;
      _routePoints = newPoints;
      _navSteps = opt.steps;
      _currentStepIndex = 0;
      _halfMileAnnouncedStepIndex = null;
      _nearTurnAnnouncedStepIndex = null;
      _routeData = opt.routeData;
      // Re-filter POIs for the newly selected route alternative so only stops
      // within 10 km of this specific polyline are displayed.
      _truckStops = const <TruckStop>[];
    });
    _refreshLiveRoadContextFromCurrentPosition();
    _fitCameraToRoute(_routePoints);
    _updateRouteViolationWarnings();
    // Keep trip-progress strip in sync with the newly selected route option.
    _updateTripProgressFromRoute(opt.distanceMiles, opt.durationSeconds);
  }

  /// Selects the route line directly touched by the driver in preview mode.
  ///
  /// Route-line selection is intentionally disabled after native guidance has
  /// started. Changing a live route must go through the native reroute API so
  /// route progress, maneuvers, voice guidance, and warnings stay synchronized.
  void _handleRoutePolylineTap() {
    if (_isNavigating || _routeOptions.length < 2) return;
    final hitResult = _routeHitNotifier.value;
    if (hitResult == null || hitResult.hitValues.isEmpty) return;

    // flutter_map reports hit values from the visually top-most polyline
    // downward. Selecting the first one matches what the driver sees.
    final index = hitResult.hitValues.first;
    if (index < 0 || index >= _routeOptions.length) return;

    HapticFeedback.selectionClick();
    if (index != _selectedRouteOptionIndex) {
      _applyRouteOption(index);
    }

    final option = _routeOptions[index];
    final hours = option.durationSeconds ~/ 3600;
    final minutes = (option.durationSeconds % 3600) ~/ 60;
    final durationLabel = hours > 0 ? '${hours}h ${minutes}m' : '${minutes}m';
    final routeLabel = index == 0 ? 'Recommended' : 'Alternative $index';
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          duration: const Duration(milliseconds: 1800),
          behavior: SnackBarBehavior.floating,
          content: Text(
            '$routeLabel selected • '
            '${_formatRemainingDistance(option.distanceMiles)} • $durationLabel',
          ),
        ),
      );
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
                    final etaLabel = etaH > 0
                        ? '${etaH}h ${etaM}m'
                        : '${etaM}m';
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
                                      horizontal: 8,
                                      vertical: 2,
                                    ),
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
                                  _formatRemainingDistance(opt.distanceMiles),
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
                                  '⛽',
                                  '${opt.fuelStopCount} truck fuel stops',
                                ),
                                _routeChip(
                                  '⚖️',
                                  '${opt.weighStationCount} weigh stations',
                                ),
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
        if (_distanceBetween(pt, zonePt) <=
            _restrictionProximityThresholdMeters) {
          hit = true;
          break;
        }
      }
      if (hit) {
        final type = zone['type'] as String;
        final limit = zone['limit_value'] as double;
        if (type == 'low_bridge') {
          violations.add(
            'Low bridge (${limit.toStringAsFixed(1)} ft clearance) near route',
          );
        } else if (type == 'weight_limit') {
          violations.add(
            'Weight limit (${limit.toStringAsFixed(0)} tons) near route',
          );
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
        _restrictionProximityThresholdMeters *
        _restrictionSegmentThresholdMultiplier;
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
          final zonePt = LatLng(zone['lat']! as double, zone['lng']! as double);
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

  Widget _destinationCategoryShortcut(
    BuildContext sheetContext,
    IconData icon,
    String label,
    Color color,
    String? category,
    String title,
  ) {
    return SizedBox(
      width: 82,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () {
          final selection = category == null
              ? const _DestinationSearchSelection.more()
              : _DestinationSearchSelection.category(category, title);
          FocusScope.of(sheetContext).unfocus();
          Navigator.of(sheetContext).pop(selection);
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(icon, color: Colors.white, size: 27),
              ),
              const SizedBox(height: 6),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Opens the dedicated destination-search stage used by the truck-planning
  /// flow. Results remain provider-backed; no fake recent destinations are
  /// inserted when the driver has no history.
  Future<void> _showDestinationSearch({
    String initialQuery = '',
    bool searchImmediately = false,
  }) async {
    // Do not stack two search routes when the search icon or microphone is
    // tapped repeatedly. Stacked modal teardown is a common cause of inherited
    // element lifecycle assertions.
    if (_destinationSearchOpen) return;
    if (_mapboxToken.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Destination search is not configured. Rebuild with the Mapbox public access token.',
          ),
        ),
      );
      return;
    }

    _destinationSearchOpen = true;
    final requestGeneration = ++_destinationSearchRequestGeneration;
    final controller = _destinationSearchController;
    controller.value = TextEditingValue(
      text: initialQuery,
      selection: TextSelection.collapsed(offset: initialQuery.length),
    );
    List<Map<String, dynamic>> results = [];
    String? searchError;
    bool isSearching = false;
    bool initialSearchScheduled = false;

    _DestinationSearchSelection? selection;
    try {
      selection = await showModalBottomSheet<_DestinationSearchSelection>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        backgroundColor: Colors.transparent,
        builder: (sheetContext) {
          return StatefulBuilder(
            builder: (sheetContext, setModalState) {
              Future<void> search(String query) async {
                final q = query.trim();
                if (q.isEmpty ||
                    isSearching ||
                    !_destinationSearchOpen ||
                    requestGeneration != _destinationSearchRequestGeneration) {
                  return;
                }
                setModalState(() {
                  isSearching = true;
                  searchError = null;
                });
                try {
                  final matches = await _geocodeAddress(q);
                  if (!sheetContext.mounted ||
                      !_destinationSearchOpen ||
                      requestGeneration !=
                          _destinationSearchRequestGeneration) {
                    return;
                  }
                  setModalState(() {
                    results = matches;
                    isSearching = false;
                    searchError = matches.isEmpty
                        ? 'No destinations found.'
                        : null;
                  });
                } catch (error) {
                  if (!sheetContext.mounted ||
                      !_destinationSearchOpen ||
                      requestGeneration !=
                          _destinationSearchRequestGeneration) {
                    return;
                  }
                  setModalState(() {
                    results = [];
                    isSearching = false;
                    searchError = error.toString().replaceFirst(
                      'Bad state: ',
                      '',
                    );
                  });
                }
              }

              if (searchImmediately &&
                  !initialSearchScheduled &&
                  initialQuery.trim().isNotEmpty) {
                initialSearchScheduled = true;
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (sheetContext.mounted) {
                    unawaited(search(initialQuery));
                  }
                });
              }

              final media = MediaQuery.of(sheetContext);
              final height = math.max(
                360.0,
                media.size.height * 0.91 - media.viewInsets.bottom,
              );
              final scheme = Theme.of(sheetContext).colorScheme;
              return Container(
                margin: EdgeInsets.only(bottom: media.viewInsets.bottom),
                height: height,
                decoration: BoxDecoration(
                  color: scheme.surface,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(28),
                  ),
                ),
                child: Column(
                  children: [
                    const SizedBox(height: 10),
                    Container(
                      width: 44,
                      height: 5,
                      decoration: BoxDecoration(
                        color: scheme.onSurface.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
                      child: TextField(
                        controller: controller,
                        autofocus: true,
                        textInputAction: TextInputAction.search,
                        decoration: InputDecoration(
                          hintText: 'Set destination for truck routes',
                          prefixIcon: IconButton(
                            tooltip: 'Close search',
                            onPressed: () {
                              FocusScope.of(sheetContext).unfocus();
                              Navigator.of(sheetContext).pop();
                            },
                            icon: const Icon(Icons.arrow_back_ios_new_rounded),
                          ),
                          suffixIcon: isSearching
                              ? const Padding(
                                  padding: EdgeInsets.all(13),
                                  child: SizedBox(
                                    width: 18,
                                    height: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2.2,
                                    ),
                                  ),
                                )
                              : Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      tooltip: 'Speak destination',
                                      onPressed: () async {
                                        try {
                                          final spoken =
                                              await _captureVoiceDestination();
                                          if (!sheetContext.mounted ||
                                              spoken == null ||
                                              spoken.trim().isEmpty) {
                                            return;
                                          }
                                          controller.value = TextEditingValue(
                                            text: spoken.trim(),
                                            selection: TextSelection.collapsed(
                                              offset: spoken.trim().length,
                                            ),
                                          );
                                          await search(spoken);
                                        } on VoiceDestinationException catch (
                                          error
                                        ) {
                                          if (!sheetContext.mounted) return;
                                          setModalState(
                                            () => searchError = error.message,
                                          );
                                        }
                                      },
                                      icon: const Icon(
                                        Icons.mic_rounded,
                                        color: SemiTrackColors.orange,
                                      ),
                                    ),
                                    IconButton(
                                      tooltip: 'Search',
                                      onPressed: () => search(controller.text),
                                      icon: const Icon(Icons.search_rounded),
                                    ),
                                  ],
                                ),
                          filled: true,
                          fillColor: scheme.surfaceContainerHighest,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(18),
                            borderSide: BorderSide.none,
                          ),
                        ),
                        onSubmitted: search,
                      ),
                    ),
                    SizedBox(
                      height: 91,
                      child: ListView(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        scrollDirection: Axis.horizontal,
                        children: [
                          _destinationCategoryShortcut(
                            sheetContext,
                            Icons.restaurant_rounded,
                            'Truck Stops',
                            const Color(0xFFE8583E),
                            'truck_stop',
                            'Truck Stops',
                          ),
                          _destinationCategoryShortcut(
                            sheetContext,
                            Icons.scale_rounded,
                            'Weigh',
                            const Color(0xFF008F7D),
                            'weigh_station',
                            'Weigh Stations',
                          ),
                          _destinationCategoryShortcut(
                            sheetContext,
                            Icons.local_parking_rounded,
                            'Parking',
                            const Color(0xFF0B68E8),
                            'truck_parking',
                            'Truck Parking',
                          ),
                          _destinationCategoryShortcut(
                            sheetContext,
                            Icons.local_gas_station_rounded,
                            'Truck Fuel',
                            const Color(0xFFFF8A00),
                            'truck_stop',
                            'Truck Fuel & Stops',
                          ),
                          _destinationCategoryShortcut(
                            sheetContext,
                            Icons.park_rounded,
                            'Rest Areas',
                            const Color(0xFF0A9FC1),
                            'rest_area',
                            'Rest Areas',
                          ),
                          _destinationCategoryShortcut(
                            sheetContext,
                            Icons.storefront_rounded,
                            'Walmarts',
                            const Color(0xFF146DE0),
                            'walmart_store',
                            'Walmarts',
                          ),
                          _destinationCategoryShortcut(
                            sheetContext,
                            Icons.more_horiz_rounded,
                            'More',
                            const Color(0xFF7189AC),
                            null,
                            'More',
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 1),
                    Expanded(
                      child: Builder(
                        builder: (_) {
                          if (searchError != null) {
                            return Center(
                              child: Padding(
                                padding: const EdgeInsets.all(24),
                                child: Text(
                                  searchError!,
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: scheme.error),
                                ),
                              ),
                            );
                          }
                          if (results.isEmpty) {
                            return Center(
                              child: Padding(
                                padding: const EdgeInsets.all(28),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      Icons.route_rounded,
                                      size: 52,
                                      color: scheme.primary.withOpacity(0.65),
                                    ),
                                    const SizedBox(height: 12),
                                    const Text(
                                      'Where are you hauling to?',
                                      style: TextStyle(
                                        fontSize: 19,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                    const SizedBox(height: 7),
                                    Text(
                                      'Search a city, address, business, or choose a live truck place above.',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        color: scheme.onSurface.withOpacity(
                                          0.62,
                                        ),
                                        height: 1.35,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          }
                          return ListView.separated(
                            padding: const EdgeInsets.only(bottom: 16),
                            itemCount: results.length,
                            separatorBuilder: (_, __) =>
                                const Divider(height: 1, indent: 72),
                            itemBuilder: (_, index) {
                              final result = results[index];
                              final suggestion = PlaceSuggestion(
                                name: result['name'] as String? ?? '',
                                placeName: result['place'] as String? ?? '',
                                position: result['position'] as LatLng,
                              );
                              final current = _truckPosition;
                              final distanceMiles = current == null
                                  ? null
                                  : geo.Geolocator.distanceBetween(
                                          current.latitude,
                                          current.longitude,
                                          suggestion.position.latitude,
                                          suggestion.position.longitude,
                                        ) /
                                        _metersPerMile;
                              return ListTile(
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 18,
                                  vertical: 7,
                                ),
                                leading: Container(
                                  width: 42,
                                  height: 42,
                                  decoration: BoxDecoration(
                                    color: scheme.primaryContainer,
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    Icons.location_on_outlined,
                                    color: scheme.onPrimaryContainer,
                                  ),
                                ),
                                title: Text(
                                  suggestion.name,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                subtitle: Text(
                                  suggestion.placeName,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                trailing: distanceMiles == null
                                    ? const Icon(Icons.chevron_right_rounded)
                                    : Column(
                                        mainAxisAlignment:
                                            MainAxisAlignment.center,
                                        children: [
                                          const Icon(
                                            Icons.alt_route_rounded,
                                            size: 18,
                                          ),
                                          Text(
                                            _formatRemainingDistance(
                                              distanceMiles,
                                            ),
                                            style: const TextStyle(
                                              fontSize: 10,
                                            ),
                                          ),
                                        ],
                                      ),
                                onTap: () {
                                  FocusScope.of(sheetContext).unfocus();
                                  Navigator.of(sheetContext).pop(
                                    _DestinationSearchSelection.place(
                                      suggestion,
                                    ),
                                  );
                                },
                              );
                            },
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
    } finally {
      // showModalBottomSheet completes at the start of the reverse transition.
      // Mark requests stale immediately and release keyboard dependencies.
      _destinationSearchOpen = false;
      _destinationSearchRequestGeneration++;
      FocusManager.instance.primaryFocus?.unfocus();
    }

    if (!mounted || selection == null) return;
    await Future<void>.delayed(const Duration(milliseconds: 260));
    if (!mounted) return;
    final suggestion = selection.suggestion;
    if (suggestion != null) {
      await _showDestinationDetails(suggestion);
      return;
    }
    if (selection.showMore) {
      _showMoreMapFeaturesSheet();
      return;
    }
    final category = selection.category;
    final title = selection.title;
    if (category != null && title != null) {
      await _showLivePlaceCategory(category, title);
    }
  }

  /// Shows a separate destination-detail stage before route calculation. Only
  /// real provider fields are displayed; availability, deals, loads, and
  /// parking counts are omitted unless a future provider supplies them.
  Future<void> _showDestinationDetails(PlaceSuggestion suggestion) async {
    final current = _truckPosition;
    final distanceMiles = current == null
        ? null
        : geo.Geolocator.distanceBetween(
                current.latitude,
                current.longitude,
                suggestion.position.latitude,
                suggestion.position.longitude,
              ) /
              _metersPerMile;

    final buildNow = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) {
        final scheme = Theme.of(sheetContext).colorScheme;
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 22),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 50,
                    height: 50,
                    decoration: BoxDecoration(
                      color: scheme.primaryContainer,
                      borderRadius: BorderRadius.circular(15),
                    ),
                    child: Icon(
                      Icons.location_on_rounded,
                      color: scheme.onPrimaryContainer,
                      size: 29,
                    ),
                  ),
                  const SizedBox(width: 13),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          suggestion.name,
                          style: const TextStyle(
                            fontSize: 23,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          suggestion.placeName,
                          style: TextStyle(
                            color: scheme.onSurface.withOpacity(0.65),
                            height: 1.3,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (distanceMiles != null)
                    Text(
                      _formatRemainingDistance(distanceMiles),
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: const Row(
                  children: [
                    Icon(
                      Icons.verified_user_rounded,
                      color: SemiTrackColors.green,
                    ),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Truck dimensions, weight, axles and hazmat settings will be applied to route calculation.',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          height: 1.3,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: () => Navigator.of(sheetContext).pop(false),
                icon: const Icon(Icons.push_pin_outlined),
                label: const Text('Set destination only'),
              ),
              const SizedBox(height: 9),
              SizedBox(
                height: 54,
                child: FilledButton.icon(
                  style: FilledButton.styleFrom(
                    backgroundColor: SemiTrackColors.orange,
                    foregroundColor: Colors.white,
                  ),
                  onPressed: () => Navigator.of(sheetContext).pop(true),
                  icon: const Icon(Icons.alt_route_rounded),
                  label: const Text(
                    'Build truck route',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );

    if (buildNow == null || !mounted) return;
    _selectDestinationFromSearch(suggestion);
    if (!buildNow) return;
    setState(() => _isBuildingRoute = true);
    try {
      await _startRouteToSelectedDestination();
    } finally {
      if (mounted) setState(() => _isBuildingRoute = false);
    }
  }

  /// Queries the Mapbox Geocoding v5 API for [query] and returns up to 5  /// results as maps with keys 'name', 'place', and 'position' (LatLng).
  Future<List<Map<String, dynamic>>> _geocodeAddress(String query) async {
    try {
      final encoded = Uri.encodeComponent(query);
      final position = _truckPosition;
      final proximity = position == null
          ? ''
          : '&proximity=${position.longitude},${position.latitude}';
      final url =
          'https://api.mapbox.com/geocoding/v5/mapbox.places/$encoded.json'
          '?types=address,place,poi'
          '&limit=5'
          '$proximity'
          '&access_token=$_mapboxToken';
      final res = await http.get(Uri.parse(url));
      if (res.statusCode == 401 || res.statusCode == 403) {
        throw StateError(
          'Destination search credential was rejected. Rebuild with a valid Mapbox public token.',
        );
      }
      if (res.statusCode == 429) {
        throw StateError(
          'Destination search is temporarily rate limited. Try again shortly.',
        );
      }
      if (res.statusCode != 200) {
        throw StateError('Destination search is unavailable right now.');
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final features = (data['features'] as List?) ?? const [];
      return features.map<Map<String, dynamic>>((dynamic f) {
        final props = f as Map<String, dynamic>;
        final coords =
            (props['geometry'] as Map<String, dynamic>)['coordinates'] as List;
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
      // Only emit in debug builds – suppressed in release/profile mode.
      if (kDebugMode) debugPrint('Geocoding error for "$query": $e');
      if (e is StateError) rethrow;
      throw StateError('Unable to search destinations. Check the connection.');
    }
  }

  /// Reverse-geocodes [lat]/[lng] to the exact street address using
  /// the Mapbox Geocoding v5 API.
  ///
  /// Returns a precise street address string on success.  Returns `null` when
  /// the network request fails, the API returns no features, or the result is
  /// not a precise street address — so callers display "Address unavailable"
  /// rather than an approximate fallback.
  ///
  /// Results are cached in [_reverseGeocodeCache] to avoid redundant requests
  /// for the same coordinate during a session.
  Future<String?> _reverseGeocode(double lat, double lng) async {
    final String key = '${lat.toStringAsFixed(6)},${lng.toStringAsFixed(6)}';
    if (_reverseGeocodeCache.containsKey(key)) {
      final cached = _reverseGeocodeCache[key]!;
      return cached.isEmpty ? null : cached;
    }
    try {
      final url =
          'https://api.mapbox.com/geocoding/v5/mapbox.places/'
          '${lng.toStringAsFixed(6)},${lat.toStringAsFixed(6)}.json'
          '?types=address'
          '&limit=1'
          '&access_token=$_mapboxToken';
      final res = await http.get(Uri.parse(url));
      if (res.statusCode != 200) {
        _reverseGeocodeCache[key] = '';
        return null;
      }
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final features = (data['features'] as List?) ?? const [];
      if (features.isEmpty) {
        _reverseGeocodeCache[key] = '';
        return null;
      }
      final feature = features.first as Map<String, dynamic>;
      final String placeName = (feature['place_name'] as String?) ?? '';
      final String featureType =
          ((feature['place_type'] as List?)?.first as String?) ?? '';

      // Only accept a precise street-level address result.
      if (featureType != 'address' || placeName.isEmpty) {
        _reverseGeocodeCache[key] = '';
        return null;
      }
      _reverseGeocodeCache[key] = placeName;
      return placeName;
    } catch (e) {
      _reverseGeocodeCache[key] = '';
      return null;
    }
  }

  /// Handles a long-press on the map to place a destination pin at the tapped
  /// coordinate. Route building remains an explicit driver action.
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
    // Match search selection: show the pin first, then let the driver confirm
    // it with Start Route.
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
        _searchError = null;
      });
      return;
    }
    setState(() {
      _isSearching = true;
      _searchError = null;
    });
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
    if (_mapboxToken.isEmpty) {
      setState(() {
        _searchResults = const [];
        _isSearching = false;
        _searchError =
            'Destination search is not configured. Rebuild with a Mapbox public access token.';
      });
      return;
    }
    setState(() {
      _isSearching = true;
      _searchError = null;
    });
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
        // Only emit in debug builds to avoid leaking response bodies in production.
        if (kDebugMode)
          debugPrint('Geocoding HTTP ${res.statusCode} for "$q": ${res.body}');
        if (mounted) {
          setState(() {
            _isSearching = false;
            _searchResults = const [];
            _searchError = res.statusCode == 401 || res.statusCode == 403
                ? 'Destination search credential was rejected. Rebuild with a valid Mapbox public token.'
                : res.statusCode == 429
                ? 'Destination search is temporarily rate limited. Try again shortly.'
                : 'Destination search is unavailable right now.';
          });
        }
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
          suggestions.add(
            PlaceSuggestion(
              name: props['text'] as String? ?? '',
              placeName: props['place_name'] as String? ?? '',
              position: LatLng(
                (coords[1] as num).toDouble(),
                (coords[0] as num).toDouble(),
              ),
            ),
          );
        } catch (_) {
          // Skip malformed features rather than aborting the whole batch.
        }
      }
      if (mounted) {
        setState(() {
          _searchResults = suggestions;
          _isSearching = false;
          _searchError = suggestions.isEmpty ? 'No destinations found.' : null;
        });
      }
    } catch (e) {
      // Log the error so developers can diagnose network or parsing failures.
      // Only emit in debug builds – suppressed in release/profile mode.
      if (kDebugMode) debugPrint('Geocoding error for "$q": $e');
      if (mounted) {
        setState(() {
          _searchResults = const [];
          _isSearching = false;
          _searchError = 'Unable to search destinations. Check the connection.';
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
      _searchError = null;
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
      top: 12,
      left: 14,
      right: 14,
      child: Material(
        elevation: 9,
        shadowColor: Colors.black26,
        borderRadius: BorderRadius.circular(18),
        child: ValueListenableBuilder<TextEditingValue>(
          valueListenable: _searchController,
          builder: (_, value, __) {
            return TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Where do you want to go?',
                prefixIcon: const Icon(
                  Icons.search_rounded,
                  color: SemiTrackColors.orange,
                ),
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
                        icon: const Icon(Icons.close_rounded),
                        onPressed: () {
                          _searchController.clear();
                          setState(() {
                            _searchResults = const [];
                            _searchError = null;
                          });
                        },
                      )
                    : null,
                filled: true,
                fillColor: Theme.of(context).colorScheme.surface,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 17,
                ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(18),
                  borderSide: BorderSide.none,
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(18),
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
    if (!hasText &&
        !_isSearching &&
        _searchResults.isEmpty &&
        _searchError == null) {
      return const SizedBox.shrink();
    }

    Widget content;
    if (_isSearching) {
      content = const Padding(
        padding: EdgeInsets.symmetric(vertical: 20),
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    } else if (_searchError != null) {
      content = Padding(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 16),
        child: Row(
          children: [
            const Icon(Icons.error_outline, color: Colors.deepOrange),
            const SizedBox(width: 10),
            Expanded(child: Text(_searchError!)),
          ],
        ),
      );
    } else if (_searchResults.isEmpty) {
      content = const Padding(
        padding: EdgeInsets.symmetric(vertical: 16, horizontal: 16),
        child: Text('No results found', style: TextStyle(color: Colors.grey)),
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
      top: 78,
      left: 14,
      right: 14,
      child: Material(
        elevation: 8,
        shadowColor: Colors.black26,
        borderRadius: BorderRadius.circular(18),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: Container(
            color: Theme.of(context).colorScheme.surface,
            child: content,
          ),
        ),
      ),
    );
  }

  void _cancelRouteCalculation() {
    _routeCalculationCoordinator.invalidate();
    _isLoadingRoute = false;
    setState(() {
      _isLoading = false;
      _isBuildingRoute = false;
      _isLoadingRouteWeighStations = false;
      _routePoints = const [];
      _routeOptions = const [];
    });
  }

  Widget _buildRouteLoadingOverlay() {
    return Positioned.fill(
      child: ColoredBox(
        color: const Color(0x990B1420),
        child: Center(
          child: Container(
            width: 292,
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x55000000),
                  blurRadius: 28,
                  offset: Offset(0, 12),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    color: const Color(0xFFEAF3FF),
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: const Icon(
                    Icons.alt_route_rounded,
                    size: 44,
                    color: Color(0xFF0B68E8),
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  'Calculating truck routes',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: SemiTrackColors.navy,
                    fontSize: 21,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Checking dimensions, weight, hazmat, tolls, ferries and road restrictions…',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Color(0xFF697586),
                    fontSize: 13,
                    height: 1.35,
                  ),
                ),
                const SizedBox(height: 18),
                const LinearProgressIndicator(
                  minHeight: 4,
                  borderRadius: BorderRadius.all(Radius.circular(99)),
                ),
                const SizedBox(height: 15),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: _cancelRouteCalculation,
                    child: const Text('Cancel'),
                  ),
                ),
              ],
            ),
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
      left: 14,
      right: 14,
      bottom: 14,
      child: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: SemiTrackColors.navy,
            borderRadius: BorderRadius.circular(22),
            boxShadow: const [
              BoxShadow(
                color: Color(0x40101820),
                blurRadius: 22,
                offset: Offset(0, 10),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.location_on_rounded,
                    color: SemiTrackColors.orange,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'DESTINATION',
                          style: TextStyle(
                            color: Colors.white54,
                            fontSize: 10,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 0.8,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _selectedDestinationName ?? 'Selected map location',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: SemiTrackColors.orange,
                  foregroundColor: Colors.white,
                ),
                icon: _isBuildingRoute
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(Icons.route_rounded),
                label: Text(
                  _isBuildingRoute
                      ? 'Building truck route…'
                      : 'Build truck route',
                ),
                onPressed: _isBuildingRoute
                    ? null
                    : () async {
                        setState(() => _isBuildingRoute = true);
                        await _startRouteToSelectedDestination();
                        if (mounted) setState(() => _isBuildingRoute = false);
                      },
              ),
            ],
          ),
        ),
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
    final guidanceAvailable =
        _nativeNavigationStatus?.truckSafeGuidanceAvailable == true;
    final checkingGuidance = _nativeNavigationStatusLoading;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_previewPanelExpanded && _routeOptions.length > 1) ...[
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: SemiTrackColors.navy,
              side: const BorderSide(color: SemiTrackColors.navy, width: 1.5),
              padding: const EdgeInsets.symmetric(vertical: 11),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              backgroundColor: Colors.white,
            ),
            icon: const Icon(Icons.compare_arrows, size: 20),
            label: Text(
              'Compare ${_routeOptions.length} truck routes',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
            ),
            onPressed: _showRouteOptionsBottomSheet,
          ),
          const SizedBox(height: 8),
        ],
        SizedBox(
          height: 54,
          child: ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: SemiTrackColors.orange,
              foregroundColor: Colors.white,
              disabledBackgroundColor: SemiTrackColors.orange.withOpacity(0.55),
              disabledForegroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              elevation: 5,
            ),
            icon: checkingGuidance
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.2,
                      color: Colors.white,
                    ),
                  )
                : Icon(
                    guidanceAvailable
                        ? Icons.navigation_rounded
                        : Icons.map_rounded,
                  ),
            label: Text(
              checkingGuidance
                  ? 'Checking navigation…'
                  : guidanceAvailable
                  ? 'Start truck navigation'
                  : 'Start route assistance',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
            ),
            onPressed: checkingGuidance
                ? null
                : () => unawaited(
                    _beginSelectedRouteAssistance(
                      nativeGuidanceAvailable: guidanceAvailable,
                    ),
                  ),
          ),
        ),
        if (!checkingGuidance && !guidanceAvailable) ...[
          const SizedBox(height: 7),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: const Color(0xFFF1F4F7),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.lock_outline_rounded,
                  size: 15,
                  color: Color(0xFF5F6E7C),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: Text(
                    _routeOptions.length > 1
                        ? 'Tap any route line to select it. Foreground voice uses the selected HERE truck route.'
                        : 'Foreground GPS, maneuvers, voice, alerts, and truck-safe rerouting are available.',
                    style: const TextStyle(
                      color: Color(0xFF5F6E7C),
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const IconButton(
                  tooltip: 'Recheck navigation availability',
                  visualDensity: VisualDensity.compact,
                  onPressed: null,
                  icon: Icon(Icons.info_outline_rounded, size: 17),
                ),
              ],
            ),
          ),
        ],
        if (_routeViolations.isNotEmpty && _previewPanelExpanded) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _isRestrictionRerouting
                ? null
                : _smartRerouteAroundRestrictions,
            icon: const Icon(Icons.alt_route_rounded),
            label: const Text('Optimize around restrictions'),
          ),
        ],
      ],
    );
  }

  Future<void> _beginSelectedRouteAssistance({
    required bool nativeGuidanceAvailable,
  }) async {
    if (!await _confirmHosPlanningWarningIfNeeded()) return;
    if (!mounted) return;
    if (nativeGuidanceAvailable) {
      await _startNavigation();
    } else {
      _startRoutePreview();
    }
  }

  Future<bool> _confirmHosPlanningWarningIfNeeded() async {
    final etaMinutes = (_routeData?['etaMinutes'] as num?)?.toInt() ?? 0;
    const federalDrivingLimitMinutes = 11 * 60;
    if (etaMinutes <= federalDrivingLimitMinutes) return true;

    _analyticsService.updateNavigationSnapshot(hosWarningShown: true);
    unawaited(
      _analyticsService.recordEvent(
        'HOS_WARNING_SHOWN',
        numericValue: etaMinutes.toDouble(),
        durationSeconds: etaMinutes * 60,
      ),
    );

    final eldMinutesLeft = _intelligence['driveMinutesLeft'] as int?;
    final routeDuration = _formatEta(etaMinutes);
    final hosStatus = _eldHosAvailable && eldMinutesLeft != null
        ? 'Connected ELD reports ${_formatEta(eldMinutesLeft)} of driving time remaining.'
        : 'No current ELD HOS clock is available. SemiTraX will not estimate your legal remaining hours.';

    return await showDialog<bool>(
          context: context,
          barrierDismissible: false,
          builder: (dialogContext) => AlertDialog(
            icon: const Icon(
              Icons.schedule_rounded,
              color: Color(0xFFF45A13),
              size: 34,
            ),
            title: const Text('HOS planning required'),
            content: Text(
              'This truck route is approximately $routeDuration and exceeds the federal 11-hour driving limit. $hosStatus\n\nPlan required breaks and verify your current duty status before departure. This warning supports planning and is not a legal HOS determination.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Review route'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('Continue planning'),
              ),
            ],
          ),
        ) ??
        false;
  }

  /// Starts GPS-following assistance for the authenticated HERE truck route.
  ///
  /// This fallback uses only provider route steps and fresh truck-safe route
  /// calculations. It does not claim lane-level, offline, or licensed native
  /// HERE Navigate guidance, and it never substitutes a passenger-car route.
  void _startRoutePreview() {
    _gestureReturnTimer?.cancel();
    final now = DateTime.now();
    setState(() {
      _cameraMode = NavigationCameraMode.follow;
      _previewPanelExpanded = false;
      _routePreviewActive = true;
      _navigationActive = true;
      _navigationMode = true;
      _navigationStartedAt = now;
      _lastRerouteAt = null;
      _offRouteDetectedAt = null;
      _hasStableFixForNavigation =
          _lastAcceptedPosition != null &&
          _lastAcceptedPosition!.accuracy >= 0 &&
          _lastAcceptedPosition!.accuracy < 30 &&
          _lastAcceptedPosition!.speed >= 0;
      _isUserInteractingWithMap = false;
      _lastManualMapInteractionAt = null;
    });
    // HERE Explore assistance is still a live driving session even though it
    // is not licensed native Navigate guidance. Hide AppShell's planning tabs
    // and use the same distraction-reduced map layout for both modes.
    TruckMapScreen.isNavigatingNotifier.value = true;
    unawaited(
      _analyticsService.startNavigation(
        estimatedDriveMinutes: (_routeTotalDurationSeconds / 60).ceil(),
      ),
    );
    _warningManager.startNavigation();
    _startTripStats();
    unawaited(_startGps());
    if (_navSteps.isNotEmpty) {
      final context = _roadContextForRouteIndex(_truckIndex);
      final stepIndex = (context?.key ?? 0).clamp(0, _navSteps.length - 1);
      _activateNavigationStep(stepIndex, speak: false);
      final instruction = _navSteps[stepIndex].instruction.trim();
      unawaited(
        _speak(
          instruction.isEmpty
              ? 'Live truck route assistance started'
              : 'Live truck route assistance started. $instruction',
        ),
      );
    }
    _refreshClosestTruckStopsAhead();
    _refreshClosestWeighStationsAhead();
    _refreshClosestRestAreasAhead();
    _refreshTripProgress();
    _refreshUpcomingAlerts();
    _refreshRoutePoiSourceIfNeeded(force: true);
    _scheduleRoadFeatureRefresh(center: _truckPosition, routeAware: true);
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          content: Text(
            'Live truck-route assistance started. Tap Navigation controls to continue, reroute, or quit.',
          ),
          behavior: SnackBarBehavior.floating,
          duration: Duration(seconds: 4),
        ),
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
    if (_tripLegs.isEmpty || !_isLiveRouteAssistanceActive) {
      return const SizedBox.shrink();
    }
    if (_activeLegIndex >= _tripLegs.length) return const SizedBox.shrink();
    final leg = _tripLegs[_activeLegIndex];
    // In landscape mode (shorter screen height) use a reduced bottom offset
    // so the card stays on-screen and does not overlap the top nav card.
    final isLandscape =
        MediaQuery.of(context).orientation == Orientation.landscape;
    return Positioned(
      left: 16,
      right: 16,
      bottom: isLandscape ? 140.0 : 250.0,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.12), blurRadius: 10),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Leg ${_activeLegIndex + 1} of ${_tripLegs.length}',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 8),
            Text('${leg.fromName} → ${leg.toName}'),
            const SizedBox(height: 6),
            Text(
              '${_formatRemainingDistance(leg.distanceMiles)} • ${_formatDuration(leg.durationSeconds)}',
            ),
            const SizedBox(height: 6),
            Text(
              leg.restrictionCount == 0
                  ? 'No known restrictions'
                  : '${leg.restrictionCount} restriction warning(s)',
              style: TextStyle(
                color: leg.restrictionCount == 0 ? Colors.green : Colors.red,
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
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 14),
              ...List.generate(_tripLegs.length, (index) {
                final leg = _tripLegs[index];
                final active = index == _activeLegIndex;
                return Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: active ? Colors.green.shade50 : Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: active ? Colors.green : Colors.grey.shade300,
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
                        '${_formatRemainingDistance(leg.distanceMiles)} • ${_formatDuration(leg.durationSeconds)}',
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

  /// Opens the full-screen [NavSettingsScreen] when the user taps the
  /// **More** button on the bottom trip strip.
  ///
  /// The persistent [_navSettings] model is passed in so that all toggle
  /// state is retained across visits.  The [onChanged] callback triggers
  /// an immediate map rebuild whenever the user changes a setting, so
  /// features like map type, layer visibility, and audio mode take effect
  /// in real time even while the settings screen is open.
  void _showMoreMapFeaturesSheet() {
    if (_isLiveRouteAssistanceActive) {
      unawaited(_showActiveNavigationMenu());
      return;
    }
    _showNavigationSettings();
  }

  void _showNavigationSettings() {
    Navigator.push<void>(
      context,
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => NavSettingsScreen(
          settings: _navSettings,
          onChanged: () {
            if (!mounted) return;
            // Sync _isSatelliteView so the satellite-toggle button stays in step.
            _isSatelliteView = _navSettings.mapType == 1;
            _applyAudioSettings();
            // Persist the updated settings and immediately refresh all POI
            // sources so category-toggle changes appear on the map without a
            // restart.
            _navSettings.saveToPrefs();
            _refreshAllPoiSourcesForSettingsChange();
          },
        ),
      ),
    );
  }

  Future<void> _showActiveNavigationMenu() async {
    final instruction = _topInstructionData;
    final headline = instruction == null
        ? 'Continue on truck route'
        : [
            instruction.primaryText.trim(),
            instruction.roadName.trim(),
          ].where((part) => part.isNotEmpty).join(' ');
    final remainingMiles = _formatRemainingDistance(
      _tripProgressInfo.milesRemaining,
    );
    final remainingDuration = _fmtDuration(_tripProgressInfo.durationRemaining);
    final arrival = _fmtArrival(_tripProgressInfo);
    final timezone = _tripProgressInfo.timezoneLabel.trim();
    final audioLabel = switch (_navSettings.audioMode) {
      0 => 'Muted',
      1 => 'Safety alerts only',
      _ => 'Voice guidance on',
    };

    final action = await Navigator.push<ActiveNavigationMenuAction>(
      context,
      MaterialPageRoute<ActiveNavigationMenuAction>(
        fullscreenDialog: true,
        builder: (_) => ActiveNavigationMenuScreen(
          instruction: headline,
          towardRoad: instruction?.towardRoadName,
          maneuverIcon: instruction == null
              ? Icons.straight_rounded
              : _maneuverVisualIcon(instruction.visualType),
          maneuverDistance: _formatDistance(_distanceToNextStep()),
          remainingDistance: remainingMiles,
          remainingDuration: remainingDuration,
          arrivalTime: timezone.isEmpty ? arrival : '$arrival $timezone',
          audioLabel: audioLabel,
          truckName: _activeTruckProfile?.name ?? 'Active truck profile',
        ),
      ),
    );
    if (!mounted || action == null) return;

    switch (action) {
      case ActiveNavigationMenuAction.quit:
        await _stopNavigation();
        if (mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(const SnackBar(content: Text('Navigation stopped')));
        }
      case ActiveNavigationMenuAction.reroute:
        _shortcutReroute();
      case ActiveNavigationMenuAction.poiAhead:
        _shortcutPoiAhead();
      case ActiveNavigationMenuAction.searchPlaces:
        _shortcutSearchPlaces();
      case ActiveNavigationMenuAction.report:
        _shortcutReport();
      case ActiveNavigationMenuAction.placesFilter:
        _shortcutPlacesFilter();
      case ActiveNavigationMenuAction.shareTrip:
        _shortcutShareTrip();
      case ActiveNavigationMenuAction.routeOptions:
        _showRouteOptionsBottomSheet();
      case ActiveNavigationMenuAction.audioSettings:
        _showNavigationSettings();
    }
  }

  /// Builds a mini FAB that opens the leg breakdown sheet during navigation.
  ///
  /// Hidden when there are no legs or navigation has not started.
  Widget _buildLegBreakdownButton() {
    if (_tripLegs.isEmpty || !_isLiveRouteAssistanceActive) {
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

  // ── Shortcut bar ─────────────────────────────────────────────────────────

  /// Builds a horizontally scrollable row of quick-action shortcut buttons
  /// just above the bottom trip strip during active navigation.
  ///
  /// Only shortcuts that the driver has enabled (active = true) in the
  /// [NavSettingsScreen] Shortcut section are shown.  Returns
  /// [SizedBox.shrink] when no shortcuts are active or navigation is idle.
  Widget _buildShortcutBar() {
    if (!_isLiveRouteAssistanceActive) return const SizedBox.shrink();

    final items = <_ShortcutBarItem>[];
    if (_navSettings.shortcutReroute) {
      items.add(
        _ShortcutBarItem(
          icon: Icons.alt_route,
          label: 'Reroute',
          onTap: _shortcutReroute,
        ),
      );
    }
    if (_navSettings.shortcutPoiAhead) {
      items.add(
        _ShortcutBarItem(
          icon: Icons.local_parking,
          label: 'POI Ahead',
          onTap: _shortcutPoiAhead,
        ),
      );
    }
    if (_navSettings.shortcutSearchPlaces) {
      items.add(
        _ShortcutBarItem(
          icon: Icons.search,
          label: 'Search',
          onTap: _shortcutSearchPlaces,
        ),
      );
    }
    if (_navSettings.shortcutReport) {
      items.add(
        _ShortcutBarItem(
          icon: Icons.flag_outlined,
          label: 'Report',
          onTap: _shortcutReport,
        ),
      );
    }
    if (_navSettings.shortcutPlacesFilter) {
      items.add(
        _ShortcutBarItem(
          icon: Icons.filter_list,
          label: 'Filter',
          onTap: _shortcutPlacesFilter,
        ),
      );
    }
    if (_navSettings.shortcutShareTrip) {
      items.add(
        _ShortcutBarItem(
          icon: Icons.share,
          label: 'Share',
          onTap: _shortcutShareTrip,
        ),
      );
    }

    if (items.isEmpty) return const SizedBox.shrink();

    return Positioned(
      left: 16,
      // Position above the full-width navigation summary card.
      bottom: 112,
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: items
                .map(
                  (item) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: _buildShortcutBarButton(item),
                  ),
                )
                .toList(),
          ),
        ),
      ),
    );
  }

  /// Builds a single compact shortcut button for the shortcut bar.
  Widget _buildShortcutBarButton(_ShortcutBarItem item) {
    return GestureDetector(
      onTap: item.onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.82),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white24),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(item.icon, color: Colors.white, size: 16),
            const SizedBox(width: 6),
            Text(
              item.label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Shortcut action handlers ──────────────────────────────────────────────

  /// Manually triggers a reroute from the current GPS position.
  void _shortcutReroute() {
    if (_truckPosition == null) {
      _showSnack('GPS position not yet available.  Try again in a moment.');
      return;
    }
    if (!_isLiveRouteAssistanceActive) {
      _showSnack('Start navigation first to use Reroute.');
      return;
    }
    _speakAlert('Rerouting');
    unawaited(_requestReroute(_truckPosition!, reason: 'manual'));
  }

  /// Shows a bottom sheet listing nearby POIs ahead on the active route.
  void _shortcutPoiAhead() {
    final pos = _truckPosition;
    if (pos == null) {
      _showSnack('Waiting for GPS position.');
      return;
    }

    // Collect POIs within roughly 20 miles ahead (≈ 32 km).
    const double radiusMeters = 32000;
    final nearby = <MapPoi>[];
    for (final poi in _mapPois) {
      final dist = geo.Geolocator.distanceBetween(
        pos.latitude,
        pos.longitude,
        poi.position.latitude,
        poi.position.longitude,
      );
      if (dist <= radiusMeters) nearby.add(poi);
    }
    nearby.sort((a, b) {
      final da = geo.Geolocator.distanceBetween(
        pos.latitude,
        pos.longitude,
        a.position.latitude,
        a.position.longitude,
      );
      final db = geo.Geolocator.distanceBetween(
        pos.latitude,
        pos.longitude,
        b.position.latitude,
        b.position.longitude,
      );
      return da.compareTo(db);
    });

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF1A2535),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
            child: Text(
              'POIs Ahead (${nearby.length})',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 17,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          if (nearby.isEmpty)
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 8, 20, 24),
              child: Text(
                'No points of interest found within 20 miles.',
                style: TextStyle(color: Color(0xFF8A9BB0)),
              ),
            )
          else
            Flexible(
              child: ListView.builder(
                shrinkWrap: true,
                itemCount: nearby.length > 10 ? 10 : nearby.length,
                itemBuilder: (_, i) {
                  final poi = nearby[i];
                  final dist = geo.Geolocator.distanceBetween(
                    pos.latitude,
                    pos.longitude,
                    poi.position.latitude,
                    poi.position.longitude,
                  );
                  final miles = (dist / 1609.34);
                  return ListTile(
                    leading: const Icon(
                      Icons.place_outlined,
                      color: Color(0xFF2196F3),
                    ),
                    title: Text(
                      poi.name,
                      style: const TextStyle(color: Colors.white),
                    ),
                    subtitle: Text(
                      '${_formatRemainingDistance(miles)} away',
                      style: const TextStyle(color: Color(0xFF8A9BB0)),
                    ),
                    onTap: () {
                      Navigator.pop(context);
                      _showPoiAlert(poi);
                    },
                  );
                },
              ),
            ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  /// Opens a search dialog so the driver can find a new destination while
  /// navigating.
  void _shortcutSearchPlaces() {
    final controller = TextEditingController();
    List<PlaceSuggestion> results = [];
    bool searching = false;

    showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDlgState) => AlertDialog(
          backgroundColor: const Color(0xFF1A2535),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Text(
            'Search Places',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
          ),
          content: SizedBox(
            width: double.maxFinite,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: controller,
                  autofocus: true,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'City, address, or place…',
                    hintStyle: const TextStyle(color: Color(0xFF8A9BB0)),
                    prefixIcon: const Icon(
                      Icons.search,
                      color: Color(0xFF8A9BB0),
                    ),
                    suffixIcon: searching
                        ? const Padding(
                            padding: EdgeInsets.all(12),
                            child: SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Color(0xFF2196F3),
                              ),
                            ),
                          )
                        : null,
                    filled: true,
                    fillColor: const Color(0xFF0F1923),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                      borderSide: BorderSide.none,
                    ),
                  ),
                  onSubmitted: (q) async {
                    if (q.trim().isEmpty) return;
                    setDlgState(() => searching = true);
                    await _executeSearch(q.trim());
                    setDlgState(() {
                      results = List.from(_searchResults);
                      searching = false;
                    });
                  },
                ),
                if (results.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 200),
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: results.length,
                      itemBuilder: (_, i) => ListTile(
                        dense: true,
                        leading: const Icon(
                          Icons.place_outlined,
                          color: Color(0xFF2196F3),
                          size: 18,
                        ),
                        title: Text(
                          results[i].name,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                          ),
                        ),
                        subtitle: Text(
                          results[i].placeName,
                          style: const TextStyle(
                            color: Color(0xFF8A9BB0),
                            fontSize: 11,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () {
                          Navigator.pop(ctx);
                          _selectDestinationFromSearch(results[i]);
                        },
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text(
                'Cancel',
                style: TextStyle(color: Color(0xFF8A9BB0)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Shows a dialog for reporting a road incident or hazard.
  void _shortcutReport() {
    const List<String> incidentTypes = [
      'Traffic Jam',
      'Accident',
      'Road Hazard',
      'Construction',
      'Speed Camera',
      'Weigh Station Active',
      'Road Closed',
      'Other',
    ];
    String? selected;

    showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDlgState) => AlertDialog(
          backgroundColor: const Color(0xFF1A2535),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Row(
            children: [
              Icon(Icons.flag_outlined, color: Color(0xFFF44336), size: 22),
              SizedBox(width: 8),
              Text(
                'Report Incident',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Select incident type:',
                style: TextStyle(color: Color(0xFF8A9BB0), fontSize: 13),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: incidentTypes
                    .map(
                      (t) => GestureDetector(
                        onTap: () => setDlgState(() => selected = t),
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 150),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: selected == t
                                ? const Color(0xFFF44336).withOpacity(0.18)
                                : const Color(0xFF253041),
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(
                              color: selected == t
                                  ? const Color(0xFFF44336)
                                  : Colors.transparent,
                            ),
                          ),
                          child: Text(
                            t,
                            style: TextStyle(
                              color: selected == t
                                  ? Colors.white
                                  : const Color(0xFF8A9BB0),
                              fontSize: 12,
                              fontWeight: selected == t
                                  ? FontWeight.w600
                                  : FontWeight.w400,
                            ),
                          ),
                        ),
                      ),
                    )
                    .toList(),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text(
                'Cancel',
                style: TextStyle(color: Color(0xFF8A9BB0)),
              ),
            ),
            TextButton(
              onPressed: selected == null
                  ? null
                  : () {
                      Navigator.pop(ctx);
                      _showSnack(
                        'Thanks! "$selected" reported near your location.',
                      );
                    },
              child: const Text(
                'Submit',
                style: TextStyle(color: Color(0xFF2196F3)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Shows a dialog to filter which POI categories are shown on the map.
  void _shortcutPlacesFilter() {
    // Use the current nav-settings toggles as the filter state, with a local
    // copy so the driver can cancel without committing.
    bool weighStation = _navSettings.viewWeighStation;
    bool truckRestrictions = _navSettings.viewTruckRestrictions;
    bool roadSigns = _navSettings.viewRoadSign;
    bool trafficIncidents = _navSettings.viewTrafficIncidents;

    showDialog<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDlgState) => AlertDialog(
          backgroundColor: const Color(0xFF1A2535),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Row(
            children: [
              Icon(Icons.filter_list, color: Color(0xFF2196F3), size: 22),
              SizedBox(width: 8),
              Text(
                'Places Filter',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _filterCheckRow(
                'Weigh Stations',
                Icons.scale_outlined,
                weighStation,
                (v) => setDlgState(() => weighStation = v),
              ),
              _filterCheckRow(
                'Truck Restrictions',
                Icons.local_shipping,
                truckRestrictions,
                (v) => setDlgState(() => truckRestrictions = v),
              ),
              _filterCheckRow(
                'Road Signs',
                Icons.turn_right_outlined,
                roadSigns,
                (v) => setDlgState(() => roadSigns = v),
              ),
              _filterCheckRow(
                'Traffic Incidents',
                Icons.warning_amber_outlined,
                trafficIncidents,
                (v) => setDlgState(() => trafficIncidents = v),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text(
                'Cancel',
                style: TextStyle(color: Color(0xFF8A9BB0)),
              ),
            ),
            TextButton(
              onPressed: () {
                setState(() {
                  _navSettings.viewWeighStation = weighStation;
                  _navSettings.viewTruckRestrictions = truckRestrictions;
                  _navSettings.viewRoadSign = roadSigns;
                  _navSettings.viewTrafficIncidents = trafficIncidents;
                });
                Navigator.pop(ctx);
              },
              child: const Text(
                'Apply',
                style: TextStyle(color: Color(0xFF2196F3)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Helper row for the Places Filter dialog.
  Widget _filterCheckRow(
    String label,
    IconData icon,
    bool value,
    ValueChanged<bool> onChanged,
  ) {
    return CheckboxListTile(
      value: value,
      onChanged: (v) => onChanged(v ?? value),
      activeColor: const Color(0xFF2196F3),
      checkColor: Colors.white,
      title: Row(
        children: [
          Icon(icon, color: const Color(0xFF8A9BB0), size: 18),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(color: Colors.white, fontSize: 14),
          ),
        ],
      ),
      contentPadding: EdgeInsets.zero,
    );
  }

  /// Shows a share dialog with the current trip summary that the driver can
  /// copy to the clipboard or share via the system share sheet.
  void _shortcutShareTrip() {
    final pos = _truckPosition;
    final info = StringBuffer('🚛 Semitrack Trip Share\n');
    if (pos != null) {
      info.writeln(
        'Current position: ${pos.latitude.toStringAsFixed(5)}, '
        '${pos.longitude.toStringAsFixed(5)}',
      );
    }
    if (_hasActiveDestination) {
      final dest = _selectedDestination ?? _destination;
      final hasName = _selectedDestinationName?.isNotEmpty ?? false;
      final destLabel = hasName
          ? _selectedDestinationName!
          : '${dest.latitude.toStringAsFixed(4)}, '
                '${dest.longitude.toStringAsFixed(4)}';
      info.writeln('Destination: $destLabel');
      final miles = _tripProgressInfo.milesRemaining;
      final mins = _tripProgressInfo.durationRemaining.inMinutes;
      if (miles > 0) {
        info.writeln(
          'Remaining: ${_formatRemainingDistance(miles)}, ~${mins}m',
        );
      }
    }
    final shareText = info.toString().trim();

    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A2535),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.share, color: Color(0xFF2196F3), size: 22),
            SizedBox(width: 8),
            Text(
              'Share Trip',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF0F1923),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                shareText.isEmpty ? 'No active trip to share.' : shareText,
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 13,
                  fontFamily: 'monospace',
                ),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text(
              'Close',
              style: TextStyle(color: Color(0xFF8A9BB0)),
            ),
          ),
          if (shareText.isNotEmpty)
            TextButton(
              onPressed: () {
                Clipboard.setData(ClipboardData(text: shareText));
                Navigator.pop(ctx);
                _showSnack('Trip info copied to clipboard.');
              },
              child: const Text(
                'Copy',
                style: TextStyle(color: Color(0xFF2196F3)),
              ),
            ),
        ],
      ),
    );
  }

  /// Shows a brief snackbar [message] at the bottom of the screen.
  void _showSnack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        duration: const Duration(seconds: 3),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Widget _previewStat(
    IconData icon,
    String value,
    String label, {
    Color color = SemiTrackColors.navy,
  }) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: color,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 3),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF687583),
              fontSize: 10,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _previewChip(IconData icon, String label, {Color? color}) {
    final chipColor = color ?? SemiTrackColors.blue;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: chipColor.withOpacity(0.1),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: chipColor),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: chipColor,
              fontSize: 11,
              fontWeight: FontWeight.w800,
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
        (_routeData?['distanceMiles'] as num?)?.toDouble() ?? 0;
    final etaMinutes = (_routeData?['etaMinutes'] as num?)?.toInt() ?? 0;
    final etaLabel = _fmtDuration(Duration(minutes: etaMinutes));
    final provider = _routeData?['provider']?.toString().trim();
    final providerLabel = provider == null || provider.isEmpty
        ? 'TRUCK ROUTE'
        : '${provider.toUpperCase()} TRUCK';

    // Fuel stops: truck stops near the route that are actual fuel providers
    // (exclude rest-area and weigh-station brands which don't sell diesel).
    final fuelStops = _countFuelStopsForRoute(_routePoints);

    final weighStations = _selectedRouteOptionIndex < _routeOptions.length
        ? _routeOptions[_selectedRouteOptionIndex].weighStationCount
        : _countWeighStationsForRoute(_routePoints);
    final weighStationLabel = _isLoadingRouteWeighStations
        ? 'Finding weigh stations…'
        : _routeWeighStationsAvailable
        ? '$weighStations weigh stations'
        : 'Weigh data unavailable';

    // Closest upcoming weigh station on this route (preview mode).
    // Re-uses the same ahead-on-route logic used during live navigation so the
    // Route Preview and the navigation chip always agree.
    final previewStations = _routePoints.isNotEmpty
        ? _getClosestWeighStationsAheadOnRoute()
        : const <AheadWeighStation>[];
    final AheadWeighStation? nextPreviewStation = previewStations.isNotEmpty
        ? previewStations.first
        : null;

    final restrictionCount = _selectedRouteOptionIndex < _routeOptions.length
        ? _routeOptions[_selectedRouteOptionIndex].restrictionCount
        : _routeViolations.length;
    final hasRestrictions = restrictionCount > 0;

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
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
          Row(
            children: [
              Expanded(
                child: Text(
                  _routePreviewActive
                      ? 'Truck route assistance'
                      : 'Truck route preview',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w900,
                    color: SemiTrackColors.navy,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: SemiTrackColors.green.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.verified_rounded,
                      size: 13,
                      color: SemiTrackColors.green,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      providerLabel,
                      style: const TextStyle(
                        color: SemiTrackColors.green,
                        fontSize: 9,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _previewStat(
                Icons.route_rounded,
                '$distanceMiles mi',
                'DISTANCE',
              ),
              Container(width: 1, height: 36, color: const Color(0xFFE2E7EC)),
              const SizedBox(width: 12),
              _previewStat(Icons.schedule_rounded, etaLabel, 'DRIVE TIME'),
              Container(width: 1, height: 36, color: const Color(0xFFE2E7EC)),
              const SizedBox(width: 12),
              _previewStat(
                hasRestrictions
                    ? Icons.warning_amber_rounded
                    : Icons.check_circle_rounded,
                hasRestrictions ? '$restrictionCount' : 'Clear',
                'RESTRICTIONS',
                color: hasRestrictions
                    ? Colors.red.shade700
                    : SemiTrackColors.green,
              ),
            ],
          ),
          const SizedBox(height: 11),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: [
              _previewChip(
                Icons.local_gas_station_rounded,
                '$fuelStops truck fuel stops',
              ),
              _previewChip(
                Icons.scale_rounded,
                weighStationLabel,
                color: SemiTrackColors.orange,
              ),
              _previewChip(
                Icons.flag_rounded,
                'Arrive ${_fmtArrival(_tripProgressInfo)} ${_tripProgressInfo.timezoneLabel}',
                color: SemiTrackColors.green,
              ),
              if (_weatherRisk != null)
                _previewChip(
                  Icons.cloud_rounded,
                  '$_weatherRisk weather',
                  color: Colors.blueGrey,
                ),
            ],
          ),
          // If the route passes a weigh station, show the first one ahead
          // with its name and distance so the driver can plan compliance stops.
          if (nextPreviewStation != null) ...[
            const SizedBox(height: 9),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
              decoration: BoxDecoration(
                color: const Color(0xFFF3F6F8),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.scale_rounded,
                    size: 14,
                    color: SemiTrackColors.orange,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'Next: ${nextPreviewStation.poi.name}',
                      style: const TextStyle(
                        fontSize: 11,
                        color: SemiTrackColors.navy,
                        fontWeight: FontWeight.w700,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    _formatRemainingDistance(nextPreviewStation.milesAhead),
                    style: const TextStyle(
                      fontSize: 11,
                      color: SemiTrackColors.orange,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (hasRestrictions) ...[
            const SizedBox(height: 9),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
              decoration: BoxDecoration(
                color: const Color(0xFFFFECEA),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Text(
                'Review truck restrictions before departure.',
                style: TextStyle(
                  fontSize: 11,
                  color: Color(0xFFB42318),
                  fontWeight: FontWeight.w800,
                ),
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

    final textScale = MediaQuery.textScalerOf(context).scale(1);
    final optionHeight = (88.0 * textScale).clamp(88.0, 120.0);

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
            height: optionHeight,
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
                      horizontal: 10,
                      vertical: 8,
                    ),
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
                            fontSize: 11,
                            color: Colors.black54,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
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
                            Expanded(
                              child: Text(
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
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
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
    final hasAlternatives = _routeOptions.length > 1;
    final hasRestrictions = _routeViolations.isNotEmpty;
    if (!hasAlternatives && !hasRestrictions) {
      return const SizedBox.shrink();
    }
    return Positioned(
      top: 14,
      left: 14,
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
            if (hasAlternatives)
              _legendRow(Colors.grey.shade500, 'Alternative route'),
            if (hasAlternatives && hasRestrictions) const SizedBox(height: 4),
            if (hasRestrictions)
              _legendRow(Colors.red.shade700, 'Restricted segment'),
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
  /// Triggers [_setupPoiCluster] to register icons and add the individual POI
  /// source and layer to the map style.  Also ensures the navigation-only
  /// route POI source and layer are present so they are ready before the first
  /// GPS fix.
  void _onStyleLoaded(mbx.StyleLoadedEventData _) {
    _setupPoiCluster();
    _enhanceRoadLabels();
    // Set up the route-only POI source and layer immediately so the first
    // navigation GPS fix can push data without a style-existence check delay.
    _ensureRoutePoiSourceAndLayer();
  }

  /// Boosts the visibility of road and highway name labels on the Mapbox style.
  ///
  /// Mapbox Streets v12 ships with road label layers whose default text size is
  /// modest.  This method increases text size, adds a thick white halo so
  /// labels are legible over any map background (satellite, dark, light), and
  /// ensures highway/motorway labels are always shown.  Only existing layers
  /// are modified — no new layers are added.
  Future<void> _enhanceRoadLabels() async {
    final mbx.MapboxMap? map = _mapboxMap;
    if (map == null) return;
    // Layer IDs used by Mapbox Streets v12 for road/highway labels.
    // Each entry is: (layerId, textSize, haloWidth, haloBlur).
    const List<(String, double, double, double)> roadLabelLayers = [
      ('road-label', 14.0, 2.5, 1.0),
      ('road-label-simple', 14.0, 2.5, 1.0),
      ('road-number-shield', 13.0, 2.0, 1.0),
      ('motorway-label', 15.0, 3.0, 1.5),
      ('motorway-junction', 13.0, 2.5, 1.0),
      ('road-exit-shield', 13.0, 2.0, 1.0),
      ('road-intersection', 12.0, 2.0, 1.0),
      ('road-oneway-arrow-blue', 11.0, 1.5, 0.5),
      ('bridge-label', 13.0, 2.5, 1.0),
      ('tunnel-label', 13.0, 2.5, 1.0),
    ];

    for (final (layerId, size, haloWidth, haloBlur) in roadLabelLayers) {
      try {
        if (!await map.style.styleLayerExists(layerId)) continue;
        // Bold text size
        await map.style.setStyleLayerProperty(layerId, 'text-size', size);
        // White halo for legibility over any background
        await map.style.setStyleLayerProperty(
          layerId,
          'text-halo-color',
          '#ffffff',
        );
        await map.style.setStyleLayerProperty(
          layerId,
          'text-halo-width',
          haloWidth,
        );
        await map.style.setStyleLayerProperty(
          layerId,
          'text-halo-blur',
          haloBlur,
        );
        // Dark text for contrast
        await map.style.setStyleLayerProperty(layerId, 'text-color', '#1a1a1a');
      } catch (e) {
        debugPrint(
          'TruckMapScreen: _enhanceRoadLabels failed for layer "$layerId": $e',
        );
      }
    }

    // Motorway labels: white text on the coloured shield background looks
    // better than dark text, so override colour for that layer only.
    try {
      if (await map.style.styleLayerExists('motorway-label')) {
        await map.style.setStyleLayerProperty(
          'motorway-label',
          'text-color',
          '#ffffff',
        );
        await map.style.setStyleLayerProperty(
          'motorway-label',
          'text-halo-color',
          '#003399',
        );
        await map.style.setStyleLayerProperty(
          'motorway-label',
          'text-halo-width',
          2.0,
        );
      }
    } catch (e) {
      debugPrint(
        'TruckMapScreen: _enhanceRoadLabels failed for motorway-label: $e',
      );
    }
  }

  /// Sets up the Mapbox GeoJSON POI source and style layers with smart
  /// clustering and zoom-based visibility, mirroring the flutter_map
  /// [_buildAllPoiMarkers] behaviour for the Mapbox SDK layer.
  ///
  /// Called from [_onStyleLoaded] after the Mapbox style finishes loading.
  /// Adds the following objects to the Mapbox style:
  ///
  ///   - `poi-source`        — clustered GeoJSON source (cluster at zoom ≤ 13.5)
  ///   - `poi-clusters`      — circle layer for cluster bubbles (zoom 10.5–13.5)
  ///   - `poi-cluster-count` — symbol layer for cluster count labels
  ///   - `poi-unclustered`   — symbol layer for individual POIs (zoom > 13.5)
  ///
  /// Zoom-based visibility matches [_buildAllPoiMarkers] / [_shouldUseClustersAtZoom]:
  ///   • zoom < 10.5  → all POI layers hidden
  ///   • zoom 10.5–13.5 → cluster bubbles only
  ///   • zoom > 13.5  → individual POI icons
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
      debugPrint(
        '[POI Audit] ${pois.length} POI(s) loaded from locations.json:',
      );
      for (var i = 0; i < pois.length; i++) {
        final p = pois[i];
        debugPrint('[POI Audit]   [$i] name="${p.name}"  icon="${p.icon}"');
      }
      // ─────────────────────────────────────────────────────────────────────

      // ── Log: breakdown of verified vs approximate POIs ──────────────────
      // All POIs are included in the Mapbox source — verified ones (entranceLat
      // present + verified=true) show a colored marker; approximate ones show
      // a grey marker.  No POIs are hidden due to missing entrance coordinates.
      final int verifiedCount = pois
          .where((p) => p.entranceLat != null && p.verified)
          .length;
      debugPrint(
        '[POI] ${pois.length} total POIs loaded; '
        '$verifiedCount verified (colored marker), '
        '${pois.length - verifiedCount} approximate (grey marker).',
      );

      // ── Diagnostic logging — verify dataset coverage ──────────────────────
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

      // 2. Add the GeoJSON source with clustering enabled.
      //    All POIs are included — verified ones (entranceLat + verified=true)
      //    are placed at their precise entrance coords; approximate POIs use
      //    property-centre lat/lng.  The `verified` GeoJSON property controls
      //    marker styling (colored vs grey) in the style layers.
      //    cluster: true       → Mapbox groups nearby features at low zoom levels.
      //    clusterMaxZoom: 13  → clusters dissolve above zoom 13.5 (individual
      //                          icons appear at minzoom 13.5 on the unclustered
      //                          layer, matching _poiClusterZoomThreshold).
      //    clusterRadius: 50   → pixel radius for grouping neighbours.
      //    minzoom: 10.5       → hides all POIs below _poiHideZoomThreshold.
      final Map<String, dynamic> geoJson = poisToGeoJson(pois);
      await map.style.addStyleSource(
        'poi-source',
        jsonEncode({
          'type': 'geojson',
          'data': geoJson,
          'cluster': true, // Enable Mapbox native clustering.
          'clusterMaxZoom': 13, // Clusters dissolve above zoom 13.5.
          'clusterRadius': 50, // Grouping radius in screen pixels.
          'minzoom': 10.5, // Hide source tiles below _poiHideZoomThreshold.
        }),
      );

      // 3. Cluster circle layer — visible at zoom 10.5–13.5.
      await map.style.addStyleLayer(
        jsonEncode({
          'id': 'poi-clusters',
          'type': 'circle',
          'source': 'poi-source',
          'filter': ['has', 'point_count'],
          'minzoom': 10.5, // _poiHideZoomThreshold
          'maxzoom': 14, // Just above _poiClusterZoomThreshold (13.5)
          'paint': {
            'circle-color': '#1E90FF',
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              16,
              10,
              22,
              50,
              28,
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          },
        }),
        null,
      );

      // 4. Cluster count label layer.
      await map.style.addStyleLayer(
        jsonEncode({
          'id': 'poi-cluster-count',
          'type': 'symbol',
          'source': 'poi-source',
          'filter': ['has', 'point_count'],
          'minzoom': 10.5, // _poiHideZoomThreshold
          'maxzoom': 14, // Just above _poiClusterZoomThreshold (13.5)
          'layout': {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 13,
          },
          'paint': {'text-color': '#ffffff'},
        }),
        null,
      );

      // 5. Individual POI icon layer — only visible above zoom 13.5.
      //    Matches _poiClusterZoomThreshold: never shows individual icons while
      //    clusters are active.  A coalesce expression falls back to
      //    'truck_parking' for any POI whose specific icon PNG is absent.
      await map.style.addStyleLayer(
        jsonEncode({
          'id': 'poi-unclustered',
          'type': 'symbol',
          'source': 'poi-source',
          'filter': [
            '!',
            ['has', 'point_count'],
          ],
          'minzoom': 13.5, // _poiClusterZoomThreshold
          'layout': {
            'icon-image': [
              'coalesce',
              [
                'image',
                ['get', 'icon'],
              ],
              ['image', 'truck_parking'],
            ],
            'icon-size': 1.2,
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

  // ── Route-only POI source + layer helpers ────────────────────────────────

  /// Ensures that the `route-pois-source` GeoJSON source and `route-pois-layer`
  /// symbol layer exist in the current Mapbox style.
  ///
  /// Called from [_onStyleLoaded] and defensively from
  /// [_refreshRoutePoiSourceIfNeeded] so they are created lazily if the style
  /// reloaded after initial setup.  The layer is configured with slightly
  /// larger icons than the browse `poi-unclustered` layer (icon-size 1.45 vs
  /// 1.2) and [icon-allow-overlap] true, because the source is already
  /// filtered down to ≤10 high-priority POIs.
  Future<void> _ensureRoutePoiSourceAndLayer() async {
    final mbx.MapboxMap? map = _mapboxMap;
    if (map == null) return;
    try {
      // Create the GeoJSON source with an initially-empty feature collection
      // if it does not exist yet.  Subsequent calls to
      // _refreshRoutePoiSourceIfNeeded will update the source data in-place.
      if (!await map.style.styleSourceExists(_routePoisSourceId)) {
        await map.style.addStyleSource(
          _routePoisSourceId,
          jsonEncode({
            'type': 'geojson',
            'data': {'type': 'FeatureCollection', 'features': []},
          }),
        );
      }

      // Create the symbol layer if it does not exist yet.
      if (!await map.style.styleLayerExists(_routePoisLayerId)) {
        await map.style.addStyleLayer(
          jsonEncode({
            'id': _routePoisLayerId,
            'type': 'symbol',
            'source': _routePoisSourceId,
            // Show only while navigating (minzoom 10 keeps markers hidden at
            // overview zoom levels where the browse cluster layer already
            // provides adequate context).
            'minzoom': 10,
            'layout': {
              // Prefer the POI-specific icon; fall back to the generic truck
              // parking icon so every feature always renders.
              'icon-image': [
                'coalesce',
                [
                  'image',
                  ['get', 'icon'],
                ],
                ['image', 'truck_parking'],
              ],
              // Slightly larger than the browse layer (1.2) so route-ahead
              // POIs stand out as visually prominent.
              'icon-size': 1.45,
              // Allow overlap because the list is already filtered to ≤10
              // high-priority POIs — clutter is controlled by filter rules,
              // not by Mapbox placement collision.
              'icon-allow-overlap': true,
              'icon-ignore-placement': false,
            },
          }),
          null,
        );
      }
    } catch (e) {
      debugPrint('TruckMapScreen: _ensureRoutePoiSourceAndLayer failed: $e');
    }
  }

  /// Returns `true` when the route-POI source should be refreshed.
  ///
  /// Refresh is needed when ANY of the following is true:
  ///   1. The source has never been refreshed (_lastRoutePoiRefreshAt is null).
  ///   2. The driver has advanced ≥ [_routePoiRefreshMilesThreshold] miles
  ///      since the last refresh.
  ///   3. At least [_routePoiMinRefreshInterval] has elapsed since the last
  ///      refresh AND the driver's position has changed at all.
  ///
  /// The method returns `false` while not navigating so the source is only
  /// populated during active navigation.
  bool _shouldRefreshRoutePois() {
    if (!_isLiveRouteAssistanceActive) return false;
    if (_lastRoutePoiRefreshAt == null) return true;

    final double progressDelta =
        (_currentRouteProgressMiles - _lastRoutePoiRefreshMiles).abs();
    if (progressDelta >= _routePoiRefreshMilesThreshold) return true;

    final Duration elapsed = DateTime.now().difference(_lastRoutePoiRefreshAt!);
    if (elapsed >= _routePoiMinRefreshInterval && progressDelta > 0)
      return true;

    return false;
  }

  /// Records that a route-POI refresh just completed.
  ///
  /// Updates [_lastRoutePoiRefreshAt] and [_lastRoutePoiRefreshMiles] to the
  /// current wall-clock time and route-progress miles respectively.
  void _markRoutePoiRefresh() {
    _lastRoutePoiRefreshAt = DateTime.now();
    _lastRoutePoiRefreshMiles = _currentRouteProgressMiles;
  }

  /// Builds the filtered list of up to [_routePoiMaxCount] high-priority POIs
  /// that are ahead of the driver on the active route.
  ///
  /// Selection rules (applied in order):
  ///   1. Prefer **verified** POIs (both [PoiItem.entranceLat] and
  ///      [PoiItem.entranceLng] set) over approximate ones.
  ///   2. Category quotas (ahead-of-truck only, sorted by distance):
  ///      • Up to [_routePoiTruckStopMax] truck stops.
  ///      • Up to [_routePoiWeighStationMax] weigh stations.
  ///      • Up to [_routePoiSafetyMax] safety/service POIs (rest areas, brake
  ///        check areas, ports of entry).
  ///   3. Hard cap of [_routePoiMaxCount] total.
  ///   4. A POI already within [_poiPassedThresholdMiles] of the driver is
  ///      considered passed and excluded.
  ///   5. POIs beyond [_poiRouteMaxAheadMiles] are excluded.
  ///
  /// Returns an empty list when not navigating or when no route / position is
  /// available.
  List<PoiItem> _buildRouteRelevantPois() {
    if (!_isLiveRouteAssistanceActive ||
        _truckPosition == null ||
        _routePoints.isEmpty ||
        _loadedPois.isEmpty) {
      return const [];
    }

    final LatLng pos = _truckPosition!;

    // Pre-filter: keep only POIs within the route corridor ahead of the truck.
    final List<LatLng> aheadPoints = _routePoints.sublist(
      _truckIndex.clamp(0, _routePoints.length),
    );
    final List<PoiItem> corridorCandidates = getPOIsOnRoute(
      _loadedPois,
      aheadPoints,
      proximityMeters: _poiRouteCorridorMeters,
    );

    // Score each candidate by straight-line distance ahead in miles.
    final List<_ScoredPoi> scored = [];
    for (final poi in corridorCandidates) {
      final double milesAhead = _distanceMiles(
        pos.latitude,
        pos.longitude,
        poi.displayLat,
        poi.displayLng,
      );
      if (milesAhead < _poiPassedThresholdMiles) continue; // Already passed.
      if (milesAhead > _poiRouteMaxAheadMiles) continue; // Too far ahead.
      scored.add(_ScoredPoi(poi, milesAhead));
    }

    // Sort: verified POIs first within each category; then by distance.
    // Verified = both entranceLat and entranceLng present.
    scored.sort((a, b) {
      final int vA = (a.poi.entranceLat != null && a.poi.entranceLng != null)
          ? 0
          : 1;
      final int vB = (b.poi.entranceLat != null && b.poi.entranceLng != null)
          ? 0
          : 1;
      if (vA != vB) return vA.compareTo(vB); // verified first
      return a.distanceMiles.compareTo(b.distanceMiles); // closer first
    });

    // Apply per-category quotas.
    int truckStopCount = 0;
    int weighStationCount = 0;
    int safetyCount = 0;
    const Set<String> safetyCategories = {
      'rest_area',
      'brake_check_area',
      'port_of_entry',
    };

    final List<PoiItem> result = [];
    for (final sp in scored) {
      if (result.length >= _routePoiMaxCount) break;
      final String cat = sp.poi.category;
      if (cat == 'truck_stop') {
        if (truckStopCount >= _routePoiTruckStopMax) continue;
        truckStopCount++;
      } else if (cat == 'weigh_station') {
        if (weighStationCount >= _routePoiWeighStationMax) continue;
        weighStationCount++;
      } else if (safetyCategories.contains(cat)) {
        if (safetyCount >= _routePoiSafetyMax) continue;
        safetyCount++;
      } else {
        // Other categories (gas_station, truck_parking, etc.) are skipped;
        // they are already visible in the browse poi-source cluster layer.
        continue;
      }
      result.add(sp.poi);
    }

    debugPrint(
      '[RoutePOI] ${result.length} route POIs selected '
      '(truckStops=$truckStopCount, weighStations=$weighStationCount, '
      'safety=$safetyCount) from ${scored.length} ahead-on-route '
      'candidates (${corridorCandidates.length} in corridor).',
    );
    return result;
  }

  /// Builds a GeoJSON FeatureCollection string from [pois].
  ///
  /// Each Feature carries `id`, `name`, `category`, and `icon` properties,
  /// matching the schema used by `poi-source` so the same registered Mapbox
  /// images work for both layers.
  String _routePoiSourceGeoJson(List<PoiItem> pois) {
    final features = pois
        .map(
          (poi) => {
            'type': 'Feature',
            'id': poi.id,
            'geometry': {
              'type': 'Point',
              'coordinates': [poi.displayLng, poi.displayLat],
            },
            'properties': {
              'id': poi.id,
              'name': poi.name,
              'category': poi.category,
              'icon': poi.icon,
            },
          },
        )
        .toList();
    return jsonEncode({'type': 'FeatureCollection', 'features': features});
  }

  /// Refreshes the `route-pois-source` with the current navigation-relevant
  /// POI list, subject to time/distance throttle rules.
  ///
  /// Pass `force: true` to bypass the throttle and always push a fresh update
  /// (used after reroutes, filter/settings changes, and nav start/stop).
  ///
  /// Skips the Mapbox API call when the filtered POI list is identical to the
  /// previously pushed list (same set of IDs), preventing unnecessary style
  /// updates even when the throttle permits a refresh.
  Future<void> _refreshRoutePoiSourceIfNeeded({bool force = false}) async {
    final mbx.MapboxMap? map = _mapboxMap;
    if (map == null) return;
    final int routeRevision = _activeRouteRevision;

    // Update the current route-progress counter before checking the throttle
    // so _shouldRefreshRoutePois() has an accurate value.
    if (_routePoints.isNotEmpty) {
      final routePts = _routePoints
          .map((p) => RoutePoint(lat: p.latitude, lng: p.longitude))
          .toList(growable: false);
      _currentRouteProgressMiles = _routeDistanceMilesBetweenIndices(
        routePts,
        0,
        _truckIndex.clamp(0, routePts.length - 1),
      );
    }

    if (!force && !_shouldRefreshRoutePois()) return;
    final int requestGeneration = ++_routePoiRequestGeneration;

    // Ensure source and layer exist (e.g. after a style reload).
    await _ensureRoutePoiSourceAndLayer();
    if (!mounted ||
        requestGeneration != _routePoiRequestGeneration ||
        routeRevision != _activeRouteRevision ||
        !identical(map, _mapboxMap)) {
      return;
    }

    final List<PoiItem> pois = _buildRouteRelevantPois();

    // Build a lightweight content hash to detect no-op updates.
    final List<String> sortedIds = pois.map((p) => p.id).toList()..sort();
    final String hash = sortedIds.join(',');
    if (!force && hash == _lastRoutePoiSourceHash) {
      // POI list unchanged — skip Mapbox update but still record the refresh
      // time/miles so the throttle window advances correctly.
      _markRoutePoiRefresh();
      debugPrint('[RoutePOI] Source unchanged (hash match) — skipping update.');
      return;
    }

    try {
      final String geoJson = _routePoiSourceGeoJson(pois);
      await map.style.setStyleSourceProperty(
        _routePoisSourceId,
        'data',
        geoJson,
      );
      if (!mounted ||
          requestGeneration != _routePoiRequestGeneration ||
          routeRevision != _activeRouteRevision ||
          !identical(map, _mapboxMap)) {
        return;
      }
      _lastRoutePoiSourceHash = hash;
      _markRoutePoiRefresh();
      debugPrint('[RoutePOI] Source updated with ${pois.length} POI(s).');
    } catch (e) {
      debugPrint('TruckMapScreen: _refreshRoutePoiSourceIfNeeded failed: $e');
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
    final RouteOption? selected = _routeOptions.isEmpty
        ? null
        : _routeOptions[_selectedRouteOptionIndex >= 0 &&
                  _selectedRouteOptionIndex < _routeOptions.length
              ? _selectedRouteOptionIndex
              : 0];
    final distanceLabel = _routePreviewActive
        ? _formatRemainingDistance(_tripProgressInfo.milesRemaining)
        : selected == null
        ? 'Truck route ready'
        : _formatRemainingDistance(selected.distanceMiles);
    final durationLabel = _routePreviewActive
        ? _formatDuration(_tripProgressInfo.durationRemaining.inSeconds)
        : selected == null
        ? ''
        : _formatDuration(selected.durationSeconds);
    final arrivalLabel = _fmtArrival(_tripProgressInfo);
    final arrivalZone = _tripProgressInfo.timezoneLabel.trim();

    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
          child: Material(
            color: Colors.transparent,
            child: Container(
              padding: const EdgeInsets.fromLTRB(12, 7, 12, 12),
              decoration: BoxDecoration(
                color: const Color(0xF9FFFFFF),
                borderRadius: BorderRadius.circular(22),
                border: Border.all(color: const Color(0xFFDCE3E9)),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x3D0B1420),
                    blurRadius: 24,
                    offset: Offset(0, 10),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      width: 42,
                      height: 4,
                      decoration: BoxDecoration(
                        color: const Color(0xFFCAD2DA),
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  InkWell(
                    borderRadius: BorderRadius.circular(13),
                    onTap: () => setState(
                      () => _previewPanelExpanded = !_previewPanelExpanded,
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 4,
                        vertical: 5,
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 38,
                            height: 38,
                            decoration: BoxDecoration(
                              color: const Color(0xFFE8F2FF),
                              borderRadius: BorderRadius.circular(11),
                            ),
                            child: const Icon(
                              Icons.alt_route_rounded,
                              color: Color(0xFF0B68E8),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  _routePreviewActive
                                      ? 'Live truck-route assistance'
                                      : _routeOptions.length > 1
                                      ? '${_routeOptions.length} truck routes ready'
                                      : 'Truck route ready',
                                  style: const TextStyle(
                                    color: SemiTrackColors.navy,
                                    fontSize: 14,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                const SizedBox(height: 1),
                                Text(
                                  durationLabel.isEmpty
                                      ? distanceLabel
                                      : '$distanceLabel  •  $durationLabel  •  ${selected?.label ?? ''}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Color(0xFF697586),
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 6),
                          Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                _previewPanelExpanded
                                    ? Icons.keyboard_arrow_down_rounded
                                    : Icons.keyboard_arrow_up_rounded,
                                color: SemiTrackColors.navy,
                              ),
                              Text(
                                _previewPanelExpanded ? 'Hide' : 'Routes',
                                style: const TextStyle(
                                  color: SemiTrackColors.navy,
                                  fontSize: 9,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_previewPanelExpanded) ...[
                    const SizedBox(height: 7),
                    _buildRouteAlternativesCard(),
                    if (_routeOptions.length >= 2) const SizedBox(height: 8),
                    _buildPreviewIntelligencePanel(),
                  ],
                  const SizedBox(height: 8),
                  if (!_routePreviewActive)
                    _buildStartNavigationButton()
                  else
                    Material(
                      color: SemiTrackColors.navy,
                      borderRadius: BorderRadius.circular(12),
                      child: InkWell(
                        key: const ValueKey('active_navigation_controls'),
                        onTap: () => unawaited(_showActiveNavigationMenu()),
                        borderRadius: BorderRadius.circular(12),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 9,
                          ),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.tune_rounded,
                                size: 22,
                                color: Colors.white,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Text(
                                      'Navigation controls',
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontSize: 13,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                    Text(
                                      'Quit or continue  •  Arrive $arrivalLabel${arrivalZone.isEmpty ? '' : ' $arrivalZone'}',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        color: Color(0xFFCAD7E5),
                                        fontSize: 10,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const Icon(
                                Icons.chevron_right_rounded,
                                color: Colors.white,
                              ),
                            ],
                          ),
                        ),
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

  /// Extracts all turn-by-turn navigation steps from [route].  ///
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
      // Highway exit number from the Mapbox `exits` field (e.g. "13", "13A").
      final rawExits = (step['exits'] as String?)?.trim();
      final stepExitNumber = (rawExits != null && rawExits.isNotEmpty)
          ? rawExits
          : null;
      return _NavStep(
        instruction,
        LatLng(lat, lng),
        maneuver: modifier,
        type: maneuverType,
        distanceMeters: distanceMeters,
        name: stepName,
        exitNumber: stepExitNumber,
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
    _cameraMode = NavigationCameraMode.overview;
    // Keep the full route above the preview controls instead of centering it
    // behind the bottom sheet. This is especially important for long-haul
    // routes where a generic 50 px inset can make the route appear as a short,
    // disconnected line near the origin.
    final bounds = LatLngBounds.fromPoints(points);
    _mapController.fitCamera(
      CameraFit.bounds(
        bounds: bounds,
        padding: EdgeInsets.fromLTRB(
          42,
          _isNavigating ? 92 : 72,
          42,
          _isNavigating ? 110 : 270,
        ),
        maxZoom: 13.5,
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
    if (!_navSettings.usesMetric) {
      final feet = meters * 3.28084;
      if (feet < 1000) return '${feet.round()} ft';
      final miles = meters / _metersPerMile;
      return '${miles.toStringAsFixed(miles < 10 ? 1 : 0)} mi';
    }
    // Close range: show exact metres for precision.
    if (meters < 200.0) return '${meters.toInt()} m';
    // Medium range: round to nearest 10 m to avoid jitter.
    if (meters < 1000.0) return '${(meters / 10).round() * 10} m';
    return '${(meters / 1000.0).toStringAsFixed(1)} km';
  }

  String _formatRemainingDistance(double miles) {
    if (!miles.isFinite || miles <= 0) {
      return _navSettings.usesMetric ? '0 km' : '0 mi';
    }
    final value = _navSettings.usesMetric ? miles * 1.609344 : miles;
    final unit = _navSettings.distanceUnit.shortLabel;
    if (value < 0.1) return '<0.1 $unit';
    return '${value.toStringAsFixed(value < 10 ? 1 : 0)} $unit';
  }

  /// Formats a distance in metres as a human-readable miles string for the
  /// road info card, e.g. "33.6 mi".
  String _formatDistanceMiles(double meters) {
    if (_navSettings.usesMetric) {
      final kilometers = meters / 1000.0;
      if (kilometers < 0.1) return '< 0.1 km';
      return '${kilometers.toStringAsFixed(kilometers < 10 ? 1 : 0)} km';
    }
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
    final nativeGuidanceActive =
        _nativeNavigationPhase == NativeNavigationPhase.navigating ||
        _nativeNavigationPhase == NativeNavigationPhase.rerouting;
    if (nativeGuidanceActive &&
        _distanceToNextManeuverMiles.isFinite &&
        _distanceToNextManeuverMiles >= 0 &&
        _distanceToNextManeuverMiles < 999) {
      return _distanceToNextManeuverMiles * _metersPerMile;
    }
    if (_navSteps.isEmpty) return 0.0;
    final safeIndex = _currentStepIndex.clamp(0, _navSteps.length - 1);
    // Point to the *upcoming* maneuver (one step ahead of the current step)
    // so the distance counts DOWN to zero as the driver approaches.
    // On the final step there is no further maneuver, so we measure the
    // remaining distance to the destination (the last step's location).
    final bool isLastStep = safeIndex >= _navSteps.length - 1;
    final int targetIndex = isLastStep ? safeIndex : safeIndex + 1;
    final upcomingStep = _navSteps[targetIndex];
    // Use the live truck position when available for real-time accuracy.
    if (_truckPosition != null) {
      return _distanceBetween(_truckPosition!, upcomingStep.location);
    }
    // Fallback: use the current step's stored distance before the first GPS fix.
    return _navSteps[safeIndex].distanceMeters;
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
            BoxShadow(color: Colors.black.withOpacity(0.18), blurRadius: 10),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Trip Stats',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
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
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
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
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
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
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
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
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
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
    final bool isImminent = distanceToNext < _imminentManeuverThresholdMeters;

    // Banner background color: green on arrival, urgency-based otherwise.
    final Color bannerColor = isArrived
        ? Colors.green.shade600
        : _getBannerColor(distanceToNext);

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
                    isArrived
                        ? Icons.check_circle
                        : _maneuverIcon(step.maneuver),
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
  /// [lanes] may be supplied directly from the route SDK. When omitted, lane
  /// guidance remains hidden rather than presenting invented recommendations.
  void _updateUpcomingManeuver({
    required String? maneuverType,
    required double distanceMiles,
    bool isHighwayManeuver = false,
    String? roadName,
    List<LaneInfo>? lanes,
  }) {
    final List<LaneInfo> resolvedLanes = lanes ?? const [];

    // Build junction-view snapshot when the maneuver warrants one.
    final JunctionViewData? newJunctionData =
        _maneuverNeedsJunctionView(maneuverType)
        ? _buildJunctionViewSnapshot(
            maneuverType: maneuverType!,
            distanceMiles: distanceMiles,
            roadName: roadName,
            resolvedLanes: resolvedLanes,
          )
        : null;

    setState(() {
      _nextManeuverType = maneuverType;
      _distanceToNextManeuverMiles = distanceMiles;
      _isHighwayManeuver = isHighwayManeuver;
      _upcomingManeuverStep = UpcomingManeuverStep(
        maneuverType: maneuverType,
        distanceMiles: distanceMiles,
        isHighwayManeuver: isHighwayManeuver,
        roadName: roadName,
        lanes: resolvedLanes,
      );
      _junctionViewData = newJunctionData;
    });
  }

  // ── Dynamic lane guidance helpers ─────────────────────────────────────────

  // ── Junction-view helpers ─────────────────────────────────────────────────

  /// Returns true when [maneuverType] is one of the complex interchange
  /// categories that warrant a junction-view overlay (exits, forks, merges).
  ///
  /// Junction view is reserved for highway-class complexity where a top-down
  /// intersection diagram provides genuine driver value.  Simple city turns
  /// are covered by the lane-guidance panel alone.
  bool _maneuverNeedsJunctionView(String? maneuverType) {
    if (maneuverType == null) return false;
    const supported = {'exit', 'fork', 'merge', 'off ramp', 'on ramp'};
    return supported.contains(maneuverType.toLowerCase());
  }

  /// Returns true when the junction-view overlay should be visible.
  ///
  /// Show threshold is 0.5 miles for highway junctions (exits/ramps) and
  /// 0.3 miles for city-level forks/merges — tighter than lane guidance so
  /// the card only appears when the driver is truly close to the junction.
  bool _shouldShowJunctionView(UpcomingManeuverStep? step) {
    if (step == null || !_maneuverNeedsJunctionView(step.maneuverType)) {
      return false;
    }
    final double threshold = step.isHighwayManeuver ? 0.5 : 0.3;
    return step.distanceMiles <= threshold;
  }

  /// Converts a [LaneDirection] value to the equivalent [LaneArrowType].
  LaneArrowType _laneDirectionToArrowType(LaneDirection direction) {
    switch (direction) {
      case LaneDirection.left:
        return LaneArrowType.left;
      case LaneDirection.slightLeft:
        return LaneArrowType.slightLeft;
      case LaneDirection.straight:
        return LaneArrowType.straight;
      case LaneDirection.slightRight:
        return LaneArrowType.slightRight;
      case LaneDirection.right:
        return LaneArrowType.right;
      case LaneDirection.uTurn:
        return LaneArrowType.uTurn;
    }
  }

  /// Builds a [JunctionViewData] snapshot from the supplied parameters.
  ///
  /// Called inside [_updateUpcomingManeuver] when [maneuverType] qualifies for
  /// a junction-view overlay.  Converts [LaneInfo] entries to [LaneGuidanceData]
  /// and derives road name labels from available context.
  JunctionViewData _buildJunctionViewSnapshot({
    required String maneuverType,
    required double distanceMiles,
    required String? roadName,
    required List<LaneInfo> resolvedLanes,
  }) {
    final List<LaneGuidanceData> jvLanes = resolvedLanes.map((lane) {
      return LaneGuidanceData(
        arrows: lane.directions.map(_laneDirectionToArrowType).toList(),
        isActive: lane.isRecommended,
      );
    }).toList();

    // Use the outgoing road name where available; fall back gracefully.
    final String outgoing = (roadName != null && roadName.trim().isNotEmpty)
        ? roadName.trim()
        : '';

    // Derive the incoming road name from the current nav step when possible.
    String incoming = '';
    if (_navSteps.isNotEmpty) {
      final safeIdx = _currentStepIndex.clamp(0, _navSteps.length - 1);
      final name = _navSteps[safeIdx].name;
      if (name.isNotEmpty) incoming = name;
    }

    return JunctionViewData(
      maneuverType: maneuverType,
      incomingRoadName: incoming,
      outgoingRoadName: outgoing,
      lanes: jvLanes,
      distanceMiles: distanceMiles,
    );
  }

  // ── Top instruction card helpers ─────────────────────────────────────────

  /// Maps a [ManeuverVisualType] to the best matching [IconData].
  ///
  /// Used by [_buildCompactTopInstructionCard] to render the maneuver icon.
  IconData _maneuverVisualIcon(ManeuverVisualType type) {
    switch (type) {
      case ManeuverVisualType.straight:
        return Icons.arrow_upward;
      case ManeuverVisualType.left:
        return Icons.turn_left;
      case ManeuverVisualType.slightLeft:
        return Icons.turn_slight_left;
      case ManeuverVisualType.right:
        return Icons.turn_right;
      case ManeuverVisualType.slightRight:
        return Icons.turn_slight_right;
      case ManeuverVisualType.uTurnLeft:
        return Icons.u_turn_left;
      case ManeuverVisualType.uTurnRight:
        return Icons.u_turn_right;
      case ManeuverVisualType.merge:
        return Icons.merge;
      case ManeuverVisualType.exit:
        return Icons.exit_to_app;
      case ManeuverVisualType.forkLeft:
        // call_split is used for both fork directions; the left/right
        // distinction is communicated by the primary text label.
        return Icons.call_split;
      case ManeuverVisualType.forkRight:
        return Icons.call_split;
      case ManeuverVisualType.roundabout:
        return Icons.roundabout_left;
    }
  }

  /// Formats [miles] into a human-readable distance string for the top card.
  ///
  /// Distances below 1 mile are shown in feet; all others in miles with one
  /// decimal place.  (This differs from [_formatDistanceMiles] which accepts
  /// metres.)
  String _formatMilesDisplay(double miles) {
    if (_navSettings.usesMetric) {
      final kilometers = miles * 1.609344;
      if (kilometers < 1) return '${(kilometers * 1000).round()} m';
      return '${kilometers.toStringAsFixed(kilometers < 10 ? 1 : 0)} km';
    }
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
    if (!_isBadRoadName(roadName)) return roadName!.trim();
    if (!_isBadRoadName(nextRoadName)) return nextRoadName!.trim();
    if (!_isBadRoadName(currentRoadName)) return currentRoadName!.trim();
    if (!_isBadRoadName(highwayName)) return highwayName!.trim();
    return '';
  }

  /// Maps a Mapbox maneuver type + modifier pair to a [ManeuverVisualType].
  ///
  /// Covers all common Mapbox maneuver type strings and falls back to
  /// [ManeuverVisualType.straight] for unknown combinations.
  ManeuverVisualType _mapStepToVisualType(
    String? maneuverType,
    String? modifier,
  ) {
    final type = (maneuverType ?? '').toLowerCase();
    final mod = (modifier ?? '').toLowerCase();

    if (type == 'merge') return ManeuverVisualType.merge;
    if (type == 'exit' || type == 'off ramp') return ManeuverVisualType.exit;
    if (type == 'roundabout') return ManeuverVisualType.roundabout;
    if (type == 'fork') {
      return mod.contains('left')
          ? ManeuverVisualType.forkLeft
          : ManeuverVisualType.forkRight;
    }
    if (type == 'turn') {
      if (mod.contains('uturn') && mod.contains('left'))
        return ManeuverVisualType.uTurnLeft;
      if (mod.contains('uturn') && mod.contains('right'))
        return ManeuverVisualType.uTurnRight;
      if (mod.contains('slight left')) return ManeuverVisualType.slightLeft;
      if (mod.contains('slight right')) return ManeuverVisualType.slightRight;
      if (mod.contains('left')) return ManeuverVisualType.left;
      if (mod.contains('right')) return ManeuverVisualType.right;
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
    required String? instruction,
    required String? roadName,
    required double distanceMiles,
    String? currentRoadName,
    String? nextRoadName,
    String? highwayName,
    String? exitNumber,
  }) {
    final fallbackRoadName = _resolveDisplayRoadName(
      roadName: roadName,
      currentRoadName: currentRoadName,
      highwayName: highwayName,
    );
    final guidance = buildStreetGuidanceText(
      maneuverType: maneuverType,
      modifier: modifier,
      instruction: instruction,
      roadName: fallbackRoadName,
      currentRoadName: currentRoadName,
      nextRoadName: nextRoadName,
    );

    setState(() {
      _topInstructionData = TopInstructionData(
        visualType: _mapStepToVisualType(maneuverType, modifier),
        primaryText: guidance.actionText,
        roadName: guidance.roadName,
        towardRoadName: guidance.towardRoadName,
        distanceMiles: distanceMiles,
        bottomChipText: null,
        exitNumber: exitNumber,
      );

      // Populate the compact "Then" card from the following route maneuver.
      final nextIdx = _currentStepIndex + 1;
      if (nextIdx < _navSteps.length) {
        final next = _navSteps[nextIdx];
        final secondaryGuidance = buildStreetGuidanceText(
          maneuverType: next.type,
          modifier: next.maneuver,
          instruction: next.instruction,
          roadName: next.nextRoadName ?? next.name,
          currentRoadName: next.currentRoadName,
          nextRoadName: _nextNamedRoadAfter(nextIdx),
        );
        _secondaryInstructionData = TopInstructionData(
          visualType: _mapStepToVisualType(next.type, next.maneuver),
          primaryText: secondaryGuidance.actionText,
          roadName: secondaryGuidance.roadName,
          towardRoadName: secondaryGuidance.towardRoadName,
          distanceMiles: next.distanceMeters / _metersPerMile,
          exitNumber: next.exitNumber,
        );
      } else {
        _secondaryInstructionData = null;
      }
    });
  }

  /// Maps a [LaneDirection] value to the [IconData] that best represents it.
  IconData _laneDirectionIcon(LaneDirection direction) {
    switch (direction) {
      case LaneDirection.left:
        return Icons.turn_left;
      case LaneDirection.slightLeft:
        return Icons.turn_slight_left;
      case LaneDirection.straight:
        return Icons.straight;
      case LaneDirection.slightRight:
        return Icons.turn_slight_right;
      case LaneDirection.right:
        return Icons.turn_right;
      case LaneDirection.uTurn:
        return Icons.u_turn_left;
    }
  }

  /// Builds a single lane tile for the dynamic lane guidance panel.
  ///
  /// Recommended lanes ([LaneInfo.isRecommended] == true) receive a blue
  /// background and a white border so they stand out immediately; non-
  /// recommended lanes use a dark-grey background.
  Widget _buildLaneBox(LaneInfo lane) {
    const Color recommendedColor = Color(0xFF1565C0); // blue 800
    const Color normalColor = Color(0xFF37474F); // blue-grey 800
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
            .map(
              (d) => Icon(_laneDirectionIcon(d), color: Colors.white, size: 26),
            )
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
    // Render only provider-supplied lane data. Explore assistance can display
    // it when present without claiming licensed HERE Navigate guidance.
    if (!_drivingUiActive) return const SizedBox.shrink();
    // Lane assist is hidden when disabled in navigation settings.
    if (!_navSettings.viewLaneAssist) return const SizedBox.shrink();

    final bool visible = _shouldShowLaneGuidance(_upcomingManeuverStep);

    return Positioned(
      // SafeArea below ensures lane guidance starts below the status bar.
      // top: 0 + internal SafeArea keeps it right below the system insets;
      // the SafeArea(bottom:false) wrapper adds the status-bar offset so the
      // content is naturally pushed below the compact next-step card (~90 px).
      top: 0,
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
                  child: Padding(
                    padding: const EdgeInsets.only(top: 184),
                    child: _buildDynamicLaneAssist(_upcomingManeuverStep!),
                  ),
                )
              : const SizedBox.shrink(key: ValueKey('laneGuidanceOff')),
        ),
      ),
    );
  }

  // ── Exit Preview / Junction View helpers and UI ───────────────────────────

  /// Returns true when [maneuverType] is an exit-style maneuver and the
  /// driver is within the 0.8-mile show threshold.
  bool _shouldShowExitPreview(String? maneuverType, double distanceMiles) {
    if (distanceMiles > 0.8) return false;
    final t = (maneuverType ?? '').toLowerCase();
    return t == 'exit' || t == 'off ramp' || t == 'ramp' || t == 'fork';
  }

  /// Builds an [ExitPreviewData] snapshot from the current navigation step
  /// data.  Returns null when the maneuver does not qualify or is too far away.
  ExitPreviewData? _buildExitPreviewData({
    required String? maneuverType,
    required String? modifier,
    required String? roadName,
    required String? exitNumber,
    required double distanceMiles,
  }) {
    if (!_shouldShowExitPreview(maneuverType, distanceMiles)) return null;
    final visualType = _mapStepToVisualType(maneuverType, modifier);
    final displayName = (roadName == null || roadName.trim().isEmpty)
        ? 'Upcoming exit'
        : roadName.trim();
    return ExitPreviewData(
      distanceMiles: distanceMiles,
      roadName: displayName,
      exitNumber: exitNumber,
      visualType: visualType,
      show: true,
    );
  }

  /// Refreshes [_exitPreviewData] from the current active navigation step.
  ///
  /// Should be called on every GPS tick while [_isNavigating] is true and
  /// whenever the step index advances.
  void _refreshExitPreview() {
    if (!_isLiveRouteAssistanceActive || _navSteps.isEmpty) {
      if (_exitPreviewData != null) setState(() => _exitPreviewData = null);
      return;
    }
    final safeIndex = _currentStepIndex.clamp(0, _navSteps.length - 1);
    final step = _navSteps[safeIndex];
    final distMeters = _distanceToNextStep();
    final distMiles = distMeters / _metersPerMile;

    final updated = _buildExitPreviewData(
      maneuverType: step.type,
      modifier: step.maneuver,
      roadName: step.name,
      exitNumber: step.exitNumber,
      distanceMiles: distMiles,
    );

    // Only call setState when the value has meaningfully changed to avoid
    // unnecessary rebuilds on every GPS tick.
    if (updated?.show != _exitPreviewData?.show ||
        updated?.roadName != _exitPreviewData?.roadName ||
        updated?.exitNumber != _exitPreviewData?.exitNumber ||
        (updated != null &&
            (updated.distanceMiles - (_exitPreviewData?.distanceMiles ?? 999.0))
                    .abs() >
                0.005)) {
      setState(() => _exitPreviewData = updated);
    }
  }

  /// Formats [miles] as a compact distance string suitable for the exit
  /// preview card header (e.g. "318 ft" or "0.6 mi").
  String _formatExitPreviewDistance(double miles) {
    if (_navSettings.usesMetric) {
      final kilometers = miles * 1.609344;
      if (kilometers < 1) return '${(kilometers * 1000).round()} m';
      return '${kilometers.toStringAsFixed(1)} km';
    }
    if (miles < (1.0 / 5.0)) {
      return '${(miles * 5280).round()} ft';
    }
    if (miles < 1.0) return '${(miles * 10).round() / 10} mi';
    return '${miles.toStringAsFixed(1)} mi';
  }

  /// Builds the stylised highway lane preview graphic shown in the lower half
  /// of the exit preview card.  Uses a [CustomPaint] to draw lane lines and
  /// a blue exit-ramp path.
  Widget _buildExitPreviewGraphic(ExitPreviewData data) {
    final bool exitRight =
        data.visualType != ManeuverVisualType.forkLeft &&
        data.visualType != ManeuverVisualType.left &&
        data.visualType != ManeuverVisualType.slightLeft;

    return SizedBox(
      height: 90,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // Lane lines background
          CustomPaint(painter: _ExitLanePainter(exitRight: exitRight)),
          // Exit sign block on the appropriate side
          Positioned(
            top: 10,
            right: exitRight ? 8 : null,
            left: exitRight ? null : 8,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFF16A34A),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(color: Colors.white, width: 1.5),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if ((data.exitNumber ?? '').isNotEmpty)
                    Text(
                      'Exit ${data.exitNumber}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0.5,
                      ),
                    ),
                  Text(
                    data.roadName.length > 16
                        ? '${data.roadName.substring(0, 14)}…'
                        : data.roadName,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 10,
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

  /// Builds the Exit Preview / Junction View overlay card.
  ///
  /// Returns [SizedBox.shrink] when there is no active exit preview data.
  Widget _buildExitPreviewCard() {
    final data = _exitPreviewData;
    if (data == null || !data.show) return const SizedBox.shrink();

    final bool urgent = data.distanceMiles <= 0.3;

    return Container(
      width: 300,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.5),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── Green header ─────────────────────────────────────────────────
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            color: urgent ? const Color(0xFF15803D) : const Color(0xFF16A34A),
            child: Row(
              children: [
                // Maneuver icon
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    _maneuverVisualIcon(data.visualType),
                    color: Colors.white,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 10),
                // Distance countdown
                Expanded(
                  child: Text(
                    _formatExitPreviewDistance(data.distanceMiles),
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: urgent ? 22 : 20,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.5,
                    ),
                  ),
                ),
                // Exit number chip
                if ((data.exitNumber ?? '').isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      data.exitNumber!,
                      style: const TextStyle(
                        color: Color(0xFF15803D),
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          // Road name bar
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            color: const Color(0xFF14532D),
            child: Text(
              data.roadName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          // ── Lane graphic ─────────────────────────────────────────────────
          Container(
            color: const Color(0xFF1E293B),
            child: _buildExitPreviewGraphic(data),
          ),
        ],
      ),
    );
  }
  // ── Junction View ─────────────────────────────────────────────────────────

  /// Maps a [LaneArrowType] value to the best matching [IconData].
  IconData _junctionArrowIcon(LaneArrowType type) {
    switch (type) {
      case LaneArrowType.left:
        return Icons.turn_left;
      case LaneArrowType.slightLeft:
        return Icons.turn_slight_left;
      case LaneArrowType.straight:
        return Icons.straight;
      case LaneArrowType.slightRight:
        return Icons.turn_slight_right;
      case LaneArrowType.right:
        return Icons.turn_right;
      case LaneArrowType.uTurn:
        return Icons.u_turn_left;
      case LaneArrowType.none:
        return Icons.straight;
    }
  }

  /// Builds a single lane tile for the junction-view diagram.
  ///
  /// Active (recommended) lanes are highlighted in blue with a border;
  /// non-active lanes use a dark-grey background.
  Widget _buildJunctionLaneTile(LaneGuidanceData lane) {
    const Color activeColor = Color(0xFF1565C0); // blue 800
    const Color inactiveColor = Color(0xFF37474F); // blue-grey 800
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 2),
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 5),
      decoration: BoxDecoration(
        color: lane.isActive ? activeColor : inactiveColor,
        borderRadius: BorderRadius.circular(7),
        border: lane.isActive
            ? Border.all(color: Colors.blueAccent, width: 1.5)
            : Border.all(color: Colors.white24, width: 0.5),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: lane.arrows
            .map(
              (a) => Icon(_junctionArrowIcon(a), color: Colors.white, size: 16),
            )
            .toList(),
      ),
    );
  }

  /// Compact junction-view overlay card shown in the top-right area of the
  /// map when the driver is approaching a complex exit, fork, or merge.
  ///
  /// Displays a lane diagram with color-coded arrows so the driver can see
  /// which lane to take without looking away from the road.
  ///
  /// Visibility rules:
  ///  - Only shown during active navigation ([_isNavigating] == true).
  ///  - Gated by [NavSettingsModel.viewJunctionView].
  ///  - Maneuver type must be an exit, fork, or merge.
  ///  - Driver must be within 0.5 mi (highway) or 0.3 mi (city) of junction.
  ///
  /// Returns [SizedBox.shrink] at zero cost when conditions are not met.
  Widget _buildJunctionView() {
    if (!_drivingUiActive) return const SizedBox.shrink();
    if (!_navSettings.viewJunctionView) return const SizedBox.shrink();

    final bool visible = _shouldShowJunctionView(_upcomingManeuverStep);

    return Positioned(
      // top: 130 positions the card below the satellite toggle (top:74 + 48 + 8)
      // so it never overlaps the compass or satellite buttons.
      top: 236,
      right: 16,
      child: SafeArea(
        bottom: false,
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 250),
          transitionBuilder: (child, animation) =>
              FadeTransition(opacity: animation, child: child),
          child: (visible && _junctionViewData != null)
              ? _buildJunctionViewCard(
                  _junctionViewData!,
                  key: const ValueKey('junctionViewOn'),
                )
              : const SizedBox.shrink(key: ValueKey('junctionViewOff')),
        ),
      ),
    );
  }

  /// Renders the actual junction-view card content for [data].
  ///
  /// Extracted from [_buildJunctionView] so the [AnimatedSwitcher] child is
  /// a stable, keyed widget.
  Widget _buildJunctionViewCard(JunctionViewData data, {Key? key}) {
    final String distStr = _formatMilesDisplay(data.distanceMiles);
    return Container(
      key: key,
      width: 148,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.88),
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [
          BoxShadow(
            color: Colors.black45,
            blurRadius: 10,
            offset: Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // ── Header: junction icon + distance ──────────────────────────────
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.call_split, color: Colors.blueAccent, size: 13),
              const SizedBox(width: 4),
              Text(
                'JUNCTION  $distStr',
                style: const TextStyle(
                  color: Colors.white70,
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.6,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          // ── Lane diagram ──────────────────────────────────────────────────
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: data.lanes.map(_buildJunctionLaneTile).toList(),
          ),
          // ── Outgoing road name ────────────────────────────────────────────
          if (data.outgoingRoadName.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              data.outgoingRoadName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ── Floating Dashboard Panel ───────────────────────────────────────────────

  /// Builds the collapsible floating dashboard panel shown in the idle/planning
  /// state (no destination selected, no route loaded, not navigating).
  ///
  /// Collapsed: shows a destination hint and provider HOS state.
  /// Expanded: shows provider HOS/fuel cards plus quick-action chips.
  ///
  /// Hidden during active navigation ([_isNavigating] == true) so the driver's
  /// view is not cluttered during a live trip.
  Widget _buildFloatingDashboard() {
    final colorScheme = Theme.of(context).colorScheme;
    return Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
          decoration: BoxDecoration(
            color: colorScheme.surface.withOpacity(0.99),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(26)),
            boxShadow: const [
              BoxShadow(
                color: Color(0x3D101820),
                blurRadius: 24,
                offset: Offset(0, -6),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 42,
                height: 4,
                decoration: BoxDecoration(
                  color: colorScheme.onSurface.withOpacity(0.16),
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              const SizedBox(height: 12),
              Material(
                color: colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(17),
                child: InkWell(
                  onTap: () => _showDestinationSearch(),
                  borderRadius: BorderRadius.circular(17),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(15, 8, 6, 8),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.search_rounded,
                          color: SemiTrackColors.orange,
                          size: 28,
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Text(
                            'Set destination for truck routes',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Speak destination',
                          onPressed: _startVoiceDestinationSearch,
                          icon: const Icon(
                            Icons.mic_rounded,
                            color: SemiTrackColors.orange,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              GridView.count(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisCount: 4,
                childAspectRatio: 1.03,
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                children: [
                  _placeQuickAction(
                    Icons.restaurant_rounded,
                    'Truck Stops',
                    const Color(0xFFE8583E),
                    () => _showLivePlaceCategory('truck_stop', 'Truck Stops'),
                  ),
                  _placeQuickAction(
                    Icons.scale_rounded,
                    'Weigh Stations',
                    const Color(0xFF008F7D),
                    () => _showLivePlaceCategory(
                      'weigh_station',
                      'Weigh Stations',
                    ),
                  ),
                  _placeQuickAction(
                    Icons.local_parking_rounded,
                    'Parking',
                    const Color(0xFF0B68E8),
                    () => _showLivePlaceCategory(
                      'truck_parking',
                      'Truck Parking',
                    ),
                  ),
                  _placeQuickAction(
                    Icons.local_gas_station_rounded,
                    'Truck Fuel',
                    const Color(0xFFFF8A00),
                    () => _showLivePlaceCategory(
                      'truck_stop',
                      'Truck Fuel & Stops',
                    ),
                  ),
                  _placeQuickAction(
                    Icons.park_rounded,
                    'Rest Areas',
                    const Color(0xFF0A9FC1),
                    () => _showLivePlaceCategory('rest_area', 'Rest Areas'),
                  ),
                  _placeQuickAction(
                    Icons.storefront_rounded,
                    'Walmarts',
                    const Color(0xFF146DE0),
                    () => _showLivePlaceCategory('walmart_store', 'Walmarts'),
                  ),
                  _placeQuickAction(
                    Icons.local_car_wash_rounded,
                    'Truck Washes',
                    const Color(0xFF008F7D),
                    () => _showLivePlaceCategory('truck_wash', 'Truck Washes'),
                  ),
                  _placeQuickAction(
                    Icons.more_horiz_rounded,
                    'More',
                    const Color(0xFF7189AC),
                    _showMoreMapFeaturesSheet,
                  ),
                ],
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(
                    Icons.verified_user_rounded,
                    size: 14,
                    color: SemiTrackColors.green,
                  ),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      _isLoadingLivePois
                          ? 'Refreshing real HERE places near your GPS position…'
                          : 'Live provider places • approximate Walmart pins hidden',
                      style: TextStyle(
                        fontSize: 10,
                        color: colorScheme.onSurface.withOpacity(0.58),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _placeQuickAction(
    IconData icon,
    String label,
    Color color,
    VoidCallback onTap,
  ) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(15),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 3),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 47,
              height: 47,
              decoration: BoxDecoration(
                color: color,
                borderRadius: BorderRadius.circular(13),
                boxShadow: [
                  BoxShadow(
                    color: color.withOpacity(0.24),
                    blurRadius: 7,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
              child: Icon(icon, color: Colors.white, size: 27),
            ),
            const SizedBox(height: 6),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
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
            style: const TextStyle(fontSize: 12, color: Colors.black54),
          ),
        ],
      ),
    );
  }

  /// Builds a quick-action chip used inside [_buildFloatingDashboard].
  ///
  /// Tapping the chip provides ink-splash feedback.  The [onTap] callback
  /// is optional; when omitted the chip is still visually interactive.
  Widget _dashboardActionChip(
    IconData icon,
    String label, {
    VoidCallback? onTap,
  }) {
    return Material(
      color: const Color(0xFFF0E9F9),
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
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
  /// Positioned on the left edge of the map, centered vertically.
  Widget _buildClosestTruckStopsRow() {
    if (!_isLiveRouteAssistanceActive) return const SizedBox.shrink();
    // Gate: hidden when POI Ahead is disabled in nav settings.
    if (!_navSettings.viewPoiAhead) return const SizedBox.shrink();
    if (_closestTruckStopsAhead.isEmpty) return const SizedBox.shrink();

    // Derive a direction label from the current maneuver for the first chip.
    final String dirLabel = _poiDirectionLabel();

    return Positioned(
      left: 12,
      top: 0,
      bottom: 0,
      child: SafeArea(
        child: Align(
          alignment: Alignment.centerLeft,
          child: ClosestTruckStopsRow(
            stops: _closestTruckStopsAhead,
            directionLabel: dirLabel,
          ),
        ),
      ),
    );
  }

  /// Derives a compact direction label shown above the first POI chip.
  ///
  /// Uses the current navigation step's maneuver to produce a short arrow
  /// indicator (e.g. "↑ AHEAD", "→ RIGHT", "← LEFT").  Falls back to
  /// "↑ AHEAD" when no maneuver data is available.
  String _poiDirectionLabel() {
    if (_navSteps.isEmpty) return '↑ AHEAD';
    final int safeIndex = _currentStepIndex.clamp(0, _navSteps.length - 1);
    final step = _navSteps[safeIndex];
    switch (step.maneuver) {
      case 'left':
      case 'sharp left':
      case 'slight left':
        return '← LEFT';
      case 'right':
      case 'sharp right':
      case 'slight right':
        return '→ RIGHT';
      case 'uturn':
        return '↩ U-TURN';
      default:
        return '↑ AHEAD';
    }
  }

  /// Returns the current road name pill placed below the navigation card.
  ///
  /// Shows the name of the road the driver is **currently on** (sourced from
  /// [_navSteps][_currentStepIndex].name) as a high-contrast dark-background
  /// pill with large bold white text.  Returns [SizedBox.shrink] when the road
  /// name is unavailable or empty so the layout remains clean.
  ///
  /// This is an inline widget (not [Positioned]) intended to be used inside
  /// the maneuver-card [Column].
  Widget _buildCurrentRoadNameLabel() {
    if (!_drivingUiActive || _navSteps.isEmpty) return const SizedBox.shrink();
    final safeIndex =
        (_liveRoadName == null ? _currentStepIndex : _liveRoadStepIndex).clamp(
          0,
          _navSteps.length - 1,
        );
    final step = _navSteps[safeIndex];
    final String roadName = (_liveRoadName ?? step.name).trim();
    if (roadName.isEmpty || roadName.toLowerCase() == 'unnamed road') {
      return const SizedBox.shrink();
    }
    final _HighwayShield? shield = _parseHighwayShield(roadName);

    return Container(
      constraints: const BoxConstraints(maxWidth: 220),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.88),
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(
            color: Colors.black54,
            blurRadius: 10,
            offset: Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          if (shield != null) ...[
            _buildHighwayShieldWidget(shield, fontSize: 12),
            const SizedBox(width: 6),
          ],
          Flexible(
            child: Text(
              roadName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.2,
                shadows: [
                  Shadow(
                    color: Colors.black87,
                    blurRadius: 4,
                    offset: Offset(0, 1),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Shows the road matched to the latest GPS fix while the user is viewing a
  /// route preview. Tapping it switches the map from full-route overview to a
  /// close follow view, making real movement visible on long routes.
  Widget _buildCurrentRoadNameBadge() {
    final roadName = _liveRoadName?.trim() ?? '';
    if (_isLiveRouteAssistanceActive ||
        _routePoints.isEmpty ||
        roadName.isEmpty) {
      return const SizedBox.shrink();
    }
    final shield = _parseHighwayShield(roadName);
    return Positioned(
      top: _gpsStale ? 88 : 12,
      left: 16,
      right: 112,
      child: SafeArea(
        bottom: false,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: _onRecenterPressed,
            borderRadius: BorderRadius.circular(16),
            child: Ink(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: const Color(0xED132231),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white24),
                boxShadow: const [
                  BoxShadow(
                    color: Colors.black38,
                    blurRadius: 8,
                    offset: Offset(0, 3),
                  ),
                ],
              ),
              child: Row(
                children: [
                  if (shield != null) ...[
                    _buildHighwayShieldWidget(shield, fontSize: 11),
                    const SizedBox(width: 9),
                  ] else ...[
                    const Icon(Icons.route, color: Color(0xFFFF6B35), size: 22),
                    const SizedBox(width: 9),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          roadName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const Text(
                          'LIVE ROAD  •  TAP TO FOLLOW GPS',
                          style: TextStyle(
                            color: Color(0xFFB9C6D3),
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.45,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(
                    Icons.gps_fixed,
                    color: Color(0xFF42A5F5),
                    size: 19,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
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
    final _HighwayShield? currentShield = _parseHighwayShield(currentRoad);
    final _HighwayShield? nextShield = nextRoad.isNotEmpty
        ? _parseHighwayShield(nextRoad)
        : null;

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
                      style: TextStyle(color: Colors.white70, fontSize: 14),
                    ),
                    const SizedBox(height: 2),
                    // Current road name with optional highway shield
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        if (currentShield != null) ...[
                          _buildHighwayShieldWidget(
                            currentShield,
                            fontSize: 13,
                          ),
                          const SizedBox(width: 8),
                        ],
                        Expanded(
                          child: Text(
                            currentRoad,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 22,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
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
                      // Next road chip with optional shield
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white24,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (nextShield != null) ...[
                              _buildHighwayShieldWidget(
                                nextShield,
                                fontSize: 10,
                              ),
                              const SizedBox(width: 6),
                            ],
                            Flexible(
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
              _navAlerts[idx] = _navAlerts[idx].copyWith(
                isExpanded: !_navAlerts[idx].isExpanded,
              );
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
        border: Border.all(color: accent.withOpacity(0.9), width: 1.3),
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
            child: Icon(Icons.air, color: accent, size: 22),
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
              child: const Icon(Icons.close, color: Colors.white70, size: 18),
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
        color: Colors.black.withValues(alpha: 0.86),
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
  ///   • Provider speed limit when available; otherwise an unknown badge.
  ///   • Red text + red border when the driver exceeds the speed limit.
  ///   • Orange border + "GPS" warning label when [_gpsStale] is true.
  ///
  /// "--" is shown when speed data is unavailable (cold start or signal loss).
  Widget _buildSpeedPanel() {
    // Convert m/s → mph; show "--" when speed is unavailable (stale or cold).
    final bool speedAvailable = _currentSpeedMps >= 0 && !_gpsStale;
    final double speedMph = speedAvailable ? _currentSpeedMps * _mpsToMph : 0.0;
    final String speedLabel = speedAvailable
        ? speedMph.toStringAsFixed(0)
        : '--';
    // Overspeed flag: only active when we have a valid speed reading.
    final bool overLimit =
        speedAvailable && _speedLimitMph > 0 && speedMph > _speedLimitMph;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.black87,
        borderRadius: BorderRadius.circular(10),
        // Orange border on GPS signal loss; red border when over speed limit.
        border: _gpsStale
            ? Border.all(color: Colors.orange, width: 2)
            : overLimit
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
          // ── GPS signal-loss indicator ─────────────────────────────────────
          if (_gpsStale)
            const Padding(
              padding: EdgeInsets.only(bottom: 4),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.gps_off, color: Colors.orange, size: 12),
                  SizedBox(width: 3),
                  Text(
                    'GPS',
                    style: TextStyle(
                      color: Colors.orange,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          // ── Current speed ─────────────────────────────────────────────────
          // Red text when over the limit; orange when stale; white otherwise.
          Text(
            speedLabel,
            style: TextStyle(
              color: _gpsStale
                  ? Colors.orange
                  : overLimit
                  ? Colors.red
                  : Colors.white,
              fontSize: 28,
              fontWeight: FontWeight.bold,
              height: 1.0,
            ),
          ),
          const Text(
            'mph',
            style: TextStyle(color: Colors.white70, fontSize: 11),
          ),
          const SizedBox(height: 6),
          // ── Speed-limit badge ─────────────────────────────────────────────
          // Styled like a US road speed-limit sign: white background, black
          // text, "LIMIT" caption above the numeric value.
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
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
                  _speedLimitMph > 0 ? _speedLimitMph.toStringAsFixed(0) : '--',
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
      appBar: _drivingUiActive
          ? null
          : AppBar(
              toolbarHeight: 66,
              backgroundColor: SemiTrackColors.navy,
              foregroundColor: Colors.white,
              title: Row(
                children: [
                  const SemiTrackWordmark(compact: true),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _selectedDestinationName ??
                          _activeTruckProfile?.name ??
                          'Truck route planner',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              actions: [
                IconButton(
                  tooltip: 'Search destination',
                  icon: const Icon(Icons.search_rounded),
                  onPressed: () => _showDestinationSearch(),
                ),
                IconButton(
                  tooltip: _navSettings.audioMode == 0
                      ? 'Turn GPS voice on'
                      : 'Mute GPS voice',
                  icon: Icon(
                    _navSettings.audioMode == 0
                        ? Icons.volume_off_rounded
                        : Icons.volume_up_rounded,
                  ),
                  onPressed: _toggleVoiceMute,
                ),
                IconButton(
                  tooltip: 'Map and navigation settings',
                  icon: const Icon(Icons.tune_rounded),
                  onPressed: _showMoreMapFeaturesSheet,
                ),
              ],
            ),
      body: SafeArea(
        // Apply top inset only during navigation (when AppBar is hidden and
        // the Stack fills the full screen height from the top).  When the
        // AppBar is visible the Scaffold already positions the body below it,
        // so enabling `top` would add redundant padding.
        top: _drivingUiActive,
        child: Column(
          children: [
            // ── Mapbox map widget (flutter_map) ──────────────────────────────
            Expanded(
              flex: 2,
              child: Stack(
                children: [
                  FlutterMap(
                    mapController: _mapController,
                    options: MapOptions(
                      initialCenter:
                          _truckPosition ?? const LatLng(39.5, -98.35),
                      initialZoom: 6,
                      minZoom: _minimumMapZoom,
                      maxZoom: _maximumMapZoom,
                      interactionOptions: const InteractionOptions(
                        flags: InteractiveFlag.all,
                      ),
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
                        if (event is MapEventMoveEnd ||
                            event is MapEventScrollWheelZoom) {
                          _scheduleRoadFeatureRefresh();
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
                            ? _navSettings.mapType == 1
                                  ? 'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}'
                                        '?access_token=$_mapboxToken'
                                  : 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}'
                                        '?access_token=$_mapboxToken'
                            : _navSettings.mapType == 1
                            ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                            : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                        userAgentPackageName: 'com.semitrack.mobile',
                      ),
                      GestureDetector(
                        onTap: _handleRoutePolylineTap,
                        child: PolylineLayer<int>(
                          hitNotifier: _routeHitNotifier,
                          // A generous touch target lets a driver select a
                          // thin alternative reliably without zooming in.
                          minimumHitbox: 18,
                          polylines: [
                            // ── Alternative routes (gray, behind selected) ──────
                            for (int i = 0; i < _routeOptions.length; i++)
                              if (i != _selectedRouteOptionIndex &&
                                  _routeOptions[i].points.isNotEmpty)
                                Polyline<int>(
                                  points: _routeOptions[i].points,
                                  strokeWidth: 5,
                                  color: Colors.blueGrey.shade300.withOpacity(
                                    0.65,
                                  ),
                                  strokeJoin: StrokeJoin.round,
                                  strokeCap: StrokeCap.round,
                                  hitValue: i,
                                ),
                            // ── Selected route: dark casing + crisp blue core ─────
                            if (_routePoints.isNotEmpty)
                              Polyline<int>(
                                points: _routePoints,
                                strokeWidth: 10,
                                color: const Color(0xCC12324A),
                                strokeJoin: StrokeJoin.round,
                                strokeCap: StrokeCap.round,
                              ),
                            if (_routePoints.isNotEmpty)
                              Polyline<int>(
                                points: _routePoints,
                                strokeWidth: 6,
                                color: const Color(0xFF168BE8),
                                strokeJoin: StrokeJoin.round,
                                strokeCap: StrokeCap.round,
                                hitValue: _selectedRouteOptionIndex,
                              ),
                            // ── Restriction overlays on selected route (red) ────
                            for (final seg in _buildRestrictionSegments(
                              _routePoints,
                            ))
                              Polyline<int>(
                                points: seg,
                                strokeWidth: 7,
                                color: Colors.red.shade700,
                                strokeJoin: StrokeJoin.round,
                                strokeCap: StrokeCap.round,
                              ),
                          ],
                        ),
                      ),
                      // ── Road-label overlay ────────────────────────────────
                      // Renders road names/numbers on a transparent background
                      // so they always appear above the blue route polyline.
                      // Uses dark labels on satellite view, light labels on
                      // standard map, ensuring readability in both modes.
                      TileLayer(
                        urlTemplate: _navSettings.mapType == 1
                            ? 'https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png'
                            : 'https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png',
                        userAgentPackageName: 'com.semitrack.mobile',
                      ),
                      MarkerLayer(
                        // _buildTruckMarker() + _buildDestinationMarker() are
                        // _buildMarkers() assembles the truck marker, the optional
                        // destination pin, and all visible truck stop POI markers
                        // into a single list.  Adding new POI types in the future
                        // only requires updating _buildMarkers() in one place.
                        markers: _buildMarkers(),
                      ),
                      if (_roadFeatures.isNotEmpty)
                        const SimpleAttributionWidget(
                          source: Text(
                            'OpenStreetMap contributors',
                            style: TextStyle(fontSize: 9),
                          ),
                          backgroundColor: Color(0xCCFFFFFF),
                        ),
                    ],
                  ),
                  if (_isLoading) _buildRouteLoadingOverlay(),
                  // ── Navigation banner ─────────────────────────────────────
                  // Shown in route-preview / arrival state (not during active
                  // turn-by-turn navigation – the compact next-step card takes
                  // that role to keep the top zone minimal).
                  if (_isArrived && _navSteps.isNotEmpty)
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
                  // ── Exit Preview / Junction View card ─────────────────────
                  // Shown top-center during exit/ramp/fork maneuvers when
                  // within 0.8 mi.  Returns SizedBox.shrink() otherwise.
                  if (_isLiveRouteAssistanceActive &&
                      _exitPreviewData != null &&
                      (_exitPreviewData?.show ?? false))
                    Positioned(
                      top: 168,
                      left: 0,
                      right: 0,
                      child: SafeArea(
                        bottom: false,
                        child: Center(child: _buildExitPreviewCard()),
                      ),
                    ),
                  // ── Junction-view card ────────────────────────────────────
                  // Compact top-right lane diagram shown when the driver is
                  // within 0.5 mi (highway) / 0.3 mi (city) of a complex
                  // exit, fork, or merge.  Returns SizedBox.shrink() when
                  // conditions are not met, so it is zero-cost otherwise.
                  _buildJunctionView(),
                  // ── Floating dashboard panel ───────────────────────────────
                  // Shown in the idle state (no destination selected, no route,
                  // not navigating) as a collapsible planning and status panel.
                  // Hidden once the driver picks a destination, starts a route,
                  // or begins active navigation so it never overlaps planning UI.
                  if (!_drivingUiActive &&
                      !_isArrived &&
                      !_isLoading &&
                      _routePoints.isEmpty &&
                      _selectedDestination == null)
                    _buildFloatingDashboard(),
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
                      !_drivingUiActive &&
                      !_isLoading)
                    _buildPreviewBottomPanel(),
                  if (_routePoints.isNotEmpty &&
                      !_drivingUiActive &&
                      !_isLoading)
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
                      top: _drivingUiActive
                          ? 176
                          : (_navSteps.isNotEmpty ? 90 : 68),
                      left: 0,
                      right: 0,
                      child: _buildRestrictionAlertCard(),
                    ),
                  // ── Warning popup stack ───────────────────────────────────
                  // Stacked top-right cards for road-hazard warning signs along
                  // the active route.  Only visible during active navigation.
                  // Anchored to the right edge with SafeArea so it never sits
                  // behind the status bar or notch in any orientation.
                  if (_isLiveRouteAssistanceActive)
                    Positioned(
                      top: 0,
                      bottom: 0,
                      right: 8,
                      child: SafeArea(
                        child: Align(
                          alignment: Alignment.topRight,
                          child: Padding(
                            // 176 px below the safe-area top keeps the stack
                            // clear of the primary nav card (~160 px tall).
                            padding: const EdgeInsets.only(top: 176),
                            child: WarningPopupStack(manager: _warningManager),
                          ),
                        ),
                      ),
                    ),
                  // ── Warning sign alert banner ─────────────────────────────
                  // Shown when a truck safety warning sign is within
                  // _warningAlertRadiusMeters of the truck's position on the
                  // active route.  Colour-coded by severity (red/orange/blue).
                  if (_hasActiveDestination && _warningAhead != null)
                    Positioned(
                      top: () {
                        int offset = _drivingUiActive
                            ? 176
                            : (_navSteps.isNotEmpty ? 90 : 68);
                        if (_restrictionAhead != null) offset += 64;
                        return offset.toDouble();
                      }(),
                      left: 0,
                      right: 0,
                      child: _buildWarningAlertBanner(),
                    ),
                  // ── Physical road-control approach alert ─────────────────
                  if (_roadFeatureAhead != null &&
                      (_isNavigating || _routePreviewActive))
                    Positioned(
                      top: () {
                        int offset = _drivingUiActive
                            ? 176
                            : (_navSteps.isNotEmpty ? 90 : 68);
                        if (_restrictionAhead != null) offset += 64;
                        if (_warningAhead != null) offset += 64;
                        return offset.toDouble();
                      }(),
                      left: 0,
                      right: 0,
                      child: _buildRoadFeatureAlertBanner(),
                    ),
                  // ── Active leg card ───────────────────────────────────────
                  // Shows the current leg (from → to, miles, duration,
                  // restriction count) when navigating a multi-stop trip.
                  if (!_drivingUiActive) _buildCurrentLegCard(),
                  // ── Leg breakdown FAB ─────────────────────────────────────
                  // Opens the full trip leg breakdown sheet during navigation.
                  if (!_drivingUiActive) _buildLegBreakdownButton(),
                  // ── Smart restriction rerouting progress banner ───────────
                  // Shown as an overlay at the top of the map while an
                  // automatic avoid-restriction reroute is in progress.
                  if (_hasActiveDestination && _isRestrictionRerouting)
                    _buildRestrictionRerouteBanner(),
                  // ── Recenter FAB ──────────────────────────────────────────
                  // Always visible in the bottom-right corner.
                  // Tap: returns to live follow mode.
                  // Long-press: switches to full-route overview mode.
                  Positioned(
                    bottom: _drivingUiActive ? 164 : 16,
                    right: 16,
                    child: _buildRecenterButton(),
                  ),
                  // ── Rerouting status indicator ────────────────────────────
                  // Shown in the centre of the map while a new route is being
                  // fetched from the driver's live position to the destination.
                  if (_navStatus != null)
                    Positioned(
                      bottom: _drivingUiActive ? 104 : 16,
                      left: 0,
                      right: 0,
                      child: Center(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 20,
                            vertical: 10,
                          ),
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
                  if (!_drivingUiActive &&
                      _hasActiveDestination &&
                      _tripStartTime != null)
                    _buildTripStatsPanel(),
                  // ── Zone 1: live current/incoming street guidance header ──
                  if (_isLiveRouteAssistanceActive &&
                      _topInstructionData != null)
                    Positioned(
                      top: 0,
                      left: 0,
                      right: 0,
                      child: SafeArea(
                        bottom: false,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _buildStreetGuidanceHeader(_topInstructionData!),
                            if (_secondaryInstructionData != null &&
                                _navSettings.viewJunctionView)
                              Align(
                                alignment: Alignment.centerLeft,
                                child: Padding(
                                  padding: const EdgeInsets.only(
                                    left: 16,
                                    top: 8,
                                  ),
                                  child: _buildSecondaryThenCard(
                                    _secondaryInstructionData!,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ), // ── Zone 1a (top-right): compass / re-centre button ────────
                  // Round dark button at the top-right corner — always top-right.
                  _buildSmallCompassButton(),
                  // ── Zone 1c (top-right, below compass): satellite toggle ───
                  // Toggles between street and satellite tile layers.
                  _buildSatelliteToggle(),
                  // ── Zone 3: upcoming route-safety alerts ──────────────────
                  // These builders require active navigation. Prefer the richer
                  // route-ahead feed and fall back to native navigation alerts.
                  if (_isLiveRouteAssistanceActive && _upcomingAlerts.isEmpty)
                    _buildRightSideAlertStack(),
                  if (_isLiveRouteAssistanceActive)
                    _buildRightSideUpcomingAlerts(),
                  // ── Zone 4 (right edge, centered): voice + speed panel ──────
                  // Voice-mute toggle above the compact speed panel, anchored to
                  // the right edge and centered vertically.  Replaces the old
                  // bottom-center-right speed panel position.
                  _buildRightCenterPanel(),
                  // ── Zone 5b: next two commercial truck stops ──────────────
                  // Compact vertical cards expose only marker, exit, and miles;
                  // tapping a card opens the complete commercial-stop sheet.
                  _buildTruckStopAheadRail(),
                  // ── Zone 5c: road name and speed near the truck ─────────
                  // Keep these high-value driving facts just above the trip
                  // strip, matching the familiar commercial GPS layout.
                  if (_drivingUiActive && _navSettings.viewSpeedLimit)
                    Positioned(
                      left: 12,
                      bottom: 88 + _drivingBottomCardLift,
                      child: SafeArea(
                        top: false,
                        child: _buildCompactSpeedPanel(),
                      ),
                    ),
                  if (_drivingUiActive)
                    Positioned(
                      left: 112,
                      right: 112,
                      bottom: 91 + _drivingBottomCardLift,
                      child: SafeArea(
                        top: false,
                        child: Center(child: _buildCurrentRoadNameLabel()),
                      ),
                    ),
                  // ── Zone 5 (bottom-left): trip summary strip ──────────────
                  // Dark translucent card with remaining mi, time, ETA,
                  // More button, and compact Stop icon.
                  if (_drivingUiActive)
                    Positioned(
                      left: 12,
                      right: 12,
                      bottom: 12 + _drivingBottomCardLift,
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
                  // ── Zone 6c: next two rest areas ────────────────────────
                  // These remain visible and tappable during navigation so a
                  // driver can inspect parking and live facility activity.
                  _buildClosestRestAreasRow(),
                  // ── Zone 6b (bottom-left, above strip): shortcut bar ─────
                  // Quick-action shortcut buttons for features the driver has
                  // enabled in the More > Shortcut settings section.
                  if (!_drivingUiActive) _buildShortcutBar(),
                  // ── Zone 7 (bottom-center): current road/highway name badge ─
                  // Compact pill showing the name of the road or highway the
                  // driver is currently on.  Sits between the bottom trip strip
                  // (left) and the speed panel (right), matching the layout of
                  // popular GPS apps.  Updates automatically as the driver
                  // advances to each new route step.
                  if (!_drivingUiActive) _buildCurrentRoadNameBadge(),
                  // ── GPS signal-loss banner ────────────────────────────────
                  // Shown across the top of the map whenever the GPS watchdog
                  // declares the position stream stale (no fix for ≥ 10 s).
                  // The banner is dismissible by the driver but reappears if
                  // the GPS remains silent so it serves as a persistent warning.
                  if (_gpsStale &&
                      (!_drivingUiActive ||
                          (_restrictionAhead == null &&
                              _warningAhead == null &&
                              _roadFeatureAhead == null)))
                    Positioned(
                      // Do not cover the live maneuver header. If a provider
                      // safety alert already owns the alert lane, the compact
                      // speed panel still carries the orange GPS indicator.
                      top: _drivingUiActive ? 172 : 0,
                      left: 0,
                      right: 0,
                      child: SafeArea(
                        bottom: false,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 6,
                          ),
                          child: Material(
                            color: Colors.transparent,
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 10,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(0xEE1A1A1A),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: Colors.orange.shade600,
                                  width: 1.5,
                                ),
                              ),
                              child: Row(
                                children: [
                                  Icon(
                                    Icons.gps_off,
                                    color: Colors.orange.shade400,
                                    size: 18,
                                  ),
                                  const SizedBox(width: 10),
                                  const Expanded(
                                    child: Text(
                                      'GPS signal lost — speed and position may be out of date',
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontSize: 13,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
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
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
                child: Container(
                  padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        children: [
                          Icon(
                            Icons.error_outline_rounded,
                            size: 18,
                            color: Theme.of(
                              context,
                            ).colorScheme.onErrorContainer,
                          ),
                          const SizedBox(width: 9),
                          Expanded(
                            child: Text(
                              _error!,
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onErrorContainer,
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: 'Dismiss message',
                            visualDensity: VisualDensity.compact,
                            onPressed: () => setState(() {
                              _error = null;
                              _locationRecoveryAction = null;
                            }),
                            icon: Icon(
                              Icons.close_rounded,
                              size: 18,
                              color: Theme.of(
                                context,
                              ).colorScheme.onErrorContainer,
                            ),
                          ),
                        ],
                      ),
                      if (_locationRecoveryAction != null)
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton.icon(
                            onPressed: _isAcquiringGpsFix
                                ? null
                                : _handleLocationRecovery,
                            icon: const Icon(
                              Icons.my_location_rounded,
                              size: 17,
                            ),
                            label: Text(_locationRecoveryLabel),
                          ),
                        ),
                    ],
                  ),
                ),
              ),

            // ── Route info + Phase 5 intelligence ────────────────────────────
            // Hidden during active navigation (_isNavigating) so Route Summary,
            // Drive Intelligence, and other planning cards do not block the map.
            if (!_drivingUiActive &&
                (_hasActiveDestination || _isArrived) &&
                _routeData != null)
              Expanded(flex: 1, child: _buildRouteInfo(_routeData!)),
          ],
        ),
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
    final driveMinutesLeft = _intelligence['driveMinutesLeft'] as int?;
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
                        fontWeight: FontWeight.bold,
                        fontSize: 18,
                      ),
                    ),
                    const Spacer(),
                    if (provider.isNotEmpty)
                      Chip(label: Text(provider), padding: EdgeInsets.zero),
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
                    'Tolls',
                    '\$${(tollsUsd as num).toStringAsFixed(2)}',
                  ),
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
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
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
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 8),
                  for (final w in warnings)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 2),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.warning_amber,
                            size: 18,
                            color: Colors.orange,
                          ),
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
                          color: Colors.red,
                        ),
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
                          const Icon(
                            Icons.error_outline,
                            size: 16,
                            color: Colors.red,
                          ),
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
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    const Spacer(),
                    if (_navSteps.isNotEmpty)
                      Text(
                        'Step ${_currentStepIndex + 1}/${_navSteps.length}',
                        style: const TextStyle(
                          fontSize: 12,
                          color: Colors.grey,
                        ),
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
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
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
  // ── GPS-style navigation overlay widgets ────────────────────────────────────

  /// Parses [roadName] into a structured [_HighwayShield] when it matches a
  /// known highway pattern.  Returns `null` for non-highway names.
  ///
  /// Recognised patterns:
  ///   Interstate  — "I-5", "I-90"
  ///   US Highway  — "US-1", "US-101"
  ///   State/Provincial — "CA-1", "TX-35", "SR-520", "BC-99", etc.
  _HighwayShield? _parseHighwayShield(String roadName) {
    final trimmed = roadName.trim();
    // Interstate
    final interstate = RegExp(
      r'\b(?:I|Interstate)\s*-?\s*(\d{1,3}[A-Z]?)\b',
      caseSensitive: false,
    );
    var m = interstate.firstMatch(trimmed);
    if (m != null) {
      return _HighwayShield(_HighwayShieldType.interstate, m.group(1)!);
    }
    // US Highway
    final us = RegExp(
      r'\b(?:US|U\.S\.)\s*-?\s*(\d{1,3}[A-Z]?)\b',
      caseSensitive: false,
    );
    m = us.firstMatch(trimmed);
    if (m != null) {
      return _HighwayShield(_HighwayShieldType.usHighway, m.group(1)!);
    }
    // State / Provincial Highway — two-letter code followed by hyphen + number,
    // or generic SR/SH/Hwy prefix.  Two capture groups are used:
    //   group(1)/group(2) — for "XX-nnn" patterns (e.g. "CA-1", "TX-35")
    //   group(3)/group(4) — for "SR/SH/Hwy nnn" patterns (e.g. "SR-520")
    // stateCode uses the actual matched prefix so the sign label is accurate.
    final state = RegExp(
      r'\b([A-Z]{2})\s*-\s*(\d{1,3}[A-Z]?)\b|\b(SR|SH|Hwy)\s*-?\s*(\d{1,3}[A-Z]?)\b',
      caseSensitive: false,
    );
    m = state.firstMatch(trimmed);
    if (m != null) {
      final prefix = (m.group(1) ?? m.group(3) ?? 'ST').toUpperCase();
      final number = m.group(2) ?? m.group(4) ?? '';
      return _HighwayShield(
        _HighwayShieldType.stateHighway,
        number,
        stateCode: prefix,
      );
    }
    return null;
  }

  /// Backwards-compatible helper: returns just the route number string, or
  /// `null` when [roadName] is not a recognisable highway reference.
  String? _extractHighwayShield(String roadName) =>
      _parseHighwayShield(roadName)?.number;

  /// Renders an official-style highway shield widget for [shield].
  ///
  /// Shape and colours follow US/Canadian signage conventions:
  ///   • Interstate  — blue shield with red top-band and white text.
  ///   • US Highway  — black pentagon with white number and "US" label.
  ///   • State/Prov  — green rectangle with white route number.
  Widget _buildHighwayShieldWidget(
    _HighwayShield shield, {
    double fontSize = 11,
  }) {
    switch (shield.type) {
      case _HighwayShieldType.interstate:
        // Classic blue/red Interstate shield
        return CustomPaint(
          size: Size(fontSize * 3.2, fontSize * 3.8),
          painter: _InterstateShieldPainter(shield.number, fontSize: fontSize),
        );
      case _HighwayShieldType.usHighway:
        // Black pentagon US Highway sign
        return CustomPaint(
          size: Size(fontSize * 3.2, fontSize * 3.6),
          painter: _UsHighwayShieldPainter(shield.number, fontSize: fontSize),
        );
      case _HighwayShieldType.stateHighway:
        // Green rounded-rectangle state sign
        return Container(
          padding: EdgeInsets.symmetric(
            horizontal: fontSize * 0.55,
            vertical: fontSize * 0.25,
          ),
          decoration: BoxDecoration(
            color: const Color(0xFF1A7340),
            borderRadius: BorderRadius.circular(fontSize * 0.4),
            border: Border.all(color: Colors.white, width: 1.5),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                shield.stateCode ?? 'ST',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: fontSize * 0.7,
                  fontWeight: FontWeight.w700,
                  height: 1,
                ),
              ),
              Text(
                shield.number,
                style: TextStyle(
                  color: Colors.white,
                  fontSize: fontSize,
                  fontWeight: FontWeight.w900,
                  height: 1,
                ),
              ),
            ],
          ),
        );
    }
  }

  /// Full-width live street header matching commercial GPS guidance layouts.
  ///
  /// The first line combines the maneuver action and the road being travelled;
  /// the second line names the incoming route street. The live-region semantic
  /// causes accessibility services to announce the change without stealing
  /// focus from the map controls.
  Widget _buildStreetGuidanceHeader(TopInstructionData data) {
    final action = data.primaryText.trim();
    final road = data.roadName.trim();
    final headline = [action, road].where((part) => part.isNotEmpty).join(' ');
    final towardRoad = data.towardRoadName?.trim();
    final semanticLabel = [
      headline,
      if (towardRoad != null && towardRoad.isNotEmpty) 'toward $towardRoad',
    ].join(', ');
    final distanceLabel = _formatDistance(_distanceToNextStep());
    final exitNumber = data.exitNumber?.trim();

    final cardWidth = (MediaQuery.sizeOf(context).width * 0.68)
        .clamp(250.0, 326.0)
        .toDouble();

    return Align(
      alignment: Alignment.topLeft,
      child: Semantics(
        liveRegion: true,
        label: '$semanticLabel, $distanceLabel',
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 220),
          child: Container(
            key: ValueKey<String>('$semanticLabel|$exitNumber'),
            width: cardWidth,
            margin: const EdgeInsets.fromLTRB(12, 10, 0, 0),
            padding: const EdgeInsets.fromLTRB(13, 13, 13, 14),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xF7161618), Color(0xF72C2C2F)],
              ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: Colors.white24),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x70000000),
                  blurRadius: 14,
                  offset: Offset(0, 5),
                ),
              ],
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  _maneuverVisualIcon(data.visualType),
                  color: Colors.white,
                  size: 52,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        action.isEmpty ? 'Continue' : action,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFFB9B9BD),
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        road.isEmpty ? 'Truck route' : road,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 25,
                          fontWeight: FontWeight.w900,
                          height: 1.02,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(height: 9),
                      Text(
                        distanceLabel,
                        maxLines: 1,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 29,
                          fontWeight: FontWeight.w900,
                          height: 1,
                        ),
                      ),
                      if (exitNumber != null &&
                          exitNumber.isNotEmpty &&
                          _navSettings.viewExit) ...[
                        const SizedBox(height: 9),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 11,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFF079447),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            'EXIT $exitNumber',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ] else if (towardRoad != null &&
                          towardRoad.isNotEmpty) ...[
                        const SizedBox(height: 7),
                        Text(
                          'toward $towardRoad',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(0xFFD7DCE2),
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
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
      ),
    );
  }

  /// GPS-style primary maneuver card shown at the top-left of the map
  /// during active navigation.
  ///
  /// Displays:
  ///  • Maneuver direction icon tile on the left.
  ///  • Instruction verb (primaryText), road name, and large distance to next
  ///    maneuver stacked on the right.
  ///  • Green exit-number chip when [data.exitNumber] is available.
  Widget _buildPrimaryManeuverCard(TopInstructionData data) {
    return Container(
      width: 128,
      padding: const EdgeInsets.fromLTRB(10, 9, 10, 10),
      decoration: BoxDecoration(
        // Dark opaque background for maximum instruction readability.
        color: Colors.black.withOpacity(0.85),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          // ── "Next turn" micro-label ──────────────────────────────────────
          Text(
            'NEXT TURN',
            style: TextStyle(
              color: Colors.white.withOpacity(0.60),
              fontSize: 9,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.9,
              height: 1,
            ),
          ),
          const SizedBox(height: 6),
          // ── Direction arrow — bare icon, no background box ───────────────
          Icon(
            _maneuverVisualIcon(data.visualType),
            color: Colors.white,
            size: 42,
          ),
          const SizedBox(height: 6),
          // ── Action verb (e.g. "Head out") ────────────────────────────────
          Text(
            data.primaryText,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white.withOpacity(0.88),
              fontSize: 11,
              fontWeight: FontWeight.w600,
              height: 1.2,
            ),
          ),
          const SizedBox(height: 4),
          // ── Large bold distance ──────────────────────────────────────────
          // Use live distance-to-next-step so this value updates in real time
          // as the driver advances along the current maneuver segment.
          Text(
            _formatMilesDisplay(_distanceToNextStep() / _metersPerMile),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
              height: 1,
            ),
          ),
          // ── Green exit chip (optional) ───────────────────────────────────
          if ((data.exitNumber ?? '').trim().isNotEmpty &&
              _navSettings.viewExit) ...[
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
              decoration: BoxDecoration(
                color: const Color(0xFF22C55E),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.turn_slight_right,
                    color: Colors.white,
                    size: 11,
                  ),
                  const SizedBox(width: 3),
                  Text(
                    data.exitNumber!,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (data.roadName.isNotEmpty) ...[
            const SizedBox(height: 6),
            // ── Road name ────────────────────────────────────────────────
            Text(
              data.roadName,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
                fontWeight: FontWeight.w700,
                height: 1.2,
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// Small secondary "Then" chip shown below [_buildPrimaryManeuverCard].
  ///
  /// Displays a "Then" label, the next maneuver icon, and the road name for
  /// the step after the current upcoming turn.
  Widget _buildSecondaryThenCard(TopInstructionData data) {
    final exitNumber = data.exitNumber?.trim();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        // Dark opaque background to match the primary maneuver card.
        color: Colors.black.withOpacity(0.85),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'Then',
            style: TextStyle(
              color: Colors.white.withOpacity(0.60),
              fontSize: 11,
            ),
          ),
          const SizedBox(width: 5),
          Icon(
            _maneuverVisualIcon(data.visualType),
            color: Colors.white,
            size: 15,
          ),
          const SizedBox(width: 3),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 130),
            child: Text(
              data.roadName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: Colors.white.withOpacity(0.85),
                fontSize: 11,
              ),
            ),
          ),
          const SizedBox(width: 7),
          Text(
            _formatMilesDisplay(data.distanceMiles),
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 10,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (exitNumber != null &&
              exitNumber.isNotEmpty &&
              _navSettings.viewExit) ...[
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFF0A8F4D),
                borderRadius: BorderRadius.circular(5),
              ),
              child: Text(
                'EXIT $exitNumber',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ],
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

    final String milesStr = _formatRemainingDistance(milesLeft);
    final String timeStr = _fmtDuration(timeLeft);
    final String etaStr = _fmtArrival(_tripProgressInfo);
    final String arrivalLabel = _tripProgressInfo.timezoneLabel.isEmpty
        ? 'arrival'
        : 'arrival ${_tripProgressInfo.timezoneLabel}';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.97),
        borderRadius: BorderRadius.circular(17),
        boxShadow: const [
          BoxShadow(
            color: Color(0x40000000),
            blurRadius: 14,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: Image.asset(
              'assets/images/semitrax_app_icon.png',
              width: 48,
              height: 48,
              fit: BoxFit.cover,
              filterQuality: FilterQuality.high,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Flexible(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          milesStr,
                          style: const TextStyle(
                            color: Color(0xFF172049),
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ),
                    Container(
                      width: 1,
                      height: 21,
                      margin: const EdgeInsets.symmetric(horizontal: 8),
                      color: const Color(0xFFB6BAC5),
                    ),
                    Flexible(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          timeStr,
                          style: const TextStyle(
                            color: Color(0xFF172049),
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  '$etaStr  •  $arrivalLabel',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF747B91),
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 7),
          Semantics(
            button: true,
            label: 'More navigation controls',
            child: Material(
              color: const Color(0xFFE9EBF0),
              borderRadius: BorderRadius.circular(12),
              child: InkWell(
                onTap: _showMoreMapFeaturesSheet,
                borderRadius: BorderRadius.circular(12),
                child: const SizedBox(
                  width: 48,
                  height: 48,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.keyboard_arrow_up_rounded,
                        color: Color(0xFF59617B),
                        size: 20,
                      ),
                      Text(
                        'More',
                        style: TextStyle(
                          color: Color(0xFF59617B),
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
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
          style: const TextStyle(color: Colors.white54, fontSize: 10),
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
    final bool speedAvailable = _currentSpeedMps >= 0 && !_gpsStale;
    final double speedMph = speedAvailable ? _currentSpeedMps * _mpsToMph : 0.0;
    final String speedLabel = speedAvailable
        ? speedMph.round().toString()
        : '--';
    final double truckLimit = _getTruckSpeedLimit(_speedLimitMph);
    final bool isOver =
        speedAvailable && truckLimit > 0 && speedMph > truckLimit;

    return Container(
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.97),
        borderRadius: BorderRadius.circular(13),
        border: Border.all(
          color: _gpsStale ? Colors.orange : const Color(0xFF172049),
          width: _gpsStale ? 2 : 1.5,
        ),
        boxShadow: const [
          BoxShadow(color: Colors.black45, blurRadius: 8, offset: Offset(0, 3)),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 44,
            height: 53,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: const Color(0xFF172049), width: 2),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  truckLimit > 0 ? truckLimit.round().toString() : '--',
                  style: const TextStyle(
                    color: Color(0xFF172049),
                    fontSize: 21,
                    fontWeight: FontWeight.w900,
                    height: 1,
                  ),
                ),
                const Text(
                  'LIMIT',
                  style: TextStyle(
                    color: Color(0xFF172049),
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 7),
          SizedBox(
            width: 42,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_gpsStale)
                  const Icon(Icons.gps_off, color: Colors.orange, size: 15),
                Text(
                  speedLabel,
                  style: TextStyle(
                    color: _gpsStale
                        ? Colors.orange
                        : isOver
                        ? Colors.red
                        : const Color(0xFF0864C9),
                    fontSize: 25,
                    fontWeight: FontWeight.w900,
                    height: 1,
                  ),
                ),
                const Text(
                  'MPH',
                  style: TextStyle(
                    color: Color(0xFF172049),
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
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

  /// Right-edge panel: zoom and voice controls, centered vertically.
  ///
  /// Only visible during active navigation.  The voice button toggles audio
  /// between Muted (0), Alert-Only (1), and Unmuted (2) in a cycle.
  Widget _buildRightCenterPanel() {
    final showNavigationControls = _isNavigating || _routePreviewActive;
    final IconData voiceIcon = switch (_navSettings.audioMode) {
      0 => Icons.volume_off,
      1 => Icons.volume_down,
      _ => Icons.volume_up,
    };
    return Positioned(
      right: 16,
      top: 0,
      bottom: 0,
      child: SafeArea(
        child: Align(
          alignment: Alignment.centerRight,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildMapZoomControls(),
              if (showNavigationControls) ...[
                const SizedBox(height: 12),
                // ── Voice toggle button ──────────────────────────────────
                GestureDetector(
                  onTap: _toggleVoiceMute,
                  child: Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: Colors.black.withOpacity(0.72),
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.28),
                          blurRadius: 8,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                    child: Icon(voiceIcon, color: Colors.white, size: 24),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

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
        color: const Color(0xEE22232A),
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
                  style: const TextStyle(color: Colors.white70, fontSize: 12),
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
  /// Uses [_distanceToNextStep] for the live maneuver distance.
  Widget _buildCompactNextStepCard() {
    // Only show during active navigation with available steps.
    if (!_isNavigating || _navSteps.isEmpty) return const SizedBox.shrink();

    // Clamp index to avoid out-of-bounds access on step list changes.
    final int safeIndex = _currentStepIndex.clamp(0, _navSteps.length - 1);
    final _NavStep step = _navSteps[safeIndex];

    // Format the live distance-to-next-step in a human-readable string.
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
              Icon(_maneuverIcon(step.maneuver), color: Colors.white, size: 28),
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

    // During navigation the full-width street header owns the top edge, so the
    // compass moves below it instead of obscuring the incoming-street text.
    final bool guidanceVisible =
        _isLiveRouteAssistanceActive && _topInstructionData != null;

    return Positioned(
      top: guidanceVisible ? 120 : 18,
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
    final bool guidanceVisible =
        _isLiveRouteAssistanceActive && _topInstructionData != null;
    return Positioned(
      top: guidanceVisible ? 176 : 74,
      right: 16,
      child: SafeArea(
        bottom: false,
        child: GestureDetector(
          onTap: () => setState(() {
            _isSatelliteView = !_isSatelliteView;
            _navSettings.mapType = _isSatelliteView ? 1 : 0;
          }),
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
              child: Icon(Icons.satellite_alt, color: Colors.white, size: 24),
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
  /// [_navAlerts] is populated from route-matched safety providers.
  Widget _buildRightSideAlertStack() {
    if (!_isLiveRouteAssistanceActive || _navAlerts.isEmpty) {
      return const SizedBox.shrink();
    }

    // Show at most 3 alerts to avoid cluttering the map viewport.
    final visibleAlerts = _navAlerts.take(3).toList();

    return Positioned(
      left: 12,
      // Keep safety cards below the current and "Then" maneuver headers.
      top: _routeSafetyAlertTop,
      child: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
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
  /// Displays an en dash only when a provider did not supply route distance.
  Widget _smallRightAlert(NavigationAlert alert) {
    // Map alert type to a recognisable Material icon.
    IconData alertIcon;
    Color alertColor;
    switch (alert.type) {
      case AlertType.weighStation:
        alertIcon = Icons.monitor_weight_outlined;
        alertColor = const Color(0xFFF57C00); // amber
        break;
      case AlertType.truckParking:
        alertIcon = Icons.local_parking;
        alertColor = const Color(0xFF1976D2);
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

    final String distText = alert.distanceMiles != null
        ? _formatRemainingDistance(alert.distanceMiles!)
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
    return _formatRemainingDistance(distance);
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

    return Semantics(
      button: true,
      label: '${item.label}, $distanceText ahead. Tap for details.',
      child: Material(
        color: Colors.black.withOpacity(0.84),
        elevation: 4,
        shadowColor: Colors.black45,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => _showUpcomingAlertDetails(item),
          child: Container(
            constraints: const BoxConstraints(minWidth: 112, maxWidth: 165),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: accent.withOpacity(0.95), width: 1.4),
              boxShadow: [
                BoxShadow(
                  color: accent.withOpacity(0.18),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
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
          ),
        ),
      ),
    );
  }

  void _showUpcomingAlertDetails(UpcomingAlertItem item) {
    NavigationAlert? alert;
    for (final candidate in _navAlerts) {
      if (candidate.id == item.sourceAlertId) {
        alert = candidate;
        break;
      }
    }
    final detail = alert;
    final accent = _upcomingAlertAccent(item.type);
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Row(
          children: [
            Icon(_upcomingAlertIcon(item.type), color: accent),
            const SizedBox(width: 10),
            Expanded(child: Text(detail?.title ?? item.label)),
          ],
        ),
        content: Text(
          [
            '${_formatChipDistance(item.distanceMiles)} ahead',
            if ((detail?.roadName ?? '').trim().isNotEmpty)
              'Road: ${detail!.roadName!.trim()}',
            if ((detail?.subtitle ?? '').trim().isNotEmpty)
              detail!.subtitle!.trim(),
            if ((detail?.message ?? '').trim().isNotEmpty)
              detail!.message!.trim(),
            if ((detail?.suggestedAction ?? '').trim().isNotEmpty)
              'Driver action: ${detail!.suggestedAction!.trim()}',
          ].join('\n\n'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Close'),
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
    if (!_isLiveRouteAssistanceActive || _upcomingAlerts.isEmpty) {
      return const SizedBox.shrink();
    }

    return Positioned(
      // Keep the nearest route hazards in a stable left-side rail below the
      // maneuver header, matching established commercial GPS scan patterns.
      top: _routeSafetyAlertTop,
      left: 12,
      child: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
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

  /// Compact vertical rail of the next commercial truck stops shown directly
  /// below the maneuver guidance during active navigation.
  ///
  /// Only visible when navigating and at least one ahead-stop is available.
  ///
  /// [_closestTruckStopsAhead] is refreshed from route-matched POIs on GPS
  /// updates.
  Widget _buildTruckStopAheadRail() {
    if (!_drivingUiActive ||
        !_navSettings.viewPoiAhead ||
        _closestTruckStopsAhead.isEmpty) {
      return const SizedBox.shrink();
    }

    return Positioned(
      left: 12,
      // Keep commercial fuel/truck-stop cards close to the trip summary so
      // weigh stations and rest areas retain the higher safety-priority lane.
      bottom: 170 + _drivingBottomCardLift,
      child: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: _closestTruckStopsAhead.take(2).map((ahead) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _truckStopAheadChip(ahead),
            );
          }).toList(),
        ),
      ),
    );
  }

  double get _weighStationAheadRailHeight =>
      _navSettings.viewWeighStation &&
          _isLiveRouteAssistanceActive &&
          _closestWeighStationsAhead.isNotEmpty
      ? 54
      : 0;

  double get _restAreaAheadRailHeight =>
      _isLiveRouteAssistanceActive && _closestRestAreasAhead.isNotEmpty
      ? math.min(_closestRestAreasAhead.length, 2) * 52.0
      : 0;

  double get _routeSafetyAlertTop =>
      218 + _weighStationAheadRailHeight + _restAreaAheadRailHeight + 18;

  /// Builds a single compact, tappable truck-stop-ahead chip.
  ///
  /// The collapsed state intentionally contains only the provider marker,
  /// highway exit number, and distance. Full commercial-stop details are
  /// available from [_showAheadTruckStopSheet] when the driver taps it.
  Widget _truckStopAheadChip(AheadTruckStop ahead) {
    final String milesText = ahead.routeMilesAhead < 10
        ? '${ahead.routeMilesAhead.toStringAsFixed(1)} mi'
        : '${ahead.routeMilesAhead.round()} mi';
    final String exitText = (ahead.poi.exitNumber ?? '').trim();

    // Resolve the brand logo bytes (may be null if not yet loaded).
    final Uint8List? logoBytes =
        _brandIconBytes['assets/logo_brand_markers/${ahead.poi.logoName}.png'] ??
        _brandIconBytes['assets/logo_brand_markers/truck_parking.png'];
    final normalizedLogoName = ahead.poi.logoName.toLowerCase();
    // Source brand PNGs use differently sized transparent canvases. Scale
    // their visible artwork into one consistent, legible compact marker.
    final logoScale = normalizedLogoName.contains('ta_truck_stop')
        ? 2.4
        : normalizedLogoName.contains('petro')
        ? 1.75
        : 1.9;

    return Semantics(
      button: true,
      label:
          '${ahead.poi.name}, ${exitText.isEmpty ? 'exit not reported' : 'exit $exitText'}, $milesText ahead. Tap for details.',
      child: Material(
        color: Colors.black.withValues(alpha: 0.86),
        elevation: 5,
        shadowColor: Colors.black45,
        borderRadius: BorderRadius.circular(13),
        child: InkWell(
          borderRadius: BorderRadius.circular(13),
          onTap: () => _showAheadTruckStopSheet(ahead),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48, maxWidth: 154),
            padding: const EdgeInsets.fromLTRB(8, 6, 10, 6),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(13),
              border: Border.all(
                color: const Color(0xFF22C55E).withValues(alpha: 0.88),
                width: 1.2,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: const Color(0xFF22C55E),
                      width: 1.4,
                    ),
                  ),
                  child: ClipOval(
                    child: logoBytes != null
                        ? Transform.scale(
                            scale: logoScale,
                            child: Image.memory(
                              logoBytes,
                              width: 32,
                              height: 32,
                              fit: BoxFit.contain,
                              filterQuality: FilterQuality.high,
                              errorBuilder: (_, __, ___) => const Icon(
                                Icons.local_gas_station_rounded,
                                size: 18,
                                color: Color(0xFF159A55),
                              ),
                            ),
                          )
                        : const Icon(
                            Icons.local_gas_station_rounded,
                            size: 18,
                            color: Color(0xFF159A55),
                          ),
                  ),
                ),
                const SizedBox(width: 8),
                if (exitText.isNotEmpty) ...[
                  SizedBox(
                    width: 36,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'EXIT',
                          style: TextStyle(
                            color: Color(0xFF7BE3A8),
                            fontSize: 8,
                            fontWeight: FontWeight.w800,
                            height: 1,
                            letterSpacing: 0.7,
                          ),
                        ),
                        Text(
                          exitText,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.w900,
                            height: 1.15,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                Text(
                  milesText,
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w900,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _showAheadTruckStopSheet(AheadTruckStop ahead) {
    final stop = ahead.poi;
    final estimatedDuration = _estimatedDurationToAheadStop(ahead);
    final canInsertIntoNativeRoute =
        _nativeNavigationStatus?.truckSafeGuidanceAvailable == true &&
        (_nativeNavigationPhase == NativeNavigationPhase.navigating ||
            _nativeNavigationPhase == NativeNavigationPhase.previewing ||
            _nativeNavigationPhase == NativeNavigationPhase.rerouting);

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: const Color(0xFFE7F2FF),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(
                      Icons.local_shipping_rounded,
                      color: Color(0xFF0969E8),
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
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                            color: Color(0xFF122131),
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          _formatRemainingDistance(ahead.routeMilesAhead),
                          style: const TextStyle(
                            color: Color(0xFF0969E8),
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if ((stop.locationName ?? '').trim().isNotEmpty) ...[
                const SizedBox(height: 16),
                _truckStopDetailRow(
                  Icons.location_on_outlined,
                  stop.locationName!.trim(),
                ),
              ],
              if ((stop.address ?? '').trim().isNotEmpty)
                _truckStopDetailRow(
                  Icons.signpost_outlined,
                  stop.address!.trim(),
                ),
              if ((stop.exitNumber ?? '').trim().isNotEmpty)
                _truckStopDetailRow(
                  Icons.exit_to_app_rounded,
                  'Exit ${stop.exitNumber}',
                ),
              if (estimatedDuration != null)
                _truckStopDetailRow(
                  Icons.schedule_rounded,
                  'Estimated ${_fmtDuration(estimatedDuration)} ahead',
                ),
              _truckStopDetailRow(
                Icons.access_time_rounded,
                [
                  switch (stop.openNow) {
                    true => 'Open now',
                    false => 'Closed now',
                    null => 'Operating status unknown',
                  },
                  if ((stop.openingHours ?? '').trim().isNotEmpty)
                    stop.openingHours!.trim(),
                ].join(' • '),
              ),
              if (stop.dieselPrice != null)
                _truckStopDetailRow(
                  Icons.local_gas_station_rounded,
                  'Diesel: \$${stop.dieselPrice!.toStringAsFixed(2)}/gal',
                ),
              if (stop.defPrice != null)
                _truckStopDetailRow(
                  Icons.opacity_rounded,
                  'DEF: \$${stop.defPrice!.toStringAsFixed(2)}/gal',
                ),
              _truckStopDetailRow(
                Icons.local_parking_rounded,
                (stop.parkingStatus ?? '').trim().isNotEmpty ||
                        stop.truckParkingSpaces != null
                    ? [
                        if ((stop.parkingStatus ?? '').trim().isNotEmpty)
                          'Truck parking: ${stop.parkingStatus!.trim()}',
                        if (stop.truckParkingSpaces != null)
                          '${stop.truckParkingSpaces} spaces',
                      ].join(' • ')
                    : 'Truck parking availability not reported',
              ),
              if (stop.amenities.isNotEmpty)
                _truckStopDetailRow(
                  Icons.storefront_rounded,
                  stop.amenities.join(' • '),
                ),
              _truckStopDetailRow(
                stop.verified
                    ? Icons.verified_rounded
                    : Icons.info_outline_rounded,
                stop.verified
                    ? 'Verified commercial truck location'
                    : 'Provider location; truck entrance not verified',
              ),
              if ((stop.dataSource ?? '').trim().isNotEmpty)
                _truckStopDetailRow(
                  Icons.storage_rounded,
                  'Source: ${stop.dataSource}',
                ),
              const SizedBox(height: 14),
              const Text(
                'Fuel price, parking availability, hours, and amenities are shown only when supplied by an authenticated provider.',
                style: TextStyle(
                  color: Color(0xFF65717E),
                  fontSize: 12,
                  height: 1.35,
                ),
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(sheetContext),
                      child: const Text('Close'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    flex: 2,
                    child: FilledButton.icon(
                      onPressed: canInsertIntoNativeRoute
                          ? () async {
                              Navigator.pop(sheetContext);
                              await _addTruckStopToNativeRoute(ahead);
                            }
                          : null,
                      icon: const Icon(Icons.add_location_alt_rounded),
                      label: Text(
                        canInsertIntoNativeRoute
                            ? 'Add Stop'
                            : 'Add Stop needs HERE Navigate',
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _truckStopDetailRow(IconData icon, String value) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 19, color: const Color(0xFF526273)),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: Color(0xFF263646),
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Estimates time-to-stop from live route progress. This is a route-time
  /// proportion, not provider operating data, and is omitted when progress is
  /// unavailable rather than inventing an arrival estimate.
  Duration? _estimatedDurationToAheadStop(AheadTruckStop ahead) {
    final routeMilesLeft = _tripProgressInfo.milesRemaining;
    final routeTimeLeft = _tripProgressInfo.durationRemaining;
    if (!routeMilesLeft.isFinite ||
        routeMilesLeft <= 0 ||
        routeTimeLeft <= Duration.zero ||
        !ahead.routeMilesAhead.isFinite ||
        ahead.routeMilesAhead < 0) {
      return null;
    }
    final ratio = (ahead.routeMilesAhead / routeMilesLeft).clamp(0.0, 1.0);
    return Duration(seconds: (routeTimeLeft.inSeconds * ratio).round());
  }

  Future<void> _addTruckStopToNativeRoute(AheadTruckStop ahead) async {
    try {
      await NativeNavigationService.instance.addWaypoint(
        ahead.poi.id,
        ahead.poi.latitude,
        ahead.poi.longitude,
      );
      await _requestReroute(
        _truckPosition ?? LatLng(ahead.poi.latitude, ahead.poi.longitude),
        reason: 'waypoint-added',
      );
      if (!mounted) return;
      _showSnack('${ahead.poi.name} added to the active truck route.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = 'Unable to add truck stop: $error');
    }
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
  /// Values are read from [_tripProgressInfo], which is recalculated on every
  /// GPS tick by [_refreshTripProgress] while [_isNavigating] is true.
  Widget _buildCompactTripStrip() {
    if (!_drivingUiActive) return const SizedBox.shrink();

    // ── Derive display values from live trip progress ──────────────────────
    // _tripProgressInfo is updated on every GPS fix by _refreshTripProgress().
    final double milesLeft = _tripProgressInfo.milesRemaining;
    final Duration timeLeft = _tripProgressInfo.durationRemaining;

    final String milesStr = _formatRemainingDistance(milesLeft);
    final String timeStr = _fmtDuration(timeLeft);
    final String etaStr = _fmtArrival(_tripProgressInfo);
    final String arrivalLabel = _tripProgressInfo.timezoneLabel.isEmpty
        ? 'arrival'
        : 'arrival ${_tripProgressInfo.timezoneLabel}';

    return Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
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
                  milesStr,
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
                  arrivalLabel,
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
    if (!_navSettings.viewSpeedLimit) return const SizedBox.shrink();

    final double speedMph = _currentSpeedMps >= 0
        ? _currentSpeedMps * _mpsToMph
        : 0.0;
    final int speedInt = speedMph.round();
    final String limitLabel = _speedLimitMph > 0
        ? _speedLimitMph.round().toString()
        : '--';
    final bool isOverSpeed =
        _currentSpeedMps >= 0 &&
        _speedLimitMph > 0 &&
        speedMph > _speedLimitMph;

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
                  limitLabel,
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
    this.exitNumber,
    this.currentRoadName,
    this.nextRoadName,
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

  /// Highway exit number for this step, e.g. "13", from the Mapbox
  /// Directions API `exits` field.  Null when no exit number is available.
  final String? exitNumber;

  /// Provider road before this maneuver, when supplied by HERE.
  final String? currentRoadName;

  /// Provider road after this maneuver, when supplied by HERE.
  final String? nextRoadName;
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
  final String? address;
  final String? dataSource;
  final bool verified;
  final bool? openNow;
  final String? openingHours;
  final double? dieselPrice;
  final double? defPrice;
  final String? parkingStatus;
  final int? truckParkingSpaces;
  final List<String> amenities;

  /// Highway exit number nearest to this stop, e.g. "309".
  final String? exitNumber;

  const TruckStopPoi({
    required this.id,
    required this.name,
    required this.brand,
    required this.logoName,
    required this.latitude,
    required this.longitude,
    this.locationName,
    this.address,
    this.dataSource,
    this.verified = false,
    this.openNow,
    this.openingHours,
    this.dieselPrice,
    this.defPrice,
    this.parkingStatus,
    this.truckParkingSpaces,
    this.amenities = const [],
    this.exitNumber,
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

/// Derives a short brand abbreviation from a [logoName] stem for display
/// inside the red-bordered circle on the truck-stop chip.
///
/// Examples:
///   'pilot'               → 'P'
///   'loves'               → 'L'
///   'ta_truck_stop' / 'ta' → 'TA'
///   'petro_truck_stop'    → 'Pe'
///   'flying_j_truck_stop' → 'FJ'
///   'flyingj'             → 'FJ'
String _truckStopBrandAbbr(String logoName) {
  final key = logoName.toLowerCase();
  if (key.contains('pilot')) return 'P';
  if (key == 'loves' || key.startsWith('loves')) return 'L';
  if (key == 'ta' || key.startsWith('ta_')) return 'TA';
  if (key.contains('petro_canada')) return 'PC';
  if (key.startsWith('petro')) return 'Pe';
  if (key.contains('flyingj') || key.contains('flying_j')) return 'FJ';
  if (key.contains('circle')) return 'CK';
  if (key.contains('rest')) return 'RA';
  if (key.contains('weigh')) return 'WS';
  if (key.contains('quicktrip') || key.contains('quiktrip')) return 'QT';
  if (key.contains('maverik')) return 'MV';
  if (key.contains('walmart')) return 'W';
  if (key.contains('hotel')) return 'H';
  if (key.contains('restaurant')) return 'R';
  // Generic fallback: first 1–2 uppercase letters of the stem.
  final clean = key.replaceAll(RegExp(r'[_\-].*'), '');
  if (clean.length >= 2) return clean.substring(0, 2).toUpperCase();
  return clean.toUpperCase();
}

/// A single truck-stop card displayed in the closest-stops-ahead row.
///
/// Visual layout (matching the reference screenshot):
///   [Green exit badge]  [White rounded card: [Logo circle] [Miles]]
///
/// • **Exit badge** (left): green rounded rectangle with exit number and a
///   small curved-arrow icon.  Hidden when [exitNumber] is null.
/// • **White card**: rounded-rectangle with drop shadow.
///   – Brand abbreviation (e.g. "P", "TA") in a red-bordered white circle.
///   – Miles number in bold black with a smaller "mi" suffix.
///   – "approaching" badge when the stop is within 2 miles.
class ClosestTruckStopChip extends StatelessWidget {
  /// Brand logo name stem, e.g. `'pilot'` or `'ta_truck_stop'`.
  /// Used to derive the abbreviation shown inside the logo circle.
  final String logoName;

  /// Distance ahead in miles (raw value used to render "89 mi", "3.4 mi").
  final double miles;

  /// Highway exit number, e.g. `'309'`.  When non-null the green exit badge
  /// is shown at the top edge of the white card.
  final String? exitNumber;

  const ClosestTruckStopChip({
    super.key,
    required this.logoName,
    required this.miles,
    this.exitNumber,
  });

  @override
  Widget build(BuildContext context) {
    final String abbr = _truckStopBrandAbbr(logoName);
    final String milesNum = miles < 10
        ? miles.toStringAsFixed(1)
        : miles.round().toString();
    final bool isApproaching = miles < 2.0;

    // ── White rounded card ─────────────────────────────────────────────────
    final Widget card = Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.15),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // ── Logo circle (red border, white fill, brand abbr) ──────
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white,
                  border: Border.all(color: const Color(0xFFCC0000), width: 2),
                ),
                child: Center(
                  child: Text(
                    abbr,
                    style: const TextStyle(
                      color: Color(0xFFCC0000),
                      fontWeight: FontWeight.w900,
                      fontSize: 12,
                      height: 1.0,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              // ── Miles: bold number + smaller 'mi' suffix ──────────────
              RichText(
                text: TextSpan(
                  children: [
                    TextSpan(
                      text: milesNum,
                      style: const TextStyle(
                        color: Colors.black,
                        fontWeight: FontWeight.w900,
                        fontSize: 18,
                        height: 1.1,
                      ),
                    ),
                    const TextSpan(
                      text: ' mi',
                      style: TextStyle(
                        color: Colors.black54,
                        fontWeight: FontWeight.w500,
                        fontSize: 11,
                        height: 1.1,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          // ── Approaching badge (< 2 miles) ──────────────────────────────
          if (isApproaching) ...[
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.orange,
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text(
                'approaching',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                  height: 1.0,
                ),
              ),
            ),
          ],
        ],
      ),
    );

    if (exitNumber == null || exitNumber!.isEmpty) {
      return Padding(padding: const EdgeInsets.only(bottom: 10.0), child: card);
    }

    // ── Green exit badge overlaid at the top edge of the white card ────────
    return Padding(
      padding: const EdgeInsets.only(bottom: 10.0, top: 12.0),
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.topCenter,
        children: [
          card,
          Positioned(
            top: -12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: const Color(0xFF2E7D32),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.arrow_upward, color: Colors.white, size: 11),
                  const SizedBox(width: 3),
                  Text(
                    exitNumber!,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 11,
                      height: 1.0,
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
}

/// A vertically stacked column of up to 2 [ClosestTruckStopChip] widgets,
/// displayed on the left edge of the map during active navigation.
///
/// A direction label (e.g. "↑ AHEAD", "→ RIGHT") is shown above the first
/// chip to indicate the route direction toward the stops.
class ClosestTruckStopsRow extends StatelessWidget {
  final List<AheadTruckStop> stops;

  /// Short direction label shown above the first chip (e.g. "↑ AHEAD").
  final String directionLabel;

  const ClosestTruckStopsRow({
    super.key,
    required this.stops,
    this.directionLabel = '↑ AHEAD',
  });

  @override
  Widget build(BuildContext context) {
    if (stops.isEmpty) return const SizedBox.shrink();
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Direction label above first chip ─────────────────────────────
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
          decoration: BoxDecoration(
            color: Colors.black.withOpacity(0.72),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            directionLabel,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 10,
              fontWeight: FontWeight.w700,
              height: 1.0,
            ),
          ),
        ),
        const SizedBox(height: 6),
        // ── Chips (up to 2) ───────────────────────────────────────────────
        ...stops.take(2).map((stop) {
          return ClosestTruckStopChip(
            logoName: stop.poi.logoName,
            miles: stop.routeMilesAhead,
            exitNumber: stop.poi.exitNumber,
          );
        }),
      ],
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
    this.exitNumber,
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

  /// Highway exit number nearest to this stop, e.g. "309".
  /// Shown in the green exit badge on the truck-stop chip.
  /// Null when no exit number is associated with this stop.
  final String? exitNumber;
}

// ── Live map POI types and model ─────────────────────────────────────────────

/// Classifies the kind of truck-relevant point of interest shown on the map.
enum PoiType {
  /// Commercial vehicle weigh station or portable scale site.
  weighStation,

  /// Police checkpoint, enforcement stop, or roving inspection unit.
  police,

  /// International or inter-state port of entry inspection facility.
  portOfEntry,

  /// 511 traffic camera visible to the driver on the map.
  camera511,
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
    this.weighStation,
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

  /// Complete sourced weigh-station metadata when this POI came from the
  /// official/community-status service. Null for other POI types and older
  /// bundled records.
  final live_ws.WeighStation? weighStation;
}

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

/// Result returned after the destination-search sheet has completely closed.
/// Keeping the next navigation action outside the sheet prevents overlapping
/// modal-route teardown, which can leave inherited widget dependents active.
class _DestinationSearchSelection {
  const _DestinationSearchSelection.place(this.suggestion)
    : category = null,
      title = null,
      showMore = false;

  const _DestinationSearchSelection.category(this.category, this.title)
    : suggestion = null,
      showMore = false;

  const _DestinationSearchSelection.more()
    : suggestion = null,
      category = null,
      title = null,
      showMore = true;

  final PlaceSuggestion? suggestion;
  final String? category;
  final String? title;
  final bool showMore;
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

  /// Number of verified commercial truck stops within 5 km of route.
  final int fuelStopCount;

  /// Number of weigh stations within 5 km of route.
  final int weighStationCount;

  /// Legacy route data map used by the route info panel and preview panel.
  final Map<String, dynamic> routeData;
  RouteOption copyWith({int? weighStationCount, int? fuelStopCount}) {
    return RouteOption(
      id: id,
      label: label,
      points: points,
      steps: steps,
      distanceMiles: distanceMiles,
      durationSeconds: durationSeconds,
      restrictionCount: restrictionCount,
      fuelStopCount: fuelStopCount ?? this.fuelStopCount,
      weighStationCount: weighStationCount ?? this.weighStationCount,
      routeData: routeData,
    );
  }
}

// ── Multi-stop leg models ─────────────────────────────────────────────────────

/// Raw result returned by [_TruckMapScreenState._fetchRouteFromApi].
///
/// Contains everything needed to display a route on the map and for use in
/// either a [RouteOption] (pre-navigation selection) or a [TripLeg]
/// (per-segment breakdown during navigation).
class RouteResult {
  const RouteResult({
    required this.provider,
    required this.points,
    required this.steps,
    required this.distanceMiles,
    required this.durationSeconds,
    required this.providerNotices,
    this.alternatives = const [],
  });

  /// Provider that calculated this route. Used for provenance and UI labels;
  /// provider payloads themselves remain isolated in the backend adapters.
  final String provider;

  /// Decoded, simplified polyline points.
  final List<LatLng> points;

  /// Turn-by-turn navigation steps.
  final List<_NavStep> steps;

  /// Route distance in miles.
  final double distanceMiles;

  /// Route travel time in seconds.
  final int durationSeconds;

  /// Safety notices returned by the authoritative truck-routing provider.
  final List<String> providerNotices;

  /// Additional truck-safe routes returned by the selected provider.
  final List<RouteResult> alternatives;
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
  truckParking,
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

enum AlertSeverity { low, medium, high }

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

  NavigationAlert copyWith({bool? isExpanded, bool? isDismissed}) {
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
  final int arrivalDayOffset;

  const TripProgressInfo({
    required this.milesRemaining,
    required this.durationRemaining,
    required this.etaLocal,
    required this.timezoneLabel,
    required this.arrivalDayOffset,
  });
}

// ── Navigation alert utility functions ────────────────────────────────────────

String _fmtMiles(double miles) => _fmtRemainingMiles(miles);

String _fmtRemainingMiles(double miles) {
  if (!miles.isFinite || miles <= 0) return '0 mi';
  if (miles < 0.1) return '<0.1 mi';
  if (miles < 10) return '${miles.toStringAsFixed(1)} mi';
  return '${miles.round()} mi';
}

String _fmtDuration(Duration duration) {
  final seconds = math.max(0, duration.inSeconds);
  if (seconds == 0) return '0m';
  if (seconds < 60) return '<1m';
  final h = seconds ~/ 3600;
  final m = (seconds ~/ 60) % 60;
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

String _fmtArrival(TripProgressInfo tripInfo) {
  final daySuffix = tripInfo.arrivalDayOffset > 0
      ? ' +${tripInfo.arrivalDayOffset}'
      : tripInfo.arrivalDayOffset < 0
      ? ' ${tripInfo.arrivalDayOffset}'
      : '';
  return '${_fmtEta(tripInfo.etaLocal)}$daySuffix';
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
    case AlertType.truckParking:
      return Icons.local_parking;
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

  const MiniAlertRow({super.key, required this.alerts, this.onNext});

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
  // speedLimitMph:   provider-posted limit, or zero when unavailable.
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
                      horizontal: 10,
                      vertical: 4,
                    ),
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
                      horizontal: 10,
                      vertical: 6,
                    ),
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
                      color:
                          speedLimitMph > 0 &&
                              (currentSpeedMps * mpsToMph) > speedLimitMph
                          ? Colors.red
                          : Colors.black87,
                    ),
                  ),
                  const SizedBox(width: 12),
                  // Posted speed limit for the current road segment.
                  if (speedLimitMph > 0)
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
          _stat(
            Icons.straighten,
            _fmtRemainingMiles(tripInfo.milesRemaining),
            'left',
          ),
          _divider(),
          _stat(
            Icons.access_time,
            _fmtDuration(tripInfo.durationRemaining),
            'drive time',
          ),
          _divider(),
          _stat(
            Icons.flag_outlined,
            _fmtEta(tripInfo.etaLocal),
            tripInfo.timezoneLabel,
          ),
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
    return Container(width: 1, height: 28, color: const Color(0xFFE0E0E0));
  }
}

class _SignalLamp extends StatelessWidget {
  const _SignalLamp(this.color);

  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: 7,
    height: 7,
    decoration: BoxDecoration(
      color: color,
      shape: BoxShape.circle,
      border: Border.all(color: Colors.white54, width: 0.5),
    ),
  );
}

class _OctagonClipper extends CustomClipper<Path> {
  const _OctagonClipper();

  @override
  Path getClip(Size size) {
    final cut = size.shortestSide * 0.28;
    return Path()
      ..moveTo(cut, 0)
      ..lineTo(size.width - cut, 0)
      ..lineTo(size.width, cut)
      ..lineTo(size.width, size.height - cut)
      ..lineTo(size.width - cut, size.height)
      ..lineTo(cut, size.height)
      ..lineTo(0, size.height - cut)
      ..lineTo(0, cut)
      ..close();
  }

  @override
  bool shouldReclip(_OctagonClipper oldClipper) => false;
}
// ── Warning marker visual helpers ─────────────────────────────────────────────

/// Distance-based visual emphasis for a warning sign marker.
///
/// Used by [_buildYellowTriangleMarker] to scale size, opacity, and shadow
/// based on how far the driver is from the sign.
enum _WarningEmphasis {
  /// > 2.0 mi (highway) / > 1.0 mi (city): faint preload indicator.
  preload,

  /// ≤ 2.0 mi (highway) / ≤ 1.0 mi (city): low-emphasis visible marker.
  lowEmphasis,

  /// ≤ 1.0 mi (highway) / ≤ 0.5 mi (city): normal, clear marker.
  visible,

  /// ≤ 0.5 mi (highway) / ≤ 0.25 mi (city): strong pop, larger marker.
  highlighted,

  /// ≤ 0.2 mi (highway) / ≤ 0.1 mi (city): urgent maximum emphasis.
  urgent;

  double get markerSize {
    switch (this) {
      case _WarningEmphasis.preload:
        return 24;
      case _WarningEmphasis.lowEmphasis:
        return 30;
      case _WarningEmphasis.visible:
        return 36;
      case _WarningEmphasis.highlighted:
        return 44;
      case _WarningEmphasis.urgent:
        return 52;
    }
  }

  double get opacity {
    switch (this) {
      case _WarningEmphasis.preload:
        return 0.35;
      case _WarningEmphasis.lowEmphasis:
        return 0.65;
      case _WarningEmphasis.visible:
        return 0.88;
      case _WarningEmphasis.highlighted:
        return 1.0;
      case _WarningEmphasis.urgent:
        return 1.0;
    }
  }

  double get shadowBlur {
    switch (this) {
      case _WarningEmphasis.preload:
        return 0;
      case _WarningEmphasis.lowEmphasis:
        return 3;
      case _WarningEmphasis.visible:
        return 5;
      case _WarningEmphasis.highlighted:
        return 8;
      case _WarningEmphasis.urgent:
        return 12;
    }
  }
}

/// Paints a yellow diamond warning sign with a black border,
/// matching the official USA / Canada MUTCD road-sign appearance.
///
/// The diamond follows the North-American warning-sign shape. Fill is yellow
/// (0xFFFFCC00).  The [opacity] parameter fades the entire marker for
/// distance-based preload emphasis.
class _WarningTrianglePainter extends CustomPainter {
  const _WarningTrianglePainter({
    required this.opacity,
    required this.shadowBlur,
  });

  final double opacity;
  final double shadowBlur;

  static const Color _fillColor = Color(0xFFFFCC00);
  static const Color _borderColor = Colors.black;

  @override
  void paint(Canvas canvas, Size size) {
    final double w = size.width;
    final double h = size.height;

    // Triangle path: tip at top-centre, base at bottom.
    final path = Path()
      ..moveTo(w * 0.5, 0)
      ..lineTo(w, h * 0.5)
      ..lineTo(w * 0.5, h)
      ..lineTo(0, h * 0.5)
      ..close();

    // Shadow / glow when emphasis is elevated.
    if (shadowBlur > 0) {
      canvas.drawShadow(
        path,
        Colors.black.withOpacity(0.4 * opacity),
        shadowBlur,
        false,
      );
    }

    // Yellow fill.
    canvas.drawPath(
      path,
      Paint()
        ..color = _fillColor.withOpacity(opacity)
        ..style = PaintingStyle.fill,
    );

    // Black border.
    canvas.drawPath(
      path,
      Paint()
        ..color = _borderColor.withOpacity(opacity)
        ..style = PaintingStyle.stroke
        ..strokeWidth = size.width * 0.06
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_WarningTrianglePainter old) =>
      old.opacity != opacity || old.shadowBlur != shadowBlur;
}

/// Paints a semi-transparent red glow ring around the urgent warning triangle
/// to create a strong visual pulse effect for the 0.2-mile urgency stage.
class _UrgentGlowPainter extends CustomPainter {
  const _UrgentGlowPainter({required this.size});

  final double size;

  @override
  void paint(Canvas canvas, Size canvasSize) {
    final center = Offset(canvasSize.width / 2, canvasSize.height / 2);
    final radius = size * 0.52;
    canvas.drawCircle(
      center,
      radius,
      Paint()
        ..color = Colors.red.withOpacity(0.30)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 8),
    );
  }

  @override
  bool shouldRepaint(_UrgentGlowPainter old) => old.size != size;
}

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
    this.logoName = 'weight_station',
    this.details,
  });

  /// Unique identifier — matches the source [MapPoi.id].
  final String id;

  /// Geographic coordinate of the weigh station.
  final LatLng position;

  /// Human-readable station name shown in chips and dialogs.
  final String name;

  /// Operational status string, e.g. "Open", "Closed", "Bypass Required".
  final String status;

  /// PNG filename (without `.png`) under `assets/logo_brand_markers/` used to
  /// display the station's logo.  Defaults to `'weight_station'` which maps to
  /// `assets/logo_brand_markers/weight_station.png`.
  final String logoName;

  /// Official source, direction, highway, and live-status metadata when
  /// available from the authenticated weigh-station service.
  final live_ws.WeighStation? details;

  /// Constructs a [WeighStationPoi] from an existing [MapPoi] of type
  /// [PoiType.weighStation].  The [logoName] defaults to `'weight_station'`.
  factory WeighStationPoi.fromMapPoi(MapPoi poi) {
    return WeighStationPoi(
      id: poi.id,
      position: poi.position,
      name: poi.name,
      status: poi.status,
      details: poi.weighStation,
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

/// A compact right-side navigation chip for the closest weigh station ahead.
///
/// Design:
/// • **White rounded card** with a subtle drop shadow — matches the other
///   right-side overlay chips.
/// • **Bold green "W"** at the top of the card.
/// • **Miles label** (e.g. `"8.4 mi"`) in small bold black text directly
///   below the "W", inside the same card.
///
/// The value updates live on every GPS fix via
/// [_TruckMapScreenState._refreshClosestWeighStationsAhead].
///
/// **Usage:**
/// ```dart
/// ClosestWeighStationChip(station: aheadStation)
/// ```
class ClosestWeighStationChip extends StatelessWidget {
  final AheadWeighStation station;
  final VoidCallback? onTap;

  const ClosestWeighStationChip({super.key, required this.station, this.onTap});

  @override
  Widget build(BuildContext context) {
    final miles = station.milesAhead;

    // Format distance: one decimal below 10 mi, whole number above.
    final String distLabel = miles < 10
        ? '${miles.toStringAsFixed(1)} mi'
        : '${miles.round()} mi';

    return Semantics(
      button: true,
      label:
          '${station.poi.name}, $distLabel ahead. Open weigh station details',
      child: Material(
        color: const Color(0xED07120F),
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Container(
            constraints: const BoxConstraints(minWidth: 132),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFF17A894), width: 1.5),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.monitor_weight_outlined,
                  color: Color(0xFF35D7C0),
                  size: 22,
                ),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    'Weigh  $distLabel',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── ClosestWeighStationsRow widget ────────────────────────────────────────────

/// Renders the single closest upcoming weigh station as a
/// [ClosestWeighStationChip] on the right side of the map.
///
/// Only one station is shown at a time so the driver's attention is focused on
/// the very next weigh station ahead.  Once the driver passes it the list is
/// refreshed by [_refreshClosestWeighStationsAhead] and the next station
/// appears automatically.
///
/// Returns zero-size when [stations] is empty.
///
/// **Usage:**
/// ```dart
/// ClosestWeighStationsRow(stations: _closestWeighStationsAhead)
/// ```
class ClosestWeighStationsRow extends StatelessWidget {
  final List<AheadWeighStation> stations;
  final ValueChanged<AheadWeighStation>? onTap;

  const ClosestWeighStationsRow({
    super.key,
    required this.stations,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    if (stations.isEmpty) return const SizedBox.shrink();

    // Show only the first (closest) station — one at a time per spec.
    return ClosestWeighStationChip(
      station: stations.first,
      onTap: onTap == null ? null : () => onTap!(stations.first),
    );
  }
}

// ── RestAreaPoi model ──────────────────────────────────────────────────────────

/// A rest area point-of-interest used for ahead-on-route detection.
class RestAreaPoi {
  const RestAreaPoi({
    required this.id,
    required this.position,
    required this.name,
    required this.source,
  });

  /// Unique identifier — matches the source [PoiItem.id].
  final String id;

  /// Geographic coordinate of the rest area.
  final LatLng position;

  /// Human-readable rest area name shown in chips.
  final String name;

  /// Complete provider-backed POI record used by the details sheet.
  final PoiItem source;
}

// ── AheadRestArea model ────────────────────────────────────────────────────────

/// A rest area that lies ahead of the truck on the active route, together
/// with pre-computed distance information.
///
/// Produced by [_TruckMapScreenState._getClosestRestAreasAheadOnRoute] and
/// consumed by [ClosestRestAreaChip] / [ClosestRestAreasRow].
class AheadRestArea {
  const AheadRestArea({
    required this.poi,
    required this.milesAhead,
    required this.routeIndex,
  });

  /// The rest area POI data including its name.
  final RestAreaPoi poi;

  /// Approximate route miles from the truck's current position to this rest area.
  final double milesAhead;

  /// Index into `_routePoints` of the nearest point to this rest area.
  final int routeIndex;
}

// ── ClosestRestAreaChip widget ─────────────────────────────────────────────────

/// A compact right-side navigation chip for the closest rest area ahead.
///
/// Design:
/// • **White rounded card** with a subtle drop shadow — matches the other
///   right-side overlay chips.
/// • **Bold blue "R"** at the top of the card.
/// • **Miles label** (e.g. `"8.4 mi"`) in small bold black text directly
///   below the "R", inside the same card.
///
/// The value updates live on every GPS fix via
/// [_TruckMapScreenState._refreshClosestRestAreasAhead].
class ClosestRestAreaChip extends StatelessWidget {
  final AheadRestArea area;
  final VoidCallback? onTap;

  const ClosestRestAreaChip({super.key, required this.area, this.onTap});

  @override
  Widget build(BuildContext context) {
    final miles = area.milesAhead;

    // Format distance: one decimal below 10 mi, whole number above.
    final String distLabel = miles < 10
        ? '${miles.toStringAsFixed(1)} mi'
        : '${miles.round()} mi';

    return Semantics(
      button: true,
      label: '${area.poi.name}, $distLabel ahead. Open rest area details',
      child: Material(
        color: const Color(0xED07131C),
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Container(
            constraints: const BoxConstraints(minWidth: 132),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFF2D8FE3), width: 1.5),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.park_rounded,
                  color: Color(0xFF69B8FF),
                  size: 22,
                ),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    'Rest  $distLabel',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ── ClosestRestAreasRow widget ─────────────────────────────────────────────────

/// Renders the single closest upcoming rest area as a [ClosestRestAreaChip]
/// on the right side of the map.
///
/// Only one rest area is shown at a time so the driver's attention is focused
/// on the very next one ahead.  Once the driver passes it the list is refreshed
/// by [_refreshClosestRestAreasAhead] and the next rest area appears
/// automatically.
///
/// Returns zero-size when [areas] is empty.
class ClosestRestAreasRow extends StatelessWidget {
  final List<AheadRestArea> areas;
  final ValueChanged<AheadRestArea>? onTap;

  const ClosestRestAreasRow({super.key, required this.areas, this.onTap});

  @override
  Widget build(BuildContext context) {
    if (areas.isEmpty) return const SizedBox.shrink();

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: areas
          .take(2)
          .map((area) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 7),
              child: ClosestRestAreaChip(
                area: area,
                onTap: onTap == null ? null : () => onTap!(area),
              ),
            );
          })
          .toList(growable: false),
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

  /// Identifier of the full navigation alert opened when this chip is tapped.
  final String? sourceAlertId;

  const UpcomingAlertItem({
    required this.type,
    required this.label,
    required this.distanceMiles,
    this.sourceAlertId,
  });
}

// ── Shortcut bar data model ────────────────────────────────────────────────────

/// Data model for a single shortcut button in the navigation shortcut bar.
class _ShortcutBarItem {
  const _ShortcutBarItem({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
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

// ── Exit Preview lane painter ─────────────────────────────────────────────

/// [CustomPainter] that draws a simplified top-down highway diagram with
/// dashed lane lines and a blue exit-ramp path curving off to the right
/// (or left when [exitRight] is false).
class _ExitLanePainter extends CustomPainter {
  const _ExitLanePainter({required this.exitRight});

  final bool exitRight;

  @override
  void paint(Canvas canvas, Size size) {
    final double w = size.width;
    final double h = size.height;

    // ── Road surface ─────────────────────────────────────────────────────
    canvas.drawRect(
      Rect.fromLTWH(0, 0, w, h),
      Paint()..color = const Color(0xFF334155),
    );

    // ── Lane dividers (dashed white lines) ───────────────────────────────
    final dashPaint = Paint()
      ..color = Colors.white38
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    for (int i = 1; i <= 2; i++) {
      final double x = w * i / 3;
      double y = 0;
      while (y < h) {
        canvas.drawLine(
          Offset(x, y),
          Offset(x, (y + 12).clamp(0, h)),
          dashPaint,
        );
        y += 22;
      }
    }

    // ── Blue route / exit-ramp path ──────────────────────────────────────
    final routePaint = Paint()
      ..color = const Color(0xFF2563EB)
      ..strokeWidth = 10
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final rampPath = Path();
    if (exitRight) {
      // Straight along the middle-right lane, then curve right off the road.
      rampPath.moveTo(w * 0.67, h);
      rampPath.lineTo(w * 0.67, h * 0.5);
      rampPath.quadraticBezierTo(w * 0.67, h * 0.1, w, h * 0.05);
    } else {
      // Mirror for left exits.
      rampPath.moveTo(w * 0.33, h);
      rampPath.lineTo(w * 0.33, h * 0.5);
      rampPath.quadraticBezierTo(w * 0.33, h * 0.1, 0, h * 0.05);
    }
    canvas.drawPath(rampPath, routePaint);
  }

  @override
  bool shouldRepaint(_ExitLanePainter old) => old.exitRight != exitRight;
}

// ── Highway shield types ──────────────────────────────────────────────────────

/// Classifies the type of highway whose name appears on a road sign.
enum _HighwayShieldType {
  /// Red/blue interstate shield (e.g. "I-95").
  interstate,

  /// Black/white US Highway pentagon (e.g. "US-1").
  usHighway,

  /// Green state/provincial route sign (e.g. "CA-1", "TX-35").
  stateHighway,
}

/// Carries a parsed highway shield — its [type], route [number], and optional
/// two-letter [stateCode] for state/provincial signs.
class _HighwayShield {
  const _HighwayShield(this.type, this.number, {this.stateCode});

  final _HighwayShieldType type;

  /// Route number as a string (e.g. "95", "101", "1A").
  final String number;

  /// Two-letter state/province code used for [_HighwayShieldType.stateHighway]
  /// signs (e.g. "CA", "TX").  May be `null` for generic SR/SH/Hwy patterns.
  final String? stateCode;
}

// ── Interstate shield painter ─────────────────────────────────────────────────

/// Renders a stylised US Interstate shield:
///   • Blue body shaped like a classic highway shield (pentagon top cut).
///   • Red top band with "INTERSTATE" micro-label.
///   • White route number centred in the blue body.
class _InterstateShieldPainter extends CustomPainter {
  const _InterstateShieldPainter(this.number, {this.fontSize = 11});

  final String number;
  final double fontSize;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // Shield outline path — pentagon-top shield shape
    final shieldPath = Path()
      ..moveTo(w * 0.5, 0)
      ..lineTo(w, h * 0.18)
      ..lineTo(w, h * 0.82)
      ..quadraticBezierTo(w, h, w * 0.78, h)
      ..lineTo(w * 0.22, h)
      ..quadraticBezierTo(0, h, 0, h * 0.82)
      ..lineTo(0, h * 0.18)
      ..close();

    // Blue body
    canvas.drawPath(shieldPath, Paint()..color = const Color(0xFF003399));

    // Red top band (roughly top 28% of the shield)
    final redBandPath = Path()
      ..moveTo(w * 0.5, 0)
      ..lineTo(w, h * 0.18)
      ..lineTo(w, h * 0.30)
      ..lineTo(0, h * 0.30)
      ..lineTo(0, h * 0.18)
      ..close();
    canvas.drawPath(redBandPath, Paint()..color = const Color(0xFFCC0000));

    // White border
    canvas.drawPath(
      shieldPath,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = w * 0.07,
    );

    // "INTERSTATE" micro text in red band
    _paintText(
      canvas,
      'INTERSTATE',
      Offset(w / 2, h * 0.165),
      fontSize * 0.55,
      Colors.white,
      bold: false,
    );

    // Route number in blue body
    _paintText(
      canvas,
      number,
      Offset(w / 2, h * 0.66),
      fontSize * 1.1,
      Colors.white,
      bold: true,
    );
  }

  void _paintText(
    Canvas canvas,
    String text,
    Offset center,
    double size,
    Color color, {
    bool bold = false,
  }) {
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: color,
          fontSize: size,
          fontWeight: bold ? FontWeight.w900 : FontWeight.w600,
          height: 1,
        ),
      ),
      textAlign: TextAlign.center,
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, center - Offset(tp.width / 2, tp.height / 2));
  }

  @override
  bool shouldRepaint(_InterstateShieldPainter old) =>
      old.number != number || old.fontSize != fontSize;
}

// ── US Highway shield painter ─────────────────────────────────────────────────

/// Renders a stylised US Highway sign:
///   • Black pentagon (cut-corner rectangle) body.
///   • "US" label in the top portion.
///   • White route number centred in the black body.
class _UsHighwayShieldPainter extends CustomPainter {
  const _UsHighwayShieldPainter(this.number, {this.fontSize = 11});

  final String number;
  final double fontSize;

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    // Pentagon-like shape: flat top with cut corners at bottom
    final bodyPath = Path()
      ..moveTo(w * 0.15, 0)
      ..lineTo(w * 0.85, 0)
      ..lineTo(w, h * 0.15)
      ..lineTo(w, h * 0.78)
      ..quadraticBezierTo(w, h, w * 0.78, h)
      ..lineTo(w * 0.22, h)
      ..quadraticBezierTo(0, h, 0, h * 0.78)
      ..lineTo(0, h * 0.15)
      ..close();

    // Black fill
    canvas.drawPath(bodyPath, Paint()..color = Colors.black);

    // White border
    canvas.drawPath(
      bodyPath,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = w * 0.08,
    );

    // Inner white border (double-border effect)
    canvas.save();
    canvas.translate(w * 0.08, h * 0.08);
    canvas.scale(0.84, 0.84);
    canvas.drawPath(
      bodyPath,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = w * 0.06,
    );
    canvas.restore();

    // "US" label
    _paintText(
      canvas,
      'US',
      Offset(w / 2, h * 0.32),
      fontSize * 0.65,
      Colors.white,
    );

    // Route number
    _paintText(
      canvas,
      number,
      Offset(w / 2, h * 0.72),
      fontSize * 1.05,
      Colors.white,
      bold: true,
    );
  }

  void _paintText(
    Canvas canvas,
    String text,
    Offset center,
    double size,
    Color color, {
    bool bold = false,
  }) {
    final tp = TextPainter(
      text: TextSpan(
        text: text,
        style: TextStyle(
          color: color,
          fontSize: size,
          fontWeight: bold ? FontWeight.w900 : FontWeight.w700,
          height: 1,
        ),
      ),
      textAlign: TextAlign.center,
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, center - Offset(tp.width / 2, tp.height / 2));
  }

  @override
  bool shouldRepaint(_UsHighwayShieldPainter old) =>
      old.number != number || old.fontSize != fontSize;
}

// ── POI Address Dialog helpers ────────────────────────────────────────────────
//
// These stateful widgets handle the asynchronous reverse-geocoding look-up for
// POI dialogs.  Keeping them as separate StatefulWidgets means the loading
// spinner / address swap is contained inside the dialog without touching the
// parent TruckMapScreen state.

enum _PoiReportKind { parking, diesel }

/// Dialog shown when a [PoiItem] map marker is tapped.
///
/// Displays the POI name immediately, then resolves [geocodeFuture] to show the
/// exact street address.  Shows "Address unavailable" when the geocoding API
/// cannot return a precise street-level result.
class _PoiAddressDialog extends StatefulWidget {
  const _PoiAddressDialog({
    required this.poiName,
    required this.geocodeFuture,
    this.onReport,
  });

  final String poiName;
  final Future<String?> geocodeFuture;
  final VoidCallback? onReport;

  @override
  State<_PoiAddressDialog> createState() => _PoiAddressDialogState();
}

class _PoiAddressDialogState extends State<_PoiAddressDialog> {
  String? _resolvedAddress;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    widget.geocodeFuture
        .then((addr) {
          if (mounted) {
            setState(() {
              _resolvedAddress = addr;
              _loading = false;
            });
          }
        })
        .catchError((_) {
          if (mounted) setState(() => _loading = false);
        });
  }

  @override
  Widget build(BuildContext context) {
    final String addressLabel = _loading
        ? ''
        : (_resolvedAddress ?? 'Address unavailable');
    return AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Text(widget.poiName),
      content: _loading
          ? const SizedBox(
              height: 40,
              child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
            )
          : Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.location_on, size: 18, color: Colors.grey),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    addressLabel,
                    style: const TextStyle(fontSize: 14),
                  ),
                ),
              ],
            ),
      actions: [
        if (widget.onReport != null)
          TextButton(
            onPressed: widget.onReport,
            child: const Text('Report Live Data'),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('OK'),
        ),
      ],
    );
  }
}

/// Alert dialog shown when the driver is approaching a [MapPoi] (weigh station,
/// police checkpoint, port of entry, or 511 camera).
///
/// Shows the POI type, name, status, and best available address.  The address
/// row is populated asynchronously from [geocodeFuture].
class _MapPoiAlertDialog extends StatefulWidget {
  const _MapPoiAlertDialog({
    required this.poi,
    required this.typeLabel,
    required this.typeIcon,
    required this.typeColor,
    required this.geocodeFuture,
    this.activityFuture,
    this.onReportStatus,
  });

  final MapPoi poi;
  final String typeLabel;
  final IconData typeIcon;
  final Color typeColor;
  final Future<String?> geocodeFuture;
  final Future<live_ws.WeighStationStatusSummary?>? activityFuture;
  final VoidCallback? onReportStatus;

  @override
  State<_MapPoiAlertDialog> createState() => _MapPoiAlertDialogState();
}

class _MapPoiAlertDialogState extends State<_MapPoiAlertDialog> {
  String? _resolvedAddress;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    widget.geocodeFuture
        .then((addr) {
          if (mounted) {
            setState(() {
              _resolvedAddress = addr;
              _loading = false;
            });
          }
        })
        .catchError((_) {
          if (mounted) setState(() => _loading = false);
        });
  }

  String _statusLabel(live_ws.WeighStationStatus value) => switch (value) {
    live_ws.WeighStationStatus.open => 'Open',
    live_ws.WeighStationStatus.closed => 'Closed',
    live_ws.WeighStationStatus.inspection => 'Inspection active',
    live_ws.WeighStationStatus.unknown => 'Unknown',
  };

  Widget _detailRow(IconData icon, String text) => Padding(
    padding: const EdgeInsets.only(top: 7),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: Colors.grey.shade600),
        const SizedBox(width: 6),
        Expanded(child: Text(text, style: const TextStyle(fontSize: 13))),
      ],
    ),
  );

  Widget _buildActivity() {
    final future = widget.activityFuture;
    if (future == null) return const SizedBox.shrink();
    return FutureBuilder<live_ws.WeighStationStatusSummary?>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.only(top: 10),
            child: LinearProgressIndicator(minHeight: 2),
          );
        }
        final activity = snapshot.data;
        if (activity == null) {
          return _detailRow(
            Icons.groups_outlined,
            'No verified live station activity is available.',
          );
        }
        final freshness = activity.stale ? 'stale' : 'current';
        return _detailRow(
          Icons.groups_outlined,
          '${_statusLabel(activity.value)} • ${activity.source} • '
          '${(activity.confidence * 100).round()}% confidence • $freshness'
          '${activity.lastReportedAt == null ? '' : ' • ${activity.lastReportedAt!.toLocal()}'}'
          '${activity.confirmations == 0 && activity.disagreements == 0 ? '' : ' • ${activity.confirmations} confirmations, ${activity.disagreements} disagreements'}',
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final String addressLabel = _loading
        ? ''
        : (_resolvedAddress ?? 'Address unavailable');
    final station = widget.poi.weighStation;

    return AlertDialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Row(
        children: [
          Icon(widget.typeIcon, color: widget.typeColor, size: 28),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              widget.typeLabel,
              style: TextStyle(
                color: widget.typeColor,
                fontWeight: FontWeight.bold,
                fontSize: 18,
              ),
            ),
          ),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.poi.name,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            Text(
              'Status: ${widget.poi.status}',
              style: const TextStyle(fontSize: 14),
            ),
            const SizedBox(height: 6),
            if (_loading)
              const SizedBox(
                height: 20,
                child: Row(
                  children: [
                    SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    SizedBox(width: 8),
                    Text(
                      'Loading address…',
                      style: TextStyle(fontSize: 13, color: Colors.grey),
                    ),
                  ],
                ),
              )
            else
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.location_on, size: 16, color: Colors.grey),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      addressLabel,
                      style: const TextStyle(fontSize: 13, color: Colors.grey),
                    ),
                  ),
                ],
              ),
            if (station != null) ...[
              if ((station.highway ?? '').trim().isNotEmpty)
                _detailRow(
                  Icons.route_outlined,
                  [
                    station.highway!.trim(),
                    if ((station.direction ?? '').trim().isNotEmpty)
                      station.direction!.trim(),
                    if (station.mileMarker != null)
                      'mile ${station.mileMarker!.toStringAsFixed(1)}',
                  ].join(' • '),
                ),
              _detailRow(
                station.isOfficial
                    ? Icons.verified_outlined
                    : Icons.info_outline,
                'Source: ${station.officialSourceName}',
              ),
              if (station.lastStatusUpdate != null)
                _detailRow(
                  Icons.update_rounded,
                  'Official status updated ${station.lastStatusUpdate!.toLocal()}',
                ),
            ],
            _buildActivity(),
            const SizedBox(height: 12),
            const Text(
              'Station status can change quickly. Follow posted signs and official instructions.',
              style: TextStyle(fontSize: 13, color: Colors.grey),
            ),
          ],
        ),
      ),
      actions: [
        if (widget.onReportStatus != null)
          TextButton(
            onPressed: widget.onReportStatus,
            child: const Text('Report Status'),
          ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Dismiss'),
        ),
      ],
    );
  }
}

// ── POI map-layer filtering helpers ──────────────────────────────────────────

/// Pairs a [PoiItem] with its computed distance (in miles) for sorting.
class _ScoredPoi {
  const _ScoredPoi(this.poi, this.distanceMiles);
  final PoiItem poi;
  final double distanceMiles;
}
