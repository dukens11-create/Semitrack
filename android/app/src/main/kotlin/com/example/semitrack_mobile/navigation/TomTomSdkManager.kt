package com.example.semitrack_mobile.navigation

import android.content.Context
import com.example.semitrack_mobile.BuildConfig
import com.tomtom.sdk.common.configuration.buildSdkConfiguration
import com.tomtom.sdk.init.TomTomSdk
import com.tomtom.sdk.telemetry.UserConsent
import java.util.concurrent.Executors

/** Owns process-wide TomTom SDK initialization for SemiTrack. */
object TomTomSdkManager {
    private val executor = Executors.newSingleThreadExecutor()
    private val lock = Any()
    @Volatile private var initializationError: String? = null
    @Volatile private var initializing = false

    val isReady: Boolean
        get() = TomTomSdk.isInitialized && initializationError == null

    val isInitializing: Boolean
        get() = initializing

    val error: String?
        get() = initializationError

    fun initializeAsync(context: Context, completion: (NavigationFailure?) -> Unit) {
        synchronized(lock) {
            if (TomTomSdk.isInitialized) {
                initializationError = null
                completion(null)
                return
            }
            if (initializing) {
                executor.execute {
                    while (initializing) Thread.sleep(25)
                    completion(
                        initializationError?.let {
                            NavigationFailure("TOMTOM_SDK_INITIALIZATION_FAILED", it)
                        },
                    )
                }
                return
            }
            initializing = true
        }

        executor.execute {
            val failure = initializeWorker(context.applicationContext)
            initializing = false
            completion(failure)
        }
    }

    private fun initializeWorker(context: Context): NavigationFailure? {
        val apiKey = BuildConfig.TOMTOM_API_KEY.trim()
        if (apiKey.isBlank()) {
            val message = "TomTom API key is not configured. Set tomtomApiKey in android/local.properties or the protected build environment."
            initializationError = message
            return NavigationFailure("TOMTOM_API_KEY_REQUIRED", message)
        }

        return try {
            val sdkConfiguration = buildSdkConfiguration(
                context = context,
                apiKey = apiKey,
                telemetryUserConsent = suspend { UserConsent.TelemetryOff },
            )
            TomTomSdk.initialize(context = context, sdkConfiguration = sdkConfiguration)
            initializationError = null
            null
        } catch (error: Exception) {
            val message = error.message ?: "TomTom SDK initialization failed"
            initializationError = message
            NavigationFailure("TOMTOM_SDK_INITIALIZATION_FAILED", message)
        }
    }
}
