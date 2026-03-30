/// Represents a completed truck trip.
class Trip {
  final String id;
  final String destinationName;
  final double distanceMiles;
  final Duration duration;
  final DateTime completedAt;

  const Trip({
    required this.id,
    required this.destinationName,
    required this.distanceMiles,
    required this.duration,
    required this.completedAt,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'destinationName': destinationName,
        'distanceMiles': distanceMiles,
        'duration': duration.inSeconds,
        'completedAt': completedAt.toIso8601String(),
      };

  factory Trip.fromJson(Map<String, dynamic> json) {
    return Trip(
      id: json['id'] as String,
      destinationName: json['destinationName'] as String,
      distanceMiles: (json['distanceMiles'] as num).toDouble(),
      duration: Duration(seconds: json['duration'] as int),
      completedAt: DateTime.parse(json['completedAt'] as String),
    );
  }
}
