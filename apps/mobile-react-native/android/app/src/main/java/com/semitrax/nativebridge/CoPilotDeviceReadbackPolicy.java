package com.semitrax.nativebridge;

/** A void SDK setter is not proof of completion; readiness needs actual readback. */
final class CoPilotDeviceReadbackPolicy {
  enum Result { PENDING, VERIFIED, MISMATCH }
  static final long TIMEOUT_MS = 10000;
  static Result evaluate(String expected, String actual, long elapsedMs) {
    if (expected == null || expected.isEmpty()) return Result.MISMATCH;
    if (expected.equalsIgnoreCase(actual)) return Result.VERIFIED;
    return elapsedMs < TIMEOUT_MS ? Result.PENDING : Result.MISMATCH;
  }
}
