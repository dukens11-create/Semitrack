package com.semitrax.nativebridge;

public final class MapInventoryVerificationTest {
  private static int checks;
  private static void check(boolean result, String label) {
    checks++; if (!result) throw new AssertionError(label);
  }
  public static void main(String[] args) {
    MapInventoryVerification v = new MapInventoryVerification();
    check(!v.signal(40, "DOWNLOADING", 0), "progress is not completion");
    check(v.signal(40, "SUCCEEDED", 0), "download callback starts read-only fallback");
    int old = v.generation;
    check(v.takeProbe(old, 40, 0), "immediate inventory probe");
    check(!v.signal(40, "SUCCEEDED", 1), "duplicate callback cannot reset budget");
    check(v.nextDelay(old, 0) == 2000, "initial backoff");
    check(v.signal(40, "INSTALLATION_FINISHED", 2), "installation callback starts fresh bounded verification");
    int token = v.generation;
    check(!v.takeProbe(old, 40, 2), "outdated scheduled probe ignored");
    check(!v.takeProbe(token, 41, 2), "different selected coverage cannot be verified");
    int reads = 0; long now = 2;
    while (v.takeProbe(token, 40, now)) {
      reads++;
      long delay = v.nextDelay(token, now);
      if (delay < 0) break;
      now += delay;
    }
    check(reads == 7 && now < 90002, "seven probes within ninety seconds");
    check(v.nextDelay(token, now) == -1, "no indefinite retries");
    check(v.finish(token, false), "missing inventory becomes explicit timeout");
    check(!v.signal(40, "INSTALLATION_FINISHED", now), "duplicate terminal callback cannot restart exhausted verification");
    v.reset(); v.signal(40, "INSTALLATION_FINISHED", 0); token = v.generation;
    check(!v.takeProbe(token, 40, 90000), "foreground delay cannot extend deadline");
    check(v.finish(token, false), "deadline reports unverified state");
    v.reset(); v.signal(40, "INSTALLATION_FINISHED", 0); token = v.generation;
    v.takeProbe(token, 40, 0); v.confirmed();
    check(!v.takeProbe(token, 40, 2000), "authoritative inventory stops probes");
    check(!v.finish(token, false), "late task cannot overwrite confirmed state");
    v.reset(); v.signal(40, "INSTALLATION_FINISHED", 0); token = v.generation;
    v.reset();
    check(!v.takeProbe(token, 40, 1) && !v.finish(token, false), "cancel or selection change invalidates tasks");
    System.out.println("MapInventoryVerification: " + checks + " checks PASS");
  }
}
