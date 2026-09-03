package com.example.semitrack_mobile.navigation

interface NativeGuidanceEngine {
    val providerName: String
    val isAvailable: Boolean

    fun preview(
        profile: CommercialTruckProfile,
        destination: Coordinate,
        waypoints: List<NavigationWaypoint>,
        completion: (NavigationFailure?) -> Unit,
    )

    fun start(
        profile: CommercialTruckProfile,
        destination: Coordinate,
        waypoints: List<NavigationWaypoint>,
        completion: (NavigationFailure?) -> Unit,
    )

    fun recalculate(
        profile: CommercialTruckProfile,
        destination: Coordinate,
        waypoints: List<NavigationWaypoint>,
        completion: (NavigationFailure?) -> Unit,
    )

    fun stop()
}

/**
 * Production fail-safe used until a native SDK capable of honoring SemiTrack's
 * full commercial-truck route contract is licensed and validated.
 *
 * Route operations are callback-based because TomTom's RoutePlanner is
 * asynchronous. Keeping the provider contract async avoids blocking Flutter's
 * platform thread once the TomTom implementation is enabled.
 */
class TruckSafeGuidanceUnavailableEngine : NativeGuidanceEngine {
    override val providerName = "unavailable"
    override val isAvailable = false
    private val failure = NavigationFailure(
        "TRUCK_SAFE_NATIVE_ROUTING_UNAVAILABLE",
        "Truck-safe native guidance is unavailable. Mapbox passenger-car routing is disabled; use the authenticated HERE truck-routing workflow.",
    )

    override fun preview(
        profile: CommercialTruckProfile,
        destination: Coordinate,
        waypoints: List<NavigationWaypoint>,
        completion: (NavigationFailure?) -> Unit,
    ) = completion(failure)

    override fun start(
        profile: CommercialTruckProfile,
        destination: Coordinate,
        waypoints: List<NavigationWaypoint>,
        completion: (NavigationFailure?) -> Unit,
    ) = completion(failure)

    override fun recalculate(
        profile: CommercialTruckProfile,
        destination: Coordinate,
        waypoints: List<NavigationWaypoint>,
        completion: (NavigationFailure?) -> Unit,
    ) = completion(failure)

    override fun stop() = Unit
}
