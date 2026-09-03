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
import com.tomtom.sdk.routing.options.calculation.RouteLegOptions
import com.tomtom.sdk.routing.options.calculation.RouteStopOptions
import com.tomtom.sdk.vehicle.Vehicle
import com.tomtom.sdk.vehicle.VehicleDimensions

/**
 * TomTom-backed commercial-truck guidance adapter.
 *
 * Trimble/PC*Miler remains SemiTrack's authoritative commercial-truck route
 * planner. When Flutter supplies the selected Trimble RoutePath geometry,
 * TomTom reconstructs that external path and provides native on-device
 * guidance for it instead of independently choosing a different road route.
 */
class TomTomGuidanceEngine : NativeGuidanceEngine {
    override val providerName: String = "tomtom"
    override val isAvailable: Boolean
        get() = TomTomSdkManager.isReady

    private var routePlanner = if (TomTomSdkManager.isReady) TomTomSdk.createRoutePlanner() else null
    private var externalRouteProvider: String? = null
    private var externalRouteGeometry: List<Coordinate> = emptyList()

    override fun setExternalRoute(provider: String, geometry: List<Coordinate>) {
        externalRouteProvider = provider.trim()
        externalRouteGeometry = geometry.toList()
    }

    override fun clearExternalRoute() {
        externalRouteProvider = null
        externalRouteGeometry = emptyList()
    }

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
                    "Hazardous-material guidance is blocked until SemiTrack hazmat values are explicitly mapped to TomTom HazmatClass values.",
                ),
            )
            return
        }

        val planner = routePlanner ?: try {
            TomTomSdk.createRoutePlanner().also { routePlanner = it }
        } catch (error: Exception) {
            completion(null, null, NavigationFailure("TOMTOM_ROUTE_PLANNER_UNAVAILABLE", error.message ?: "TomTom route planner is unavailable"))
            return
        }

        val truck = tomTomTruck(profile)
        val externalGeometry = externalRouteGeometry
        val options = if (externalGeometry.size >= 2) {
            buildExternalRouteOptions(externalGeometry, truck)
        } else {
            val origin = NavigationEventEmitter.currentCoordinate()
            if (origin == null) {
                completion(null, null, NavigationFailure("CURRENT_LOCATION_REQUIRED", "Wait for a current GPS fix before planning a TomTom truck route"))
                return
            }
            buildTomTomRouteOptions(origin, destination, waypoints, truck)
        }

        try {
            planner.planRoute(options, object : RoutePlanningCallback {
                override fun onSuccess(result: RoutePlanningResponse) {
                    completion(result, options, null)
                }

                override fun onFailure(failure: RoutingFailure) {
                    val source = externalRouteProvider?.let { "$it route reconstruction" } ?: "TomTom route planning"
                    completion(null, options, NavigationFailure("TOMTOM_ROUTE_FAILED", "$source failed: $failure"))
                }
            })
        } catch (error: Exception) {
            completion(null, options, NavigationFailure("TOMTOM_ROUTE_FAILED", error.message ?: "TomTom route planning failed"))
        }
    }

    private fun buildExternalRouteOptions(
        geometry: List<Coordinate>,
        truck: Vehicle.Truck,
    ): RoutePlanningOptions {
        val itinerary = Itinerary(
            origin = itineraryPoint(geometry.first()),
            destination = itineraryPoint(geometry.last()),
        )
        val baseOptions = buildRoutePlanningOptions(itinerary)
        val routeLegOptions = listOf(
            RouteLegOptions(
                supportingPoints = geometry.map(::geoPoint),
                routeStopOptions = RouteStopOptions(),
            ),
        )
        return copyOptions(baseOptions, truck, routeLegOptions)
    }

    private fun buildTomTomRouteOptions(
        origin: Coordinate,
        destination: Coordinate,
        waypoints: List<NavigationWaypoint>,
        truck: Vehicle.Truck,
    ): RoutePlanningOptions {
        val itinerary = Itinerary(
            origin = itineraryPoint(origin),
            destination = itineraryPoint(destination),
            waypoints = waypoints.map { itineraryPoint(it.coordinate) },
        )
        return copyOptions(buildRoutePlanningOptions(itinerary), truck, null)
    }

    private fun copyOptions(
        baseOptions: RoutePlanningOptions,
        truck: Vehicle.Truck,
        routeLegOptions: List<RouteLegOptions>?,
    ) = RoutePlanningOptions(
        itinerary = baseOptions.itinerary,
        costModel = baseOptions.costModel,
        departAt = baseOptions.departAt,
        arriveAt = baseOptions.arriveAt,
        alternativeRoutesOptions = baseOptions.alternativeRoutesOptions,
        guidanceOptions = baseOptions.guidanceOptions,
        routeLegOptions = routeLegOptions ?: baseOptions.routeLegOptions,
        vehicle = truck,
        chargingOptions = baseOptions.chargingOptions,
        queryOptions = baseOptions.queryOptions,
        waypointOptimization = baseOptions.waypointOptimization,
        mode = baseOptions.mode,
        arrivalSidePreference = baseOptions.arrivalSidePreference,
    )

    private fun itineraryPoint(coordinate: Coordinate) = ItineraryPoint(
        Place(geoPoint(coordinate)),
    )

    private fun geoPoint(coordinate: Coordinate) = GeoPoint(coordinate.latitude, coordinate.longitude)

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
