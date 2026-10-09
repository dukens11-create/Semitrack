package com.semitrax.nativebridge;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.alk.copilot.CopilotService;
import com.alk.cpik.CopilotListener;
import com.alk.cpik.CopilotMgr;
import com.alk.cpik.Coordinate;
import com.alk.cpik.Stop;
import com.alk.cpik.guidance.GuidanceSettings;
import com.alk.cpik.guidance.GuidanceMgr;
import com.alk.cpik.licensing.FeatureStatus;
import com.alk.cpik.licensing.LicenseFeature;
import com.alk.cpik.licensing.LicenseListener;
import com.alk.cpik.licensing.LicenseMgr;
import com.alk.cpik.licensing.LicenseMgtInfo;
import com.alk.cpik.mapdata.MapDataMgr;
import com.alk.cpik.mapdata.MapDataListener;
import com.alk.cpik.mapdata.MapDownloadResponse;
import com.alk.cpik.mapdata.MapInfo;
import com.alk.cpik.mapdata.MapRegion;
import com.alk.cpik.ui.MapDrawer;
import com.alk.cpik.ui.MapImageInfo;
import com.alk.cpik.ui.MapImageInfoList;
import com.alk.cpik.ui.MapImageSet;
import com.alk.cpik.ui.UIListener;
import com.alk.cpik.ui.UIMgr;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import com.facebook.react.bridge.*;
import com.facebook.react.common.LifecycleState;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Device-only AMS provisioning; never calls updateCreds or deactivates a license. */
public final class CoPilotHostModule extends ReactContextBaseJavaModule implements LifecycleEventListener {
  private final ReactApplicationContext context;
  private final Handler main = new Handler(Looper.getMainLooper());
  private static final String STORE = "copilot_device_v1";
  private static final String KEY = "semitrax_copilot_device_v1";
  private static final String CHANNEL = "semitrax_copilot";
  private JSONObject configuration;
  private boolean binding, connected, started, invalidated, mapPrepared;
  private boolean identityMismatch, listenersRegistered;
  private final List<Promise> startupWaiters = new ArrayList<>();
  private MapImageSet markerSet;

