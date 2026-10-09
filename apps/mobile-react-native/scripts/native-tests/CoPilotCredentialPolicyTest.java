package com.semitrax.nativebridge;

import com.alk.cpik.licensing.LicenseListener;
import com.alk.cpik.licensing.LicenseMgr;
import com.alk.cpik.licensing.LicenseMgtInfo;

public final class CoPilotCredentialPolicyTest {
  private static int checks;
  private static void expect(boolean value, String description) {
    if (!value) throw new AssertionError(description);
    ++checks;
  }
  public static void main(String[] args) throws Exception {
    expect(CoPilotEnrollmentPolicy.shouldEnroll(true, "SM-S908U", false, false), "designated fresh Samsung enrolls");
    expect(!CoPilotEnrollmentPolicy.shouldEnroll(false, "SM-S908U", false, false), "general builds never seed a shared device ID");
    expect(!CoPilotEnrollmentPolicy.shouldEnroll(true, "Other", false, false), "other models never enroll");
    expect(!CoPilotEnrollmentPolicy.shouldEnroll(true, "SM-S908U", true, false), "saved identities are preserved");
    expect(!CoPilotEnrollmentPolicy.shouldEnroll(true, "SM-S908U", false, true), "running sessions cannot change assignment");
    expect("XGNKEA".equals(CoPilotEnrollmentPolicy.COMPANY), "assigned company is exact");
    expect("SemiTraX-Android-Test-01".equals(CoPilotEnrollmentPolicy.DEVICE), "assigned Device ID is exact");
    expect(com.alk.cpik.mapdata.MapRegion.valueOf(CoPilotEnrollmentPolicy.REGION) ==
        com.alk.cpik.mapdata.MapRegion.NORTH_AMERICA_California, "enrollment region is the shipped SDK California enum");
    expect(CoPilotEnrollmentPolicy.isAssigned("XGNKEA", "semitrax-android-test-01"), "assignment permits SDK device case variation");
    expect(!CoPilotEnrollmentPolicy.isAssigned("XGNKEAX", CoPilotEnrollmentPolicy.DEVICE), "saved company typo is detected");
    expect(CoPilotEnrollmentPolicy.canRepairTypo(true, "SM-S908U", "XGNKEAX", CoPilotEnrollmentPolicy.DEVICE, true, true, () -> null), "confirmed rejected typo with no account can be corrected");
    expect(!CoPilotEnrollmentPolicy.canRepairTypo(true, "SM-S908U", "XGNKEAX", CoPilotEnrollmentPolicy.DEVICE, true, true, () -> new LicenseMgtInfo("Other", "Other")), "active accounts cannot be replaced");
    expect(!CoPilotEnrollmentPolicy.canRepairTypo(true, "SM-S908U", "XGNKEAX", CoPilotEnrollmentPolicy.DEVICE, true, true, () -> { throw new Exception(); }), "unknown account query cannot permit repair");
    expect(!CoPilotEnrollmentPolicy.canRepairTypo(true, "SM-S908U", "XGNKEAX", CoPilotEnrollmentPolicy.DEVICE, true, false, () -> { throw new AssertionError("cold SDK query"); }), "cold repair never queries the SDK");
    expect(!CoPilotEnrollmentPolicy.canRepairTypo(true, "SM-S908U", "XGNKEAX", CoPilotEnrollmentPolicy.DEVICE, false, true, () -> null), "non-rejected assignments are preserved");
    expect(!CoPilotEnrollmentPolicy.canRepairTypo(false, "SM-S908U", "XGNKEAX", CoPilotEnrollmentPolicy.DEVICE, true, true, () -> null), "repair is unavailable in general builds");
    expect(!CoPilotEnrollmentPolicy.canRepairTypo(true, "SM-S908U", "OTHER", CoPilotEnrollmentPolicy.DEVICE, true, true, () -> null), "arbitrary company changes are blocked");
    expect(!CoPilotEnrollmentPolicy.canRepairTypo(true, "SM-S908U", "XGNKEAX", "Other", true, true, () -> null), "other device changes are blocked");
    LicenseMgtInfo assigned = new LicenseMgtInfo("Unit-Device", "UNIT");
    // Reproduce the shipped SDK failure before native pointers are initialized.
    boolean earlyQueryFailed = false;
    try { LicenseMgr.GetActiveAMSUser(); } catch (NullPointerException expected) { earlyQueryFailed = true; }
    expect(earlyQueryFailed, "SDK active-user query fails before initialization");
    int[] reads = {0};
    CoPilotCredentialPolicy.IdentityReader earlyReader = () -> { ++reads[0]; return LicenseMgr.GetActiveAMSUser(); };
    expect(CoPilotCredentialPolicy.decide(false, assigned, earlyReader) ==
        CoPilotCredentialPolicy.Decision.SUPPLY_ASSIGNED, "cold startup must supply the immutable assignment");
    expect(reads[0] == 0, "cold startup must never call the unsupported active-user API");
    expect(CoPilotCredentialPolicy.decide(true, assigned, earlyReader) ==
        CoPilotCredentialPolicy.Decision.QUERY_FAILED, "running query failure must preserve accounts");
    expect(CoPilotCredentialPolicy.decide(true, assigned, () -> assigned) ==
        CoPilotCredentialPolicy.Decision.SUPPLY_ASSIGNED, "matching runtime identity restores assignment");
    expect(CoPilotCredentialPolicy.decide(true, assigned, () -> new LicenseMgtInfo("unit-device", "UNIT")) ==
        CoPilotCredentialPolicy.Decision.SUPPLY_ASSIGNED, "case-only device identity matches");
    expect(CoPilotCredentialPolicy.decide(true, assigned, () -> new LicenseMgtInfo("Other", "UNIT")) ==
        CoPilotCredentialPolicy.Decision.PRESERVE_OTHER_ACCOUNT, "other device must not be replaced");
    expect(CoPilotCredentialPolicy.decide(true, assigned, () -> new LicenseMgtInfo("Unit-Device", "OTHER")) ==
        CoPilotCredentialPolicy.Decision.PRESERVE_OTHER_ACCOUNT, "other company must not be replaced");
    expect(CoPilotCredentialPolicy.decide(true, assigned, () -> new LicenseMgtInfo("Unit-Device", "unit")) ==
        CoPilotCredentialPolicy.Decision.PRESERVE_OTHER_ACCOUNT, "company comparison is exact");
    expect(CoPilotCredentialPolicy.decide(true, assigned, () -> null) ==
        CoPilotCredentialPolicy.Decision.SUPPLY_ASSIGNED, "no active account permits assigned login");
    expect(CoPilotCredentialPolicy.decide(false, null, earlyReader) ==
        CoPilotCredentialPolicy.Decision.NO_ASSIGNMENT, "missing assignment never supplies credentials");
    LicenseListener emptyBridge = new LicenseListener() {};
    LicenseListener host = new LicenseListener() {
      @Override public LicenseMgtInfo licenseMgtCredentialHook() { return assigned; }
    };
    java.lang.reflect.Method signal = LicenseListener.class.getDeclaredMethod("signalLicenseMgtCredentialHook");
    signal.setAccessible(true);
    LicenseListener.registerHook(host);
    expect(signal.invoke(null) == assigned, "host hook returns assigned object");
    LicenseListener.registerHook(emptyBridge);
    expect(signal.invoke(null) == null, "vendor default hook can overwrite global slot");
    LicenseListener.registerHook(host);
    expect(signal.invoke(null) == assigned, "last registration reclaims the global slot");
    System.out.println("PASS: " + checks + " native CoPilot credential-policy and shipped-SDK regression assertions.");
  }
}
