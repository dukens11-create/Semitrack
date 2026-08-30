class StreetGuidanceText {
  const StreetGuidanceText({
    required this.actionText,
    required this.roadName,
    this.towardRoadName,
  });

  final String actionText;
  final String roadName;
  final String? towardRoadName;

  String get headline => [
    actionText.trim(),
    roadName.trim(),
  ].where((part) => part.isNotEmpty).join(' ');

  String? get towardLine {
    final road = towardRoadName?.trim();
    return road == null || road.isEmpty ? null : 'toward $road';
  }
}

StreetGuidanceText buildStreetGuidanceText({
  required String? maneuverType,
  required String? modifier,
  required String? instruction,
  required String? roadName,
  String? currentRoadName,
  String? nextRoadName,
}) {
  final providerInstruction = instruction?.trim() ?? '';
  final displayRoad = _firstRoadName([
    roadName,
    _roadFromInstruction(providerInstruction),
    currentRoadName,
    nextRoadName,
  ]);
  final towardFromInstruction = _towardRoadFromInstruction(providerInstruction);
  final towardRoad = _firstDistinctRoadName([
    towardFromInstruction,
    nextRoadName,
  ], displayRoad);
  final action = _actionText(
    maneuverType: maneuverType,
    modifier: modifier,
    instruction: providerInstruction,
    hasRoadName: displayRoad.isNotEmpty,
  );

  return StreetGuidanceText(
    actionText: action,
    roadName: displayRoad,
    towardRoadName: towardRoad,
  );
}

String _actionText({
  required String? maneuverType,
  required String? modifier,
  required String instruction,
  required bool hasRoadName,
}) {
  final type = (maneuverType ?? '').trim().toLowerCase();
  final mod = (modifier ?? '').trim().toLowerCase();
  final heading = _cardinalDirection('$mod $instruction');
  final headingText = heading == null ? '' : ' $heading';

  if (type == 'arrive' || instruction.toLowerCase().contains('destination')) {
    return 'Arrive at';
  }
  if (type == 'depart') {
    return hasRoadName ? 'Head$headingText on' : 'Head out';
  }
  if (type == 'turn') {
    if (mod.contains('u-turn') || mod.contains('uturn')) {
      return hasRoadName ? 'Make a U-turn onto' : 'Make a U-turn';
    }
    if (mod.contains('slight left')) {
      return hasRoadName ? 'Turn slight left onto' : 'Turn slight left';
    }
    if (mod.contains('slight right')) {
      return hasRoadName ? 'Turn slight right onto' : 'Turn slight right';
    }
    if (mod.contains('sharp left')) {
      return hasRoadName ? 'Turn sharp left onto' : 'Turn sharp left';
    }
    if (mod.contains('sharp right')) {
      return hasRoadName ? 'Turn sharp right onto' : 'Turn sharp right';
    }
    if (mod.contains('left')) {
      return hasRoadName ? 'Turn left onto' : 'Turn left';
    }
    if (mod.contains('right')) {
      return hasRoadName ? 'Turn right onto' : 'Turn right';
    }
    return hasRoadName ? 'Turn onto' : 'Turn';
  }
  if (type == 'merge') return hasRoadName ? 'Merge onto' : 'Merge';
  if (type == 'exit' || type == 'off ramp') {
    return hasRoadName ? 'Take exit onto' : 'Take exit';
  }
  if (type == 'fork') {
    if (mod.contains('left')) return hasRoadName ? 'Keep left on' : 'Keep left';
    if (mod.contains('right')) {
      return hasRoadName ? 'Keep right on' : 'Keep right';
    }
    return hasRoadName ? 'Keep on' : 'Keep ahead';
  }
  if (type == 'roundabout') {
    return hasRoadName ? 'Exit roundabout onto' : 'Enter roundabout';
  }
  if (type == 'continue' || type == 'new name') {
    final startsWithHeading = RegExp(
      r'^(?:head|drive)\b',
      caseSensitive: false,
    ).hasMatch(instruction);
    if (startsWithHeading && heading != null) return 'Head $heading on';
    return hasRoadName ? 'Continue on' : 'Continue ahead';
  }

  if (RegExp(
        r'^(?:head|drive)\b',
        caseSensitive: false,
      ).hasMatch(instruction) &&
      heading != null) {
    return hasRoadName ? 'Head $heading on' : 'Head $heading';
  }
  return hasRoadName ? 'Continue on' : _instructionWithoutRoad(instruction);
}

