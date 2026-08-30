import 'package:latlong2/latlong.dart';

class LiveRoadEvent {
  const LiveRoadEvent({
    required this.id,
    required this.title,
    required this.type,
    required this.severity,
    required this.position,
    required this.routeDistanceAheadMeters,
    required this.lastUpdated,
    required this.provider,
    this.description,
    this.affectedRoad,
    this.direction,
    this.endsAt,
    this.sourceUrl,
  });

  final String id;
  final String title;
  final String? description;
  final String type;
  final String severity;
  final LatLng position;
  final String? affectedRoad;
  final String? direction;
  final double routeDistanceAheadMeters;
  final DateTime lastUpdated;
  final DateTime? endsAt;
  final String provider;
  final String? sourceUrl;

  factory LiveRoadEvent.fromJson(Map<String, dynamic> json) => LiveRoadEvent(
    id: json['id'].toString(),
    title: json['title'].toString(),
    description: json['description']?.toString(),
    type: json['type'].toString(),
    severity: json['severity'].toString(),
    position: LatLng(
      (json['latitude'] as num).toDouble(),
      (json['longitude'] as num).toDouble(),
    ),
    affectedRoad: json['affectedRoad']?.toString(),
    direction: json['direction']?.toString(),
    routeDistanceAheadMeters: (json['routeDistanceAheadMeters'] as num)
        .toDouble(),
    lastUpdated: DateTime.parse(json['lastUpdated'].toString()),
    endsAt: DateTime.tryParse(json['endsAt']?.toString() ?? ''),
    provider: json['provider'].toString(),
    sourceUrl: json['sourceUrl']?.toString(),
  );
}

class RouteRestrictionNotice {
  const RouteRestrictionNotice({
    required this.id,
    required this.type,
    required this.position,
    required this.routeDistanceAheadMeters,
    required this.source,
    required this.authoritative,
    required this.verified,
    required this.confidence,
    required this.lastUpdated,
    this.roadName,
    this.direction,
    this.heightLimitFt,
    this.grossWeightLimitLbs,
    this.axleWeightLimitLbs,
    this.widthLimitFt,
    this.lengthLimitFt,
    this.hazmatTypes = const [],
  });

  final String id;
  final String type;
  final LatLng position;
  final String? roadName;
  final String? direction;
  final double? heightLimitFt;
  final int? grossWeightLimitLbs;
  final int? axleWeightLimitLbs;
  final double? widthLimitFt;
  final double? lengthLimitFt;
  final List<String> hazmatTypes;
  final double routeDistanceAheadMeters;
  final String source;
  final bool authoritative;
  final bool verified;
  final double confidence;
  final DateTime lastUpdated;

  factory RouteRestrictionNotice.fromJson(Map<String, dynamic> json) =>
      RouteRestrictionNotice(
        id: json['id'].toString(),
        type: json['restrictionType'].toString(),
        position: LatLng(
          (json['latitude'] as num).toDouble(),
          (json['longitude'] as num).toDouble(),
        ),
        roadName: json['roadName']?.toString(),
        direction: json['direction']?.toString(),
        heightLimitFt: (json['heightLimitFt'] as num?)?.toDouble(),
        grossWeightLimitLbs: (json['grossWeightLimitLbs'] as num?)?.toInt(),
        axleWeightLimitLbs: (json['axleWeightLimitLbs'] as num?)?.toInt(),
        widthLimitFt: (json['widthLimitFt'] as num?)?.toDouble(),
        lengthLimitFt: (json['lengthLimitFt'] as num?)?.toDouble(),
        hazmatTypes: (json['hazmatTypes'] as List? ?? const [])
            .map((value) => value.toString())
            .toList(growable: false),
        routeDistanceAheadMeters: (json['routeDistanceAheadMeters'] as num)
            .toDouble(),
        source: json['source'].toString(),
        authoritative: json['authoritative'] as bool? ?? false,
        verified: json['verified'] as bool? ?? false,
        confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
        lastUpdated: DateTime.parse(json['lastUpdated'].toString()),
      );
}

class TrafficCameraLocation {
  const TrafficCameraLocation({
    required this.id,
    required this.name,
    required this.position,
    required this.provider,
    required this.lastUpdated,
    required this.routeDistanceAheadMeters,
    this.roadway,
    this.direction,
    this.imageUrl,
    this.streamUrl,
  });

  final String id;
  final String name;
  final LatLng position;
  final String provider;
  final String? roadway;
  final String? direction;
  final String? imageUrl;
  final String? streamUrl;
  final DateTime lastUpdated;
  final double routeDistanceAheadMeters;

  factory TrafficCameraLocation.fromJson(Map<String, dynamic> json) =>
      TrafficCameraLocation(
        id: json['id'].toString(),
        name: json['name'].toString(),
        position: LatLng(
          (json['latitude'] as num).toDouble(),
          (json['longitude'] as num).toDouble(),
        ),
        provider: json['provider'].toString(),
        roadway: json['roadway']?.toString(),
        direction: json['direction']?.toString(),
        imageUrl: json['imageUrl']?.toString(),
        streamUrl: json['streamUrl']?.toString(),
        lastUpdated: DateTime.parse(json['lastUpdated'].toString()),
        routeDistanceAheadMeters: (json['routeDistanceAheadMeters'] as num)
            .toDouble(),
      );
}

