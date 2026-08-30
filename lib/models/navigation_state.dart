import 'navigation_maneuver.dart';

enum NativeNavigationPhase {
  idle,
  previewing,
  navigating,
  rerouting,
  arrived,
  error,
}

class NativeNavigationState {
  const NativeNavigationState({
    required this.phase,
    this.remainingDistanceMeters,
    this.remainingDurationSeconds,
    this.roadName,
    this.currentManeuver,
    this.nextManeuver,
    this.errorCode,
    this.errorMessage,
    this.voiceMuted = false,
  });

  final NativeNavigationPhase phase;
  final double? remainingDistanceMeters;
  final double? remainingDurationSeconds;
  final String? roadName;
  final NavigationManeuver? currentManeuver;
  final NavigationManeuver? nextManeuver;
  final String? errorCode;
  final String? errorMessage;
  final bool voiceMuted;

  factory NativeNavigationState.fromMap(Map<Object?, Object?> map) {
    final rawPhase = map['phase']?.toString() ?? 'idle';
    final phase = NativeNavigationPhase.values.firstWhere(
      (value) => value.name == rawPhase,
      orElse: () => NativeNavigationPhase.error,
    );
    NavigationManeuver? maneuver(String key) {
      final value = map[key];
      return value is Map
          ? NavigationManeuver.fromMap(Map<Object?, Object?>.from(value))
          : null;
    }

    return NativeNavigationState(
      phase: phase,
      remainingDistanceMeters: _finiteNumber(map['remainingDistanceMeters']),
      remainingDurationSeconds: _finiteNumber(map['remainingDurationSeconds']),
      roadName: _optionalString(map['roadName']),
      currentManeuver: maneuver('currentManeuver'),
      nextManeuver: maneuver('nextManeuver'),
      errorCode: _optionalString(map['errorCode']),
      errorMessage: _optionalString(map['errorMessage']),
      voiceMuted: map['voiceMuted'] == true,
    );
  }

  static double? _finiteNumber(Object? value) {
    final number = value is num ? value.toDouble() : null;
    return number != null && number.isFinite ? number : null;
  }

  static String? _optionalString(Object? value) {
    if (value == null) return null;
    final text = value.toString().trim();
    return text.isEmpty ? null : text;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is NativeNavigationState &&
          phase == other.phase &&
          remainingDistanceMeters == other.remainingDistanceMeters &&
          remainingDurationSeconds == other.remainingDurationSeconds &&
          roadName == other.roadName &&
          currentManeuver == other.currentManeuver &&
          nextManeuver == other.nextManeuver &&
          errorCode == other.errorCode &&
          errorMessage == other.errorMessage &&
          voiceMuted == other.voiceMuted;

  @override
  int get hashCode => Object.hash(
    phase,
    remainingDistanceMeters,
    remainingDurationSeconds,
    roadName,
    currentManeuver,
    nextManeuver,
    errorCode,
    errorMessage,
    voiceMuted,
  );
}

class NativeTruckProfile {
  const NativeTruckProfile({
    required this.heightMeters,
    required this.widthMeters,
    required this.lengthMeters,
    required this.grossWeightKg,
    required this.axleCount,
    required this.axleWeightsKg,
    required this.hazmatEnabled,
    required this.hazmatClasses,
    this.trailerType,
  });

  final double heightMeters;
  final double widthMeters;
  final double lengthMeters;
  final double grossWeightKg;
  final int axleCount;
  final List<double> axleWeightsKg;
  final bool hazmatEnabled;
  final List<String> hazmatClasses;
  final String? trailerType;

  Map<String, Object?> toMap() => {
    'heightMeters': heightMeters,
    'widthMeters': widthMeters,
    'lengthMeters': lengthMeters,
    'grossWeightKg': grossWeightKg,
    'axleCount': axleCount,
    'axleWeightsKg': axleWeightsKg,
    'hazmatEnabled': hazmatEnabled,
    'hazmatClasses': hazmatClasses,
    'trailerType': trailerType,
  };
}
