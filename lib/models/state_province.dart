/// Represents a US state or Canadian province loaded from
/// `assets/data/states_provinces.json`.
class StateProvince {
  final String code;
  final String country;
  final String name;
  final String capital;
  final String mainCity;
  final int becameStateYear;
  final String population;
  final String specialization;

  const StateProvince({
    required this.code,
    required this.country,
    required this.name,
    required this.capital,
    required this.mainCity,
    required this.becameStateYear,
    required this.population,
    required this.specialization,
  });

  factory StateProvince.fromJson(Map<String, dynamic> json) {
    return StateProvince(
      code: json['code'] as String,
      country: json['country'] as String,
      name: json['name'] as String,
      capital: json['capital'] as String,
      mainCity: json['main_city'] as String,
      becameStateYear: json['became_state_year'] as int,
      population: json['population'] as String,
      specialization: json['specialization'] as String,
    );
  }

  /// Display label shown in dropdowns: e.g. "TX – Texas".
  String get label => '$code – $name';

  @override
  String toString() => label;
}
