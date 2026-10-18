package com.semitrax.nativebridge;

/** Recovery builds accept only explicit device setup stored in the native secure store. */
public final class CoPilotEnrollmentPolicy {
  public static final String COMPANY = "";
  public static final String DEVICE = "";
  public static final String REGION = "NorthAmerica";
  public static String asset(boolean testAsset) { return ""; }
  public static String sdkDevice(boolean testAsset, String savedAsset) { return savedAsset; }
  public static boolean isAssigned(String company, String device) { return false; }
  public static boolean canRepairTypo(boolean designatedBuild, String model, String company, String device,
      boolean loginRejected, boolean engineActive, CoPilotCredentialPolicy.IdentityReader reader) { return false; }
  private CoPilotEnrollmentPolicy() {}
  public static boolean shouldEnroll(boolean designatedBuild, String model, boolean hasSavedSetup, boolean sessionActive) { return false; }
}
