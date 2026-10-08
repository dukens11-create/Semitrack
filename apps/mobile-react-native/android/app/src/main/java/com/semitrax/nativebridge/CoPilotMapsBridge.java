package com.semitrax.nativebridge;

import android.content.Context;
import android.os.StatFs;
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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.BooleanSupplier;

/** Explicit, additive map downloads. Never starts guidance or deletes installed data. */
final class CoPilotMapsBridge {
  private final Context context;
  private final BooleanSupplier ready;
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final ConcurrentHashMap<Integer, Progress> progress = new ConcurrentHashMap<>();
  private boolean observing;
  private static final class Progress {
    final String status;
    final long bytes;
    final long total;
    Progress(String status, long bytes, long total) { this.status = status; this.bytes = bytes; this.total = total; }
  }
  private final MapDataListener listener = new MapDataListener() {
    @Override public void onMapdataUpdate(MapInfo info, DownloadStatus status) {
      if (info == null || info.getRegion() == null || status == null) return;
      progress.put(info.getRegion().ordinal(), new Progress(status.name(), Math.max(0, info.getDownloadedCount()), Math.max(0, info.getMapFileSize())));
    }
    @Override public void onMapDownloadResponse(MapDownloadResponse response, List<MapRegion> regions, boolean overwrite) {
      if (response == null || regions == null || response == MapDownloadResponse.SUCCESS) return;
      for (MapRegion region : regions) progress.put(region.ordinal(), new Progress(response.name(), 0, 0));
    }
  };
  CoPilotMapsBridge(Context context, BooleanSupplier ready) { this.context = context; this.ready = ready; }
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
            // Adding a region must use the same release as existing maps. Never overwrite them.
            List<MapInfo> inventory = MapDataMgr.getInstalledMaps();
            List<MapRegion> requested = Collections.singletonList(region);
            List<MapDataComponent> disabled = new ArrayList<>();
            if (inventory == null || inventory.isEmpty()) {
              requireReady();
              progress.put(id, new Progress("REQUESTING", 0, 0));
              response = MapDataMgr.downloadMap(requested, disabled, false);
            }
            else {
              MapInfo release = inventory.get(0);
              if (release.getYear() < 2000 || release.getQuarter() < 1 || release.getQuarter() > 4 || release.getVersion() == null || release.getVersion().isEmpty()) throw new IllegalStateException("COPILOT_MAP_VERSION_UNVERIFIED");
              for (MapInfo info : inventory) if (info.getYear() != release.getYear() || info.getQuarter() != release.getQuarter() || !release.getVersion().equals(info.getVersion())) throw new IllegalStateException("COPILOT_MAP_VERSION_MISMATCH");
              requireReady();
              progress.put(id, new Progress("REQUESTING", 0, 0));
              response = MapDataMgr.downloadMap(requested, disabled, release.getYear(), release.getQuarter(), release.getVersion(), false);
            }
            break;
          }
          case "pause": response = MapDataMgr.pauseMapDownload(region); break;
          case "resume": response = MapDataMgr.resumeMapDownload(region); break;
          case "cancel": response = MapDataMgr.cancelMapDownload(region); break;
          default: throw new IllegalStateException("COPILOT_MAP_ACTION_INVALID");
        }
        if (response == null) throw new IllegalStateException("COPILOT_MAP_OPERATION_FAILED");
        // An accepted request is not proof of download or installation.
        if (action.equals("download")) {
          if (response == MapDownloadResponse.SUCCESS) progress.compute(id, (key, previous) -> previous != null && !previous.status.equals("REQUESTING") ? previous : new Progress("QUEUED", 0, 0));
          else progress.put(id, new Progress(response.name(), 0, 0));
        }
        promise.resolve(response.name());
      } catch (Exception | LinkageError error) {
        progress.computeIfPresent(id, (key, previous) -> previous.status.equals("REQUESTING") ? new Progress("FAILED", 0, 0) : previous);
        reject(promise, error);
      }
    });
  }
}
