package com.semitrax.nativebridge;

import java.util.function.IntConsumer;

/** Owns one bounded Start attempt, including geocoding before SDK submission. */
final class CoPilotStartAttempt {
  interface Scheduler {
    void postDelayed(Runnable task, long delayMillis);
    void removeCallbacks(Runnable task);
  }
  private final Scheduler scheduler;
  private int generation;
  private boolean pending;
  private Runnable deadline;
  CoPilotStartAttempt(Scheduler scheduler) { this.scheduler = scheduler; }
  synchronized int begin(IntConsumer onTimeout) {
    if (pending) throw new IllegalStateException("ENGINE_TRIP_BUSY");
    final int token = ++generation;
    pending = true;
    deadline = () -> expire(token, onTimeout);
    scheduler.postDelayed(deadline, 60000);
    return token;
  }
  private synchronized void expire(int token, IntConsumer onTimeout) {
    if (isCurrent(token)) onTimeout.accept(token);
  }
  synchronized boolean isCurrent(int token) { return pending && generation == token; }
  synchronized boolean finish(int token) {
    if (!isCurrent(token)) return false;
    cancel();
    return true;
  }
  synchronized void cancel() {
    pending = false;
    ++generation;
    if (deadline != null) scheduler.removeCallbacks(deadline);
    deadline = null;
  }
}
