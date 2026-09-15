package com.semitrax.nativebridge
import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.*
import android.os.*
import com.semitrax.MainActivity
/** Started by an explicit foreground user action. No automatic restart or boot receiver. */
class LocationForegroundService : Service(), LocationListener {
  private lateinit var manager: LocationManager
  override fun onBind(intent: Intent?) = null
  override fun onCreate() {
    super.onCreate()
    manager = getSystemService(LocationManager::class.java)
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) throw SecurityException("Precise location permission required.")
      val notifications = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= 26) notifications.createNotificationChannel(NotificationChannel("semitrax_location", "Truck location", NotificationManager.IMPORTANCE_LOW))
      val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "semitrax_location") else Notification.Builder(this)
      val notification = builder.setContentTitle("SemiTraX location active").setContentText("Return to SemiTraX to stop location tracking.").setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentIntent(open).setOngoing(true).build()
      if (Build.VERSION.SDK_INT >= 29) startForeground(2401, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) else startForeground(2401, notification)
      if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) throw IllegalStateException("Enable GPS in device settings.")
      manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 1f, this, Looper.getMainLooper())
    } catch (error: Exception) {
      LocationEvents.onError?.invoke(error.message ?: "Location tracking unavailable.")
      stopSelf()
    }
    return START_NOT_STICKY
  }
  override fun onLocationChanged(location: Location) = LocationEvents.publish(location)
  override fun onProviderDisabled(provider: String) { LocationEvents.onError?.invoke("GPS is disabled.") }
  override fun onProviderEnabled(provider: String) {}
  @Deprecated("Legacy API callback")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
  override fun onTaskRemoved(rootIntent: Intent?) { stopSelf() }
  override fun onDestroy() { manager.removeUpdates(this); super.onDestroy() }
}

