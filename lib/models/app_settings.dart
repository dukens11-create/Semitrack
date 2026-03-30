/// Shared settings model for the Semitrax app.
///
/// Holds truck dimensions, fuel data, route preferences, and app toggles.
/// Immutable — use [copyWith] to produce a modified copy.
class AppSettings {
  final double truckHeightFt;
  final double truckWeightLb;
  final double truckLengthFt;
  final double fuelTankGallons;
  final double avgMpg;
  final bool avoidTolls;
  final bool avoidFerries;
  final bool preferTruckSafe;
  final bool voiceNavigation;
  final bool darkMode;

  const AppSettings({
    required this.truckHeightFt,
    required this.truckWeightLb,
    required this.truckLengthFt,
    required this.fuelTankGallons,
    required this.avgMpg,
    required this.avoidTolls,
    required this.avoidFerries,
    required this.preferTruckSafe,
    required this.voiceNavigation,
    required this.darkMode,
  });

  factory AppSettings.defaults() {
    return const AppSettings(
      truckHeightFt: 13.6,
      truckWeightLb: 80000,
      truckLengthFt: 72,
      fuelTankGallons: 150,
      avgMpg: 6.8,
      avoidTolls: false,
      avoidFerries: true,
      preferTruckSafe: true,
      voiceNavigation: true,
      darkMode: false,
    );
  }

  AppSettings copyWith({
    double? truckHeightFt,
    double? truckWeightLb,
    double? truckLengthFt,
    double? fuelTankGallons,
    double? avgMpg,
    bool? avoidTolls,
    bool? avoidFerries,
    bool? preferTruckSafe,
    bool? voiceNavigation,
    bool? darkMode,
  }) {
    return AppSettings(
      truckHeightFt: truckHeightFt ?? this.truckHeightFt,
      truckWeightLb: truckWeightLb ?? this.truckWeightLb,
      truckLengthFt: truckLengthFt ?? this.truckLengthFt,
      fuelTankGallons: fuelTankGallons ?? this.fuelTankGallons,
      avgMpg: avgMpg ?? this.avgMpg,
      avoidTolls: avoidTolls ?? this.avoidTolls,
      avoidFerries: avoidFerries ?? this.avoidFerries,
      preferTruckSafe: preferTruckSafe ?? this.preferTruckSafe,
      voiceNavigation: voiceNavigation ?? this.voiceNavigation,
      darkMode: darkMode ?? this.darkMode,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'truckHeightFt': truckHeightFt,
      'truckWeightLb': truckWeightLb,
      'truckLengthFt': truckLengthFt,
      'fuelTankGallons': fuelTankGallons,
      'avgMpg': avgMpg,
      'avoidTolls': avoidTolls,
      'avoidFerries': avoidFerries,
      'preferTruckSafe': preferTruckSafe,
      'voiceNavigation': voiceNavigation,
      'darkMode': darkMode,
    };
  }

  factory AppSettings.fromMap(Map<String, dynamic> map) {
    final defaults = AppSettings.defaults();
    return AppSettings(
      truckHeightFt:
          (map['truckHeightFt'] as num?)?.toDouble() ?? defaults.truckHeightFt,
      truckWeightLb:
          (map['truckWeightLb'] as num?)?.toDouble() ?? defaults.truckWeightLb,
      truckLengthFt:
          (map['truckLengthFt'] as num?)?.toDouble() ?? defaults.truckLengthFt,
      fuelTankGallons: (map['fuelTankGallons'] as num?)?.toDouble() ??
          defaults.fuelTankGallons,
      avgMpg: (map['avgMpg'] as num?)?.toDouble() ?? defaults.avgMpg,
      avoidTolls: map['avoidTolls'] as bool? ?? defaults.avoidTolls,
      avoidFerries: map['avoidFerries'] as bool? ?? defaults.avoidFerries,
      preferTruckSafe:
          map['preferTruckSafe'] as bool? ?? defaults.preferTruckSafe,
      voiceNavigation:
          map['voiceNavigation'] as bool? ?? defaults.voiceNavigation,
      darkMode: map['darkMode'] as bool? ?? defaults.darkMode,
    );
  }

  /// Estimated maximum range in miles on a full tank.
  double get fuelRangeMiles => fuelTankGallons * avgMpg;
}
