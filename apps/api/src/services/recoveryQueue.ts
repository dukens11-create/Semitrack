/** Bounded background admission keeps account/provider timing out of the HTTP response.
 * Jobs are not durable across process restarts; a durable encrypted outbox remains a release gate.
 */
export function createRecoveryQueue(reportFailure: () => void, capacity = 20, workers = 4) {
  const pending: Array<() => Promise<void>> = [];
  let active = 0;
  function drain() {
    while (active < workers && pending.length) {
      const job = pending.shift()!;
      active++;
      void Promise.resolve().then(job).catch(() => reportFailure()).finally(() => {
        active--;
        drain();
      });
    }
  }
  return (job: () => Promise<void>): boolean => {
    if (active + pending.length >= capacity) return false;
    pending.push(job);
    // Admission/response occurs before any account lookup or provider I/O.
    setImmediate(drain);
    return true;
  };
}
