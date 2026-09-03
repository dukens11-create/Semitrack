package com.example.semitrack_mobile.navigation

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class SemiTrackNavigationManager(
    private val context: Context,
    private val guidanceEngine: NativeGuidanceEngine = TruckSafeGuidanceUnavailableEngine(),
) {
    private var truckProfile: CommercialTruckProfile? = null
    private var destination: Coordinate? = null
    private val waypoints = linkedMapOf<String, NavigationWaypoint>()
    private var externalRouteProvider: String? = null
    private var externalRoutePointCount = 0
    private var voiceMuted = false
    private var phase = "idle"

    fun startLocationTracking(intervalMs: Long, distanceMeters: Float) {
        ContextCompat.startForegroundService(
            context,
            NavigationForegroundService.startIntent(context, intervalMs, distanceMeters),
        )
    }

    fun setTruckProfile(profile: CommercialTruckProfile) {
        truckProfile = profile
    }

    fun updateDestination(coordinate: Coordinate) {
        destination = coordinate
    }

    fun setExternalRoute(provider: String, geometry: List<Coordinate>) {
        require(provider.isNotBlank()) { "External route provider is required" }
        require(geometry.size >= 2) { "External route geometry must contain at least two coordinates" }
        externalRouteProvider = provider.trim()
        externalRoutePointCount = geometry.size
        guidanceEngine.setExternalRoute(externalRouteProvider!!, geometry)
    }

    fun clearExternalRoute() {
        externalRouteProvider = null
        externalRoutePointCount = 0
        guidanceEngine.clearExternalRoute()
    }

    fun addWaypoint(waypoint: NavigationWaypoint) {
        require(waypoints.size < 25 || waypoints.containsKey(waypoint.id)) { "A maximum of 25 waypoints is supported" }
        waypoints[waypoint.id] = waypoint
    }

    fun removeWaypoint(id: String) {
        require(waypoints.remove(id) != null) { "Waypoint not found" }
    }

    fun muteVoice() {
        voiceMuted = true
        emitState()
    }

    fun unmuteVoice() {
        voiceMuted = false
        emitState()
    }

    fun cancelRoute() {
        guidanceEngine.stop()
        clearExternalRoute()
        destination = null
        waypoints.clear()
        phase = "idle"
        emitState()
    }

    fun stopNavigation() {
        context.stopService(Intent(context, NavigationForegroundService::class.java))
        guidanceEngine.stop()
        clearExternalRoute()
        destination = null
        waypoints.clear()
        phase = "idle"
        emitState()
    }

    fun previewRoute(completion: (NavigationFailure?) -> Unit) =
        routeOperation("previewing", guidanceEngine::preview, completion)

    fun startNavigation(completion: (NavigationFailure?) -> Unit) =
        routeOperation("navigating", guidanceEngine::start, completion)

    fun recalculateRoute(completion: (NavigationFailure?) -> Unit) =
        routeOperation("rerouting", guidanceEngine::recalculate, completion)

    private fun routeOperation(
        successPhase: String,
        operation: (
            CommercialTruckProfile,
            Coordinate,
            List<NavigationWaypoint>,
            (NavigationFailure?) -> Unit,
        ) -> Unit,
        completion: (NavigationFailure?) -> Unit,
    ) {
        val profile = truckProfile
        if (profile == null) {
            completion(NavigationFailure("TRUCK_PROFILE_REQUIRED", "Set the active commercial truck profile before routing"))
            return
        }
        val routeDestination = destination
        if (routeDestination == null) {
            completion(NavigationFailure("DESTINATION_REQUIRED", "Set a destination before routing"))
            return
        }

        operation(profile, routeDestination, waypoints.values.toList()) { failure ->
            if (failure == null) {
                phase = successPhase
                emitState()
            }
            completion(failure)
        }
    }

    private fun emitState() = NavigationEventEmitter.state(
        phase,
        mapOf("voiceMuted" to voiceMuted),
    )

    fun status(): Map<String, Any?> = mapOf(
        "hasTruckProfile" to (truckProfile != null),
        "hasDestination" to (destination != null),
        "waypointCount" to waypoints.size,
        "externalRouteProvider" to externalRouteProvider,
        "externalRoutePointCount" to externalRoutePointCount,
        "voiceMuted" to voiceMuted,
        "phase" to phase,
        "guidanceProvider" to guidanceEngine.providerName,
        "truckSafeGuidanceAvailable" to guidanceEngine.isAvailable,
        "tomtomSdkReady" to TomTomSdkManager.isReady,
        "tomtomSdkError" to TomTomSdkManager.error,
        "running" to NavigationForegroundService.running,
    )
}
