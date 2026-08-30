package com.example.semitrack_mobile.navigation

object TruckProfileMapper {
    fun fromMap(arguments: Map<*, *>): CommercialTruckProfile {
        fun positive(name: String, maximum: Double): Double {
            val value = (arguments[name] as? Number)?.toDouble()
                ?: throw IllegalArgumentException("$name is required")
            require(value > 0 && value <= maximum) { "$name is outside the supported range" }
            return value
        }

        val axleCount = (arguments["axleCount"] as? Number)?.toInt()
            ?: throw IllegalArgumentException("axleCount is required")
        require(axleCount in 2..20) { "axleCount is outside the supported range" }
        val axleWeights = (arguments["axleWeightsKg"] as? List<*>)
            ?.map { (it as? Number)?.toDouble() ?: throw IllegalArgumentException("Invalid axle weight") }
            ?: emptyList()
        require(axleWeights.isEmpty() || axleWeights.size == axleCount) {
            "One axle weight is required per axle"
        }
        require(axleWeights.all { it >= 0 }) { "Axle weights cannot be negative" }

        val hazmatEnabled = arguments["hazmatEnabled"] as? Boolean ?: false
        val hazmatClasses = (arguments["hazmatClasses"] as? List<*>)
            ?.map { it as? String ?: throw IllegalArgumentException("Invalid hazmat class") }
            ?: emptyList()
        require(hazmatEnabled || hazmatClasses.isEmpty()) {
            "Hazmat classes require hazmatEnabled"
        }

        return CommercialTruckProfile(
            heightMeters = positive("heightMeters", 6.1),
            widthMeters = positive("widthMeters", 6.1),
            lengthMeters = positive("lengthMeters", 61.0),
            grossWeightKg = positive("grossWeightKg", 113_400.0),
            axleCount = axleCount,
            axleWeightsKg = axleWeights,
            hazmatEnabled = hazmatEnabled,
            hazmatClasses = hazmatClasses,
            trailerType = arguments["trailerType"] as? String,
        )
    }
}


