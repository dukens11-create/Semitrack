package com.example.semitrack_mobile.navigation

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.content.Intent
import androidx.core.content.ContextCompat
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class NavigationChannelHandler(private val activity: Activity) : EventChannel.StreamHandler {
    private val manager = SemiTrackNavigationManager(activity.applicationContext)

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, METHODS).setMethodCallHandler(::handle)
        EventChannel(messenger, EVENTS).setStreamHandler(this)
    }

    private fun handle(call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "start" -> startLocation(call, result)
                "startNavigation" -> {
                    val failure = manager.startNavigation()
                    if (failure != null) fail(result, failure) else result.success(null)
                }
                "previewRoute" -> {
                    val failure = manager.previewRoute()
                    if (failure != null) fail(result, failure) else result.success(null)
                }
                "recalculateRoute" -> {
                    val failure = manager.recalculateRoute()
                    if (failure != null) fail(result, failure) else result.success(null)
                }
                "stop", "stopNavigation" -> {
                    manager.stopNavigation()
                    result.success(null)
                }
                "cancelRoute" -> {
                    manager.cancelRoute()
                    result.success(null)
                }
                "muteVoice" -> {
                    manager.muteVoice()
                    result.success(null)
                }
                "unmuteVoice" -> {
                    manager.unmuteVoice()
                    result.success(null)
                }
                "setTruckProfile" -> {
                    manager.setTruckProfile(TruckProfileMapper.fromMap(arguments(call)))
                    result.success(null)
                }
                "updateDestination" -> {
                    manager.updateDestination(coordinate(arguments(call)))
                    result.success(null)
                }
                "addWaypoint" -> {
                    val values = arguments(call)
                    val id = values["id"] as? String ?: throw IllegalArgumentException("Waypoint id is required")
                    manager.addWaypoint(NavigationWaypoint(id, coordinate(values)))
                    result.success(null)
                }
                "removeWaypoint" -> {
                    val id = arguments(call)["id"] as? String ?: throw IllegalArgumentException("Waypoint id is required")
                    manager.removeWaypoint(id)
                    result.success(null)
                }
                "status" -> result.success(status())
                "openBatterySettings" -> {
                    activity.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${activity.packageName}")
                    })
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        } catch (error: IllegalArgumentException) {
            fail(result, NavigationFailure("INVALID_ARGUMENT", error.message ?: "Invalid navigation argument"))
        } catch (error: Exception) {
            fail(result, NavigationFailure("NATIVE_NAVIGATION_ERROR", error.message ?: "Native navigation failed"))
        }
    }

    private fun startLocation(call: MethodCall, result: MethodChannel.Result) {
        if (!hasLocationPermission()) {
            fail(result, NavigationFailure("LOCATION_PERMISSION_REQUIRED", "Grant precise location permission before starting navigation"))
            return
        }
        val values = arguments(call)
        val interval = (values["intervalMs"] as? Number)?.toLong()?.coerceIn(500, 10_000) ?: 1_000
        val distance = (values["distanceFilterMeters"] as? Number)?.toFloat()?.coerceIn(0f, 100f) ?: 1f
        manager.startLocationTracking(interval, distance)
        result.success(null)
    }

    private fun arguments(call: MethodCall): Map<*, *> = call.arguments as? Map<*, *> ?: emptyMap<Any, Any>()

    private fun coordinate(values: Map<*, *>): Coordinate = Coordinate(
        (values["latitude"] as? Number)?.toDouble() ?: throw IllegalArgumentException("latitude is required"),
        (values["longitude"] as? Number)?.toDouble() ?: throw IllegalArgumentException("longitude is required"),
    )

    private fun hasLocationPermission() = ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun status(): Map<String, Any?> {
        val locationManager = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val enabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) locationManager.isLocationEnabled
        else locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
        return manager.status() + mapOf(
            "permission" to if (hasLocationPermission()) "granted" else "denied",
            "locationServicesEnabled" to enabled,
        )
    }

    private fun fail(result: MethodChannel.Result, failure: NavigationFailure) {
        NavigationEventEmitter.error(failure)
        result.error(failure.code, failure.message, null)
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) = NavigationEventEmitter.attach(events)
    override fun onCancel(arguments: Any?) = NavigationEventEmitter.detach()

    companion object {
        private const val METHODS = "com.semitrack/navigation/methods"
        private const val EVENTS = "com.semitrack/navigation/locations"
    }
}


