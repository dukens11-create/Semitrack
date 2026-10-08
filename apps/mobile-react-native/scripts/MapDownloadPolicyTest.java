package com.semitrax.nativebridge;

public final class MapDownloadPolicyTest {
  private static int checks;
  private static void check(boolean value, String name) { checks++; if (!value) throw new AssertionError(name); }
  public static void main(String[] args) {
    MapDownloadPolicy p = new MapDownloadPolicy();
    check(!p.shouldRequest(true, false, 0), "no consent, no download");
    p.select(40, 0);
    check(!p.shouldRequest(false, false, 100), "no AMS readiness, no request");
    check(p.shouldRequest(true, false, 100), "verified AMS can request without product-key callback");
    p.requesting(100); p.response("FAILURE_MANAGER_BUSY", 100);
    boolean duplicate = false; try { p.select(40, 200); } catch (IllegalStateException expected) { duplicate = true; }
    check(duplicate && p.attempts == 1, "duplicate selection cannot reset retry budget");
    check(!p.shouldRequest(true, false, 1000), "busy backoff");
    check(p.shouldRequest(true, false, 15100), "bounded retry due");
    p.requesting(15100); p.response("FAILURE_INVALID_CONNECTION", 15100);
    check(!p.shouldRequest(true, false, 45100 - 1), "second backoff");
    check(p.shouldRequest(true, false, 45100), "third attempt due");
    p.requesting(45100); p.response("FAILURE_MANAGER_BUSY", 45100);
    check(!p.shouldRequest(true, false, 1000000) && p.attempts == 3, "no infinite retries");
    p.select(40, 0); p.requesting(0); p.response("SUCCESS", 0);
    check(p.pending && !p.shouldRequest(true, false, 1), "accepted request not repeated");
    boolean rejected = false; try { p.select(41, 1); } catch (IllegalStateException expected) { rejected = true; }
    check(rejected && p.region == 40, "active coverage not replaced");
    p.progress("INSTALLATION_FINISHED", 10);
    check(p.pending && !p.shouldRequest(true, false, 11), "callback is not inventory");
    check(!p.shouldRequest(true, true, 12) && !p.pending, "actual inventory verifies completion");
    check(!p.shouldRequest(true, false, 13), "later missing inventory cannot silently redownload");
    p.select(40, 0); p.shouldRequest(false, false, 90000);
    check(p.error.equals("COPILOT_MAP_READINESS_TIMEOUT"), "missing callback/readiness bounded");
    p.select(40, 0); p.requesting(0); p.shouldRequest(true, false, 600000);
    check(p.pending && p.error.equals("COPILOT_MAP_PROGRESS_TIMEOUT"), "stall locks active transfer");
    check(!p.shouldRequest(true, false, 900000), "no replacement after missing callback");
    p.progress("CANCELLED", 900001);
    check(!p.pending, "explicit native cancellation releases guard");
    p.select(40, 0); p.requesting(0); p.response("FAILURE_UNLICENSED", 1);
    check(!p.shouldRequest(true, false, 100000), "entitlement rejection terminal");
    p.select(40, 0); p.requesting(0); p.response("COPILOT_MAP_RESPONSE_UNKNOWN", 1);
    check(p.pending && !p.shouldRequest(true, false, 100000), "unknown outcome cannot be repeated");
    System.out.println("MapDownloadPolicy: " + checks + " assertions PASS");
  }
}
