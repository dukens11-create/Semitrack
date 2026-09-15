package com.semitrax.app.navigation

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
}
