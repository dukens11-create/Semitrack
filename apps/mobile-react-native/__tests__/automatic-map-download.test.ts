import { AutomaticMapDownload } from '../src/services/copilot/AutomaticMapDownload';
function fixture() {
  const port = {
    active: jest.fn(() => true),
    installed: jest.fn().mockResolvedValue(false),
    download: jest.fn().mockResolvedValue('SUCCESS'),
    refresh: jest.fn().mockResolvedValue(undefined),
  };
  const report = jest.fn();
  return { port, report, job: new AutomaticMapDownload(port, report) };
}
afterEach(() => jest.useRealTimers());
test('success is not installation proof; verified inventory refreshes readiness', async () => {
  jest.useFakeTimers();
  const { port, report, job } = fixture();
  await job.tick();
  expect(port.refresh).not.toHaveBeenCalled();
  expect(report.mock.calls.flat().join(' ')).not.toContain(
    'verified in installed',
  );
  port.installed.mockResolvedValue(true);
  await jest.advanceTimersByTimeAsync(5000);
  expect(port.download).toHaveBeenCalledTimes(1);
  expect(port.refresh).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
test('existing installed maps are verified without another download', async () => {
  const { port, job } = fixture();
  port.installed.mockResolvedValue(true);
  await job.tick();
  expect(port.download).not.toHaveBeenCalled();
  expect(port.refresh).toHaveBeenCalledTimes(1);
});
test('busy SDK retries are bounded and stop without marking maps installed', async () => {
  jest.useFakeTimers();
  const { port, job } = fixture();
  port.download.mockResolvedValue('FAILURE_MANAGER_BUSY');
  await job.tick();
  await jest.advanceTimersByTimeAsync(30000);
  expect(port.download).toHaveBeenCalledTimes(3);
  expect(port.refresh).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
test('insufficient storage is terminal rather than a retry loop', async () => {
  jest.useFakeTimers();
  const { port, report, job } = fixture();
  port.download.mockResolvedValue('FAILURE_INSUFFICIENT_DISK_SPACE');
  await job.tick();
  expect(port.download).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith(expect.stringContaining('Free storage'));
  expect(jest.getTimerCount()).toBe(0);
});
test('stopping while inventory is pending suppresses download and status changes', async () => {
  const { port, report, job } = fixture();
  let resolve!: (value: boolean) => void;
  port.installed.mockReturnValue(
    new Promise<boolean>(done => {
      resolve = done;
    }),
  );
  const running = job.tick();
  job.stop();
  resolve(false);
  await running;
  expect(port.download).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
});
test('concurrent checks cannot duplicate native download requests', async () => {
  jest.useFakeTimers();
  const { port, job } = fixture();
  await Promise.all([job.tick(), job.tick(), job.tick()]);
  expect(port.download).toHaveBeenCalledTimes(1);
  job.stop();
});
test('foreground loss before inventory completes prevents download', async () => {
  const { port, job } = fixture();
  port.installed.mockImplementation(async () => {
    port.active.mockReturnValue(false);
    return false;
  });
  await job.tick();
  expect(port.download).not.toHaveBeenCalled();
});
