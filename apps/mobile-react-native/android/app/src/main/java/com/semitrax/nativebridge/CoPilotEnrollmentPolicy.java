package com.semitrax.nativebridge;

/** Initial enrollment only: an existing saved assignment always wins. */
public final class CoPilotEnrollmentPolicy {
  public static final String COMPANY = "XGNKEA";
  public static final String DEVICE = "SemiTraX-Android-Test-01";
  public static final String REGION = "NORTH_AMERICA_California";
  public static boolean isAssigned(String company, String device) {
    return COMPANY.equals(company) && DEVICE.equalsIgnoreCase(device == null ? "" : device);
  }
  public static boolean canRepairTypo(boolean designatedBuild, String model, String company, String device,
      boolean loginRejected, boolean engineActive, CoPilotCredentialPolicy.IdentityReader reader) {
    if (!designatedBuild || !"SM-S908U".equals(model) || !"XGNKEAX".equals(company) ||
        !DEVICE.equalsIgnoreCase(device == null ? "" : device) || !loginRejected || !engineActive) return false;
    try {
      com.alk.cpik.licensing.LicenseMgtInfo active = reader.read();
      // Never repair over an SDK account, including one with incomplete identity.
      return active == null;
    } catch (Exception e) { return false; }
  }
  private CoPilotEnrollmentPolicy() {}
  public static boolean shouldEnroll(boolean designatedBuild, String model, boolean hasSavedSetup, boolean sessionActive) {
    return designatedBuild && "SM-S908U".equals(model) && !hasSavedSetup && !sessionActive;
  }
}
