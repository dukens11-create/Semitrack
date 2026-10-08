package com.semitrax.nativebridge;

import android.Manifest;
import android.content.pm.PackageManager;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

/**
 * Read-only readiness diagnostics. Never starts CoPilot, sends credentials,
 * claims route entitlement, or mounts a native map without verified state.
 */
public final class SemiTraxCopilotMapReadinessModule extends ReactContextBaseJavaModule {
    public static final String NAME = "SemiTraxCopilotMapReadiness";

    public SemiTraxCopilotMapReadinessModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void getStatus(Promise promise) {
        ReactApplicationContext context = getReactApplicationContext();
        WritableMap status = Arguments.createMap();
        boolean locationGranted =
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        // The CPIK manager is accessible only from the vendor Android module.
        // Query the vendor's read-only adapter reflectively; never call
        // createViewInstance or equate an empty placeholder with a real map.
        boolean fragmentReady = false;
        if (locationGranted) {
            try {
                Class<?> manager = Class.forName("com.alk.cpik.react.CopilotViewManager");
                Object result = manager.getMethod("isNativeCoPilotViewAvailable").invoke(null);
                fragmentReady = Boolean.TRUE.equals(result);
            } catch (ReflectiveOperationException | LinkageError unavailable) {
                fragmentReady = false;
            }
        }
        status.putBoolean("locationGranted", locationGranted);
        status.putBoolean("fragmentReady", fragmentReady);
        // These MUST be replaced only with verified SDK-native license,
        // initialization and installed-map queries. Do not infer from files.
        status.putBoolean("initialized", false);
        status.putBoolean("licensingReady", false);
        status.putBoolean("fullNavigationLicensed", false);
        status.putBoolean("heavyTruckLicensed", false);
        status.putBoolean("mapsReady", false);
        status.putString("reason", !locationGranted
            ? "LOCATION_PERMISSION_REQUIRED"
            : !fragmentReady
                ? "COPILOT_NATIVE_VIEW_NOT_INITIALIZED"
                : "COPILOT_LICENSE_MAP_ATTESTATION_REQUIRED");
        promise.resolve(status);
    }
}
