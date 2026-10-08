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
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import com.alk.copilot.CopilotService;
import com.alk.cpik.CopilotListener;
import com.alk.cpik.react.licensing.LicenseListenerModule;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableNativeMap;
import com.facebook.react.common.LifecycleState;
import com.semitrax.R;

/** Explicit setup only: no profile, route, guidance, or map-download mutations. */
public final class CoPilotSetupModule extends ReactContextBaseJavaModule implements LifecycleEventListener {
  private final ReactApplicationContext context;
  private final Handler main = new Handler(Looper.getMainLooper());
  private volatile boolean started;
  private boolean bound;
  private boolean connected;
  private boolean observing;
  private String company;
  private String asset;
  private Promise pending;
  private final CopilotListener observer = new CopilotListener() {
    @Override public void onCPStartup() { started = true; }
    @Override public void onCPShutdown() { started = false; }
  };
  private final Runnable timeout = () -> fail("COPILOT_BIND_TIMEOUT");
  private final ServiceConnection connection = new ServiceConnection() {
    @Override public void onServiceConnected(ComponentName name, IBinder binder) {
      if (!bound) return;
      try {
        if (context.getLifecycleState() != LifecycleState.RESUMED) {
          fail("COPILOT_FOREGROUND_REQUIRED");
          return;
        }
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= 26) {
          manager.createNotificationChannel(new NotificationChannel("semitrax_copilot_setup", "CoPilot setup", NotificationManager.IMPORTANCE_LOW));
          builder = new Notification.Builder(context, "semitrax_copilot_setup");
        } else {
          builder = new Notification.Builder(context);
        }
        Notification notification = builder.setSmallIcon(R.drawable.ic_copilot_setup)
            .setContentTitle("SemiTraX CoPilot setup")
            .setContentText("Checking navigation license and map data")
            .setOngoing(true).build();
        ((CopilotService.CopilotBinder) binder).startForeground(919, notification);
        connected = true;
        main.removeCallbacks(timeout);
        Promise result = pending;
        pending = null;
        if (result != null) result.resolve(null); // Bound is not startup/license evidence.
      } catch (Exception | LinkageError error) {
        fail("COPILOT_SERVICE_FAILED"); // Never expose vendor exceptions or account IDs.
      }
    }
    @Override public void onServiceDisconnected(ComponentName name) {
      connected = false;
      started = false;
      if (pending != null) fail("COPILOT_SERVICE_DISCONNECTED");
    }
    @Override public void onBindingDied(ComponentName name) { fail("COPILOT_SERVICE_DISCONNECTED"); }
    @Override public void onNullBinding(ComponentName name) { fail("COPILOT_SERVICE_FAILED"); }
  };

  public CoPilotSetupModule(ReactApplicationContext context) {
    super(context);
    this.context = context;
    context.addLifecycleEventListener(this);
  }
  @Override public String getName() { return "SemiTraxCoPilotSetup"; }
  private boolean valid(String value) {
    if (value == null || value.trim().isEmpty() || value.length() > 256) return false;
    for (int i = 0; i < value.length(); i++) if (value.charAt(i) < 32 || value.charAt(i) == 127) return false;
    return true;
  }
  @ReactMethod public void startSetup(String companyId, String assetId, Promise promise) {
    main.post(() -> {
      Activity activity = getCurrentActivity();
      if (!valid(companyId) || !valid(assetId)) { promise.reject("COPILOT_IDS_INVALID", "Invalid device settings."); return; }
      if (activity == null || activity.isFinishing() || activity.isDestroyed() || context.getLifecycleState() != LifecycleState.RESUMED) {
        promise.reject("COPILOT_FOREGROUND_REQUIRED", "Keep SemiTraX open during setup."); return;
      }
      if (Build.VERSION.SDK_INT >= 23 && context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
        promise.reject("COPILOT_LOCATION_REQUIRED", "Precise location is required."); return;
      }
      if (company != null && (!company.equals(companyId) || !asset.equals(assetId))) {
        promise.reject("COPILOT_RESTART_REQUIRED", "Restart SemiTraX before changing its license identity."); return;
      }
      if (bound) {
        if (connected) promise.resolve(null);
        else promise.reject("COPILOT_SETUP_BUSY", "Setup is already running.");
        return;
      }
      pending = promise;
      try {
        // Supply the vendor's actual AMS hook synchronously before binding.
        LicenseListenerModule listener = context.getNativeModule(LicenseListenerModule.class);
        if (listener == null) { fail("COPILOT_MODULE_UNAVAILABLE"); return; }
        listener.setAMSLoginInfo(assetId, companyId);
        company = companyId;
        asset = assetId;
        if (!observing) { CopilotListener.registerListener(observer); observing = true; }
        bound = context.bindService(new Intent(context, CopilotService.class), connection, Context.BIND_AUTO_CREATE);
        if (!bound) { fail("COPILOT_BIND_FAILED"); return; }
        main.postDelayed(timeout, 15000);
      } catch (Exception | LinkageError error) { fail("COPILOT_BIND_FAILED"); }
    });
  }
  @ReactMethod public void readSetupState(Promise promise) {
    main.post(() -> {
      WritableNativeMap report = new WritableNativeMap();
      report.putBoolean("started", started);
      report.putBoolean("connected", connected);
      promise.resolve(report);
    });
  }
  private void fail(String code) {
    Promise result = pending;
    pending = null;
    cleanup();
    if (result != null) result.reject(code, "CoPilot setup could not complete.");
  }
  private void cleanup() {
    main.removeCallbacks(timeout);
    if (bound) { try { context.unbindService(connection); } catch (IllegalArgumentException ignored) { /* Already disconnected. */ } }
    bound = false;
    connected = false;
    started = false;
    if (observing) { CopilotListener.unregisterListener(observer); observing = false; }
    // Keep identity for this process: do not silently switch AMS and remove licenses.
  }
  @Override public void onHostResume() {}
  @Override public void onHostPause() { main.post(() -> fail("COPILOT_FOREGROUND_REQUIRED")); }
  @Override public void onHostDestroy() { main.post(() -> fail("COPILOT_HOST_DESTROYED")); }
  @Override public void invalidate() {
    context.removeLifecycleEventListener(this);
    main.post(() -> fail("COPILOT_HOST_DESTROYED"));
    super.invalidate();
  }
}
