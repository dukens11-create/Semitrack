package com.semitrax.nativebridge;

/** Bounded read-only probes. A completion callback is never installation proof. */
final class MapInventoryVerification {
  static final int MAX_PROBES = 7;
  static final long LIMIT_MS = 90000L;
  private int region = -1;
  private int phase;
  private int probes;
  private long deadline;
  private boolean active;
  int generation;

  void reset() { generation++; region = -1; phase = 0; probes = 0; active = false; }
  boolean signal(int id, String status, long now) {
    int next = status.equals("INSTALLATION_FINISHED") ? 2 : status.equals("SUCCEEDED") ? 1 : 0;
    if (next == 0 || (region == id && next <= phase)) return false;
    generation++; region = id; phase = next; probes = 0;
    deadline = now + LIMIT_MS; active = true;
    return true;
  }
  boolean takeProbe(int token, int selected, long now) {
    if (!active || token != generation || selected != region || now >= deadline || probes >= MAX_PROBES) return false;
    probes++; return true;
  }
  long nextDelay(int token, long now) {
    if (!active || token != generation || probes >= MAX_PROBES || now >= deadline) return -1;
    long delay = Math.min(20000L, 1000L << probes);
    return now + delay < deadline ? delay : -1;
  }
  boolean finish(int token, boolean confirmed) {
    if (token != generation || !active) return false;
    active = false;
    return !confirmed;
  }
  void confirmed() { active = false; }
}
