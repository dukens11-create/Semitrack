class NavigationManeuver {
  const NavigationManeuver({
    required this.instruction,
    required this.type,
    this.roadName,
    this.exitNumber,
    this.distanceMeters,
    this.lanes = const [],
  });

  final String instruction;
  final String type;
  final String? roadName;
  final String? exitNumber;
  final double? distanceMeters;
  final List<NavigationLane> lanes;

  factory NavigationManeuver.fromMap(Map<Object?, Object?> map) {
    String text(String key, [String fallback = '']) {
      final value = map[key];
      return value is String ? value : fallback;
    }

    String? optionalText(String key) {
      final value = map[key];
      return value is String && value.trim().isNotEmpty ? value : null;
    }

    final rawDistance = map['distanceMeters'];
    final distance = rawDistance is num ? rawDistance.toDouble() : null;
    final rawLanes = map['lanes'];
    return NavigationManeuver(
      instruction: text('instruction'),
      type: text('type', 'unknown'),
      roadName: optionalText('roadName'),
      exitNumber: optionalText('exitNumber'),
      distanceMeters: distance != null && distance.isFinite ? distance : null,
      lanes: (rawLanes is List ? rawLanes : const [])
          .whereType<Map>()
          .map(
            (lane) => NavigationLane.fromMap(Map<Object?, Object?>.from(lane)),
          )
          .toList(growable: false),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is NavigationManeuver &&
          instruction == other.instruction &&
          type == other.type &&
          roadName == other.roadName &&
          exitNumber == other.exitNumber &&
          distanceMeters == other.distanceMeters &&
          _listEquals(lanes, other.lanes);

  @override
  int get hashCode => Object.hash(
    instruction,
    type,
    roadName,
    exitNumber,
    distanceMeters,
    Object.hashAll(lanes),
  );
}

class NavigationLane {
  const NavigationLane({required this.directions, required this.recommended});
  final List<String> directions;
  final bool recommended;

  factory NavigationLane.fromMap(Map<Object?, Object?> map) => NavigationLane(
    directions:
        (map['directions'] is List ? map['directions'] as List : const [])
            .whereType<String>()
            .toList(growable: false),
    recommended: map['recommended'] == true,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is NavigationLane &&
          recommended == other.recommended &&
          _listEquals(directions, other.directions);

  @override
  int get hashCode => Object.hash(Object.hashAll(directions), recommended);
}

bool _listEquals<T>(List<T> left, List<T> right) {
  if (identical(left, right)) return true;
  if (left.length != right.length) return false;
  for (var index = 0; index < left.length; index++) {
    if (left[index] != right[index]) return false;
  }
  return true;
}