class LiveParkingLocation {
  const LiveParkingLocation({
    required this.id,
    required this.name,
    required this.position,
    required this.routeDistanceAheadMeters,
    required this.availability,
    required this.source,
    required this.confidence,
    this.lastReportedAt,
    this.totalTruckSpaces,
  });

  final String id;
  final String name;
  final LatLng position;
  final double routeDistanceAheadMeters;
  final String availability;
  final String source;
  final double confidence;
  final DateTime? lastReportedAt;
  final int? totalTruckSpaces;

  factory LiveParkingLocation.fromJson(Map<String, dynamic> json) {
    final aggregate = json['currentAvailability'] as Map? ?? const {};
    return LiveParkingLocation(
      id: json['id'].toString(),
      name: json['name'].toString(),
      position: LatLng(
        (json['latitude'] as num).toDouble(),
        (json['longitude'] as num).toDouble(),
      ),
      routeDistanceAheadMeters: (json['routeDistanceAheadMeters'] as num)
          .toDouble(),
      availability: aggregate['value']?.toString() ?? 'UNKNOWN',
      source: aggregate['source']?.toString() ?? 'UNKNOWN',
      confidence: (aggregate['confidence'] as num?)?.toDouble() ?? 0,
      lastReportedAt: DateTime.tryParse(
        aggregate['lastReportedAt']?.toString() ?? '',
      ),
      totalTruckSpaces: (json['totalTruckSpaces'] as num?)?.toInt(),
    );
  }
}

class LiveDieselStation {
  const LiveDieselStation({
    required this.id,
    required this.name,
    required this.position,
    required this.routeDistanceAheadMeters,
    this.cashPrice,
    this.creditPrice,
    this.observedAt,
    this.source,
    this.confidence = 0,
    this.verified = false,
  });

  final String id;
  final String name;
  final LatLng position;
  final double routeDistanceAheadMeters;
  final double? cashPrice;
  final double? creditPrice;
  final DateTime? observedAt;
  final String? source;
  final double confidence;
  final bool verified;

  factory LiveDieselStation.fromJson(Map<String, dynamic> json) {
    final prices = json['prices'] as List? ?? const [];
    final price = prices.isEmpty
        ? const <String, dynamic>{}
        : prices.first as Map<String, dynamic>;
    double? number(Object? value) => value == null
        ? null
        : value is num
        ? value.toDouble()
        : double.tryParse(value.toString());

    return LiveDieselStation(
      id: json['id'].toString(),
      name: json['name'].toString(),
      position: LatLng(
        (json['latitude'] as num).toDouble(),
        (json['longitude'] as num).toDouble(),
      ),
      routeDistanceAheadMeters: (json['routeDistanceAheadMeters'] as num)
          .toDouble(),
      cashPrice: number(price['cashPrice']),
      creditPrice: number(price['creditPrice']),
      observedAt: DateTime.tryParse(price['observedAt']?.toString() ?? ''),
      source: price['source']?.toString(),
      confidence: (price['confidence'] as num?)?.toDouble() ?? 0,
      verified: price['verified'] as bool? ?? false,
    );
  }
}

class RoadFeature {
  const RoadFeature({
    required this.id,
    required this.kind,
    required this.title,
    required this.position,
    required this.provider,
    required this.sourceUrl,
    required this.distanceMeters,
    this.direction,
    this.value,
    this.lastUpdated,
  });

  final String id;
  final String kind;
  final String title;
  final LatLng position;
  final String? direction;
  final String? value;
  final String provider;
  final String sourceUrl;
  final DateTime? lastUpdated;
  final double distanceMeters;

  factory RoadFeature.fromJson(Map<String, dynamic> json) => RoadFeature(
    id: json['id'].toString(),
    kind: json['kind'].toString(),
    title: json['title'].toString(),
    position: LatLng(
      (json['latitude'] as num).toDouble(),
      (json['longitude'] as num).toDouble(),
    ),
    direction: json['direction']?.toString(),
    value: json['value']?.toString(),
    provider: json['provider']?.toString() ?? 'Unknown',
    sourceUrl: json['sourceUrl']?.toString() ?? '',
    lastUpdated: DateTime.tryParse(json['lastUpdated']?.toString() ?? ''),
    distanceMeters: (json['distanceMeters'] as num?)?.toDouble() ?? 0,
  );
}

class DriverSafetySnapshot {
  const DriverSafetySnapshot({
    this.restrictions = const [],
    this.events = const [],
    this.cameras = const [],
    this.parking = const [],
    this.fuel = const [],
    this.errors = const [],
  });

  final List<RouteRestrictionNotice> restrictions;
  final List<LiveRoadEvent> events;
  final List<TrafficCameraLocation> cameras;
  final List<LiveParkingLocation> parking;
  final List<LiveDieselStation> fuel;
  final List<String> errors;
}
