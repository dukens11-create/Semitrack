package com.example.semitrack_mobile.navigation

import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.location.LocationCompat
import io.flutter.plugin.common.EventChannel

object NavigationEventEmitter {
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var sink: EventChannel.EventSink? = null
    @Volatile private var lastLocation: Map<String, Any>? = null
    @Volatile private var lastState: Map<String, Any?> = mapOf("phase" to "idle")

    fun attach(eventSink: EventChannel.EventSink?) {
        sink = eventSink
        lastLocation?.let { emit("location", it) }
        emit("state", lastState)
    }

    fun detach() {
        sink = null
    }

    fun location(location: Location) {
        val data = mapOf<String, Any>(
            "latitude" to location.latitude,
            "longitude" to location.longitude,
            "timestampMs" to location.time,
            "accuracy" to if (location.hasAccuracy()) location.accuracy.toDouble() else -1.0,
            "altitude" to if (location.hasAltitude()) location.altitude else 0.0,
            "altitudeAccuracy" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasVerticalAccuracy()) location.verticalAccuracyMeters.toDouble() else -1.0,
            "heading" to if (location.hasBearing()) location.bearing.toDouble() else -1.0,
            "headingAccuracy" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasBearingAccuracy()) location.bearingAccuracyDegrees.toDouble() else -1.0,
            "speed" to if (location.hasSpeed()) location.speed.toDouble() else -1.0,
            "speedAccuracy" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && location.hasSpeedAccuracy()) location.speedAccuracyMetersPerSecond.toDouble() else -1.0,
            "isMocked" to LocationCompat.isMock(location),
        )
        lastLocation = data
        emit("location", data)
    }

    fun state(phase: String, extra: Map<String, Any?> = emptyMap()) {
        val data = mapOf("phase" to phase) + extra
        lastState = data
        emit("state", data)
    }

    fun error(failure: NavigationFailure) {
        state("error", mapOf("errorCode" to failure.code, "errorMessage" to failure.message))
    }

    private fun emit(type: String, data: Map<String, Any?>) {
        val target = sink ?: return
        mainHandler.post {
            if (sink !== target) return@post
            try {
                target.success(mapOf("type" to type, "data" to data))
            } catch (_: RuntimeException) {
                // Flutter may detach while a background location callback is
                // crossing the channel. Dropping that stale event is safer
                // than crashing the foreground navigation service.
            }
        }
    }
}

