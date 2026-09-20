/** Bounded background admission keeps account/provider timing out of the HTTP response.
 * Jobs are not durable across process restarts; a durable encrypted outbox remains a release gate.
 */
export function createRecoveryQueue(reportFailure: () => void, capacity = 20, workers = 4) {
  const pending: Array<() => Promise<void>> = [];
  let active = 0;
  let closing = false;
  const idleWaiters: Array<() => void> = [];
  function drain() {
    while (active < workers && pending.length) {
      const job = pending.shift()!;
      active++;
      void Promise.resolve().then(job).catch(() => {
        try { reportFailure(); } catch { /* Diagnostics must never leak or interrupt draining. */ }
      }).finally(() => {
        active--;
        drain();
        if (!active && !pending.length) idleWaiters.splice(0).forEach(resolve => resolve());
      });
    }
  }
  const enqueue = (job: () => Promise<void>): boolean => {
    if (closing || active + pending.length >= capacity) return false;
    pending.push(job);
    // Admission/response occurs before any account lookup or provider I/O.
    setImmediate(drain);
    return true;
  };
  return Object.assign(enqueue, {
    async stop() {
      closing = true;
      if (active || pending.length) await new Promise<void>(resolve => idleWaiters.push(resolve));
    },
  });
}
