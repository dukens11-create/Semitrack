package com.semitrax.nativebridge
import android.location.Location
import org.json.JSONObject
/** Process-local events. Never persist location or emit a fabricated fix. */
object LocationEvents {
  var onFix: ((String) -> Unit)? = null
  var onError: ((String) -> Unit)? = null
  fun publish(location: Location) {
    if (location.isFromMockProvider) { onError?.invoke("Mock location is not accepted for truck routing."); return }
    if (!location.hasAccuracy()) return
    onFix?.invoke(JSONObject().apply {
      put("latitude", location.latitude); put("longitude", location.longitude)
      put("accuracy", location.accuracy.toDouble()); put("timestamp", location.time)
      put("heading", if (location.hasBearing()) location.bearing.toDouble() else JSONObject.NULL)
      put("speed", if (location.hasSpeed()) location.speed.toDouble() else JSONObject.NULL)
    }.toString())
  }
}

