package com.semitrax.nativebridge;

/** Initial enrollment only: an existing saved assignment always wins. */
public final class CoPilotEnrollmentPolicy {
  public static final String COMPANY = "XGNKEA";
  public static final String DEVICE = "SemiTraX-Android-Test-01";
  public static final String REGION = "NORTH_AMERICA_California";
  private CoPilotEnrollmentPolicy() {}
  public static boolean shouldEnroll(boolean designatedBuild, String model, boolean hasSavedSetup, boolean sessionActive) {
    return designatedBuild && "SM-S908U".equals(model) && !hasSavedSetup && !sessionActive;
  }
}
