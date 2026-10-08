package com.semitrax.nativebridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.StatFs;
import com.alk.cpik.CopilotMgr;
import com.alk.cpik.ConfigurationSetting;
import com.alk.cpik.mapdata.MapDataListener;
import com.alk.cpik.mapdata.MapDataListener.DownloadStatus;
import com.alk.cpik.mapdata.MapDataMgr;
import com.alk.cpik.mapdata.MapDataComponent;
import com.alk.cpik.mapdata.MapDownloadResponse;
import com.alk.cpik.mapdata.MapInfo;
import com.alk.cpik.mapdata.MapRegion;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.WritableNativeArray;
import com.facebook.react.bridge.WritableNativeMap;
import java.io.File;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.BooleanSupplier;

/** Explicit, additive map downloads. Never starts guidance or deletes installed data. */
final class CoPilotMapsBridge {
  private final Context context;
  private final BooleanSupplier ready;
  private final BooleanSupplier amsLicensed;
  private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
  private final MapDownloadPolicy policy = new MapDownloadPolicy();
  private final SharedPreferences saved;
  private final ConcurrentHashMap<Integer, Progress> progress = new ConcurrentHashMap<>();
  private boolean observing;
  private volatile boolean initialReady;
  private volatile boolean downloadPolicyApplied;
  private static final class Progress {
    final String status;
    final long bytes;
    final long total;
    Progress(String status, long bytes, long total) { this.status = status; this.bytes = bytes; this.total = total; }
  }
  private final MapDataListener listener = new MapDataListener() {
    @Override public void onReadyToDownloadInitialMapData() { initialReady = true; }
    @Override public void onMapdataUpdate(MapInfo info, DownloadStatus status) {
      if (info == null || info.getRegion() == null || status == null) return;
      Progress previous = progress.put(info.getRegion().ordinal(), new Progress(status.name(), Math.max(0, info.getDownloadedCount()), Math.max(0, info.getMapFileSize())));
      callback(() -> {
        if (policy.region == info.getRegion().ordinal() && (previous == null || !previous.status.equals(status.name()) || info.getDownloadedCount() > previous.bytes)) {
          policy.progress(status.name(), System.currentTimeMillis()); persist();
        }
      });
    }
    @Override public void onMapDownloadResponse(MapDownloadResponse response, List<MapRegion> regions, boolean overwrite) {
      if (response == null || regions == null || response == MapDownloadResponse.SUCCESS) return;
      for (MapRegion region : regions) progress.put(region.ordinal(), new Progress(response.name(), 0, 0));
      callback(() -> {
        if (regions.stream().anyMatch(region -> region.ordinal() == policy.region)) {
          policy.response(response.name(), System.currentTimeMillis()); persist();
        }
      });
    }
  };
  CoPilotMapsBridge(Context context, BooleanSupplier ready, BooleanSupplier amsLicensed) {
    this.context = context; this.ready = ready; this.amsLicensed = amsLicensed;
    saved = context.getSharedPreferences("semitrax_copilot_maps", Context.MODE_PRIVATE);
    policy.region = saved.getInt("region", -1);
    policy.attempts = saved.getInt("attempts", 0);
    policy.pending = saved.getBoolean("pending", false);
    policy.completed = saved.getBoolean("completed", false);
    policy.changedAt = saved.getLong("changedAt", System.currentTimeMillis());
    policy.retryAt = saved.getLong("retryAt", 0);
    policy.error = saved.getString("error", "");
    worker.scheduleWithFixedDelay(this::tick, 5, 5, TimeUnit.SECONDS);
  }
  private void callback(Runnable task) {
    try { worker.execute(task); }
    catch (RejectedExecutionException ignored) { /* Host was destroyed; persisted state is retained. */ }
  }
  private void persist() {
    // Commit the in-flight guard before invoking the SDK; process death must not repeat it.
    if (!saved.edit().putInt("region", policy.region).putInt("attempts", policy.attempts)
        .putBoolean("pending", policy.pending).putBoolean("completed", policy.completed).putLong("changedAt", policy.changedAt)
        .putLong("retryAt", policy.retryAt).putString("error", policy.error).commit())
      throw new IllegalStateException("COPILOT_MAP_STATE_SAVE_FAILED");
  }
  private boolean verified(List<MapInfo> inventory, int id) {
    if (inventory == null) return false;
    List<MapRegion> licensed = MapDataMgr.getLicensedMapList();
    if (id < 0 || id >= MapRegion.values().length || licensed == null || !licensed.contains(MapRegion.values()[id])) return false;
    int matches = 0;
    for (MapInfo info : inventory) if (info != null && info.getRegion() != null && info.getRegion().ordinal() == id &&
        info.getYear() >= 2000 && info.getQuarter() >= 1 && info.getQuarter() <= 4 &&
        info.getVersion() != null && !info.getVersion().isEmpty()) matches++;
    return matches == 1;
  }
  private void tick() {
    if (!ready.getAsBoolean() || policy.region < 0) return;
    try {
      List<MapInfo> inventory = MapDataMgr.getInstalledMaps();
      if (inventory == null) throw new IllegalStateException("COPILOT_MAP_INVENTORY_UNAVAILABLE");
      boolean eligible = downloadPolicyApplied && amsLicensed.getAsBoolean();
      boolean installed = eligible && verified(inventory, policy.region);
      if (policy.shouldRequest(eligible, installed, System.currentTimeMillis())) {
        MapRegion region = licensedRegion(policy.region);
        policy.requesting(System.currentTimeMillis()); persist();
        MapDownloadResponse response = request(region, inventory);
        policy.response(response == null ? "COPILOT_MAP_RESPONSE_UNKNOWN" : response.name(), System.currentTimeMillis());
      }
      persist();
    } catch (Exception | LinkageError error) {
      // Unknown native outcomes never trigger an automatic replacement download.
      policy.error = error instanceof IllegalStateException && error.getMessage() != null && error.getMessage().startsWith("COPILOT_MAP")
          ? error.getMessage() : "COPILOT_MAP_OPERATION_FAILED";
      try { persist(); } catch (Exception ignored) { /* Keep the in-memory guard. */ }
    }
  }
  private MapDownloadResponse request(MapRegion region, List<MapInfo> inventory) {
    requireReady();
    List<MapRegion> requested = Collections.singletonList(region);
    List<MapDataComponent> disabled = new ArrayList<>();
    progress.put(region.ordinal(), new Progress("REQUESTING", 0, 0));
    MapDownloadResponse response;
    if (inventory.isEmpty()) {
      // Device-based AMS: verified active identity + entitlements + licensed region.
      // The product-key callback is diagnostic only; the SDK validates manager readiness.
      // Always additive: true would cancel/replace an existing first-map transaction.
      response = MapDataMgr.downloadMap(requested, disabled, false);
    } else {
      MapInfo release = inventory.get(0);
      if (release.getYear() < 2000 || release.getQuarter() < 1 || release.getQuarter() > 4 || release.getVersion() == null || release.getVersion().isEmpty()) throw new IllegalStateException("COPILOT_MAP_VERSION_UNVERIFIED");
      for (MapInfo info : inventory) if (info.getYear() != release.getYear() || info.getQuarter() != release.getQuarter() || !release.getVersion().equals(info.getVersion())) throw new IllegalStateException("COPILOT_MAP_VERSION_MISMATCH");
      response = MapDataMgr.downloadMap(requested, disabled, release.getYear(), release.getQuarter(), release.getVersion(), false);
    }
    if (response != null) progress.compute(region.ordinal(), (key, previous) ->
        response == MapDownloadResponse.SUCCESS && previous != null && !previous.status.equals("REQUESTING")
        ? previous : new Progress(response == MapDownloadResponse.SUCCESS ? "QUEUED" : response.name(), 0, 0));
    return response;
  }
  void startup() {
    if (downloadPolicyApplied) return;
    try {
      CopilotMgr.setConfigurationSetting(ConfigurationSetting.create(ConfigurationSetting.MAP_DOWNLOADS_WIFI_ONLY, true));
      CopilotMgr.setConfigurationSetting(ConfigurationSetting.create(ConfigurationSetting.PREVENT_DATA_DOWNLOAD, ConfigurationSetting.ALLOW_ALL_DOWNLOADS));
      downloadPolicyApplied = true;
    } catch (Exception | LinkageError error) { downloadPolicyApplied = false; }
  }
  void shutdown() { initialReady = false; downloadPolicyApplied = false; }
  synchronized void attach() { if (!observing) { MapDataListener.registerListener(listener); observing = true; } }
  synchronized void detach() { if (observing) { MapDataListener.unregisterListener(listener); observing = false; } }
  void destroy() { detach(); worker.shutdownNow(); }
  private void requireReady() {
    if (!ready.getAsBoolean()) throw new IllegalStateException("COPILOT_MAPS_SETUP_REQUIRED");
  }
  private MapRegion licensedRegion(int id) {
    if (id < 0 || id >= MapRegion.values().length) throw new IllegalStateException("COPILOT_MAP_REGION_INVALID");
    MapRegion region = MapRegion.values()[id];
    List<MapRegion> licensed = MapDataMgr.getLicensedMapList();
    if (region == MapRegion.Error || licensed == null || !licensed.contains(region)) throw new IllegalStateException("COPILOT_MAP_UNLICENSED");
    return region;
  }
  private WritableNativeMap installedMap(MapInfo info) {
    WritableNativeMap map = new WritableNativeMap();
    map.putInt("id", info.getRegion().ordinal());
    map.putString("name", info.getRegion().name());
    map.putString("label", info.getRegion().getDescription());
    map.putInt("year", info.getYear());
    map.putInt("quarter", info.getQuarter());
    map.putString("version", info.getVersion() == null ? "" : info.getVersion());
    return map;
  }
  private void reject(Promise promise, Throwable error) {
    String message = error.getMessage();
    String code = error instanceof IllegalStateException && message != null && message.startsWith("COPILOT_MAP") ? message : "COPILOT_MAP_OPERATION_FAILED";
    promise.reject(code, "CoPilot map operation could not complete.");
  }
  void read(Promise promise) {
    worker.execute(() -> {
      try {
        requireReady();
        WritableNativeMap result = new WritableNativeMap();
        WritableNativeArray regions = new WritableNativeArray();
        List<MapRegion> licensed = MapDataMgr.getLicensedMapList();
        if (licensed != null) for (MapRegion region : licensed) {
          if (region == MapRegion.Error) continue;
          WritableNativeMap map = new WritableNativeMap();
          map.putInt("id", region.ordinal()); map.putString("name", region.name()); map.putString("label", region.getDescription());
          Progress current = progress.get(region.ordinal());
          map.putString("status", current == null ? "NOT_REQUESTED" : current.status);
          map.putDouble("downloadedBytes", current == null ? 0 : current.bytes);
          map.putDouble("totalBytes", current == null ? 0 : current.total);
          regions.pushMap(map);
        }
        WritableNativeArray installed = new WritableNativeArray();
        List<MapInfo> inventory = MapDataMgr.getInstalledMaps();
        if (inventory != null) for (MapInfo info : inventory) if (info.getRegion() != null) installed.pushMap(installedMap(info));
        File directory = context.getExternalFilesDir(null);
        if (directory == null) directory = context.getFilesDir();
        result.putDouble("freeBytes", new StatFs(directory.getAbsolutePath()).getAvailableBytes());
        result.putArray("regions", regions); result.putArray("installed", installed);
        result.putBoolean("initialReady", initialReady);
        result.putBoolean("initialAccepted", policy.pending);
        result.putBoolean("downloadPolicyApplied", downloadPolicyApplied);
        result.putString("readinessSource", amsLicensed.getAsBoolean() ? "AMS_LICENSED" : "WAITING_FOR_LICENSE");
        result.putInt("selectedRegion", policy.region);
        result.putInt("attempts", policy.attempts);
        result.putString("automationError", policy.error);
        result.putBoolean("selectedCoverageInstalled", amsLicensed.getAsBoolean() && verified(inventory, policy.region));
        requireReady();
        promise.resolve(result);
      } catch (Exception | LinkageError error) { reject(promise, error); }
    });
  }
  void command(int id, String action, Promise promise) {
    worker.execute(() -> {
      try {
        requireReady();
        MapRegion region = licensedRegion(id);
        MapDownloadResponse response;
        switch (action) {
          case "download": {
            policy.select(id, System.currentTimeMillis()); persist(); tick();
            promise.resolve("SCHEDULED"); return;
          }
          case "pause": response = MapDataMgr.pauseMapDownload(region); break;
          case "resume": response = MapDataMgr.resumeMapDownload(region); break;
          case "cancel": response = MapDataMgr.cancelMapDownload(region); break;
          default: throw new IllegalStateException("COPILOT_MAP_ACTION_INVALID");
        }
        if (response == null) throw new IllegalStateException("COPILOT_MAP_OPERATION_FAILED");
        if (id == policy.region && action.equals("cancel") && response == MapDownloadResponse.SUCCESS) {
          policy.progress("CANCELLED", System.currentTimeMillis()); persist();
        }
        if (response == MapDownloadResponse.SUCCESS && !action.equals("download")) {
          progress.put(id, new Progress(action.equals("cancel") ? "CANCELLED" : action.equals("pause") ? "PAUSED" : "QUEUED", 0, 0));
        }
        promise.resolve(response.name());
      } catch (Exception | LinkageError error) {
        progress.computeIfPresent(id, (key, previous) -> previous.status.equals("REQUESTING") ? new Progress("FAILED", 0, 0) : previous);
        reject(promise, error);
      }
    });
  }
}
