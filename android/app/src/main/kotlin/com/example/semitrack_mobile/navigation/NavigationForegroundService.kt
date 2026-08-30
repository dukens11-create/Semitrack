package com.example.semitrack_mobile.navigation

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.example.semitrack_mobile.MainActivity
import com.example.semitrack_mobile.R
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

class NavigationForegroundService : Service() {
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            // LocationResult may contain several chronologically ordered fixes
            // after Android briefly batches updates in the background. Emitting
            // every fix lets Flutter interpolate continuously without losing
            // genuine movement between the first and last samples.
            result.locations.forEach(NavigationEventEmitter::location)
        }
    }

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        createNotificationChannel()
    }

    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val intervalMs = intent?.getLongExtra(EXTRA_INTERVAL, 1_000L)?.coerceIn(500, 10_000) ?: 1_000L
        val distanceMeters = intent?.getFloatExtra(EXTRA_DISTANCE, 0f)?.coerceIn(0f, 100f) ?: 0f
        startForeground(NOTIFICATION_ID, notification())
        running = true

        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs.coerceAtLeast(500L))
            .setMinUpdateDistanceMeters(distanceMeters)
            .setWaitForAccurateLocation(false)
            // Navigation must not opt into fused-location batching. A delayed
            // batch makes the marker appear two or three seconds behind even
            // when each fix itself is accurate.
            .setMaxUpdateDelayMillis(intervalMs)
            .build()

        try {
            fusedLocationClient.removeLocationUpdates(locationCallback)
            fusedLocationClient.requestLocationUpdates(
                request,
                locationCallback,
                Looper.getMainLooper(),
            ).addOnFailureListener { error ->
                NavigationEventEmitter.error(
                    NavigationFailure(
                        "LOCATION_UPDATES_FAILED",
                        error.message ?: "Android could not start high-accuracy location updates",
                    ),
                )
            }

            // Do not wait for the next one-second interval before drawing the
            // truck. The fused provider supplies its latest known fix first;
            // the callback above immediately replaces it with live updates.
            fusedLocationClient.lastLocation.addOnSuccessListener { location ->
                if (location != null && System.currentTimeMillis() - location.time <= MAX_CACHED_FIX_AGE_MS) {
                    NavigationEventEmitter.location(location)
                }
            }
        } catch (error: SecurityException) {
            NavigationEventEmitter.error(NavigationFailure("LOCATION_PERMISSION_REVOKED", error.message ?: "Location permission was revoked"))
            stopSelf()
        }
        return START_REDELIVER_INTENT
    }

    override fun onDestroy() {
        fusedLocationClient.removeLocationUpdates(locationCallback)
        running = false
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Active navigation", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Keeps truck navigation and location active"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun notification() = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.mipmap.ic_launcher)
        .setContentTitle("Semitrack navigation active")
        .setContentText("Using precise location for active truck navigation")
        .setOngoing(true)
        .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
        .setContentIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        .build()

    companion object {
        private const val CHANNEL_ID = "semitrack_navigation"
        private const val NOTIFICATION_ID = 4101
        private const val EXTRA_INTERVAL = "intervalMs"
        private const val EXTRA_DISTANCE = "distanceFilterMeters"
        private const val MAX_CACHED_FIX_AGE_MS = 30_000L
        @Volatile var running: Boolean = false

        fun startIntent(context: Context, intervalMs: Long, distanceMeters: Float) =
            Intent(context, NavigationForegroundService::class.java)
                .putExtra(EXTRA_INTERVAL, intervalMs)
                .putExtra(EXTRA_DISTANCE, distanceMeters)
    }
}
