package com.example.semitrack_mobile.navigation

import com.tomtom.quantity.Distance
import com.tomtom.quantity.Weight
import com.tomtom.sdk.init.TomTomSdk
import com.tomtom.sdk.location.GeoPoint
import com.tomtom.sdk.location.Place
import com.tomtom.sdk.navigation.NavigationOptions
import com.tomtom.sdk.navigation.RoutePlan
import com.tomtom.sdk.routing.RoutePlanningCallback
import com.tomtom.sdk.routing.RoutePlanningResponse
import com.tomtom.sdk.routing.RoutingFailure
import com.tomtom.sdk.routing.buildRoutePlanningOptions
import com.tomtom.sdk.routing.createRoutePlanner
import com.tomtom.sdk.routing.options.Itinerary
import com.tomtom.sdk.routing.options.ItineraryPoint
import com.tomtom.sdk.routing.options.RoutePlanningOptions
import com.tomtom.sdk.vehicle.Vehicle
import com.tomtom.sdk.vehicle.VehicleDimensions

/**
 * TomTom-backed commercial-truck guidance adapter.
 *
 * SemiTrack deliberately fails closed when the SDK is unavailable, no current
 * location has been received, or a truck restriction cannot be represented
 * safely. Passenger-car routing is never used as a fallback.
 */
class TomTomGuidanceEngine : NativeGuidanceEngine {
    override val providerName: String = "tomtom"
    override val isAvailable: Boolean
        get() = TomTomSdkManager.isReady

    private var routePlanner = if (TomTomSdkManager.isReady) TomTomSdk.createRoutePlanner() else null

    override fun preview(
        profile: CommercialTruckProfile,
        destination: Coordinate,
        waypoints: List<NavigationWaypoint>,
        completion: (NavigationFailure?) -> Unit,
    ) {
        plan(profile, destination, waypoints) { _, _, failure -> completion(failure) }
    }

    override fun start(
        profile: CommercialTruckProfile,
        destination: Coordinate,
        waypoints: List<NavigationWaypoint>,
        completion: (NavigationFailure?) -> Unit,
    ) {
        plan(profile, destination, waypoints) { response, options, failure ->
            if (failure != null || response == null || options == null) {
                completion(failure ?: NavigationFailure("TOMTOM_ROUTE_FAILED", "TomTom did not return a route"))
                return@plan
            }

            try {
                val route = response.routes.first()
                val navigation = TomTomSdk.navigation
                navigation.vehicleProvider.vehicle = options.vehicle
                navigation.start(NavigationOptions(RoutePlan(route, options)))
                completion(null)
            } catch (error: Exception) {
                completion(NavigationFailure("TOMTOM_NAVIGATION_START_FAILED", error.message ?: "TomTom navigation could not start"))
            }
        }
    }

    override fun recalculate(
        profile: CommercialTruckProfile,
        destination: Coordinate,
        waypoints: List<NavigationWaypoint>,
        completion: (NavigationFailure?) -> Unit,
    ) {
        plan(profile, destination, waypoints) { response, options, failure ->
            if (failure != null || response == null || options == null) {
                completion(failure ?: NavigationFailure("TOMTOM_REROUTE_FAILED", "TomTom did not return a replacement route"))
                return@plan
            }

            try {
                val route = response.routes.first()
                val navigation = TomTomSdk.navigation
                navigation.vehicleProvider.vehicle = options.vehicle
                navigation.setActiveRoutePlan(RoutePlan(route, options))
                completion(null)
            } catch (error: Exception) {
                completion(NavigationFailure("TOMTOM_REROUTE_FAILED", error.message ?: "TomTom could not activate the replacement route"))
            }
        }
    }

    override fun stop() {
        if (!TomTomSdkManager.isReady) return
        try {
            TomTomSdk.navigation.stop()
        } catch (_: Exception) {
            // Stop is best-effort during Activity/service teardown.
        }
    }

