export type RecoveryQueue = {
  (job: () => Promise<void>): boolean;
  closeAndDrain(): Promise<void>;
};

/** Bounded background admission keeps account/provider timing out of the HTTP response.
 * Jobs are not durable across process crashes; the queue can, however, drain accepted
 * work during a normal graceful shutdown. A durable encrypted outbox remains a release gate.
 */
export function createRecoveryQueue(
  reportFailure: () => void,
  capacity = 20,
  workers = 4,
): RecoveryQueue {
  const pending: Array<() => Promise<void>> = [];
  const drainWaiters: Array<() => void> = [];
  let active = 0;
  let closed = false;
  let scheduled = false;

  const resolveIfDrained = () => {
    if (!closed || active || pending.length) return;
    for (const resolve of drainWaiters.splice(0)) resolve();
  };

  function drain() {
    scheduled = false;
    while (active < workers && pending.length) {
      const job = pending.shift()!;
      active++;
      void Promise.resolve()
        .then(job)
        .catch(() => reportFailure())
        .finally(() => {
          active--;
          drain();
          resolveIfDrained();
        });
    }
    resolveIfDrained();
  }

  const enqueue = ((job: () => Promise<void>): boolean => {
    if (closed || active + pending.length >= capacity) return false;
    pending.push(job);
    // Admission/response occurs before any account lookup or provider I/O.
    if (!scheduled) {
      scheduled = true;
      setImmediate(drain);
    }
    return true;
  }) as RecoveryQueue;

  enqueue.closeAndDrain = () => {
    closed = true;
    if (!active && !pending.length) return Promise.resolve();
    if (!scheduled) {
      scheduled = true;
      setImmediate(drain);
    }
    return new Promise<void>(resolve => drainWaiters.push(resolve));
  };

  return enqueue;
}
