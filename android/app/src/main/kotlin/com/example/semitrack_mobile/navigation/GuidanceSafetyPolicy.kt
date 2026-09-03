package com.example.semitrack_mobile.navigation

/** Safety gate shared by the platform bridge and the TomTom adapter. */
object GuidanceSafetyPolicy {
    fun validateExternalRoute(provider: String?, geometry: List<Coordinate>): NavigationFailure? {
        if (!provider.equals("Trimble", ignoreCase = true)) {
            return NavigationFailure(
                "TRIMBLE_ROUTE_REQUIRED",
                "TomTom guidance accepts only authoritative Trimble route geometry.",
            )
        }
        if (geometry.size < 2) {
            return NavigationFailure(
                "TRIMBLE_ROUTE_GEOMETRY_REQUIRED",
                "Trimble route geometry must contain at least two coordinates.",
            )
        }
        return null
    }

    fun validateMappedRestrictions(profile: CommercialTruckProfile): NavigationFailure? {
        if (profile.hazmatEnabled || profile.hazmatClasses.isNotEmpty()) {
            return NavigationFailure(
                "TOMTOM_HAZMAT_MAPPING_REQUIRED",
                "Hazardous-material guidance is blocked until every SemiTrack hazmat value is explicitly mapped to a TomTom HazmatClass.",
            )
        }
        if (!profile.trailerType.isNullOrBlank()) {
            return NavigationFailure(
                "TOMTOM_TRAILER_MAPPING_REQUIRED",
                "Trailer-specific guidance is blocked until the SemiTrack trailer type is explicitly mapped to a validated TomTom vehicle configuration.",
            )
        }
        return null
    }
}
