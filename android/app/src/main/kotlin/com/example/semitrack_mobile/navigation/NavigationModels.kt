package com.example.semitrack_mobile.navigation

data class Coordinate(val latitude: Double, val longitude: Double) {
    init {
        require(latitude in -90.0..90.0) { "Latitude is outside the valid range" }
        require(longitude in -180.0..180.0) { "Longitude is outside the valid range" }
    }
}

data class NavigationWaypoint(val id: String, val coordinate: Coordinate)

data class CommercialTruckProfile(
    val heightMeters: Double,
    val widthMeters: Double,
    val lengthMeters: Double,
    val grossWeightKg: Double,
    val axleCount: Int,
    val axleWeightsKg: List<Double>,
    val hazmatEnabled: Boolean,
    val hazmatClasses: List<String>,
    val trailerType: String?,
)

data class NavigationFailure(val code: String, val message: String)


