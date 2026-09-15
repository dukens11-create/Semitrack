package com.semitrax.nativebridge
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.location.*
import android.os.*
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

class SemiTraxPlatformModule(private val context: ReactApplicationContext) : NativeSemiTraxPlatformSpec(context), PermissionListener, LifecycleEventListener, LocationListener {
  private val handler = Handler(Looper.getMainLooper())
  private val manager = context.getSystemService(LocationManager::class.java)
  private val guidance: GuidanceBoundary = UnconfiguredGuidanceBoundary()
  private var pendingPermission: Promise? = null
  private var foregroundOnly = false
  init { context.addLifecycleEventListener(this) }
  override fun guidanceCommand(command: String, payload: String, promise: Promise) {
    try { promise.resolve(guidance.command(command, payload)) }
    catch (_: IllegalStateException) { promise.reject("NATIVE_TRUCK_GUIDANCE_NOT_CONFIGURED", "Native commercial guidance is not configured.") }
  }
  override fun locationPermissionStatus(promise: Promise) {
    promise.resolve(if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) "granted" else "denied")
  }
  override fun requestLocationPermission(background: Boolean, promise: Promise) {
    handler.post {
      if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) { promise.resolve("granted"); return@post }
      val activity = context.currentActivity as? PermissionAwareActivity
      if (activity == null) { promise.reject("ACTIVITY_UNAVAILABLE", "Open SemiTraX before requesting location."); return@post }
      if (pendingPermission != null) { promise.reject("PERMISSION_PENDING", "A permission request is already active."); return@post }
      pendingPermission = promise
      // Background uses a user-started foreground service, not background-start privileges.
      activity.requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 2402, this)
    }
  }
  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray): Boolean {
    if (requestCode != 2402) return false
    pendingPermission?.resolve(if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) "granted" else "denied")
    pendingPermission = null
    return true
  }
  override fun startLocation(background: Boolean, promise: Promise) {
    handler.post {
      try {
        if (context.currentActivity == null) throw IllegalStateException("Start tracking while SemiTraX is visible.")
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) throw SecurityException("Precise location permission required.")
        stopTracking()
        LocationEvents.onFix = { if (context.hasActiveReactInstance()) emitOnLocation(it) }
        LocationEvents.onError = { if (context.hasActiveReactInstance()) emitOnLocationError(it) }
        if (background) {
          val intent = Intent(context, LocationForegroundService::class.java)
          if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
        } else {
          if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) throw IllegalStateException("Enable GPS in device settings.")
          foregroundOnly = true
          // Receive real GPS updates while stationary; RN still rejects stale or inaccurate fixes.
          manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper())
        }
        promise.resolve(null)
      } catch (error: Exception) { stopTracking(); promise.reject("LOCATION_UNAVAILABLE", error.message, error) }
    }
  }
  override fun stopLocation(promise: Promise) { handler.post { stopTracking(); promise.resolve(null) } }
  private fun stopTracking() {
    foregroundOnly = false; manager.removeUpdates(this)
    context.stopService(Intent(context, LocationForegroundService::class.java))
    LocationEvents.onFix = null; LocationEvents.onError = null
  }
  override fun onLocationChanged(location: Location) = LocationEvents.publish(location)
  override fun onProviderDisabled(provider: String) { LocationEvents.onError?.invoke("GPS is disabled.") }
  override fun onProviderEnabled(provider: String) {}
  @Deprecated("Legacy API callback")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
  override fun onHostResume() {}
  override fun onHostPause() { if (foregroundOnly) { stopTracking(); emitOnLocationError("Foreground location paused. Enable location when returning to the planner.") } }
  override fun onHostDestroy() { stopTracking() }
  override fun invalidate() {
    handler.post { pendingPermission?.reject("MODULE_CLOSED", "Location module closed."); pendingPermission = null; stopTracking(); context.removeLifecycleEventListener(this) }
    super.invalidate()
  }
}