    private fun plan(
        profile: CommercialTruckProfile,
        destination: Coordinate,
        waypoints: List<NavigationWaypoint>,
        completion: (RoutePlanningResponse?, RoutePlanningOptions?, NavigationFailure?) -> Unit,
    ) {
        if (!TomTomSdkManager.isReady) {
            completion(null, null, NavigationFailure("TOMTOM_SDK_UNAVAILABLE", TomTomSdkManager.error ?: "TomTom SDK is not initialized"))
            return
        }

        if (profile.hazmatEnabled || profile.hazmatClasses.isNotEmpty()) {
            completion(
                null,
                null,
                NavigationFailure(
                    "TOMTOM_HAZMAT_MAPPING_REQUIRED",
                    "Hazardous-material routing is blocked until SemiTrack hazmat class values are explicitly mapped to TomTom HazmatClass values.",
                ),
            )
            return
        }

        val origin = NavigationEventEmitter.currentCoordinate()
        if (origin == null) {
            completion(null, null, NavigationFailure("CURRENT_LOCATION_REQUIRED", "Wait for a current GPS fix before planning a TomTom truck route"))
            return
        }

        val planner = routePlanner ?: try {
            TomTomSdk.createRoutePlanner().also { routePlanner = it }
        } catch (error: Exception) {
            completion(null, null, NavigationFailure("TOMTOM_ROUTE_PLANNER_UNAVAILABLE", error.message ?: "TomTom route planner is unavailable"))
            return
        }

        val truck = tomTomTruck(profile)
        val itinerary = Itinerary(
            origin = itineraryPoint(origin),
            destination = itineraryPoint(destination),
            waypoints = waypoints.map { itineraryPoint(it.coordinate) },
        )
        val baseOptions = buildRoutePlanningOptions(itinerary)
        val options = RoutePlanningOptions(
            itinerary = baseOptions.itinerary,
            costModel = baseOptions.costModel,
            departAt = baseOptions.departAt,
            arriveAt = baseOptions.arriveAt,
            alternativeRoutesOptions = baseOptions.alternativeRoutesOptions,
            guidanceOptions = baseOptions.guidanceOptions,
            routeLegOptions = baseOptions.routeLegOptions,
            vehicle = truck,
            chargingOptions = baseOptions.chargingOptions,
            queryOptions = baseOptions.queryOptions,
            waypointOptimization = baseOptions.waypointOptimization,
            mode = baseOptions.mode,
            arrivalSidePreference = baseOptions.arrivalSidePreference,
        )

        try {
            planner.planRoute(options, object : RoutePlanningCallback {
                override fun onSuccess(result: RoutePlanningResponse) {
                    completion(result, options, null)
                }

                override fun onFailure(failure: RoutingFailure) {
                    completion(null, options, NavigationFailure("TOMTOM_ROUTE_FAILED", failure.toString()))
                }
            })
        } catch (error: Exception) {
            completion(null, options, NavigationFailure("TOMTOM_ROUTE_FAILED", error.message ?: "TomTom route planning failed"))
        }
    }

    private fun itineraryPoint(coordinate: Coordinate) = ItineraryPoint(
        Place(GeoPoint(coordinate.latitude, coordinate.longitude)),
    )

    private fun tomTomTruck(profile: CommercialTruckProfile): Vehicle.Truck {
        val axleWeightKg = profile.axleWeightsKg.maxOrNull()
        return Vehicle.Truck(
            isCommercial = true,
            dimensions = VehicleDimensions(
                weight = Weight.kilograms(profile.grossWeightKg),
                axleWeight = axleWeightKg?.let(Weight::kilograms),
                length = Distance.meters(profile.lengthMeters),
                width = Distance.meters(profile.widthMeters),
                height = Distance.meters(profile.heightMeters),
                numberOfAxles = profile.axleCount,
            ),
        )
    }
}
