import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:latlong2/latlong.dart';
import 'package:semitrack_mobile/models/weigh_station.dart';

typedef RemoteWeighStationLoader = Future<Map<String, dynamic>?> Function(
  String state,
  String? bundledVersion,
);

class WeighStationRepository {
  WeighStationRepository({
    AssetBundle? bundle,
    this.remoteLoader,
  }) : bundle = bundle ?? rootBundle;

  final AssetBundle bundle;
  final RemoteWeighStationLoader? remoteLoader;
  final Map<String, List<WeighStation>> _byState = {};
  Map<String, dynamic>? _manifest;

  Future<Map<String, dynamic>> get manifest async {
    return _manifest ??= jsonDecode(await bundle.loadString(
      'assets/data/weigh_stations/us_weigh_stations_manifest.json',
    )) as Map<String, dynamic>;
  }

  Future<List<WeighStation>> getStationsByState(String state) async {
    final normalized = state.trim().toUpperCase();
    final cached = _byState[normalized];
    if (cached != null) return cached;

    final manifestData = await manifest;
    final states = (manifestData['states'] as List? ?? const [])
        .cast<Map<String, dynamic>>();
    final stateMeta = states.cast<Map<String, dynamic>?>().firstWhere(
          (item) => item?['state'] == normalized,
          orElse: () => null,
        );
    if (stateMeta == null) return const [];

    Map<String, dynamic>? data;
    if (remoteLoader != null) {
      try {
        data = await remoteLoader!(
            normalized, stateMeta['datasetVersion']?.toString());
      } catch (_) {
        data = null;
      }
    }
    data ??= jsonDecode(await bundle.loadString(
      'assets/data/weigh_stations/$normalized.json',
    )) as Map<String, dynamic>;

    final stations = (data['stations'] as List? ?? const [])
        .cast<Map<String, dynamic>>()
        .map(WeighStation.fromJson)
        .where((station) => station.isActive && station.state == normalized)
        .toList(growable: false);
    _byState[normalized] = stations;
    return stations;
  }

  Future<List<WeighStation>> getAllStations() async {
    final data = await manifest;
    final states = (data['states'] as List? ?? const [])
        .cast<Map<String, dynamic>>()
        .map((entry) => entry['state'].toString());
    final results = await Future.wait(states.map(getStationsByState));
    return results.expand((items) => items).toList(growable: false);
  }

  Future<List<WeighStation>> getStationsNearLocation(
    LatLng location, {
    double radiusMeters = 80467,
  }) async {
    final stations = await getAllStations();
    return getStationsWithinDistance(stations, location, radiusMeters);
  }

  List<WeighStation> getStationsWithinDistance(
    Iterable<WeighStation> stations,
    LatLng location,
    double radiusMeters,
  ) {
    const distance = Distance();
    final matches = stations
        .map((station) => (
              station: station,
              meters: distance.as(LengthUnit.Meter, location, station.position),
            ))
        .where((entry) => entry.meters <= radiusMeters)
        .toList()
      ..sort((a, b) => a.meters.compareTo(b.meters));
    return matches.map((entry) => entry.station).toList(growable: false);
  }

  List<UpcomingWeighStation> getStationsAlongRoute(
    Iterable<WeighStation> stations,
    List<LatLng> route, {
    double maxCorridorMeters = 2500,
    double currentRouteOffsetMeters = 0,
    double maxDistanceAheadMeters = 160934,
    double? routeBearing,
  }) {
    if (route.length < 2) return const [];
    const distance = Distance();
    final cumulative = <double>[0];
    for (var index = 1; index < route.length; index++) {
      cumulative
          .add(cumulative.last + distance(route[index - 1], route[index]));
    }
    final matches = <UpcomingWeighStation>[];
    for (final station in stations) {
      if (!_directionMatches(station.direction, routeBearing)) continue;
      var closestMeters = double.infinity;
      var routeOffset = 0.0;
      for (var index = 1; index < route.length; index++) {
        final projection =
            _project(station.position, route[index - 1], route[index]);
        if (projection.distanceMeters < closestMeters) {
          closestMeters = projection.distanceMeters;
          routeOffset = cumulative[index - 1] +
              (cumulative[index] - cumulative[index - 1]) * projection.fraction;
        }
      }
      final ahead = routeOffset - currentRouteOffsetMeters;
      if (closestMeters <= maxCorridorMeters &&
          ahead >= 0 &&
          ahead <= maxDistanceAheadMeters) {
        matches.add(UpcomingWeighStation(
          station: station,
          routeDistanceMeters: ahead,
          distanceFromRouteMeters: closestMeters,
        ));
      }
    }
    matches
        .sort((a, b) => a.routeDistanceMeters.compareTo(b.routeDistanceMeters));
    return matches;
  }

  UpcomingWeighStation? getNextStationAhead(
    Iterable<WeighStation> stations,
    List<LatLng> route, {
    double maxCorridorMeters = 2500,
    double currentRouteOffsetMeters = 0,
    double maxDistanceAheadMeters = 160934,
    double? routeBearing,
  }) {
    final matches = getStationsAlongRoute(
      stations,
      route,
      maxCorridorMeters: maxCorridorMeters,
      currentRouteOffsetMeters: currentRouteOffsetMeters,
      maxDistanceAheadMeters: maxDistanceAheadMeters,
      routeBearing: routeBearing,
    );
    return matches.isEmpty ? null : matches.first;
  }

  ({double fraction, double distanceMeters}) _project(
    LatLng point,
    LatLng start,
    LatLng end,
  ) {
    const latitudeScale = 111320.0;
    final longitudeScale = math.max(
      1.0,
      latitudeScale * math.cos(point.latitude * math.pi / 180),
    );
    final x = (point.longitude - start.longitude) * longitudeScale;
    final y = (point.latitude - start.latitude) * latitudeScale;
    final dx = (end.longitude - start.longitude) * longitudeScale;
    final dy = (end.latitude - start.latitude) * latitudeScale;
    final lengthSquared = dx * dx + dy * dy;
    final fraction = lengthSquared == 0
        ? 0.0
        : ((x * dx + y * dy) / lengthSquared).clamp(0.0, 1.0);
    final projected = LatLng(
      start.latitude + (end.latitude - start.latitude) * fraction,
      start.longitude + (end.longitude - start.longitude) * fraction,
    );
    return (
      fraction: fraction,
      distanceMeters: const Distance()(point, projected),
    );
  }

  bool _directionMatches(String? direction, double? bearing) {
    if (direction == null || bearing == null) return true;
    const bearings = <String, double>{
      'N': 0,
      'NORTH': 0,
      'NB': 0,
      'E': 90,
      'EAST': 90,
      'EB': 90,
      'S': 180,
      'SOUTH': 180,
      'SB': 180,
      'W': 270,
      'WEST': 270,
      'WB': 270,
      'NE': 45,
      'SE': 135,
      'SW': 225,
      'NW': 315,
    };
    final expected = bearings[direction.trim().toUpperCase()];
    if (expected == null) return true;
    final difference = (((bearing - expected + 540) % 360) - 180).abs();
    return difference <= 75;
  }
}
