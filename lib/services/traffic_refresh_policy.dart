class TrafficRouteCandidate {
  const TrafficRouteCandidate({required this.truckSafe, required this.navigationAllowed, required this.etaSeconds, required this.routeId});
  final bool truckSafe;
  final bool navigationAllowed;
  final int etaSeconds;
  final String routeId;
}

class TrafficRefreshPolicy {
  const TrafficRefreshPolicy({this.refreshInterval = const Duration(minutes: 5), this.minimumSavings = const Duration(minutes: 3), this.minimumSavingsRatio = 0.08});
  final Duration refreshInterval;
  final Duration minimumSavings;
  final double minimumSavingsRatio;

  bool shouldRefresh(DateTime now, DateTime? lastRefresh) => lastRefresh == null || now.difference(lastRefresh) >= refreshInterval;

  bool shouldReplace({required TrafficRouteCandidate current, required TrafficRouteCandidate candidate}) {
    // Non-negotiable: an unsafe/non-navigable candidate can never replace the active route.
    if (!candidate.truckSafe || !candidate.navigationAllowed || candidate.routeId == current.routeId) return false;
    final savings = current.etaSeconds - candidate.etaSeconds;
    if (savings <= 0) return false;
    final ratio = current.etaSeconds <= 0 ? 0.0 : savings / current.etaSeconds;
    return savings >= minimumSavings.inSeconds && ratio >= minimumSavingsRatio;
  }
}
