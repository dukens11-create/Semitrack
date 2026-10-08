package com.semitrax.nativebridge;

/** No identifiers or credentials leave this snapshot. Every gate remains required. */
final class CoPilotReadiness {
  /** The pinned AMS runtime changes ASCII letter case on readback (device evidence).
   * Keep original login credentials, company comparison and entitlement checks.
   * Do not trim, Unicode-fold, alias, or substitute a genuinely different asset. */
  static boolean sameAsset(String saved, String active) {
    if (saved == null || active == null || saved.isEmpty() || active.isEmpty()) return false;
    if (saved.equals(active)) return true;
    return saved.matches("[A-Za-z0-9_-]+") && active.matches("[A-Za-z0-9_-]+") && saved.equalsIgnoreCase(active);
  }
  boolean connected, started, foreground, credentialsPresent, licensingReady;
  boolean activeAmsPresent, companyMatches, assetMatches, fullNavigationLicensed, heavyTruckLicensed;
  boolean assetCaseOnlyDifference, assetWhitespaceOnlyDifference;
  boolean queryFailed;
  String code() {
    if (!connected) return "COPILOT_ENGINE_DISCONNECTED";
    if (!started) return "COPILOT_ENGINE_NOT_STARTED";
    if (!foreground) return "COPILOT_FOREGROUND_REQUIRED";
    if (!credentialsPresent) return "COPILOT_SAVED_IDENTITY_MISSING";
    if (queryFailed) return "COPILOT_LICENSE_QUERY_FAILED";
    if (!licensingReady) return "COPILOT_LICENSING_NOT_READY";
    if (!activeAmsPresent) return "COPILOT_AMS_IDENTITY_UNAVAILABLE";
    if (!companyMatches) return "COPILOT_AMS_COMPANY_MISMATCH";
    if (!assetMatches) return "COPILOT_AMS_ASSET_MISMATCH";
    if (!fullNavigationLicensed) return "COPILOT_FULL_LICENSE_REQUIRED";
    if (!heavyTruckLicensed) return "COPILOT_TRUCK_LICENSE_REQUIRED";
    return "READY";
  }
  boolean verified() { return code().equals("READY"); }
  String diagnostic() {
    return "code=" + code() + " connected=" + connected + " started=" + started + " foreground=" + foreground +
        " savedIdentityPresent=" + credentialsPresent + " licensingReady=" + licensingReady +
        " activeAmsPresent=" + activeAmsPresent + " companyMatches=" + companyMatches + " assetMatches=" + assetMatches +
        " assetCaseOnlyDifference=" + assetCaseOnlyDifference + " assetWhitespaceOnlyDifference=" + assetWhitespaceOnlyDifference +
        " fullNavigationLicensed=" + fullNavigationLicensed + " heavyTruckLicensed=" + heavyTruckLicensed;
  }
}
