import 'package:latlong2/latlong.dart';

enum WeighStationType {
  fixedWeighStation,
  portOfEntry,
  commercialVehicleEnforcement,
  inspectionStation,
  enforcementWim,
  virtualWeighStation,
  otherEnforcement;

  static WeighStationType parse(String value) => switch (value) {
        'FIXED_WEIGH_STATION' => fixedWeighStation,
        'PORT_OF_ENTRY' => portOfEntry,
        'COMMERCIAL_VEHICLE_ENFORCEMENT' => commercialVehicleEnforcement,
        'INSPECTION_STATION' => inspectionStation,
        'ENFORCEMENT_WIM' => enforcementWim,
        'VIRTUAL_WEIGH_STATION' => virtualWeighStation,
        'OTHER_ENFORCEMENT' => otherEnforcement,
        _ => throw FormatException('Unsupported weigh-station type: $value'),
      };
}

enum WeighStationStatus {
  open,
  closed,
  inspection,
  unknown;

  static WeighStationStatus parse(String? value) => switch (value) {
        'OPEN' => open,
        'CLOSED' => closed,
        'INSPECTION' || 'INSPECTION_ACTIVE' => inspection,
        _ => unknown,
      };

  String get apiValue => name.toUpperCase();
}

class WeighStation {
  const WeighStation({
    required this.id,
    required this.name,
    required this.state,
    required this.position,
    required this.type,
    required this.status,
    required this.officialSourceName,
    required this.officialSourceUrl,
    required this.isOfficial,
    required this.isActive,
    required this.createdAt,
    required this.updatedAt,
    this.highway,
    this.direction,
    this.mileMarker,
    this.statusSource,
    this.lastOfficialVerification,
    this.lastStatusUpdate,
  });

  final String id;
  final String name;
  final String state;
  final LatLng position;
  final String? highway;
  final String? direction;
  final double? mileMarker;
  final WeighStationType type;
  final WeighStationStatus status;
  final String? statusSource;
  final String officialSourceName;
  final String officialSourceUrl;
  final bool isOfficial;
  final bool isActive;
  final DateTime? lastOfficialVerification;
  final DateTime? lastStatusUpdate;
  final DateTime createdAt;
  final DateTime updatedAt;

  factory WeighStation.fromJson(Map<String, dynamic> json) {
    final latitude = (json['latitude'] as num?)?.toDouble();
    final longitude = (json['longitude'] as num?)?.toDouble();
    if (latitude == null ||
        longitude == null ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180) {
      throw const FormatException('Weigh station has invalid coordinates');
    }
    final sourceUrl = json['officialSourceUrl']?.toString() ?? '';
    final parsedSourceUrl = Uri.tryParse(sourceUrl);
    if (parsedSourceUrl == null ||
        !(parsedSourceUrl.scheme == 'https' ||
            parsedSourceUrl.scheme == 'http')) {
      throw const FormatException(
          'Weigh station requires an official source URL');
    }
    return WeighStation(
      id: json['id'].toString(),
      name: json['name'].toString(),
      state: json['state'].toString().toUpperCase(),
      position: LatLng(latitude, longitude),
      highway: json['highway']?.toString(),
      direction: json['direction']?.toString(),
      mileMarker: (json['mileMarker'] as num?)?.toDouble(),
      type: WeighStationType.parse(json['type'].toString()),
      status: WeighStationStatus.parse(json['status']?.toString()),
      statusSource: json['statusSource']?.toString(),
      officialSourceName: json['officialSourceName'].toString(),
      officialSourceUrl: sourceUrl,
      isOfficial: json['isOfficial'] as bool? ?? true,
      isActive: json['isActive'] as bool? ?? true,
      lastOfficialVerification:
          DateTime.tryParse(json['lastOfficialVerification']?.toString() ?? ''),
      lastStatusUpdate:
          DateTime.tryParse(json['lastStatusUpdate']?.toString() ?? ''),
      createdAt: DateTime.parse(json['createdAt'].toString()),
      updatedAt: DateTime.parse(json['updatedAt'].toString()),
    );
  }
}

class UpcomingWeighStation {
  const UpcomingWeighStation({
    required this.station,
    required this.routeDistanceMeters,
    required this.distanceFromRouteMeters,
  });

  final WeighStation station;
  final double routeDistanceMeters;
  final double distanceFromRouteMeters;
}

class WeighStationStatusSummary {
  const WeighStationStatusSummary({
    required this.value,
    required this.source,
    required this.confidence,
    required this.stale,
    this.lastReportedAt,
    this.confirmations = 0,
    this.disagreements = 0,
  });

  final WeighStationStatus value;
  final String source;
  final double confidence;
  final bool stale;
  final DateTime? lastReportedAt;
  final int confirmations;
  final int disagreements;

  factory WeighStationStatusSummary.fromJson(Map<String, dynamic> json) =>
      WeighStationStatusSummary(
        value: WeighStationStatus.parse(json['value']?.toString()),
        source: json['source']?.toString() ?? 'UNKNOWN',
        confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
        stale: json['stale'] as bool? ?? true,
        lastReportedAt:
            DateTime.tryParse(json['lastReportedAt']?.toString() ?? ''),
        confirmations: (json['confirmations'] as num?)?.toInt() ?? 0,
        disagreements: (json['disagreements'] as num?)?.toInt() ?? 0,
      );
}
