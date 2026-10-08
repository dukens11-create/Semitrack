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
    // These values originate from the running CPIK React Native license/map
    // queries, not a hardcoded license or filesystem-based assumption.
    private volatile boolean observedInitialized = false;
    private volatile boolean observedLicensingReady = false;
    private volatile boolean observedFullNavigation = false;
    private volatile boolean observedHeavyTruck = false;
    private volatile boolean observedMapsReady = false;

    public SemiTraxCopilotMapReadinessModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void reportSdkReadiness(
            boolean initialized,
            boolean licensingReady,
            boolean fullNavigationLicensed,
            boolean heavyTruckLicensed,
            boolean mapsReady,
            Promise promise) {
        // State is supplied only by CoPilotLifecycle's SDK callback/query path.
        // It is NOT itself a licensing API. The view is attested independently
        // by the native vendor getView() adapter in getStatus().
        observedInitialized = initialized;
        observedLicensingReady = initialized && licensingReady;
        observedFullNavigation = observedLicensingReady && fullNavigationLicensed;
        observedHeavyTruck = observedLicensingReady && heavyTruckLicensed;
        observedMapsReady = observedLicensingReady && mapsReady;
        promise.resolve(true);
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
        // Licensing/map observations come from the CPIK RN SDK callbacks and
        // API responses; the native map view is checked independently above.
        status.putBoolean("initialized", observedInitialized);
        status.putBoolean("licensingReady", observedLicensingReady);
        status.putBoolean("fullNavigationLicensed", observedFullNavigation);
        status.putBoolean("heavyTruckLicensed", observedHeavyTruck);
        status.putBoolean("mapsReady", observedMapsReady);
        status.putString("reason", !locationGranted
            ? "LOCATION_PERMISSION_REQUIRED"
            : !fragmentReady
                ? "COPILOT_NATIVE_VIEW_NOT_INITIALIZED"
                : "COPILOT_LICENSE_MAP_ATTESTATION_REQUIRED");
        promise.resolve(status);
    }
}
