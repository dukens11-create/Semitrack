package com.example.semitrack_mobile.navigation

interface NativeGuidanceEngine {
    val providerName: String
    val isAvailable: Boolean

    fun setExternalRoute(provider: String, geometry: List<Coordinate>)
    fun clearExternalRoute()

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
 * Production fail-safe used until a licensed native SDK capable of honoring
 * SemiTraX's full commercial-truck route contract is integrated and validated.
 * Route operations remain asynchronous so a future provider can be added
 * without blocking Flutter's platform thread.
 */
class TruckSafeGuidanceUnavailableEngine : NativeGuidanceEngine {
    override val providerName = "unavailable"
    override val isAvailable = false
    private val failure = NavigationFailure(
        "TRUCK_SAFE_NATIVE_ROUTING_UNAVAILABLE",
        "Truck-safe native guidance is unavailable in this build.",
    )

    override fun setExternalRoute(provider: String, geometry: List<Coordinate>) = Unit
    override fun clearExternalRoute() = Unit

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