String _instructionWithoutRoad(String instruction) {
  if (instruction.trim().isEmpty) return 'Continue ahead';
  return instruction
      .replaceFirst(RegExp(r'\s+toward(?:s)?\s+.+$', caseSensitive: false), '')
      .replaceFirst(
        RegExp(
          r'\s+for\s+\d[\d.,]*\s*(?:ft|feet|mi|miles?)\.?$',
          caseSensitive: false,
        ),
        '',
      )
      .trim();
}

String _firstRoadName(Iterable<String?> candidates) {
  for (final candidate in candidates) {
    final cleaned = _cleanRoadName(candidate);
    if (cleaned != null) return cleaned;
  }
  return '';
}

String? _firstDistinctRoadName(
  Iterable<String?> candidates,
  String currentRoad,
) {
  final currentKey = _roadKey(currentRoad);
  for (final candidate in candidates) {
    final cleaned = _cleanRoadName(candidate);
    if (cleaned != null && _roadKey(cleaned) != currentKey) return cleaned;
  }
  return null;
}

String? _roadFromInstruction(String instruction) {
  if (instruction.isEmpty) return null;
  final match = RegExp(
    r'\b(?:onto|on)\s+(.+?)(?=\s+toward(?:s)?\b|\s+for\s+\d|[,;]|$)',
    caseSensitive: false,
  ).firstMatch(instruction);
  return _cleanRoadName(match?.group(1));
}

String? _towardRoadFromInstruction(String instruction) {
  if (instruction.isEmpty) return null;
  final match = RegExp(
    r'\btoward(?:s)?\s+(.+?)(?=\s+for\s+\d|[,;]|$)',
    caseSensitive: false,
  ).firstMatch(instruction);
  return _cleanRoadName(match?.group(1));
}

String? _cleanRoadName(String? value) {
  if (value == null) return null;
  final cleaned = value
      .replaceAll(RegExp(r'<[^>]*>'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .replaceAll(RegExp(r'[.,;]+$'), '')
      .trim();
  final normalized = cleaned.toLowerCase();
  if (cleaned.isEmpty || normalized == 'unnamed road' || normalized == 'road') {
    return null;
  }
  return cleaned;
}

String _roadKey(String value) {
  return value
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9 ]'), ' ')
      .replaceAll(RegExp(r'\bstreet\b'), 'st')
      .replaceAll(RegExp(r'\bavenue\b'), 'ave')
      .replaceAll(RegExp(r'\bboulevard\b'), 'blvd')
      .replaceAll(RegExp(r'\bdrive\b'), 'dr')
      .replaceAll(RegExp(r'\broad\b'), 'rd')
      .replaceAll(RegExp(r'\blane\b'), 'ln')
      .replaceAll(RegExp(r'\bhighway\b'), 'hwy')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}

String? _cardinalDirection(String value) {
  final normalized = value.toLowerCase().replaceAll('-', ' ');
  const directions = <String, String>{
    'northeastbound': 'NE',
    'northwestbound': 'NW',
    'southeastbound': 'SE',
    'southwestbound': 'SW',
    'northeast': 'NE',
    'northwest': 'NW',
    'southeast': 'SE',
    'southwest': 'SW',
    'northbound': 'N',
    'southbound': 'S',
    'eastbound': 'E',
    'westbound': 'W',
    'north': 'N',
    'south': 'S',
    'east': 'E',
    'west': 'W',
  };
  for (final entry in directions.entries) {
    if (RegExp('\\b${entry.key}\\b').hasMatch(normalized)) return entry.value;
  }
  return null;
}