  public CoPilotHostModule(ReactApplicationContext context) {
    super(context);
    this.context = context;
    context.addLifecycleEventListener(this);
  }
  @Override public String getName() { return "SemiTraxCoPilotHost"; }
  private void emit(String event) {
    if (!invalidated && context.hasActiveReactInstance())
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(event, null);
  }
  private void emitMap(String event, WritableMap value) {
    if (!invalidated && context.hasActiveReactInstance())
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(event, value);
  }
  private final MapDataListener mapListener = new MapDataListener() {
    @Override public void onMapLocationPicked(Stop stop) {
      if (!started || stop == null || stop.getAddressObject() == null) return;
      Coordinate coordinate = stop.getAddressObject().getCoordinate();
      if (coordinate == null || !coordinate.isValid()) return;
      WritableMap point = Arguments.createMap();
      point.putDouble("lat", coordinate.getLatitude());
      point.putDouble("lng", coordinate.getLongitude());
      emitMap("SemiTraxCoPilotMapPicked", point);
    }
  };
  private final UIListener uiListener = new UIListener() {
    @Override public void onMapImageTouchEvent(MapImageInfo info) {
      if (!started || info == null) return;
      WritableMap result = Arguments.createMap();
      result.putInt("id", info.getID());
      emitMap("SemiTraxCoPilotMarkerPicked", result);
    }
  };
  private SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore");
    store.load(null);
    if (!store.containsAlias(KEY)) {
      KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
      generator.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
      generator.generateKey();
    }
    return (SecretKey) store.getKey(KEY, null);
  }
  private JSONObject readStored() throws Exception {
    String value = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getString("encrypted", null);
    if (value == null) return null;
    JSONObject envelope = new JSONObject(value);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)));
    return new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
  }
  private void writeStored(JSONObject value) throws Exception {
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key());
    byte[] encrypted = cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
    JSONObject envelope = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
        .put("data", Base64.encodeToString(encrypted, Base64.NO_WRAP));
    if (!context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit().putString("encrypted", envelope.toString()).commit())
      throw new IllegalStateException("STORE_FAILED");
  }
  private boolean identityMatches(LicenseMgtInfo active) throws Exception {
    return active != null && configuration.getString("company").equals(active.getCompanyID()) &&
        configuration.getString("device").equalsIgnoreCase(active.getAssetID());
  }
  private boolean activeIdentityPresent(LicenseMgtInfo active) {
    return active != null && active.getAssetID() != null && !active.getAssetID().isEmpty();
  }
  private final LicenseListener hook = new LicenseListener() {
    @Override public LicenseMgtInfo licenseMgtCredentialHook() {
      try {
        if (invalidated || configuration == null) return null;
        LicenseMgtInfo active = LicenseMgr.GetActiveAMSUser();
        if (activeIdentityPresent(active) && !identityMatches(active)) {
          identityMismatch = true;
          // Empty hook preserves cached licenses instead of switching the AMS account.
          return null;
        }
        return new LicenseMgtInfo(configuration.getString("device"), configuration.getString("company"));
      } catch (Exception e) {
        identityMismatch = true;
        return null;
      }
    }
  };
  private final CopilotListener startupListener = new CopilotListener() {
    @Override public void onCPStartup() {
      main.post(() -> {
        if (invalidated || !binding) return;
        if (CopilotMgr.getView() == null) {
          rejectWaiters("COPILOT_VIEW_UNAVAILABLE");
          release();
          return;
        }
        // Map/preview integration does not authorize restored or new live guidance.
        try {
          if (context.getLifecycleState() != LifecycleState.RESUMED ||
              ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            throw new IllegalStateException("VISIBLE_PRECISE_LOCATION_REQUIRED");
          GuidanceMgr.suspendNavigation(true);
          CopilotMgr.enableGPS();
        }
        catch (Exception e) { rejectWaiters("COPILOT_GUIDANCE_SUSPEND_FAILED"); release(); return; }
        started = true;
        main.removeCallbacks(startupTimeout);
        emit("onCPStartup");
        for (Promise promise : new ArrayList<>(startupWaiters)) promise.resolve(null);
        startupWaiters.clear();
      });
    }
    @Override public void onCPShutdown() {
      main.post(() -> {
        started = false;
        emit("onCPShutdown");
        rejectWaiters("COPILOT_SHUTDOWN");
        release();
      });
    }
  };
  private void rejectWaiters(String code) {
    for (Promise promise : new ArrayList<>(startupWaiters)) promise.reject(code, "CoPilot native startup could not complete.");
    startupWaiters.clear();
  }
  private final Runnable startupTimeout = () -> {
    if (!started) {
      rejectWaiters("COPILOT_STARTUP_TIMEOUT");
      release();
    }
  };
  private final ServiceConnection connection = new ServiceConnection() {
    @Override public void onServiceConnected(ComponentName name, IBinder binder) {
      if (invalidated) { release(); return; }
      try {
        connected = true;
        if (!(binder instanceof CopilotService.CopilotBinder)) throw new IllegalStateException("INVALID_BINDER");
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (android.os.Build.VERSION.SDK_INT >= 26) {
          NotificationChannel channel = new NotificationChannel(CHANNEL, "SemiTraX CoPilot", NotificationManager.IMPORTANCE_LOW);
          channel.setSound(null, null);
          manager.createNotificationChannel(channel);
        }
        Notification.Builder notification = android.os.Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, CHANNEL) : new Notification.Builder(context);
        ((CopilotService.CopilotBinder) binder).startForeground(919, notification
            .setContentTitle("SemiTraX CoPilot map engine").setSmallIcon(context.getApplicationInfo().icon)
            .setOngoing(true).build());
      } catch (Exception e) {
        rejectWaiters("COPILOT_FOREGROUND_FAILED");
        release();
      }
    }
    @Override public void onServiceDisconnected(ComponentName name) {
      connected = false;
      started = false;
      rejectWaiters("COPILOT_SERVICE_DISCONNECTED");
      emit("onCPShutdown");
      release();
    }
    @Override public void onBindingDied(ComponentName name) {
      onServiceDisconnected(name);
      release();
    }
    @Override public void onNullBinding(ComponentName name) {
      rejectWaiters("COPILOT_INVALID_BINDING");
      release();
    }
  };
  private void release() {
    main.removeCallbacks(startupTimeout);
    if (binding) {
      try { context.unbindService(connection); } catch (IllegalArgumentException ignored) {}
    }
    binding = connected = started = mapPrepared = false;
  }
  private MapRegion region() throws Exception { return MapRegion.valueOf(configuration.getString("region")); }
  private List<MapInfo> installed() {
    List<MapInfo> result = MapDataMgr.getInstalledMaps();
    return result == null ? Collections.emptyList() : result;
  }
  private MapInfo selectedInstalled() throws Exception {
    MapInfo selected = null;
    for (MapInfo map : installed()) {
      if (map.getRegion() == region() && (selected == null || map.getYear() * 4 + map.getQuarter() > selected.getYear() * 4 + selected.getQuarter()))
        selected = map;
    }
    return selected;
  }
  private WritableMap publicConfiguration() throws Exception {
    WritableMap result = Arguments.createMap();
    result.putString("sdkVersion", "10.28.2.497");
    result.putString("platform", "android");
    result.putString("environment", "development");
    result.putString("licensingMode", "ams-company");
    result.putString("credentialRef", STORE);
    result.putString("mapRegionConstant", configuration.getString("region"));
    MapInfo selected = started ? selectedInstalled() : null;
    WritableMap version = Arguments.createMap();
    // Sentinel is never installation evidence; replaced with SDK inventory after startup.
    version.putInt("year", selected == null ? 2000 : selected.getYear());
    version.putInt("quarter", selected == null ? 1 : selected.getQuarter());
    version.putString("version", selected == null ? "NOT_INSTALLED" : selected.getVersion());
    result.putMap("mapVersion", version);
    return result;
  }
  @ReactMethod public void configureDevice(String company, String device, String mapRegion, Promise promise) {
    main.post(() -> {
      try {
        if (binding || started) throw new IllegalStateException("SESSION_ALREADY_STARTED");
        if (!company.matches("[A-Za-z0-9_-]{1,128}") || !device.matches("[A-Za-z0-9_.-]{1,128}")) throw new IllegalArgumentException();
        MapRegion.valueOf(mapRegion);
        JSONObject next = new JSONObject().put("company", company).put("device", device).put("region", mapRegion);
        JSONObject saved = readStored();
        if (saved != null && (!saved.getString("company").equals(company) || !saved.getString("device").equalsIgnoreCase(device)))
          throw new IllegalStateException("DEVICE_IDENTITY_CHANGE_BLOCKED");
        writeStored(next);
        configuration = next;
        promise.resolve(null);
      } catch (Exception e) { promise.reject("COPILOT_DEVICE_SETUP_FAILED", "Device setup could not be saved. Existing identity and maps are preserved."); }
    });
  }
  @ReactMethod public void prepareDevice(Promise promise) {
    main.post(() -> {
      try {
        configuration = readStored();
        promise.resolve(configuration == null ? null : publicConfiguration());
      } catch (Exception e) { promise.reject("COPILOT_SECURE_RESTORE_FAILED", "Saved CoPilot setup could not be restored."); }
    });
  }
  @ReactMethod public void startEngine(Promise promise) {
    main.post(() -> {
      try {
        if (invalidated || configuration == null) throw new IllegalStateException("DEVICE_SETUP_REQUIRED");
        if (started) { emit("onCPStartup"); promise.resolve(null); return; }
        Activity activity = getCurrentActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed() || context.getLifecycleState() != LifecycleState.RESUMED)
          throw new IllegalStateException("FOREGROUND_ACTIVITY_REQUIRED");
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
          throw new IllegalStateException("PRECISE_LOCATION_REQUIRED");
        startupWaiters.add(promise);
        if (binding) return;
        // Register hook before binding. No JS credentials, product keys or defaults.
        identityMismatch = false;
        if (!listenersRegistered) {
          CopilotListener.registerListener(startupListener);
          MapDataListener.registerListener(mapListener);
          UIListener.registerListener(uiListener);
          LicenseListener.registerHook(hook);
          listenersRegistered = true;
        }
        CopilotMgr.allowCellularDataForMapDownloads(false);
        binding = context.bindService(new Intent(context, CopilotService.class), connection, Context.BIND_AUTO_CREATE);
        if (!binding) throw new IllegalStateException("BIND_FAILED");
        main.postDelayed(startupTimeout, 30000);
      } catch (Exception e) {
        if (startupWaiters.contains(promise)) rejectWaiters("COPILOT_NATIVE_STARTUP_FAILED");
        else {
          String reason = e.getMessage();
          String code = "PRECISE_LOCATION_REQUIRED".equals(reason) ? "COPILOT_PRECISE_LOCATION_REQUIRED"
              : "FOREGROUND_ACTIVITY_REQUIRED".equals(reason) ? "COPILOT_FOREGROUND_ACTIVITY_REQUIRED"
              : "DEVICE_SETUP_REQUIRED".equals(reason) ? "COPILOT_DEVICE_SETUP_REQUIRED"
              : "COPILOT_NATIVE_STARTUP_FAILED";
          promise.reject(code, "CoPilot requires saved setup, precise location and a visible app.");
        }
        if (!started) release();
      }
    });
  }
  private void requireIdentity() throws Exception {
    if (!started || identityMismatch || !identityMatches(LicenseMgr.GetActiveAMSUser())) throw new IllegalStateException("DEVICE_IDENTITY_UNVERIFIED");
  }
  private boolean feature(LicenseFeature feature) {
    FeatureStatus status = LicenseMgr.getFeatureStatus(feature);
    return status == FeatureStatus.LICENSED || status == FeatureStatus.UNLIMITED;
  }
  @ReactMethod public void licenseState(Promise promise) {
    main.post(() -> {
      try {
        requireIdentity();
        boolean ready = LicenseMgr.isLicensingReady();
        WritableMap result = Arguments.createMap();
        result.putBoolean("licensingReady", ready);
        result.putBoolean("fullNavigationLicensed", ready && feature(LicenseFeature.FULL_NAVIGATION));
        result.putBoolean("heavyTruckLicensed", ready && feature(LicenseFeature.TRUCK_HEAVY_DUTY));
        promise.resolve(result);
      } catch (Exception e) { promise.reject("COPILOT_IDENTITY_UNVERIFIED", "This device’s AMS identity and license could not be verified."); }
    });
  }
  @ReactMethod public void mapInventory(Promise promise) {
    main.post(() -> {
      try {
        requireIdentity();
        WritableMap result = Arguments.createMap();
        WritableArray licensed = Arguments.createArray();
        List<MapRegion> licensedMaps = MapDataMgr.getLicensedMapList();
        if (licensedMaps != null) for (MapRegion map : licensedMaps) licensed.pushInt(map.ordinal());
        WritableArray maps = Arguments.createArray();
        for (MapInfo map : installed()) {
          WritableMap info = Arguments.createMap();
          info.putInt("set", map.getRegion().ordinal());
          info.putInt("year", map.getYear());
          info.putInt("quarter", map.getQuarter());
          info.putString("versionString", map.getVersion());
          maps.pushMap(info);
        }
        result.putArray("licensed", licensed);
        result.putArray("installed", maps);
        result.putInt("selectedRegion", region().ordinal());
        promise.resolve(result);
      } catch (Exception e) { promise.reject("COPILOT_INVENTORY_FAILED", "Installed-map verification is unavailable."); }
    });
  }
  @ReactMethod public void downloadSelectedMap(Promise promise) {
    main.post(() -> {
      try {
        requireIdentity();
        if (context.getLifecycleState() != LifecycleState.RESUMED) throw new IllegalStateException("FOREGROUND_REQUIRED");
        if (!LicenseMgr.isLicensingReady() || !feature(LicenseFeature.FULL_NAVIGATION) || !feature(LicenseFeature.TRUCK_HEAVY_DUTY))
          throw new IllegalStateException("LICENSE_REQUIRED");
        if (selectedInstalled() != null) { promise.resolve("INSTALLED"); return; }
        List<MapRegion> licensed = MapDataMgr.getLicensedMapList();
        if (licensed == null || !licensed.contains(region())) throw new IllegalStateException("REGION_UNLICENSED");
        // SDK validates storage and network; cellular downloads are explicitly disabled.
        // Initial-install mode only when verified inventory is empty: no existing map is overwritten.
        MapDownloadResponse response = MapDataMgr.downloadMap(Collections.singletonList(region()), Collections.emptyList(), installed().isEmpty());
        promise.resolve(response.name());
      } catch (Exception e) { promise.reject("COPILOT_DOWNLOAD_FAILED", "Map download requires verified licensing, Wi-Fi and sufficient storage."); }
    });
  }
  private void requireMap() throws Exception {
    requireIdentity();
    List<MapRegion> licensed = MapDataMgr.getLicensedMapList();
    if (!LicenseMgr.isLicensingReady() || !feature(LicenseFeature.FULL_NAVIGATION) || !feature(LicenseFeature.TRUCK_HEAVY_DUTY)
        || selectedInstalled() == null || licensed == null || !licensed.contains(region())) throw new IllegalStateException("MAP_UNVERIFIED");
  }
  @ReactMethod public void setMapAppearance(boolean night, Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        GuidanceSettings.setMapMode(night ? GuidanceSettings.MapMode.NIGHT : GuidanceSettings.MapMode.DAY);
        MapDrawer drawer = UIMgr.getMapDrawer();
        drawer.setMapView(MapDrawer.MapViewType.TWO_DIMENSIONAL_NO_WIDGETS);
        if (!mapPrepared) {
          drawer.setMapOrientation(MapDrawer.MapOrientation.NORTH_UP);
          drawer.lockToChevron();
          mapPrepared = true;
        }
        promise.resolve(null);
      }
      catch (Exception e) { promise.reject("COPILOT_MAP_UNAVAILABLE", "CoPilot map setup is incomplete."); }
    });
  }
  @ReactMethod public void mapCommand(String command, Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        MapDrawer drawer = UIMgr.getMapDrawer();
        switch (command) {
          case "recenter": drawer.lockToChevron(); break;
          case "north-up": drawer.setMapOrientation(MapDrawer.MapOrientation.NORTH_UP); break;
          case "heading-up": drawer.setMapOrientation(MapDrawer.MapOrientation.HEADING_UP); break;
          case "zoom-in": drawer.mapZoom(MapDrawer.ZoomAction.ZOOM_IN); break;
          case "zoom-out": drawer.mapZoom(MapDrawer.ZoomAction.ZOOM_OUT); break;
          default: throw new IllegalArgumentException();
        }
        promise.resolve(null);
      } catch (Exception e) { promise.reject("COPILOT_MAP_COMMAND_FAILED", "CoPilot map control is unavailable."); }
    });
  }
  @ReactMethod public void drawRoutePreview(ReadableArray points, Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        if (points.size() > 20000) throw new IllegalArgumentException();
        ArrayList<Coordinate> coordinates = new ArrayList<>();
        for (int i = 0; i < points.size(); i++) {
          ReadableArray point = points.getArray(i);
          if (point == null || point.size() != 2) throw new IllegalArgumentException();
          double longitude = point.getDouble(0), latitude = point.getDouble(1);
          if (!Double.isFinite(latitude) || !Double.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new IllegalArgumentException();
          coordinates.add(new Coordinate(latitude, longitude));
        }
        MapDrawer drawer = UIMgr.getMapDrawer();
        drawer.clearDashedLine();
        if (coordinates.size() > 1) drawer.drawDashedLine(coordinates);
        promise.resolve(null);
      } catch (Exception e) { promise.reject("COPILOT_PREVIEW_FAILED", "The planning route could not be displayed on CoPilot."); }
    });
  }
  @ReactMethod public void mapFrame(double west, double south, double east, double north, Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        if (!Double.isFinite(west + south + east + north) || west < -180 || east > 180 || south < -90 || north > 90 || west > east || south > north) throw new IllegalArgumentException();
        UIMgr.getMapDrawer().setMapFrame(new Coordinate(south, west), new Coordinate(north, east));
        promise.resolve(null);
      } catch (Exception e) { promise.reject("COPILOT_FRAME_FAILED", "Route overview could not be displayed."); }
    });
  }
  @ReactMethod public void drawMarkers(ReadableArray markers, Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        if (markers.size() > 500) throw new IllegalArgumentException();
        MapImageInfoList points = new MapImageInfoList();
        for (int i = 0; i < markers.size(); i++) {
          ReadableMap marker = markers.getMap(i);
          if (marker == null) throw new IllegalArgumentException();
          Coordinate point = new Coordinate(marker.getDouble("lat"), marker.getDouble("lng"));
          if (!point.isValid()) throw new IllegalArgumentException();
          points.add(new MapImageInfo(marker.getInt("id"), point));
        }
        MapDrawer drawer = UIMgr.getMapDrawer();
        if (markerSet != null) { drawer.removeImageSet(markerSet); markerSet = null; }
        if (!points.isEmpty()) {
          Bitmap image = Bitmap.createBitmap(40, 40, Bitmap.Config.ARGB_8888);
          Canvas canvas = new Canvas(image);
          Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
          paint.setColor(0xFFFFFFFF); canvas.drawCircle(20, 20, 19, paint);
          paint.setColor(0xFFFF6B2C); canvas.drawCircle(20, 20, 15, paint);
          markerSet = new MapImageSet("semitrax-planning-places", image, points);
          drawer.drawImages(markerSet);
        }
        promise.resolve(null);
      } catch (Exception e) { promise.reject("COPILOT_MARKERS_FAILED", "Map places could not be displayed."); }
    });
  }
  @Override public void onHostResume() {}
  @Override public void onHostPause() {}
  @Override public void onHostDestroy() { main.post(() -> { rejectWaiters("COPILOT_HOST_DESTROYED"); release(); }); }
  @Override public void invalidate() {
    invalidated = true;
    context.removeLifecycleEventListener(this);
    main.post(() -> {
      rejectWaiters("COPILOT_HOST_DESTROYED"); release();
      CopilotListener.unregisterListener(startupListener);
      MapDataListener.unregisterListener(mapListener);
      UIListener.unregisterListener(uiListener);
      // Do not clear native credentials, installed maps or cached licenses.
    });
    super.invalidate();
  }
}
