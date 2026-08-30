class TruckProfile {
  const TruckProfile({
    required this.id,
    required this.name,
    required this.isDefault,
    required this.heightFt,
    required this.widthFt,
    required this.lengthFt,
    required this.weightLbs,
    required this.axleCount,
    required this.hazmatEnabled,
    required this.hazardousGoods,
    this.currentWeightLbs,
    this.weightPerAxleLbs,
    this.tractorType,
    this.trailerType,
    this.trailerCount = 1,
    this.avoidTolls = false,
    this.avoidFerries = false,
    this.avoidHighways = false,
    this.avoidResidential = true,
    this.avoidDirtRoads = true,
  });

  final String id;
  final String name;
  final bool isDefault;
  final double heightFt;
  final double widthFt;
  final double lengthFt;
  final int weightLbs;
  final int axleCount;
  final bool hazmatEnabled;
  final List<String> hazardousGoods;
  final int? currentWeightLbs;
  final int? weightPerAxleLbs;
  final String? tractorType;
  final String? trailerType;
  final int trailerCount;
  final bool avoidTolls;
  final bool avoidFerries;
  final bool avoidHighways;
  final bool avoidResidential;
  final bool avoidDirtRoads;

  factory TruckProfile.fromJson(Map<String, dynamic> json) => TruckProfile(
        id: json['id'] as String,
        name: json['name'] as String,
        isDefault: json['isDefault'] == true,
        heightFt: (json['heightFt'] as num).toDouble(),
        widthFt: (json['widthFt'] as num).toDouble(),
        lengthFt: (json['lengthFt'] as num).toDouble(),
        weightLbs: (json['weightLbs'] as num).toInt(),
        axleCount: (json['axleCount'] as num).toInt(),
        hazmatEnabled: json['hazmatEnabled'] == true,
        hazardousGoods: (json['hazardousGoods'] as List? ?? const [])
            .map((v) => v.toString())
            .toList(),
        currentWeightLbs: (json['currentWeightLbs'] as num?)?.toInt(),
        weightPerAxleLbs: (json['weightPerAxleLbs'] as num?)?.toInt(),
        tractorType: json['tractorType'] as String?,
        trailerType: json['trailerType'] as String?,
        trailerCount: (json['trailerCount'] as num?)?.toInt() ?? 1,
        avoidTolls: json['avoidTolls'] == true,
        avoidFerries: json['avoidFerries'] == true,
        avoidHighways: json['avoidHighways'] == true,
        avoidResidential: json['avoidResidential'] != false,
        avoidDirtRoads: json['avoidDirtRoads'] != false,
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'isDefault': isDefault,
        'heightFt': heightFt,
        'widthFt': widthFt,
        'lengthFt': lengthFt,
        'weightLbs': weightLbs,
        'axleCount': axleCount,
        'hazmatEnabled': hazmatEnabled,
        'hazardousGoods': hazardousGoods,
        'currentWeightLbs': currentWeightLbs,
        'weightPerAxleLbs': weightPerAxleLbs,
        'tractorType': tractorType,
        'trailerType': trailerType,
        'trailerCount': trailerCount,
        'avoidTolls': avoidTolls,
        'avoidFerries': avoidFerries,
        'avoidHighways': avoidHighways,
        'avoidResidential': avoidResidential,
        'avoidDirtRoads': avoidDirtRoads,
      };
}
