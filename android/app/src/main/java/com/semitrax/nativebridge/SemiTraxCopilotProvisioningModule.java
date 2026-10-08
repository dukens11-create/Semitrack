package com.semitrax.nativebridge;

import com.facebook.react.bridge.Promise;
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

    @ReactMethod
    public void readConfiguration(Promise promise) {
        // No approved credential provider has been installed for this package.
        // Reject with a stable code; never return placeholder configuration.
        promise.reject("COPILOT_PROVISIONING_NOT_CONFIGURED",
                "CoPilot native provisioning requires an approved Trimble credential provider.");
    }

    @ReactMethod
    public void hasNativeCredential(String reference, Promise promise) {
        // The bridge cannot attest to a credential until vendor integration
        // establishes its presence through an Android-private credential store.
        promise.resolve(false);
    }
}
