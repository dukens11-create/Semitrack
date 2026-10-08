package com.semitrax.nativebridge;

public final class CoPilotReadinessTest {
  static CoPilotReadiness ready() {
    CoPilotReadiness s = new CoPilotReadiness();
    s.connected = s.started = s.foreground = s.credentialsPresent = s.licensingReady = true;
    s.activeAmsPresent = s.companyMatches = s.assetMatches = s.fullNavigationLicensed = s.heavyTruckLicensed = true;
    return s;
  }
  static void check(CoPilotReadiness s, String code) {
    if (!s.code().equals(code) || s.verified() != code.equals("READY")) throw new AssertionError(code);
  }
  public static void main(String[] args) {
    if (!CoPilotReadiness.sameAsset("Fleet-Test-7", "fleet-test-7")) throw new AssertionError("SDK ASCII case normalization");
    if (!CoPilotReadiness.sameAsset("Fleet-Test-7", "Fleet-Test-7")) throw new AssertionError("Exact identity");
    for (String other : new String[]{"fleet-test-8", "fleet-test-7 ", " fleet-test-7", "fleet_test_7", "FleetTest7", "", "Fleet-Teſt-7"})
      if (CoPilotReadiness.sameAsset("Fleet-Test-7", other)) throw new AssertionError("Different asset accepted");
    if (CoPilotReadiness.sameAsset(null, "x") || CoPilotReadiness.sameAsset("x", null)) throw new AssertionError("Missing identity");
    check(ready(), "READY");
    CoPilotReadiness s = ready(); s.connected=false; check(s,"COPILOT_ENGINE_DISCONNECTED");
    s=ready(); s.started=false; check(s,"COPILOT_ENGINE_NOT_STARTED");
    s=ready(); s.foreground=false; check(s,"COPILOT_FOREGROUND_REQUIRED");
    s=ready(); s.credentialsPresent=false; check(s,"COPILOT_SAVED_IDENTITY_MISSING");
    s=ready(); s.licensingReady=false; check(s,"COPILOT_LICENSING_NOT_READY");
    s=ready(); s.activeAmsPresent=false; check(s,"COPILOT_AMS_IDENTITY_UNAVAILABLE");
    s=ready(); s.companyMatches=false; check(s,"COPILOT_AMS_COMPANY_MISMATCH");
    s=ready(); s.assetMatches=false; check(s,"COPILOT_AMS_ASSET_MISMATCH");
    s.assetCaseOnlyDifference=true; check(s,"COPILOT_AMS_ASSET_MISMATCH");
    s.assetWhitespaceOnlyDifference=true; check(s,"COPILOT_AMS_ASSET_MISMATCH");
    s=ready(); s.fullNavigationLicensed=false; check(s,"COPILOT_FULL_LICENSE_REQUIRED");
    s=ready(); s.heavyTruckLicensed=false; check(s,"COPILOT_TRUCK_LICENSE_REQUIRED");
    s=ready(); s.queryFailed=true; check(s,"COPILOT_LICENSE_QUERY_FAILED");
    // No identity values can be serialized: snapshot carries only booleans.
    if (!ready().diagnostic().matches("[A-Za-z_= ]+")) throw new AssertionError("Unsafe diagnostic");
    System.out.println("CoPilotReadiness: 25 checks passed");
  }
}
