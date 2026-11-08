package com.semitrax.nativebridge;

/** Callback ordering guard; does not calculate routes or modify truck restrictions. */
final class CoPilotCalculationState {
  private String status = "unknown";
  String status() { return status; }
  void begin() { status = "calculating"; }
  void complete() { if ("calculating".equals(status)) status = "ready"; }
  void fail() { status = "failed"; }
  void arrive() { status = "arrived"; }
  void clear() { status = "none"; }
  void reset() { status = "unknown"; }
}
