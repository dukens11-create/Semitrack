package com.semitrax.nativebridge;

import com.alk.cpik.licensing.LicenseMgtInfo;

/** Immutable, device-assigned bootstrap credentials; SDK identity queries require a running engine. */
final class CoPilotCredentialPolicy {
  static LicenseMgtInfo assignedInfo(String asset, String company) {
    // Trimble confirmed direct company licensing for this account on 2026-10-13.
    return new LicenseMgtInfo(asset, company);
  }
  private static String value(String value) { return value == null ? "" : value; }
  static boolean matches(LicenseMgtInfo assigned, LicenseMgtInfo current) {
    return assigned != null && current != null &&
        value(assigned.getCompanyID()).equals(value(current.getCompanyID())) &&
        value(assigned.getAssetID()).equalsIgnoreCase(value(current.getAssetID()));
  }
  interface IdentityReader { LicenseMgtInfo read() throws Exception; }
  enum Decision { SUPPLY_ASSIGNED, PRESERVE_OTHER_ACCOUNT, QUERY_FAILED, NO_ASSIGNMENT }
  static Decision decide(boolean engineActive, LicenseMgtInfo assigned, IdentityReader reader) {
    if (assigned == null) return Decision.NO_ASSIGNMENT;
    // The hook authenticates the saved assignment during cold startup. Calling an
    // active-user API here can throw before the SDK's native pointers exist.
    if (!engineActive) return Decision.SUPPLY_ASSIGNED;
    try {
      LicenseMgtInfo current = reader.read();
      if (current == null || current.getAssetID() == null || current.getAssetID().isEmpty())
        return Decision.SUPPLY_ASSIGNED;
      boolean same = matches(assigned, current);
      return same ? Decision.SUPPLY_ASSIGNED : Decision.PRESERVE_OTHER_ACCOUNT;
    } catch (Exception e) { return Decision.QUERY_FAILED; }
  }
}
