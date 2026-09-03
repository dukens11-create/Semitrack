package com.example.semitrack_mobile.navigation

interface NativeGuidanceEngine {
    val providerName: String
    val isAvailable: Boolean
    fun preview(profile: CommercialTruckProfile, destination: Coordinate, waypoints: List<NavigationWaypoint>): NavigationFailure?
    fun start(profile: CommercialTruckProfile, destination: Coordinate, waypoints: List<NavigationWaypoint>): NavigationFailure?
    fun recalculate(profile: CommercialTruckProfile, destination: Coordinate, waypoints: List<NavigationWaypoint>): NavigationFailure?
    fun stop()
}

/**
 * Production fail-safe used until a native SDK capable of honoring SemiTrack's
 * full commercial-truck route contract is licensed and validated.
 */
class TruckSafeGuidanceUnavailableEngine : NativeGuidanceEngine {
    override val providerName = "unavailable"
    override val isAvailable = false
    private val failure = NavigationFailure(
        "TRUCK_SAFE_NATIVE_ROUTING_UNAVAILABLE",
        "Truck-safe native guidance is unavailable. Mapbox passenger-car routing is disabled; use the authenticated HERE truck-routing workflow.",
    )

    override fun preview(profile: CommercialTruckProfile, destination: Coordinate, waypoints: List<NavigationWaypoint>) = failure
    override fun start(profile: CommercialTruckProfile, destination: Coordinate, waypoints: List<NavigationWaypoint>) = failure
    override fun recalculate(profile: CommercialTruckProfile, destination: Coordinate, waypoints: List<NavigationWaypoint>) = failure
    override fun stop() = Unit
}


