package com.semitrax.app.navigation

/** Safety gate that prevents non-Trimble geometry entering native guidance. */
object GuidanceSafetyPolicy {
    fun validateExternalRoute(provider: String?, geometry: List<Coordinate>): NavigationFailure? {
        if (!provider.equals("Trimble", ignoreCase = true)) {
            return NavigationFailure(
                "TRIMBLE_ROUTE_REQUIRED",
                "Native guidance accepts only authoritative Trimble route geometry.",
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
}
