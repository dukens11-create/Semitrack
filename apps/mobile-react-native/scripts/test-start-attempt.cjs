// Tests production attempt ownership with a deterministic clock scheduler; no SDK/license claims.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'semitrax-start-'));
const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java') : 'java';
const test = `package com.semitrax.nativebridge;
import java.util.*;
public class StartAttemptTest {
  static void check(boolean ok) { if (!ok) throw new AssertionError(); }
  static class Clock implements CoPilotStartAttempt.Scheduler {
    List<Runnable> tasks = new ArrayList<>();
    public void postDelayed(Runnable r,long delay) { check(delay == 60000); tasks.add(r); }
    public void removeCallbacks(Runnable r) { tasks.remove(r); }
    void expire() { for (Runnable r : new ArrayList<>(tasks)) r.run(); }
  }
  public static void main(String[] args) {
    Clock clock = new Clock();
    CoPilotStartAttempt attempt = new CoPilotStartAttempt(clock);
    int[] failures = {0};
    int first = attempt.begin(token -> { if (attempt.finish(token)) failures[0]++; });
    check(attempt.isCurrent(first));
    try { attempt.begin(token -> {}); throw new AssertionError("duplicate accepted"); }
    catch (IllegalStateException expected) {}
    Runnable lateTimer = clock.tasks.get(0);
    clock.expire(); // Includes indefinitely pending geocoding.
    check(failures[0] == 1 && !attempt.isCurrent(first) && clock.tasks.isEmpty());
    check(!attempt.finish(first)); // Late geocode/completion cannot settle twice.
    int second = attempt.begin(token -> { throw new AssertionError("stale timer"); });
    lateTimer.run();
    check(attempt.isCurrent(second));
    check(attempt.finish(second)); // Confirmed route cancels its timer.
    clock.expire();
    check(clock.tasks.isEmpty());
    int third = attempt.begin(token -> { throw new AssertionError("cancelled timeout"); });
    Runnable cancelledTimer = clock.tasks.get(0);
    attempt.cancel(); // End Route or module invalidation.
    cancelledTimer.run();
    check(!attempt.isCurrent(third) && clock.tasks.isEmpty());
    System.out.println("PASS: timeout, duplicate start, stale completion, stale timer, success, cancellation");
  }
}`;
try {
  const file = path.join(dir, 'StartAttemptTest.java');
  fs.writeFileSync(file, test);
  const source = path.join(root, 'android/app/src/main/java/com/semitrax/nativebridge/CoPilotStartAttempt.java');
  for (const args of [
    ['--module', 'jdk.compiler/com.sun.tools.javac.Main', '-d', dir, source, file],
    ['-cp', dir, 'com.semitrax.nativebridge.StartAttemptTest'],
  ]) {
    const result = spawnSync(java, args, {stdio:'inherit'});
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Start attempt regression failed');
  }
} finally { fs.rmSync(dir, {recursive:true, force:true}); }
