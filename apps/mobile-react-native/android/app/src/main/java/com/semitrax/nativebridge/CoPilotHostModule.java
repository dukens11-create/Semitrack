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
import android.os.Build;
import com.semitrax.BuildConfig;
import android.os.IBinder;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import com.alk.copilot.CopilotService;
import com.alk.cpik.CopilotListener;
import com.alk.cpik.CopilotMgr;
import com.alk.cpik.ConfigurationSetting;
import com.alk.cpik.Coordinate;
import com.alk.cpik.Stop;
import com.alk.cpik.POICategory;
import com.alk.cpik.POIListener;
import com.alk.cpik.POIAlert;
import com.alk.cpik.POISearchResult;
import com.alk.cpik.StopBuilder;
import com.alk.cpik.GeocodeSearchType;
import com.alk.cpik.POISettings;
import com.alk.cpik.guidance.GuidanceSettings;
import com.alk.cpik.guidance.GuidanceMgr;
import com.alk.cpik.licensing.FeatureStatus;
import com.alk.cpik.licensing.LicenseFeature;
import com.alk.cpik.licensing.LicenseActivationResponse;
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
import com.alk.cpik.route.RouteMgr;
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
  private final CoPilotLoginTrace loginTrace = new CoPilotLoginTrace();
  private void trace(CoPilotLoginTrace.Event event) {
    loginTrace.record(event, started, deviceConfigured, null);
  }
  private static final String STORE = "copilot_device_v1";
  private static final String KEY = "semitrax_copilot_device_v1";
  private static final String CHANNEL = "semitrax_copilot";
  private JSONObject configuration;
  private volatile LicenseMgtInfo assignedIdentity;
  private volatile String credentialHookState = "NOT_CALLED";
  private volatile LicenseActivationResponse loginResponse;
  private volatile long credentialHookAt;
  private volatile boolean hookMatchedAssigned, callbackMatchedAssigned;
  private volatile boolean deviceConfigured;
  private volatile String deviceConfigurationStatus = "WAITING_FOR_STARTUP";
  private volatile String deviceReadbackKind = "NOT_READ";
  private long deviceWriteAt;
  private final Runnable deviceReadbackCheck = this::verifyDeviceReadback;
  private boolean assignedRepairPendingRestart;
  private boolean binding, connected, invalidated, mapPrepared;
  private final CoPilotTripHandoff tripHandoff = new CoPilotTripHandoff();
  private volatile boolean tripPreparing;
  private int tripGeneration;
  private Promise pendingTrip;
  private boolean stoppingTrip;
  private final long controlCreatedAt = android.os.SystemClock.elapsedRealtime();
  private final java.util.ArrayDeque<String[]> controlTimeline = new java.util.ArrayDeque<>();
  private void control(String action, String stage) {
    // Fixed identifiers only: no native exception text or trip/account data.
    if (controlTimeline.size() == 64) controlTimeline.removeFirst();
    controlTimeline.addLast(new String[]{action, stage, Long.toString(android.os.SystemClock.elapsedRealtime() - controlCreatedAt), Boolean.toString(started), Boolean.toString(connected)});
    android.util.Log.i("SemiTraXHybrid", "{\"action\":\"" + action + "\",\"stage\":\"" + stage + "\"}");
  }
  @ReactMethod public void recordHybridControl(String action, String stage, Promise promise) {
    main.post(() -> {
      if (!java.util.Arrays.asList("START_RESUME", "TRUCK_SETTINGS", "END_ROUTE", "BACK", "READINESS", "SYNC_PROFILE").contains(action) ||
          !java.util.Arrays.asList("PRESS", "VALIDATING", "NATIVE_CALL", "CONFIRMED", "FAILED", "BUSY").contains(stage)) {
        promise.reject("INVALID_DIAGNOSTIC", "Invalid diagnostic event."); return;
      }
      control(action, stage); promise.resolve(null);
    });
  }
  private void requireSyncedTruck() {
    // CPIK 10.28 has no verified axle/trailer-count mapping in this integration.
    // Never certify a partial truck profile or bypass the heavy-duty safety gate.
    control("SYNC_PROFILE", "BLOCKED_UNSUPPORTED_RESTRICTIONS");
    throw new IllegalStateException("TRUCK_RESTRICTIONS_UNREPRESENTABLE");
  }
  @ReactMethod public void applyTruckProfile(ReadableMap profile, Promise promise) {
    main.post(() -> {
      try {
        // Read-only comparison against the ACTIVE CoPilot truck profile. Never claim
        // that dimensions are synchronized merely because JS supplied matching data.
        if (profile == null) throw new IllegalArgumentException("TRUCK_PROFILE_REQUIRED");
        requireMap();
        com.alk.cpik.route.VehicleRoutingProfile active = RouteMgr.getActiveVehicleRoutingProfile();
        if (active == null || active.getVehicleType() != com.alk.cpik.route.RouteEnums.VehicleType.TRUCK_HEAVY_DUTY)
          throw new IllegalStateException("HEAVY_DUTY_PROFILE_REQUIRED");
        com.alk.cpik.route.VehicleDimensions dims = active.getVehicleDimensions();
        String[] keys = {"heightInches", "widthInches", "lengthInches", "weightLbs"};
        int[] actual = {dims.getHeight().getInches(), dims.getWidth().getInches(),
            dims.getLength().getInches(), dims.getTotalWeight().getPounds()};
        for (int i = 0; i < keys.length; i++) {
          if (!profile.hasKey(keys[i]) || profile.isNull(keys[i]) || profile.getType(keys[i]) != com.facebook.react.bridge.ReadableType.Number ||
              profile.getDouble(keys[i]) <= 0 || profile.getDouble(keys[i]) != actual[i])
            throw new IllegalStateException("TRUCK_DIMENSIONS_MISMATCH");
        }
        control("SYNC_PROFILE", "DIMENSIONS_MATCH_UNVERIFIED_AXLES_TRAILERS");
        // Axle/trailer counts remain unverified in CPIK 10.28. Keep guidance fail-closed.
        promise.reject("TRUCK_RESTRICTIONS_UNREPRESENTABLE",
            "CoPilot dimensions match, but axle and trailer restrictions are not verified. Navigation remains blocked.");
      } catch (Exception e) {
        control("SYNC_PROFILE", "FAILED");
        String reason = e.getMessage();
        String code = "TRUCK_DIMENSIONS_MISMATCH".equals(reason) ? "TRUCK_DIMENSIONS_MISMATCH"
            : "HEAVY_DUTY_PROFILE_REQUIRED".equals(reason) ? "HEAVY_DUTY_PROFILE_REQUIRED"
            : "TRUCK_PROFILE_REQUIRED".equals(reason) ? "TRUCK_PROFILE_REQUIRED"
            : "MAP_UNVERIFIED".equals(reason) ? "COPILOT_MAP_OR_LICENSE_UNVERIFIED"
            : "TRUCK_PROFILE_READBACK_UNAVAILABLE";
        promise.reject(code, "Could not verify the active CoPilot heavy-duty truck profile. No settings were changed.");
      }
    });
  }
  private volatile boolean started;
  private boolean listenersRegistered;
  private final List<Promise> startupWaiters = new ArrayList<>();
  private MapImageSet markerSet;
  private volatile String mapDownloadResponse = "NOT_REQUESTED";
  private volatile String mapDownloadCallback = "NOT_RECEIVED";
  private volatile String mapDownloadStatus = "NOT_INITIATED";
  private volatile String mapDownloadStage = "NOT_REQUESTED";
  private volatile boolean mapCellularAllowed;
  private volatile int mapDownloadAttempts;
  private volatile boolean initialMapSignalReceived;
  private final CoPilotGuidanceTelemetry guidanceTelemetry;

  public CoPilotHostModule(ReactApplicationContext context) {
    super(context);
    this.context = context;
    guidanceTelemetry = new CoPilotGuidanceTelemetry(main,
        () -> started && connected && !invalidated,
        value -> emitMap("SemiTraxCoPilotGuidance", value));
    context.addLifecycleEventListener(this);
  }
  @Override public String getName() { return "SemiTraxCoPilotHost"; }
  @Override public java.util.Map<String, Object> getConstants() {
    return Collections.singletonMap("automaticAssignedSetup",
        BuildConfig.SEMITRAX_ASSIGNED_SAMSUNG && "SM-S908U".equals(Build.MODEL));
  }
  private void emit(String event) {
    if (!invalidated && context.hasActiveReactInstance())
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(event, null);
  }
  private void emitMap(String event, WritableMap value) {
    if (!invalidated && context.hasActiveReactInstance())
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(event, value);
  }
  private final java.util.concurrent.ConcurrentHashMap<MapRegion, String> regionDownloadStatus = new java.util.concurrent.ConcurrentHashMap<>();
  private final MapDataListener mapListener = new MapDataListener() {
    @Override public void onReadyToDownloadInitialMapData() {
      initialMapSignalReceived = true;
    }
    @Override public void onMapDownloadResponse(MapDownloadResponse response, List<MapRegion> regions, boolean initial) {
      // Retain only SDK enums; catalog downloads may be outside California.
      try {
        if (regions != null && !regions.isEmpty() && response != null)
          mapDownloadCallback = response.name();
      } catch (Exception ignored) {}
    }
    @Override public void onMapdataUpdate(MapInfo info, MapDataListener.DownloadStatus status) {
      try {
        if (info != null && info.getRegion() != null && status != null) {
          regionDownloadStatus.put(info.getRegion(), status.name());
          mapDownloadStatus = status.name();
        }
      } catch (Exception ignored) {}
    }
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
  private void publishNativeScreen(boolean navigationScreen) {
    if (invalidated) return;
    WritableMap result = Arguments.createMap();
    result.putBoolean("navigationScreen", navigationScreen);
    emitMap("SemiTraxCoPilotScreenChanged", result);
  }
  private final UIListener uiListener = new UIListener() {
    @Override public void onShowNavigationScreen(MapDrawer.MapViewType type) {
      publishNativeScreen(true);
    }
    @Override public void onLeaveNavigationScreen() {
      publishNativeScreen(false);
    }
    @Override public void onStartingPoiWizard() {
      publishNativeScreen(false);
    }
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
  private boolean activeIdentityPresent(LicenseMgtInfo active) {
    return active != null && active.getAssetID() != null && !active.getAssetID().isEmpty();
  }
  private final LicenseListener hook = new LicenseListener() {
    @Override public LicenseMgtInfo licenseMgtCredentialHook() {
      if (invalidated) return null;
      LicenseMgtInfo assigned = assignedIdentity;
      CoPilotCredentialPolicy.Decision decision = CoPilotCredentialPolicy.decide(
          // A native pointer/active flag can exist during bootstrap. Only our
          // completed startup callback authorizes a running-identity query.
          started && CopilotMgr.isActive(), assigned, () -> LicenseMgr.GetActiveAMSUser());
      trace(CoPilotLoginTrace.Event.CREDENTIAL_HOOK);
      credentialHookAt = System.nanoTime();
      credentialHookState = decision.name();
      hookMatchedAssigned = decision == CoPilotCredentialPolicy.Decision.SUPPLY_ASSIGNED &&
          CoPilotEnrollmentPolicy.COMPANY.equals(assigned.getCompanyID()) &&
          CoPilotEnrollmentPolicy.asset(BuildConfig.SEMITRAX_TEST_ASSET).equalsIgnoreCase(assigned.getAssetID());
      // isActive may be true before the configuration native pointer is usable.
      // Do not suppress authentication because a configuration API is not ready.
      // Apply Device ID synchronously in the documented onCPStartup callback.
      return decision == CoPilotCredentialPolicy.Decision.SUPPLY_ASSIGNED ? assigned : null;
    }
    @Override public void onLicenseMgtLogin(LicenseActivationResponse response, LicenseMgtInfo info) {
      // Do not retain callback account IDs or emit them into JS/logs.
      loginTrace.record(CoPilotLoginTrace.Event.LOGIN_CALLBACK, started, deviceConfigured, response);
      loginResponse = response;
      callbackMatchedAssigned = CoPilotCredentialPolicy.matches(assignedIdentity, info);
      main.post(() -> emit("onLicenseMgtLogin"));
    }
  };
  private void restoreAssignedIdentity() throws Exception {
    assignedIdentity = configuration == null ? null :
        CoPilotCredentialPolicy.assignedInfo(configuration.getString("device"), configuration.getString("company"));
  }
  private String assignedSdkDevice() {
    return CoPilotEnrollmentPolicy.sdkDevice(BuildConfig.SEMITRAX_TEST_ASSET, assignedIdentity.getAssetID());
  }
  private void configureAssignedDevice() throws Exception {
    if (assignedIdentity == null || !CopilotMgr.isActive())
      throw new IllegalStateException("DEVICE_CONFIGURATION_UNAVAILABLE");
    trace(CoPilotLoginTrace.Event.DEVICE_WRITE_REQUEST);
    CopilotMgr.setConfigurationSetting(ConfigurationSetting.create(ConfigurationSetting.DEVICE_ID, assignedSdkDevice()));
    trace(CoPilotLoginTrace.Event.DEVICE_WRITE_RETURNED);
    deviceWriteAt = System.nanoTime();
    deviceConfigurationStatus = "WAITING_FOR_READBACK";
    main.removeCallbacks(deviceReadbackCheck);
    main.postDelayed(deviceReadbackCheck, 250);
  }
  private void verifyDeviceReadback() {
    if (invalidated || !binding || !started || assignedIdentity == null) return;
    try {
      String actual = CopilotMgr.getConfigurationSetting(ConfigurationSetting.DEVICE_ID).getStringValue();
      long elapsedMs = (System.nanoTime() - deviceWriteAt) / 1000000;
      CoPilotDeviceReadbackPolicy.Result result = CoPilotDeviceReadbackPolicy.evaluate(assignedSdkDevice(), actual, elapsedMs);
      deviceReadbackKind = actual == null ? "NO_STRING_VALUE" : actual.isEmpty() ? "EMPTY"
          : result == CoPilotDeviceReadbackPolicy.Result.VERIFIED ? "MATCH" : "DIFFERENT";
      deviceConfigured = result == CoPilotDeviceReadbackPolicy.Result.VERIFIED;
      if (result == CoPilotDeviceReadbackPolicy.Result.PENDING) {
        trace(CoPilotLoginTrace.Event.DEVICE_READBACK_PENDING);
        main.postDelayed(deviceReadbackCheck, 500);
        return;
      }
      deviceConfigurationStatus = deviceConfigured ? "VERIFIED" : "READBACK_MISMATCH";
    } catch (ConfigurationSetting.ConfigurationException e) {
      deviceConfigurationStatus = e.getConfigurationError() == null ? "SDK_CONFIGURATION_ERROR" : e.getConfigurationError().name();
    } catch (Exception e) {
      deviceConfigurationStatus = "NATIVE_READBACK_UNAVAILABLE";
    }
    trace(deviceConfigured ? CoPilotLoginTrace.Event.DEVICE_READBACK_VERIFIED : CoPilotLoginTrace.Event.DEVICE_READBACK_FAILED);
    emit("onDeviceConfigurationChecked");
  }
  private String deviceConfigurationCode() {
    return deviceConfigurationStatus.startsWith("WAITING_FOR_")
        ? "COPILOT_AMS_DEVICE_CONFIGURATION_PENDING" : "COPILOT_AMS_DEVICE_CONFIGURATION_FAILED";
  }
  private final CopilotListener startupListener = new CopilotListener() {
    @Override public void onCPStartup() {
      if (invalidated) return;
      trace(CoPilotLoginTrace.Event.STARTUP_CALLBACK);
      deviceConfigured = false;
      try {
        // Run inside the SDK callback, before handing startup completion to JS.
        configureAssignedDevice();
      } catch (ConfigurationSetting.ConfigurationException e) {
        deviceConfigurationStatus = e.getConfigurationError() == null ? "SDK_CONFIGURATION_ERROR"
            : e.getConfigurationError().name();
      } catch (Exception e) {
        // Fixed app-owned codes only; never send raw native exceptions or IDs to JS.
        deviceConfigurationStatus = "DEVICE_CONFIGURATION_MISMATCH".equals(e.getMessage())
            ? "READBACK_MISMATCH" : "NATIVE_CONFIGURATION_UNAVAILABLE";
      }
      if (!"WAITING_FOR_READBACK".equals(deviceConfigurationStatus))
        trace(CoPilotLoginTrace.Event.DEVICE_CONFIGURATION_FAILED);
      main.post(() -> {
        if (invalidated || !binding) return;
        if (CopilotMgr.getView() == null) {
          rejectWaiters("COPILOT_VIEW_UNAVAILABLE");
          release();
          return;
        }
        // This SDK API throws while inactive. Apply policy only after onCPStartup,
        // before publishing startup or allowing JS to schedule any map download.
        try { CopilotMgr.allowCellularDataForMapDownloads(false); }
        catch (Exception e) { rejectWaiters("COPILOT_MAP_POLICY_FAILED"); release(); return; }
        // Keep startup suspended until the verified native CoPilot screen is opened.
        try {
          if (context.getLifecycleState() != LifecycleState.RESUMED ||
              ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            throw new IllegalStateException("VISIBLE_PRECISE_LOCATION_REQUIRED");
          GuidanceMgr.suspendNavigation(true);
          CopilotMgr.enableGPS();
        }
        catch (Exception e) { rejectWaiters("COPILOT_GUIDANCE_SUSPEND_FAILED"); release(); return; }
        started = true;
        trace(CoPilotLoginTrace.Event.STARTUP_PUBLISHED);
        main.removeCallbacks(startupTimeout);
        emit("onCPStartup");
        for (Promise promise : new ArrayList<>(startupWaiters)) promise.resolve(null);
        startupWaiters.clear();
      });
    }
    @Override public void onCPShutdown() {
      trace(CoPilotLoginTrace.Event.SHUTDOWN_CALLBACK);
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
      trace(CoPilotLoginTrace.Event.STARTUP_TIMEOUT);
      rejectWaiters("COPILOT_STARTUP_TIMEOUT");
      release();
    }
  };
  private final ServiceConnection connection = new ServiceConnection() {
    @Override public void onServiceConnected(ComponentName name, IBinder binder) {
      if (invalidated) { release(); return; }
      try {
        connected = true;
        trace(CoPilotLoginTrace.Event.SERVICE_CONNECTED);
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
      trace(CoPilotLoginTrace.Event.SERVICE_DISCONNECTED);
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
    guidanceTelemetry.stop();
    trace(CoPilotLoginTrace.Event.SERVICE_RELEASED);
    main.removeCallbacks(startupTimeout);
    main.removeCallbacks(deviceReadbackCheck);
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
    try { result.putString("sdkVersion", CopilotMgr.getVersionInfo().getAppVersion()); }
    catch (Exception ignored) { result.putString("sdkVersion", "UNAVAILABLE"); }
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
        restoreAssignedIdentity();
        promise.resolve(null);
      } catch (Exception e) { promise.reject("COPILOT_DEVICE_SETUP_FAILED", "Device setup could not be saved. Existing identity and maps are preserved."); }
    });
  }
  @ReactMethod public void prepareDevice(Promise promise) {
    main.post(() -> {
      try {
        if (assignedRepairPendingRestart && (binding || started))
          throw new IllegalStateException("RESTART_REQUIRED");
        configuration = readStored();
        if (CoPilotEnrollmentPolicy.shouldEnroll(BuildConfig.SEMITRAX_ASSIGNED_SAMSUNG,
            Build.MODEL, configuration != null, binding || started)) {
          JSONObject assigned = new JSONObject().put("company", CoPilotEnrollmentPolicy.COMPANY)
              .put("device", CoPilotEnrollmentPolicy.asset(BuildConfig.SEMITRAX_TEST_ASSET)).put("region", CoPilotEnrollmentPolicy.REGION);
          writeStored(assigned);
          configuration = assigned;
        }
        restoreAssignedIdentity();
        promise.resolve(configuration == null ? null : publicConfiguration());
      } catch (Exception e) { promise.reject("COPILOT_SECURE_RESTORE_FAILED", "Saved CoPilot setup could not be restored."); }
    });
  }
  private boolean canRepairAssignedTypo(JSONObject saved) throws Exception {
    return saved != null && CoPilotEnrollmentPolicy.canRepairTypo(
        BuildConfig.SEMITRAX_ASSIGNED_SAMSUNG, Build.MODEL, saved.getString("company"), saved.getString("device"),
        loginResponse == LicenseActivationResponse.FAILED_LOGIN_INVALID_CREDS,
        started && CopilotMgr.isActive(), () -> LicenseMgr.GetActiveAMSUser());
  }
  @ReactMethod public void setupDiagnostics(Promise promise) {
    main.post(() -> {
      try {
        JSONObject saved = readStored();
        WritableMap result = Arguments.createMap();
        // Blank reference IDs mean this build has no pinned enrollment identity.
        // A false match against a blank reference is NOT evidence of a wrong saved ID.
        String referenceCompany = CoPilotEnrollmentPolicy.COMPANY;
        String referenceDevice = CoPilotEnrollmentPolicy.asset(BuildConfig.SEMITRAX_TEST_ASSET);
        boolean referenceConfigured = referenceCompany != null && !referenceCompany.trim().isEmpty()
            && referenceDevice != null && !referenceDevice.trim().isEmpty();
        result.putBoolean("enrollmentReferenceConfigured", referenceConfigured);
        result.putString("enrollmentReferenceStatus", referenceConfigured ? "CONFIGURED" : "NOT_CONFIGURED");
        result.putBoolean("savedSetupPresent", saved != null);
        result.putBoolean("savedCompanyMatches", referenceConfigured && saved != null && referenceCompany.equals(saved.getString("company")));
        result.putBoolean("savedDeviceMatches", referenceConfigured && saved != null && referenceDevice.equalsIgnoreCase(saved.getString("device")));
        result.putString("credentialHook", credentialHookState);
        result.putBoolean("hookMatchedAssigned", hookMatchedAssigned);
        result.putBoolean("callbackMatchedAssigned", callbackMatchedAssigned);
        result.putString("loginResponse", loginResponse == null ? "NOT_RECEIVED" : loginResponse.name());
        result.putBoolean("deviceConfigured", deviceConfigured);
        result.putString("deviceConfigurationStatus", deviceConfigurationStatus);
        result.putString("deviceReadbackKind", deviceReadbackKind);
        result.putBoolean("canRepairTypo", canRepairAssignedTypo(saved));
        result.putBoolean("restartRequired", assignedRepairPendingRestart);
        trace(CoPilotLoginTrace.Event.REPORT_REQUEST);
        result.putString("reportBuild", "hybrid-issue392-v1");
        WritableMap identity = Arguments.createMap();
        identity.putString("commit", BuildConfig.SEMITRAX_BUILD_COMMIT);
        identity.putString("builtAt", BuildConfig.SEMITRAX_BUILD_TIME);
        identity.putString("packageName", context.getPackageName());
        identity.putString("variant", BuildConfig.BUILD_TYPE);
        identity.putInt("versionCode", BuildConfig.VERSION_CODE);
        identity.putString("versionName", BuildConfig.VERSION_NAME);
        result.putMap("buildIdentity", identity);
        WritableArray controls = Arguments.createArray();
        for (String[] entry : controlTimeline) {
          WritableMap item = Arguments.createMap();
          item.putString("action", entry[0]); item.putString("stage", entry[1]);
          item.putDouble("elapsedMs", Double.parseDouble(entry[2]));
          item.putBoolean("engineStarted", Boolean.parseBoolean(entry[3]));
          item.putBoolean("serviceConnected", Boolean.parseBoolean(entry[4])); controls.pushMap(item);
        }
        result.putArray("controlTimeline", controls);
        // This is a known code-level blocker, independent of SDK login or service binding.
        // Report it explicitly rather than making a failed Start/Resume look like a dead button.
        result.putString("truckRestrictionSync", "BLOCKED_UNSUPPORTED_AXLE_TRAILER_MAPPING");
        result.putBoolean("truckRestrictionsVerified", false);
        WritableMap storage = Arguments.createMap();
        try {
          android.os.StatFs filesystem = new android.os.StatFs(context.getFilesDir().getAbsolutePath());
          storage.putString("status", "AVAILABLE");
          storage.putDouble("availableBytes", filesystem.getAvailableBytes());
          storage.putDouble("totalBytes", filesystem.getTotalBytes());
        } catch (Exception ignored) {
          storage.putString("status", "UNAVAILABLE");
        }
        result.putMap("appStorage", storage);
        result.putMap("nativeDisplay", nativeDisplayDiagnostics());
        WritableMap download = Arguments.createMap();
        download.putString("response", mapDownloadResponse);
        download.putString("callback", mapDownloadCallback);
        download.putString("status", mapDownloadStatus);
        download.putString("stage", mapDownloadStage);
        download.putInt("attempts", mapDownloadAttempts);
        download.putBoolean("cellularAllowed", mapCellularAllowed);
        download.putBoolean("initialMapSignalReceived", initialMapSignalReceived);
        result.putMap("mapDownload", download);
        result.putInt("androidApi", Build.VERSION.SDK_INT);
        result.putBoolean("engineStarted", started);
        result.putBoolean("serviceBound", binding);
        result.putBoolean("serviceConnected", connected);
        String sdkVersion = "NOT_AVAILABLE";
        if (started) {
          try {
            String version = CopilotMgr.getVersionInfo().getAppVersion();
            if (version != null && version.matches("[0-9]+([.][0-9]+){1,4}")) sdkVersion = version;
          } catch (Exception ignored) {}
        }
        result.putString("sdkVersion", sdkVersion);
        WritableArray timeline = Arguments.createArray();
        for (CoPilotLoginTrace.Entry entry : loginTrace.snapshot()) {
          WritableMap item = Arguments.createMap();
          item.putDouble("sequence", entry.sequence);
          item.putDouble("elapsedMs", entry.elapsedMs);
          item.putString("event", entry.event.name());
          item.putBoolean("started", entry.started);
          item.putBoolean("deviceVerified", entry.deviceVerified);
          item.putString("response", entry.response == null ? "NOT_RECEIVED" : entry.response.name());
          timeline.pushMap(item);
        }
        result.putArray("timeline", timeline);
        result.putDouble("droppedEvents", loginTrace.dropped());
        promise.resolve(result);
      } catch (Exception e) { promise.reject("COPILOT_DIAGNOSTIC_UNAVAILABLE", "Setup diagnostics unavailable."); }
    });
  }
  @ReactMethod public void repairAssignedSetup(Promise promise) {
    main.post(() -> {
      try {
        JSONObject saved = readStored();
        if (!canRepairAssignedTypo(saved)) throw new IllegalStateException("REPAIR_NOT_ALLOWED");
        // Save the original encrypted envelope before narrowly correcting a rejected draft.
        android.content.SharedPreferences prefs = context.getSharedPreferences(STORE, Context.MODE_PRIVATE);
        if (!prefs.edit().putString("rejectedSetupBackup", prefs.getString("encrypted", null)).commit())
          throw new IllegalStateException("BACKUP_FAILED");
        JSONObject corrected = new JSONObject(saved.toString()).put("company", CoPilotEnrollmentPolicy.COMPANY);
        writeStored(corrected);
        assignedRepairPendingRestart = true;
        // Do not update the running SDK identity, log out, remove licenses, or erase maps.
        promise.resolve(null);
      } catch (Exception e) { promise.reject("COPILOT_REPAIR_BLOCKED", "Repair blocked. Existing setup and maps are preserved."); }
    });
  }
  @ReactMethod public void startEngine(Promise promise) {
    main.post(() -> {
      try {
        trace(CoPilotLoginTrace.Event.START_REQUEST);
        if (invalidated || configuration == null) throw new IllegalStateException("DEVICE_SETUP_REQUIRED");
        if (started) { trace(CoPilotLoginTrace.Event.START_REUSED); emit("onCPStartup"); promise.resolve(null); return; }
        Activity activity = getCurrentActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed() || context.getLifecycleState() != LifecycleState.RESUMED)
          throw new IllegalStateException("FOREGROUND_ACTIVITY_REQUIRED");
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
          throw new IllegalStateException("PRECISE_LOCATION_REQUIRED");
        startupWaiters.add(promise);
        if (binding) return;
        // Register hook before binding. No JS credentials, product keys or defaults.
        if (!listenersRegistered) {
          CopilotListener.registerListener(startupListener);
          MapDataListener.registerListener(mapListener);
          UIListener.registerListener(uiListener);
          LicenseListener.registerListener(hook);
          listenersRegistered = true;
        }
        guidanceTelemetry.start();
        // The vendor RN module also owns a default global hook. Reclaim the
        // singleton immediately before every bind, after all RN modules exist.
        credentialHookState = "NOT_CALLED";
        loginResponse = null;
        deviceConfigured = false;
        deviceConfigurationStatus = "WAITING_FOR_STARTUP";
        deviceReadbackKind = "NOT_READ";
        LicenseListener.registerHook(hook);
        trace(CoPilotLoginTrace.Event.HOOK_REGISTERED);
        trace(CoPilotLoginTrace.Event.SERVICE_BIND_REQUEST);
        binding = context.bindService(new Intent(context, CopilotService.class), connection, Context.BIND_AUTO_CREATE);
        if (!binding) throw new IllegalStateException("BIND_FAILED");
        main.postDelayed(startupTimeout, 30000);
      } catch (Exception e) {
        trace(CoPilotLoginTrace.Event.STARTUP_FAILED);
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
    if (!started) throw new IllegalStateException("COPILOT_AMS_ENGINE_NOT_STARTED");
    if (!deviceConfigured) throw new IllegalStateException(deviceConfigurationCode());
    LicenseMgtInfo active;
    try { active = LicenseMgr.GetActiveAMSUser(); }
    catch (Exception e) { throw new IllegalStateException("COPILOT_AMS_IDENTITY_QUERY_FAILED"); }
    if (!activeIdentityPresent(active) || active.getCompanyID() == null || active.getCompanyID().isEmpty())
      throw new IllegalStateException(missingIdentityCode());
    if (!configuration.getString("company").equals(active.getCompanyID()))
      throw new IllegalStateException("COPILOT_AMS_COMPANY_MISMATCH");
    if (!configuration.getString("device").equalsIgnoreCase(active.getAssetID()))
      throw new IllegalStateException("COPILOT_AMS_DEVICE_MISMATCH");
    // A fresh SDK identity is authoritative; an early hook failure cannot latch a rejection.
  }
  private String missingIdentityCode() {
    LicenseActivationResponse response = loginResponse;
    if (response != null && response != LicenseActivationResponse.SUCCESS &&
        response != LicenseActivationResponse.FAILED_LOGIN_WILL_EXPIRE)
      return "COPILOT_AMS_LOGIN_" + response.name();
    if ("NOT_CALLED".equals(credentialHookState)) return "COPILOT_AMS_HOOK_NOT_CALLED";
    if ("QUERY_FAILED".equals(credentialHookState)) return "COPILOT_AMS_HOOK_QUERY_FAILED";
    if ("PRESERVE_OTHER_ACCOUNT".equals(credentialHookState)) return "COPILOT_AMS_ACCOUNT_CHANGE_BLOCKED";
    if ("NO_ASSIGNMENT".equals(credentialHookState)) return "COPILOT_AMS_ASSIGNMENT_MISSING";
    if ("DEVICE_CONFIGURATION_FAILED".equals(credentialHookState)) return "COPILOT_AMS_DEVICE_CONFIGURATION_FAILED";
    if ("SUPPLY_ASSIGNED".equals(credentialHookState) && response == null)
      return System.nanoTime() - credentialHookAt < 25000000000L
          ? "COPILOT_AMS_LOGIN_RESPONSE_PENDING" : "COPILOT_AMS_LOGIN_NO_RESPONSE";
    return "COPILOT_AMS_IDENTITY_MISSING";
  }
  private boolean safeLoginCode(String detail) {
    for (LicenseActivationResponse response : LicenseActivationResponse.values())
      if (("COPILOT_AMS_LOGIN_" + response.name()).equals(detail)) return true;
    return false;
  }
  private boolean feature(LicenseFeature feature) {
    FeatureStatus status = LicenseMgr.getFeatureStatus(feature);
    return status == FeatureStatus.LICENSED || status == FeatureStatus.UNLIMITED;
  }
  @ReactMethod public void licenseState(Promise promise) {
    main.post(() -> {
      try {
        if (!started) throw new IllegalStateException("COPILOT_AMS_ENGINE_NOT_STARTED");
        boolean ready = LicenseMgr.isLicensingReady();
        LicenseActivationResponse response = loginResponse;
        if (!ready && response != null && response != LicenseActivationResponse.SUCCESS &&
            response != LicenseActivationResponse.FAILED_LOGIN_WILL_EXPIRE)
          throw new IllegalStateException("COPILOT_AMS_LOGIN_" + response.name());
        if (!deviceConfigured) throw new IllegalStateException(deviceConfigurationCode());
        // AMS can be pending after startup. Return non-ready without granting anything;
        // verify the exact assigned identity once licensing actually becomes ready.
        if (ready) requireIdentity();
        WritableMap result = Arguments.createMap();
        result.putBoolean("licensingReady", ready);
        result.putBoolean("fullNavigationLicensed", ready && feature(LicenseFeature.FULL_NAVIGATION));
        result.putBoolean("heavyTruckLicensed", ready && feature(LicenseFeature.TRUCK_HEAVY_DUTY));
        promise.resolve(result);
      } catch (Exception e) {
        String code = "COPILOT_LICENSE_QUERY_FAILED";
        String detail = e.getMessage();
        if ("COPILOT_AMS_ENGINE_NOT_STARTED".equals(detail) ||
            "COPILOT_AMS_IDENTITY_QUERY_FAILED".equals(detail) ||
            "COPILOT_AMS_IDENTITY_MISSING".equals(detail) ||
            "COPILOT_AMS_COMPANY_MISMATCH".equals(detail) ||
            "COPILOT_AMS_DEVICE_MISMATCH".equals(detail) ||
            "COPILOT_AMS_DEVICE_CONFIGURATION_FAILED".equals(detail) ||
            "COPILOT_AMS_DEVICE_CONFIGURATION_PENDING".equals(detail) ||
            "COPILOT_AMS_HOOK_NOT_CALLED".equals(detail) ||
            "COPILOT_AMS_HOOK_QUERY_FAILED".equals(detail) ||
            "COPILOT_AMS_ACCOUNT_CHANGE_BLOCKED".equals(detail) ||
            "COPILOT_AMS_ASSIGNMENT_MISSING".equals(detail) ||
            "COPILOT_AMS_LOGIN_RESPONSE_PENDING".equals(detail) ||
            "COPILOT_AMS_LOGIN_NO_RESPONSE".equals(detail) ||
            safeLoginCode(detail)) code = detail;
        promise.reject(code, "This device’s AMS identity and license could not be verified.");
      }
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
  @ReactMethod public void licensedMapCatalog(Promise promise) {
    main.post(() -> {
      try {
        requireIdentity();
        if (!LicenseMgr.isLicensingReady()) throw new IllegalStateException();
        WritableArray catalog = Arguments.createArray();
        List<MapRegion> licensed = MapDataMgr.getLicensedMapList();
        if (licensed != null) for (MapRegion region : licensed) {
          WritableMap row = Arguments.createMap();
          row.putString("name", region.name());
          boolean present = false;
          for (MapInfo map : installed()) if (map.getRegion() == region) present = true;
          row.putBoolean("installed", present);
          row.putString("downloadStatus", regionDownloadStatus.getOrDefault(region, "NOT_INITIATED"));
          catalog.pushMap(row);
        }
        promise.resolve(catalog);
      } catch (Exception e) { promise.reject("COPILOT_CATALOG_FAILED", "Licensed map catalog is unavailable. Retry device setup."); }
    });
  }
  private final java.util.concurrent.atomic.AtomicBoolean catalogRequest = new java.util.concurrent.atomic.AtomicBoolean(false);
  @ReactMethod public void downloadLicensedRegions(ReadableArray names, boolean cellular, Promise promise) {
    main.post(() -> {
      String failureMessage = "CoPilot device setup could not be verified. Open Details and check setup.";
      try {
        ++mapDownloadAttempts;
        mapDownloadResponse = "NOT_RECEIVED";
        mapDownloadStage = "CATALOG_IDENTITY_CHECK";
        requireIdentity();
        mapDownloadStage = "FOREGROUND_CHECK";
        failureMessage = "Keep SemiTraX open while requesting maps.";
        if (context.getLifecycleState() != LifecycleState.RESUMED) throw new IllegalStateException();
        mapDownloadStage = "ROUTE_CHECK";
        failureMessage = "CoPilot still has a destination, even if guidance has not started. Cancel the trip in CoPilot, then retry the download.";
        if (RouteMgr.hasDestination()) throw new IllegalStateException();
        mapDownloadStage = "LICENSE_CHECK";
        failureMessage = "CoPilot navigation and heavy-duty truck licensing could not be verified. Open Details and check setup.";
        if (!LicenseMgr.isLicensingReady() || !feature(LicenseFeature.FULL_NAVIGATION) || !feature(LicenseFeature.TRUCK_HEAVY_DUTY))
          throw new IllegalStateException();
        mapDownloadStage = "REGION_CHECK";
        failureMessage = "The selected map region could not be verified against the current license. Refresh licensed maps and select an available region.";
        List<MapRegion> licensed = MapDataMgr.getLicensedMapList();
        ArrayList<MapRegion> requested = new ArrayList<>();
        for (int i = 0; i < names.size(); i++) {
          mapDownloadStage = "REGION_CHECK";
          failureMessage = "The selected map region could not be verified against the current license. Refresh licensed maps and select an available region.";
          MapRegion target = MapRegion.valueOf(names.getString(i));
          if (licensed == null || !licensed.contains(target)) throw new IllegalStateException();
          mapDownloadStage = "INVENTORY_CHECK";
          failureMessage = "Installed maps could not be checked. Refresh the map list before retrying.";
          boolean present = false;
          for (MapInfo map : installed()) if (map.getRegion() == target) present = true;
          if (!present && !requested.contains(target)) requested.add(target);
        }
        if (requested.isEmpty()) { mapDownloadResponse = "INSTALLED"; mapDownloadStage = "COMPLETE"; promise.resolve("INSTALLED"); return; }
        if (!catalogRequest.compareAndSet(false, true)) { mapDownloadResponse = "FAILURE_MANAGER_BUSY"; mapDownloadStage = "APP_REQUEST_BUSY"; promise.resolve("FAILURE_MANAGER_BUSY"); return; }
        try {
          mapDownloadStage = "NETWORK_POLICY";
          failureMessage = "CoPilot could not apply the mobile-data preference. Retry the map request.";
          CopilotMgr.allowCellularDataForMapDownloads(cellular);
          mapCellularAllowed = cellular;
          mapDownloadStage = "CATALOG_SDK_REQUEST";
          failureMessage = "CoPilot could not prepare the map download. Share diagnostics from Details.";
          UIMgr.showDialog(UIMgr.Dialog.MAP_NAVIGATION_VIEW);
          // downloadMap performs a synchronous web request; keep it off the UI thread.
          new Thread(() -> {
            try {
              // Add to installed maps; keep every map component enabled.
              MapDownloadResponse response = MapDataMgr.downloadMap(requested, Collections.emptyList(), false);
              mapDownloadResponse = response.name();
              mapDownloadStage = "SDK_RESPONSE";
              promise.resolve(response.name());
            } catch (Exception e) {
              mapDownloadResponse = "NATIVE_EXCEPTION";
              mapDownloadStage = "CATALOG_REQUEST_FAILED";
              promise.reject("COPILOT_DOWNLOAD_FAILED", "Map request failed. Check connection and storage.");
            } finally { catalogRequest.set(false); }
          }, "CoPilotMapCatalog").start();
        } catch (Exception e) { catalogRequest.set(false); throw e; }
      } catch (Exception e) { mapDownloadResponse = "BLOCKED"; promise.reject("COPILOT_DOWNLOAD_BLOCKED", failureMessage); }
    });
  }
  @ReactMethod public void downloadSelectedMap(Promise promise) {
    downloadSelectedMap(false, promise);
  }
  @ReactMethod public void downloadSelectedMapUsingCellular(Promise promise) {
    downloadSelectedMap(true, promise);
  }
  private void downloadSelectedMap(boolean allowCellular, Promise promise) {
    main.post(() -> {
      try {
        ++mapDownloadAttempts;
        mapDownloadResponse = "NOT_RECEIVED";
        mapDownloadStage = "IDENTITY_CHECK";
        requireIdentity();
        mapDownloadStage = "FOREGROUND_CHECK";
        if (context.getLifecycleState() != LifecycleState.RESUMED) throw new IllegalStateException("FOREGROUND_REQUIRED");
        mapDownloadStage = "LICENSE_CHECK";
        if (!LicenseMgr.isLicensingReady() || !feature(LicenseFeature.FULL_NAVIGATION) || !feature(LicenseFeature.TRUCK_HEAVY_DUTY))
          throw new IllegalStateException("LICENSE_REQUIRED");
        mapDownloadStage = "INVENTORY_CHECK";
        if (selectedInstalled() != null) { mapDownloadResponse = "INSTALLED"; mapDownloadStage = "COMPLETE"; promise.resolve("INSTALLED"); return; }
        mapDownloadStage = "REGION_CHECK";
        List<MapRegion> licensed = MapDataMgr.getLicensedMapList();
        if (licensed == null || !licensed.contains(region())) throw new IllegalStateException("REGION_UNLICENSED");
        // Cellular is allowed only by the explicit mobile-data action in setup.
        mapDownloadStage = "NETWORK_POLICY";
        CopilotMgr.allowCellularDataForMapDownloads(allowCellular);
        mapCellularAllowed = allowCellular;
        // A finished download switches into installed data only while CoPilot is idle.
        // Keep its internal navigation window available during setup; do not start or clear a route.
        if (!RouteMgr.hasDestination()) UIMgr.showDialog(UIMgr.Dialog.MAP_NAVIGATION_VIEW);
        // Preserve an accepted transfer across JS retries/foreground transitions.
        if ("DOWNLOADING".equals(mapDownloadStatus) || "SUCCEEDED".equals(mapDownloadStatus)
            || "INSTALLATION_STARTED".equals(mapDownloadStatus)) {
          promise.resolve("DOWNLOADING".equals(mapDownloadStatus) ? "FAILURE_DOWNLOADING" : "FAILURE_DOWNLOADED");
          return;
        }
        // SDK validates storage and network.
        // Initial-install mode only when verified inventory is empty: no existing map is overwritten.
        mapDownloadStage = "SDK_REQUEST";
        final boolean initialInstall = installed().isEmpty();
        if (!catalogRequest.compareAndSet(false, true)) {
          mapDownloadResponse = "FAILURE_MANAGER_BUSY";
          mapDownloadStage = "APP_REQUEST_BUSY";
          promise.resolve(mapDownloadResponse);
          return;
        }
        new Thread(() -> {
          try {
            MapDownloadResponse response = MapDataMgr.downloadMap(Collections.singletonList(region()), Collections.emptyList(), initialInstall);
            mapDownloadResponse = response.name();
            mapDownloadStage = "SDK_RESPONSE";
            promise.resolve(response.name());
          } catch (Exception e) {
            mapDownloadResponse = "NATIVE_EXCEPTION";
            promise.reject("COPILOT_DOWNLOAD_FAILED", "Map download request failed.");
          } finally { catalogRequest.set(false); }
        }, "CoPilotInitialMap").start();
      } catch (Exception e) { mapDownloadResponse = "NATIVE_EXCEPTION"; promise.reject("COPILOT_DOWNLOAD_FAILED", "Map download requires verified licensing, an allowed internet connection and sufficient storage."); }
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
        // The SDK retains its last dialog. A map style alone does not dismiss
        // an itinerary/settings screen. Restore the actual map before overlays.
        UIMgr.showDialog(UIMgr.Dialog.MAP_NAVIGATION_VIEW);
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
  // One-time defaults; subsequent driver changes in CoPilot remain authoritative.
  private void prepareNativeDisplay() throws Exception {
    android.content.SharedPreferences prefs =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE);
    if (!prefs.getBoolean("nativeHeadingV1", false)) {
      try {
        CopilotMgr.setConfigurationSetting(ConfigurationSetting.create(
            ConfigurationSetting.CHEVRON_DISPLAY, ConfigurationSetting.CHEVRON_DISPLAY_HEADING));
        if (Integer.valueOf(ConfigurationSetting.CHEVRON_DISPLAY_HEADING).equals(
            CopilotMgr.getConfigurationSetting(ConfigurationSetting.CHEVRON_DISPLAY).getIntegerValue()))
          prefs.edit().putBoolean("nativeHeadingV1", true).apply();
      } catch (Exception ignored) { /* POI setup is independent of heading support. */ }
    }
    if (prefs.getBoolean("nativePlacesV1", false)) return;
    List<POICategory> categories = CopilotMgr.getPOICategories();
    if (categories == null || categories.isEmpty()) return;
    POISettings current = CopilotMgr.getPOIAlertSettings();
    List<POICategory> alerts = new ArrayList<>();
    if (current.getPOIAlertCategories() != null) alerts.addAll(current.getPOIAlertCategories());
    boolean found = false;
    for (POICategory category : categories) {
      int id = category.getID();
      // Documented SDK categories: truck services/repair, parking/rest, fuel.
      if (id != 48 && id != 70 && id != 34 && id != 22) continue;
      found = true;
      category.setDisplayOnMap(true);
      boolean present = false;
      for (POICategory selected : alerts) {
        if (selected.getID() == id) { present = true; break; }
      }
      if (!present) alerts.add(category);
    }
    if (!found) return; // Catalog may not be ready; retry on next map entry.
    // Pass the complete catalog to preserve the visibility of other categories.
    CopilotMgr.updatePOICategoriesDisplayStatus(categories);
    POISettings settings = new POISettings();
    settings.setPOIAlertEnabled(true);
    settings.setPOIAlertCategories(alerts);
    if (!current.getPOIAlertEnabled()) {
      settings.setPOIAlertLocation(POISettings.POIAlertLocation.ON_ROUTE);
      settings.setPOIAlertDistance(POISettings.POIAlertDistance.THREE_MILES);
    }
    CopilotMgr.setPOIAlertSettings(settings);
    POISettings verified = CopilotMgr.getPOIAlertSettings();
    if (!verified.getPOIAlertEnabled())
      throw new IllegalStateException("POI settings not accepted");
    for (POICategory expected : alerts) {
      boolean present = false;
      for (POICategory actual : verified.getPOIAlertCategories())
        if (actual.getID() == expected.getID()) { present = true; break; }
      if (!present) throw new IllegalStateException("POI category not accepted");
    }
    prefs.edit().putBoolean("nativePlacesV1", true).apply();
  }

  private WritableMap nativeDisplayDiagnostics() {
    WritableMap value = Arguments.createMap();
    value.putString("status", started ? "AVAILABLE" : "NOT_STARTED");
    value.putInt("deviceUtcOffsetMinutes",
        java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000);
    if (!started) return value;
    try {
      value.putBoolean("headingDisplayEnabled",
          Integer.valueOf(ConfigurationSetting.CHEVRON_DISPLAY_HEADING).equals(
              CopilotMgr.getConfigurationSetting(ConfigurationSetting.CHEVRON_DISPLAY).getIntegerValue()));
    } catch (Exception ignored) {}
    try {
      value.putBoolean("speedLimitOnMap", GuidanceSettings.isSpeedLimitOnMap());
      POISettings settings = CopilotMgr.getPOIAlertSettings();
      value.putBoolean("poiAlertsEnabled", settings.getPOIAlertEnabled());
      value.putString("poiAlertDistance", settings.getPOIAlertDistance().name());
      value.putInt("poiAlertCategoryCount", settings.getPOIAlertCategories().size());
      int displayed = 0;
      for (POICategory category : CopilotMgr.getPOICategories())
        if (category.isDisplayedOnMap()) displayed++;
      value.putInt("poiDisplayedCategoryCount", displayed);
    } catch (Exception ignored) { value.putString("status", "PARTIAL"); }
    try {
      // Relative value avoids exporting destinations, coordinates or trip dates.
      if (RouteMgr.hasDestination()) {
        java.util.Date eta = GuidanceMgr.getETA();
        value.putDouble("etaMinutesFromNow",
            (eta.getTime() - System.currentTimeMillis()) / 60000.0);
      }
    } catch (Exception ignored) { /* ETA is unavailable without a calculated route. */ }
    return value;
  }

  @ReactMethod public void endEngineTrip(Promise promise) {
    main.post(() -> {
      control("END_ROUTE", "REQUEST");
      if (stoppingTrip) { promise.reject("ENGINE_STOP_UNCONFIRMED", "Stop confirmation pending."); return; }
      stoppingTrip = true;
      ++tripGeneration; tripPreparing = false; tripHandoff.invalidateReview();
      if (pendingTrip != null) { pendingTrip.reject("ENGINE_TRIP_CANCELLED", "Start cancelled."); pendingTrip = null; }
      // Ending must remain possible if licensing/maps/readiness later become unavailable.
      try {
        if (!started || !connected || invalidated) throw new IllegalStateException();
        GuidanceMgr.suspendNavigation(true);
        control("END_ROUTE", "NATIVE_CALL");
        RouteMgr.removeAllStops();
        pollStopped(promise, android.os.SystemClock.elapsedRealtime() + 15000);
      } catch (Exception e) { stoppingTrip = false; control("END_ROUTE", "FAILED"); promise.reject("ENGINE_STOP_UNCONFIRMED", "Stop not confirmed. Retry End Route."); }
    });
  }
  private void pollStopped(Promise promise, long deadline) {
    try {
      if (invalidated || !started || !connected) throw new IllegalStateException();
      if (!tripHandoff.pendingStops() && !RouteMgr.hasDestination() && RouteMgr.getStopList().isEmpty()) {
        tripHandoff.stopped(); guidanceTelemetry.clearRoute(); stoppingTrip = false;
        control("END_ROUTE", "CONFIRMED"); promise.resolve(null); return;
      }
      if (android.os.SystemClock.elapsedRealtime() >= deadline) throw new IllegalStateException();
      // An accepted addStops may finish after cancellation. Keep guidance suspended and remove late stops.
      GuidanceMgr.suspendNavigation(true); RouteMgr.removeAllStops();
      main.postDelayed(() -> pollStopped(promise, deadline), 250);
    } catch (Exception e) { stoppingTrip = false; control("END_ROUTE", "FAILED"); promise.reject("ENGINE_STOP_UNCONFIRMED", "Stop not confirmed. Retry End Route."); }
  }
  @ReactMethod public void hasEngineTrip(Promise promise) {
    main.post(() -> {
      try { if (!started || !connected || invalidated) throw new IllegalStateException(); promise.resolve(RouteMgr.hasDestination()); }
      catch (Exception e) { promise.reject("ENGINE_TRIP_UNAVAILABLE", "Engine trip status unavailable."); }
    });
  }
  @ReactMethod public void resumeEngineTrip(Promise promise) {
    main.post(() -> {
      control("RESUME", "REQUEST");
      try {
        requireMap(); requireTripForeground(); requireSyncedTruck();
        if (tripPreparing || stoppingTrip || !RouteMgr.hasDestination() ||
            RouteMgr.getActiveVehicleRoutingProfile().getVehicleType() != com.alk.cpik.route.RouteEnums.VehicleType.TRUCK_HEAVY_DUTY)
          throw new IllegalStateException();
        control("RESUME", "NATIVE_CALL");
        CopilotMgr.enableGPS(); GuidanceMgr.suspendNavigation(false);
        control("RESUME", "CONFIRMED"); promise.resolve(null);
      } catch (Exception e) {
        // Preserve the precise fail-closed reason for the React Native UI.
        // Do not leak SDK exception messages or account identifiers.
        String reason = e.getMessage();
        String code = "TRUCK_RESTRICTIONS_UNREPRESENTABLE".equals(reason)
            ? "TRUCK_RESTRICTIONS_UNREPRESENTABLE"
            : "MAP_UNVERIFIED".equals(reason) ? "COPILOT_MAP_OR_LICENSE_UNVERIFIED"
            : "ENGINE_TRIP_UNAVAILABLE";
        control("RESUME", "FAILED");
        promise.reject(code, "TRUCK_RESTRICTIONS_UNREPRESENTABLE".equals(code)
            ? "CoPilot cannot yet verify required axle and trailer restrictions. Truck navigation remains blocked."
            : "COPILOT_MAP_OR_LICENSE_UNVERIFIED".equals(code)
                ? "Verify CoPilot navigation and heavy-duty licenses and installed California maps."
                : "Resume requires a verified truck route, precise GPS, and an active CoPilot trip.");
      }
    });
  }
  @ReactMethod public void reviewEngineTripProfile(Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        if (tripPreparing) throw new IllegalStateException("A trip is already being prepared.");
        com.alk.cpik.route.VehicleRoutingProfile profile = tripHandoff.review();
        com.alk.cpik.route.VehicleDimensions dims = profile.getVehicleDimensions();
        WritableMap value = Arguments.createMap();
        value.putString("ticket", tripHandoff.ticket());
        value.putString("name", profile.getName());
        value.putInt("heightInches", dims.getHeight().getInches());
        value.putInt("widthInches", dims.getWidth().getInches());
        value.putInt("lengthInches", dims.getLength().getInches());
        value.putInt("weightLbs", dims.getTotalWeight().getPounds());
        // These are SDK readbacks, not proof of axle/trailer enforcement.
        value.putBoolean("heavyDutyProfileVerified", true);
        value.putBoolean("axleCountVerified", false);
        value.putBoolean("trailerCountVerified", false);
        value.putBoolean("truckRestrictionsVerified", false);
        promise.resolve(value);
      } catch (Exception e) { promise.reject("ENGINE_PROFILE_UNAVAILABLE", e.getMessage()); }
    });
  }
  @ReactMethod public void openEngineTrip(String ticket, ReadableArray locations, Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        requireTripForeground();
        requireSyncedTruck();
        control("START", "REQUEST");
        if (stoppingTrip || tripPreparing) throw new IllegalStateException("A trip is already being prepared.");
        tripHandoff.validate(ticket);
        int count = locations.size();
        if (count < 2 || count > 27) throw new IllegalArgumentException("Invalid trip stop count.");
        double[][] points = new double[count][2];
        String[] names = new String[count];
        for (int i = 0; i < count; i++) {
          ReadableMap stop = locations.getMap(i);
          points[i][0] = stop.getDouble("lat"); points[i][1] = stop.getDouble("lng");
          names[i] = stop.getString("name");
          if (names[i] == null || names[i].trim().isEmpty()) throw new IllegalArgumentException("Stop name required.");
        }
        tripPreparing = true;
        final int generation = ++tripGeneration;
        pendingTrip = promise;
        new Thread(() -> {
          try {
            com.alk.cpik.StopList stops = tripHandoff.geocode(ticket, points, names);
            main.post(() -> {
              try {
                if (generation != tripGeneration || invalidated) return;
                requireMap(); requireTripForeground(); requireSyncedTruck();
                tripHandoff.validate(ticket);
                UIMgr.getMapDrawer().clearDashedLine();
                if (markerSet != null) UIMgr.getMapDrawer().removeImageSet(markerSet);
                UIMgr.getMapDrawer().setMapView(MapDrawer.MapViewType.THREE_DIMENSIONAL_NO_WIDGETS);
                CopilotMgr.enableGPS();
                control("START", "NATIVE_CALL");
                tripHandoff.submit(ticket, stops);
                GuidanceMgr.suspendNavigation(false);
                // Submission is not confirmation: await this trip's stops and calculation callbacks.
                pollStarted(promise, generation, android.os.SystemClock.elapsedRealtime() + 60000);
              } catch (Exception e) { failStart(promise, generation, "ENGINE_TRIP_FAILED"); }
            });
          } catch (Exception e) {
            main.post(() -> failStart(promise, generation, "ENGINE_TRIP_FAILED"));
          }
        }, "SemiTraXTripGeocode").start();
      } catch (Exception e) { control("START", "FAILED"); promise.reject("TRUCK_RESTRICTIONS_UNREPRESENTABLE".equals(e.getMessage()) ? "TRUCK_RESTRICTIONS_UNREPRESENTABLE" : "ENGINE_TRIP_FAILED", "Start requires a verified profile, licenses, maps and GPS."); }
    });
  }
  private void failStart(Promise promise, int generation, String code) {
    if (generation != tripGeneration) return;
    tripPreparing = false; pendingTrip = null;
    try { GuidanceMgr.suspendNavigation(true); } catch (Exception ignored) {}
    control("START", "FAILED"); promise.reject(code, "Route not confirmed. End Route before retrying.");
  }
  private void pollStarted(Promise promise, int generation, long deadline) {
    if (generation != tripGeneration) return;
    try {
      requireMap(); requireTripForeground();
      if (tripHandoff.failed()) { failStart(promise, generation, "ENGINE_TRIP_FAILED"); return; }
      if (tripHandoff.confirmed()) {
        tripPreparing = false; pendingTrip = null;
        control("START", "CONFIRMED"); promise.resolve(null); return;
      }
      if (android.os.SystemClock.elapsedRealtime() >= deadline) { failStart(promise, generation, "ENGINE_TRIP_TIMEOUT"); return; }
      main.postDelayed(() -> pollStarted(promise, generation, deadline), 250);
    } catch (Exception e) { failStart(promise, generation, "ENGINE_TRIP_FAILED"); }
  }
  private void requireTripForeground() throws Exception {
    if (invalidated || context.getLifecycleState() != LifecycleState.RESUMED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED ||
        !RouteMgr.isReceivingGPSSignal())
      throw new IllegalStateException("Open SemiTraX and wait for a precise GPS signal before starting.");
  }
  @ReactMethod public void returnFromEngineTrip(Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        if (tripPreparing || !tripHandoff.canReturnToPlanner())
          throw new IllegalStateException("Use Trip controls to finish or cancel the engine trip before returning to the planner.");
        GuidanceMgr.suspendNavigation(true);
        promise.resolve(null);
      } catch (Exception e) { promise.reject("ENGINE_TRIP_ACTIVE", "End Route before returning to planner."); }
    });
  }
  @ReactMethod public void mapCommand(String command, Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        MapDrawer drawer = UIMgr.getMapDrawer();
        switch (command) {
          case "embedded-navigation":
            // SemiTraX owns overlays; rendering must never start/resume guidance.
            UIMgr.showDialog(UIMgr.Dialog.MAP_NAVIGATION_VIEW);
            drawer.setMapView(MapDrawer.MapViewType.THREE_DIMENSIONAL_NO_WIDGETS);
            drawer.lockToChevron();
            break;
          case "native-map":
            // Opening the native navigation screen hands control to CoPilot.
            // Merely enabling GPS does not undo startup suspension.
            if (context.getLifecycleState() != LifecycleState.RESUMED ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
              throw new IllegalStateException("VISIBLE_PRECISE_LOCATION_REQUIRED");
            CopilotMgr.enableGPS();
            GuidanceMgr.suspendNavigation(false);
            drawer.lockToChevron();
            GuidanceSettings.setSpeedLimitOnMap(true);
            drawer.setMapView(MapDrawer.MapViewType.TWO_DIMENSIONAL);
            UIMgr.showDialog(UIMgr.Dialog.MAP_NAVIGATION_VIEW);
            // Optional display configuration must never block the native map.
            try { prepareNativeDisplay(); } catch (Exception ignored) {}
            break;
          case "copilot-menu": UIMgr.showDialog(UIMgr.Dialog.DRIVING_MENU); break;
          case "trip-plan": UIMgr.showDialog(UIMgr.Dialog.PREVIEW_TRIP_PLAN_DIALOG); break;
          case "settings": UIMgr.showDialog(UIMgr.Dialog.SETTINGS_MENU); break;
          case "map": UIMgr.showDialog(UIMgr.Dialog.MAP_NAVIGATION_VIEW); break;
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
  // CPIK searches have no request ID. Keep ownership until completion, even after a
  // JS timeout, so a late result cannot be attributed to a newer category search.
  private boolean poiSearchBusy = false;
  @ReactMethod public void searchNativePois(String name, ReadableArray ids, double lat, double lng, Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        if (poiSearchBusy) { promise.reject("COPILOT_POI_BUSY", "Previous CoPilot place search is still completing. Retry shortly."); return; }
        if (name == null || name.length() > 80 || ids.size() > 100 || !Double.isFinite(lat) || !Double.isFinite(lng)
            || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new IllegalArgumentException();
        ArrayList<Integer> categories = new ArrayList<>();
        for (int i = 0; i < ids.size(); i++) {
          int id = ids.getInt(i);
          boolean known = false;
          for (POICategory category : CopilotMgr.getPOICategories()) if (category.getID() == id) known = true;
          if (!known) throw new IllegalArgumentException();
          categories.add(id);
        }
        if (categories.isEmpty() && name.trim().isEmpty()) throw new IllegalArgumentException();
        List<Stop> centers = StopBuilder.fromLatLon(new Coordinate(lat, lng)).geocode(GeocodeSearchType.BEST_MATCH);
        if (centers == null || centers.isEmpty()) throw new IllegalStateException();
        poiSearchBusy = true;
        final boolean[] settled = {false};
        final boolean[] completed = {false};
        final Runnable timeout = () -> {
          if (!settled[0]) { settled[0] = true; promise.reject("COPILOT_POI_TIMEOUT", "CoPilot places timed out. Retry after the search completes."); }
        };
        POIListener listener = new POIListener() {
          @Override public void onPOIAlert(List<POIAlert> alerts) {}
          @Override public void onPOISearchResults(List<POISearchResult> results, boolean complete) {
            if (!complete) return;
            main.post(() -> {
              if (completed[0]) return;
              completed[0] = true;
              poiSearchBusy = false;
              main.removeCallbacks(timeout);
              if (settled[0]) return;
              settled[0] = true;
              if (invalidated) { promise.reject("COPILOT_POI_UNAVAILABLE", "CoPilot closed during search."); return; }
              try {
                WritableArray items = Arguments.createArray();
                if (results != null) for (POISearchResult result : results) {
                  if (result.getStop() == null || result.getStop().getAddressObject() == null) continue;
                  Coordinate point = result.getStop().getAddressObject().getCoordinate();
                  if (point == null || !point.isValid() || result.getName() == null || result.getName().trim().isEmpty()) continue;
                  WritableMap item = Arguments.createMap();
                  item.putString("id", "copilot:" + result.getCategoryID() + ":" + point.getLatitude() + ":" + point.getLongitude() + ":" + result.getName());
                  item.putString("name", result.getName());
                  item.putDouble("latitude", point.getLatitude());
                  item.putDouble("longitude", point.getLongitude());
                  item.putInt("nativeCategoryId", result.getCategoryID());
                  item.putString("provider", "copilot");
                  item.putString("address", result.getStop().getAddressObject().getAddress());
                  items.pushMap(item);
                }
                promise.resolve(items);
              } catch (Exception e) { promise.reject("COPILOT_POI_INVALID", "CoPilot place results could not be read."); }
            });
          }
        };
        main.postDelayed(timeout, 15000);
        try {
          CopilotMgr.searchPOIsNearLocation(name, categories, centers.get(0), 50, 100, Collections.singletonList(listener));
        } catch (Exception e) { main.removeCallbacks(timeout); poiSearchBusy = false; settled[0] = true; throw e; }
      } catch (Exception e) { promise.reject("COPILOT_POI_UNAVAILABLE", "CoPilot place search is unavailable. Check map coverage."); }
    });
  }
  private WritableArray nativePoiCatalog() {
    List<POICategory> categories = CopilotMgr.getPOICategories();
    if (categories == null || categories.isEmpty()) throw new IllegalStateException("POI catalog not ready");
    WritableArray values = Arguments.createArray();
    for (POICategory category : categories) {
      WritableMap value = Arguments.createMap();
      value.putInt("id", category.getID());
      value.putString("name", category.getName());
      value.putBoolean("visible", category.isDisplayedOnMap());
      values.pushMap(value);
    }
    return values;
  }
  @ReactMethod public void poiCatalog(Promise promise) {
    main.post(() -> {
      try { requireMap(); promise.resolve(nativePoiCatalog()); }
      catch (Exception e) { promise.reject("COPILOT_POI_UNAVAILABLE", "CoPilot places are not ready."); }
    });
  }
  @ReactMethod public void setPoiCategoryVisible(int id, boolean visible, Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        List<POICategory> categories = CopilotMgr.getPOICategories();
        if (categories == null || categories.isEmpty()) throw new IllegalStateException();
        boolean found = false;
        for (POICategory category : categories) {
          if (category.getID() == id) { category.setDisplayOnMap(visible); found = true; }
        }
        if (!found) throw new IllegalArgumentException();
        CopilotMgr.updatePOICategoriesDisplayStatus(categories);
        if (visible) UIMgr.setPOIDisplaySetting(UIMgr.POIDisplayType.ALWAYS);
        boolean verified = false;
        for (POICategory category : CopilotMgr.getPOICategories()) {
          if (category.getID() == id && category.isDisplayedOnMap() == visible) verified = true;
        }
        if (!verified) throw new IllegalStateException();
        promise.resolve(nativePoiCatalog());
      } catch (Exception e) { promise.reject("COPILOT_POI_UPDATE_FAILED", "CoPilot place visibility could not be confirmed."); }
    });
  }
  @ReactMethod public void guidanceSnapshot(Promise promise) {
    main.post(() -> promise.resolve(guidanceTelemetry.snapshot()));
  }
  /** Read-only Mapbox proof: the next 25 miles of the actual engine route. */
  @ReactMethod public void guidanceMapSnapshot(Promise promise) {
    main.post(() -> {
      try {
        requireMap();
        WritableMap value = guidanceTelemetry.snapshot();
        if (value.hasKey("routeStatus") && "ready".equals(value.getString("routeStatus"))
            && RouteMgr.hasDestination()) {
          java.util.List<Coordinate> points = GuidanceMgr.getRouteCoordinates(true, 25.0, 1.0);
          if (points == null || points.size() > 20000) throw new IllegalStateException("ROUTE_GEOMETRY_UNAVAILABLE");
          com.facebook.react.bridge.WritableArray coordinates = Arguments.createArray();
          for (Coordinate point : points) {
            if (point == null || !point.isValid() || !Double.isFinite(point.getLongitude()) || !Double.isFinite(point.getLatitude()))
              throw new IllegalStateException("ROUTE_GEOMETRY_INVALID");
            com.facebook.react.bridge.WritableArray pair = Arguments.createArray();
            pair.pushDouble(point.getLongitude());
            pair.pushDouble(point.getLatitude());
            coordinates.pushArray(pair);
          }
          value.putArray("routeCoordinates", coordinates);
        }
        promise.resolve(value);
      } catch (Exception e) {
        promise.reject("ENGINE_MAP_SNAPSHOT_FAILED", "Engine route display data unavailable.");
      }
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
    ++tripGeneration;
    if (pendingTrip != null) { pendingTrip.reject("ENGINE_TRIP_CANCELLED", "Session closed."); pendingTrip = null; }
    context.removeLifecycleEventListener(this);
    main.post(() -> {
      rejectWaiters("COPILOT_HOST_DESTROYED"); release();
      CopilotListener.unregisterListener(startupListener);
      MapDataListener.unregisterListener(mapListener);
      UIListener.unregisterListener(uiListener);
      LicenseListener.unregisterListener(hook);
      tripHandoff.close();
      // Do not clear native credentials, installed maps or cached licenses.
    });
    super.invalidate();
  }
}
