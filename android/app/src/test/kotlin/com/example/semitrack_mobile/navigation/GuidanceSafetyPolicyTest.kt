package com.example.semitrack_mobile.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GuidanceSafetyPolicyTest {
    private val geometry = listOf(Coordinate(39.0, -104.0), Coordinate(40.0, -103.0))

    @Test
    fun `accepts only Trimble geometry with at least two points`() {
        assertNull(GuidanceSafetyPolicy.validateExternalRoute("Trimble", geometry))
        assertEquals(
            "TRIMBLE_ROUTE_REQUIRED",
            GuidanceSafetyPolicy.validateExternalRoute("HERE", geometry)?.code,
        )
        assertEquals(
            "TRIMBLE_ROUTE_GEOMETRY_REQUIRED",
            GuidanceSafetyPolicy.validateExternalRoute("Trimble", geometry.take(1))?.code,
        )
    }

    @Test
    fun `blocks restrictions that do not have an explicit TomTom mapping`() {
        assertEquals(
            "TOMTOM_HAZMAT_MAPPING_REQUIRED",
            GuidanceSafetyPolicy.validateMappedRestrictions(profile(hazmatEnabled = true))?.code,
        )
        assertEquals(
            "TOMTOM_TRAILER_MAPPING_REQUIRED",
            GuidanceSafetyPolicy.validateMappedRestrictions(profile(trailerType = "dry-van"))?.code,
        )
        assertNull(GuidanceSafetyPolicy.validateMappedRestrictions(profile()))
    }

    private fun profile(
        hazmatEnabled: Boolean = false,
        trailerType: String? = null,
    ) = CommercialTruckProfile(
        heightMeters = 4.1,
        widthMeters = 2.6,
        lengthMeters = 22.0,
        grossWeightKg = 36_000.0,
        axleCount = 5,
        axleWeightsKg = listOf(9_000.0),
        hazmatEnabled = hazmatEnabled,
        hazmatClasses = emptyList(),
        trailerType = trailerType,
    )
}
