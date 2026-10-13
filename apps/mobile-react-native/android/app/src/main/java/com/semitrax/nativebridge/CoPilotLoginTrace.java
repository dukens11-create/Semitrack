package com.semitrax.nativebridge;

import com.alk.cpik.licensing.LicenseActivationResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.function.LongSupplier;

/** Session-only bounded trace. Accepts enums and flags, never credentials or raw logs. */
final class CoPilotLoginTrace {
  static final int LIMIT = 96;
  enum Event {
    START_REQUEST, START_REUSED, HOOK_REGISTERED, SERVICE_BIND_REQUEST,
    SERVICE_CONNECTED, SERVICE_DISCONNECTED, STARTUP_CALLBACK, STARTUP_PUBLISHED,
    DEVICE_WRITE_REQUEST, DEVICE_WRITE_RETURNED, DEVICE_READBACK_PENDING,
    DEVICE_READBACK_VERIFIED, DEVICE_READBACK_FAILED, DEVICE_CONFIGURATION_FAILED,
    CREDENTIAL_HOOK, LOGIN_CALLBACK, SHUTDOWN_CALLBACK, STARTUP_FAILED,
    STARTUP_TIMEOUT, SERVICE_RELEASED, REPORT_REQUEST
  }
  static final class Entry {
    final long sequence, elapsedMs;
    final Event event;
    final boolean started, deviceVerified;
    final LicenseActivationResponse response;
    Entry(long sequence, long elapsedMs, Event event, boolean started,
        boolean deviceVerified, LicenseActivationResponse response) {
      this.sequence = sequence;
      this.elapsedMs = elapsedMs;
      this.event = event;
      this.started = started;
      this.deviceVerified = deviceVerified;
      this.response = response;
    }
  }
  private final LongSupplier clock;
  private final long origin;
  private long sequence;
  private final List<Entry> entries = new ArrayList<>();
  CoPilotLoginTrace() { this(System::nanoTime); }
  CoPilotLoginTrace(LongSupplier clock) { this.clock = clock; origin = clock.getAsLong(); }
  synchronized void record(Event event, boolean started, boolean verified, LicenseActivationResponse response) {
    if (entries.size() == LIMIT) entries.remove(0);
    entries.add(new Entry(++sequence, Math.max(0, (clock.getAsLong() - origin) / 1000000),
        event, started, verified, response));
  }
  synchronized List<Entry> snapshot() { return new ArrayList<>(entries); }
  synchronized long dropped() { return sequence - entries.size(); }
}
