package com.example.semitrack_mobile.navigation

import android.content.Context
import com.example.semitrack_mobile.BuildConfig
import com.tomtom.sdk.common.configuration.buildSdkConfiguration
import com.tomtom.sdk.init.TomTomSdk

/**
 * Owns process-wide TomTom SDK initialization for SemiTrack.
 *
 * The SDK is deliberately initialized in online-only mode first. Offline NDS
 * region-store support is a separate rollout so native truck guidance can be
 * validated before map lifecycle and keystore recovery are introduced.
 */
object TomTomSdkManager {
    @Volatile
    private var initializationError: String? = null

    val isReady: Boolean
        get() = TomTomSdk.isInitialized && initializationError == null

    val error: String?
        get() = initializationError

    /**
     * Initialize TomTom once. The deprecated no-consent overload is used only
     * as a bootstrap until SemiTrack's driver-facing telemetry consent setting
     * is connected; telemetry must not be treated as user-approved by this
     * wrapper. Replace this call with the consent-aware overload before release.
     */
    @Suppress("DEPRECATION")
    fun initialize(context: Context): NavigationFailure? {
        if (TomTomSdk.isInitialized) {
            initializationError = null
            return null
        }

        val apiKey = BuildConfig.TOMTOM_API_KEY.trim()
        if (apiKey.isBlank()) {
            val message = "TomTom API key is not configured. Set tomtomApiKey in android/local.properties or the protected build environment."
            initializationError = message
            return NavigationFailure("TOMTOM_API_KEY_REQUIRED", message)
        }

        return try {
            val applicationContext = context.applicationContext
            val sdkConfiguration = buildSdkConfiguration(
                context = applicationContext,
                apiKey = apiKey,
            )
            TomTomSdk.initialize(
                context = applicationContext,
                sdkConfiguration = sdkConfiguration,
            )
            initializationError = null
            null
        } catch (error: Exception) {
            val message = error.message ?: "TomTom SDK initialization failed"
            initializationError = message
            NavigationFailure("TOMTOM_SDK_INITIALIZATION_FAILED", message)
        }
    }
}
