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
        destination = null
        waypoints.clear()
        phase = "idle"
        emitState()
    }

    fun stopNavigation() {
        context.stopService(Intent(context, NavigationForegroundService::class.java))
        guidanceEngine.stop()
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
        "voiceMuted" to voiceMuted,
        "phase" to phase,
        "guidanceProvider" to guidanceEngine.providerName,
        "truckSafeGuidanceAvailable" to guidanceEngine.isAvailable,
        "running" to NavigationForegroundService.running,
    )
}
