package com.semitrax.nativebridge;

/** Single selected coverage transaction. Pure policy, also exercised without Android. */
final class MapDownloadPolicy {
  static final int MAX_ATTEMPTS = 3;
  static final long WAIT_LIMIT = 90000L;
  static final long STALL_LIMIT = 600000L;
  int region = -1;
  int attempts;
  boolean pending;
  boolean completed;
  long changedAt;
  long retryAt;
  String error = "";
  void select(int id, long now) {
    if (pending || (region >= 0 && !completed && error.isEmpty())) throw new IllegalStateException("COPILOT_MAP_INITIAL_IN_PROGRESS");
    region = id; attempts = 0; completed = false; changedAt = now; retryAt = now; error = "";
  }
  boolean shouldRequest(boolean eligible, boolean installed, long now) {
    if (installed) { pending = false; completed = true; error = ""; return false; }
    if (region < 0 || completed || !error.isEmpty()) return false;
    if (pending) {
      if (now - changedAt >= STALL_LIMIT) error = "COPILOT_MAP_PROGRESS_TIMEOUT";
      return false; // Never replace an accepted or ambiguous request, even after a timeout.
    }
    if (!eligible) {
      if (now - changedAt >= WAIT_LIMIT) error = "COPILOT_MAP_READINESS_TIMEOUT";
      return false;
    }
    return attempts < MAX_ATTEMPTS && now >= retryAt;
  }
  void requesting(long now) { attempts++; pending = true; changedAt = now; }
  void response(String code, long now) {
    if (code.equals("SUCCESS")) return;
    if (code.equals("COPILOT_MAP_RESPONSE_UNKNOWN")) { error = code; return; }
    if (code.equals("FAILURE_DOWNLOADING") || code.equals("FAILURE_DOWNLOADED") ||
        code.equals("FAILURE_PAUSED") || code.equals("FAILURE_INSTALLED")) {
      pending = true; return;
    }
    pending = false;
    if ((code.equals("FAILURE_MANAGER_BUSY") || code.equals("FAILURE_INVALID_CONNECTION")) && attempts < MAX_ATTEMPTS) {
      retryAt = now + attempts * 15000L;
    } else error = code;
  }
  void progress(String status, long now) {
    changedAt = now;
    if (status.equals("FAILED") || status.equals("CANCELLED")) {
      pending = false; error = status;
    }
    // SUCCEEDED and INSTALLATION_FINISHED still require inventory evidence.
  }
}
