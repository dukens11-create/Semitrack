enum NavigationMotionState { browsing, navigatingHighway, navigatingUrban, lowSpeed, stopped, background }

class LocationSamplingProfile {
  const LocationSamplingProfile(this.interval, this.distanceFilterMeters);
  final Duration interval;
  final int distanceFilterMeters;
}

/// Adaptive policy; native/Geolocator adapters can map these values to their
/// platform location requests. Navigation states remain high enough fidelity
/// for off-route safety while idle/browsing states reduce battery use.
class LocationSamplingPolicy {
  const LocationSamplingPolicy();
  LocationSamplingProfile forState(NavigationMotionState state) {
    switch (state) {
      case NavigationMotionState.navigatingHighway: return const LocationSamplingProfile(Duration(seconds: 1), 3);
      case NavigationMotionState.navigatingUrban: return const LocationSamplingProfile(Duration(milliseconds: 750), 2);
      case NavigationMotionState.lowSpeed: return const LocationSamplingProfile(Duration(seconds: 2), 3);
      case NavigationMotionState.stopped: return const LocationSamplingProfile(Duration(seconds: 8), 10);
      case NavigationMotionState.background: return const LocationSamplingProfile(Duration(seconds: 3), 5);
      case NavigationMotionState.browsing: return const LocationSamplingProfile(Duration(seconds: 10), 25);
    }
  }
}
