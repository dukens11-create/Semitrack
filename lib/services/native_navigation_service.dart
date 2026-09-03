import 'dart:async';

import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';

import '../models/navigation_state.dart';

class NativeNavigationStatus {
  const NativeNavigationStatus({
    required this.running,
    required this.permission,
    required this.locationServicesEnabled,
    this.phase = 'idle',
    this.guidanceProvider = 'unavailable',
    this.truckSafeGuidanceAvailable = false,
  });

  final bool running;
  final String permission;
  final bool locationServicesEnabled;
  final String phase;
  final String guidanceProvider;
  final bool truckSafeGuidanceAvailable;

  factory NativeNavigationStatus.fromMap(Map<Object?, Object?> map) {
    return NativeNavigationStatus(
      running: map['running'] == true,
      permission: map['permission']?.toString() ?? 'unknown',
      locationServicesEnabled: map['locationServicesEnabled'] == true,
      phase: map['phase']?.toString() ?? 'idle',
      guidanceProvider: map['guidanceProvider']?.toString() ?? 'unavailable',
      truckSafeGuidanceAvailable: map['truckSafeGuidanceAvailable'] == true,
    );
  }
}

class NativeNavigationFix {
  const NativeNavigationFix({
    required this.latitude,
    required this.longitude,
    required this.timestamp,
    required this.accuracy,
    required this.altitude,
    required this.altitudeAccuracy,
    required this.heading,
    required this.headingAccuracy,
    required this.speed,
    required this.speedAccuracy,
    required this.isMocked,
  });

  final double latitude;
  final double longitude;
  final DateTime timestamp;
  final double accuracy;
  final double altitude;
  final double altitudeAccuracy;
  final double heading;
  final double headingAccuracy;
  final double speed;
  final double speedAccuracy;
  final bool isMocked;

  factory NativeNavigationFix.fromMap(Map<Object?, Object?> map) {
    double number(String key, [double fallback = 0]) {
      final value = map[key];
      if (value is! num) return fallback;
      final result = value.toDouble();
      return result.isFinite ? result : fallback;
    }

    final rawTimestamp = map['timestampMs'];
    return NativeNavigationFix(
      latitude: number('latitude'),
      longitude: number('longitude'),
      timestamp: DateTime.fromMillisecondsSinceEpoch(
        (rawTimestamp is num ? rawTimestamp.toInt() : null) ??
            DateTime.now().millisecondsSinceEpoch,
        isUtc: true,
      ),
      accuracy: number('accuracy', -1),
      altitude: number('altitude'),
      altitudeAccuracy: number('altitudeAccuracy', -1),
      heading: number('heading', -1),
      headingAccuracy: number('headingAccuracy', -1),
      speed: number('speed', -1),
      speedAccuracy: number('speedAccuracy', -1),
      isMocked: map['isMocked'] == true,
    );
  }

  Position toPosition() => Position(
    longitude: longitude,
    latitude: latitude,
    timestamp: timestamp,
    accuracy: accuracy,
    altitude: altitude,
    altitudeAccuracy: altitudeAccuracy,
    heading: heading,
    headingAccuracy: headingAccuracy,
    speed: speed,
    speedAccuracy: speedAccuracy,
    isMocked: isMocked,
  );
}

class NativeNavigationException implements Exception {
  const NativeNavigationException(this.code, this.message);
  final String code;
  final String message;

  @override
  String toString() => '$code: $message';
}

class NativeNavigationService {
  NativeNavigationService._();
  static final NativeNavigationService instance = NativeNavigationService._();

  static const MethodChannel _methods = MethodChannel(
    'com.semitrack/navigation/methods',
  );
  static const EventChannel _locations = EventChannel(
    'com.semitrack/navigation/locations',
  );

  Stream<Map<Object?, Object?>>? _events;
  Stream<NativeNavigationFix>? _fixes;
  Stream<NativeNavigationState>? _states;

  Stream<Map<Object?, Object?>> get events => _events ??= _locations
      .receiveBroadcastStream()
      .map(_coerceEvent)
      .where((event) => event != null)
      .cast<Map<Object?, Object?>>()
      .asBroadcastStream();

