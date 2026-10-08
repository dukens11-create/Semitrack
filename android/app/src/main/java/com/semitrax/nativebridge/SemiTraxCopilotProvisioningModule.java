package com.semitrax.nativebridge;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * CoPilot secure-provisioning boundary.
 *
 * Credentials must only be provisioned through an approved, native vendor
 * integration. Do not read them from JavaScript, assets, BuildConfig, or
 * environment variables, and do not report a license from a reference alone.
 * No licensed native credential provider is configured in this build.
 */
public final class SemiTraxCopilotProvisioningModule extends ReactContextBaseJavaModule {
    public static final String NAME = "SemiTraxCopilotProvisioning";

    public SemiTraxCopilotProvisioningModule(ReactApplicationContext context) {
        super(context);
    }

    @Override
    public String getName() {
        return NAME;
    }

    private boolean isTestPackage() {
        return "com.semitrax.app.migration.debug2".equals(
                getReactApplicationContext().getPackageName());
    }

    @ReactMethod
    public void readConfiguration(Promise promise) {
        // Only the isolated device-test package may use this known AMS test asset.
        // Version is an expected map target, NOT installation or licensing proof.
        if (!isTestPackage()) {
            promise.reject("COPILOT_PROVISIONING_NOT_CONFIGURED",
                    "CoPilot production AMS provisioning is not configured.");
            return;
        }
        WritableMap version = Arguments.createMap();
        version.putInt("year", 2026);
        version.putInt("quarter", 3);
        version.putString("version", "2026 Q3");
        WritableMap config = Arguments.createMap();
        config.putString("sdkVersion", "10.28.2.497");
        config.putString("platform", "android");
        config.putString("environment", "development");
        config.putString("licensingMode", "ams-company");
        config.putString("credentialRef", "ams-debug-test-asset");
        config.putString("mapRegionConstant", "NORTH_AMERICA");
        config.putMap("mapVersion", version);
        promise.resolve(config);
    }

    /**
     * Called immediately before CoPilot service binding. Only return true
     * after an approved native AMS provider has installed Trimble's credential
     * hook for the active device. This build has no such provider, so fail
     * closed and never pretend the standalone CoPilot GPS app is sufficient.
     */
    @ReactMethod
    public void configureAMSLogin(Promise promise) {
        // The documented AMS RN API accepts the assigned asset and company
        // identity; acceptance by CoPilot is checked later via LicenseMgr.
        promise.resolve(isTestPackage());
    }

    @ReactMethod
    public void readAMSIdentity(Promise promise) {
        // Test asset identity is not a secret or an activation token.
        // Never export it from release builds. CoPilot must authenticate it.
        if (!isTestPackage()) {
            promise.reject("COPILOT_AMS_TEST_ASSET_DISABLED",
                    "The test AMS asset is available only in the dedicated debug package.");
            return;
        }
        WritableMap identity = Arguments.createMap();
        identity.putString("assetId", "SemiTraX-Android-Test-01");
        identity.putString("companyId", "XGNKEA");
        promise.resolve(identity);
    }

    @ReactMethod
    public void hasNativeCredential(String reference, Promise promise) {
        // This is presence of a debug AMS identity only, never a verified
        // entitlement or a password. LicenseMgr must attest license state.
        promise.resolve(isTestPackage() && "ams-debug-test-asset".equals(reference));
    }
}