  Stream<NativeNavigationFix> get fixes => _fixes ??= events
      .where((event) => event['type'] == null || event['type'] == 'location')
      .map(_fixFromEvent)
      .where((fix) => fix != null)
      .cast<NativeNavigationFix>();

  Stream<NativeNavigationState> get states => _states ??= events
      .where((event) => event['type'] == 'state')
      .where((event) => event['data'] is Map)
      .map(_stateFromEvent)
      .where((state) => state != null)
      .cast<NativeNavigationState>()
      .distinct((previous, next) => previous == next);

  static Map<Object?, Object?>? _coerceEvent(Object? event) {
    if (event is! Map) return null;
    try {
      return Map<Object?, Object?>.from(event);
    } catch (_) {
      return null;
    }
  }

  static NativeNavigationFix? _fixFromEvent(Map<Object?, Object?> event) {
    try {
      final raw = event['data'];
      final data = raw is Map ? Map<Object?, Object?>.from(raw) : event;
      final fix = NativeNavigationFix.fromMap(data);
      if (!fix.latitude.isFinite ||
          !fix.longitude.isFinite ||
          fix.latitude < -90 ||
          fix.latitude > 90 ||
          fix.longitude < -180 ||
          fix.longitude > 180) {
        return null;
      }
      return fix;
    } catch (_) {
      return null;
    }
  }

  static NativeNavigationState? _stateFromEvent(Map<Object?, Object?> event) {
    try {
      final raw = event['data'];
      if (raw is! Map) return null;
      return NativeNavigationState.fromMap(Map<Object?, Object?>.from(raw));
    } catch (_) {
      return null;
    }
  }

  Future<NativeNavigationStatus> status() async {
    final value = await _methods.invokeMapMethod<Object?, Object?>('status');
    return NativeNavigationStatus.fromMap(value ?? const {});
  }

  Future<void> start({
    int intervalMs = 1000,
    double distanceFilterMeters = 0,
  }) async {
    try {
      await _methods.invokeMethod<void>('start', {
        'intervalMs': intervalMs.clamp(500, 10000),
        'distanceFilterMeters': distanceFilterMeters.clamp(0, 100),
      });
    } on PlatformException catch (error) {
      throw _platformException(error, 'Unable to start native navigation');
    } on MissingPluginException {
      throw const NativeNavigationException(
        'NATIVE_BRIDGE_UNAVAILABLE',
        'Native navigation is unavailable in this build.',
      );
    }
  }

  Future<void> startNavigation() => _invoke('startNavigation');
  Future<void> stopNavigation() => _invoke('stopNavigation');
  Future<void> previewRoute() => _invoke('previewRoute');
  Future<void> cancelRoute() => _invoke('cancelRoute');
  Future<void> muteVoice() => _invoke('muteVoice');
  Future<void> unmuteVoice() => _invoke('unmuteVoice');
  Future<void> recalculateRoute() => _invoke('recalculateRoute');

  Future<void> setTruckProfile(NativeTruckProfile profile) =>
      _invoke('setTruckProfile', profile.toMap());

  Future<void> updateDestination(double latitude, double longitude) => _invoke(
    'updateDestination',
    {'latitude': latitude, 'longitude': longitude},
  );

  Future<void> addWaypoint(String id, double latitude, double longitude) =>
      _invoke('addWaypoint', {
        'id': id,
        'latitude': latitude,
        'longitude': longitude,
      });

  Future<void> removeWaypoint(String id) =>
      _invoke('removeWaypoint', {'id': id});

  Future<void> _invoke(String method, [Map<String, Object?>? arguments]) async {
    try {
      await _methods.invokeMethod<void>(method, arguments);
    } on PlatformException catch (error) {
      throw _platformException(error, 'Native navigation operation failed');
    } on MissingPluginException {
      throw const NativeNavigationException(
        'NATIVE_BRIDGE_UNAVAILABLE',
        'Native navigation is unavailable in this build.',
      );
    }
  }

  static NativeNavigationException _platformException(
    PlatformException error,
    String fallback,
  ) => NativeNavigationException(error.code, error.message ?? fallback);

  Future<void> stop() => _invoke('stop');

  Future<void> openBatterySettings() => _invoke('openBatterySettings');
}
