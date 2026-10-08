import {
  EmbeddedSession,
  embeddedStatus,
  type EmbeddedSessionPort,
} from '../src/services/copilot/EmbeddedSession';
import { EmbeddedSetupError } from '../src/services/copilot/EmbeddedSetup';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device' },
  getGenericPassword: jest.fn(),
}));
const ids = { companyId: 'test-company', assetId: 'test-asset' };
const report = {
  started: true,
  licensingReady: true,
  fullNavigationLicensed: true,
  heavyTruckLicensed: true,
  licensedRegions: ['TEST'],
  installedMapCount: 0,
};
function harness() {
  const port = {
    read: jest.fn().mockResolvedValue(ids),
    check: jest.fn().mockResolvedValue(report),
    maps: jest.fn().mockResolvedValue({ selectedCoverageInstalled: false }),
  };
  return { port, session: new EmbeddedSession(port as EmbeddedSessionPort) };
}
test('cold startup restores securely saved credentials without prompting or rewriting them', async () => {
  const { port, session } = harness();
  await session.ensure();
  expect(port.check).toHaveBeenCalledWith(ids, expect.any(AbortSignal), {
    requestPermission: false,
    save: false,
  });
  expect(JSON.stringify(session.getSnapshot())).not.toContain(ids.assetId);
  expect(JSON.stringify(session.getSnapshot())).not.toContain(ids.companyId);
});
test('duplicate startup shares one in-flight check', async () => {
  const { port, session } = harness();
  await Promise.all([
    session.ensure(),
    session.ensure(),
    session.setForeground(true),
  ]);
  expect(port.check).toHaveBeenCalledTimes(1);
});
test('foreground return rechecks actual engine state without repeating permission prompts', async () => {
  const { port, session } = harness();
  await session.ensure();
  await session.setForeground(false);
  expect(session.getSnapshot().report).toBeNull();
  await session.setForeground(true);
  expect(port.check).toHaveBeenCalledTimes(2);
  expect(port.check.mock.calls.every(call => !call[2].requestPermission)).toBe(
    true,
  );
});
test('background result cannot revive stale readiness', async () => {
  const { port, session } = harness();
  let done!: (v: typeof report) => void;
  port.check.mockReturnValue(
    new Promise(resolve => {
      done = resolve;
    }),
  );
  const started = session.ensure();
  await Promise.resolve();
  await session.setForeground(false);
  done(report);
  await started;
  expect(session.getSnapshot().report).toBeNull();
});
test('no credentials does not bind or ask for permission', async () => {
  const { port, session } = harness();
  port.read.mockResolvedValue(null);
  await session.ensure();
  expect(port.check).not.toHaveBeenCalled();
});
test('manual setup alone permits a permission prompt and secure save', async () => {
  const { port, session } = harness();
  await session.ensure(ids);
  expect(port.read).not.toHaveBeenCalled();
  expect(port.check).toHaveBeenCalledWith(ids, expect.any(AbortSignal), {
    requestPermission: true,
    save: true,
  });
});
test('missing startup callback produces an actionable error, never readiness', async () => {
  const { port, session } = harness();
  port.check.mockRejectedValue(
    new EmbeddedSetupError('COPILOT_STARTUP_TIMEOUT'),
  );
  await session.ensure();
  expect(session.getSnapshot().error).toBe('COPILOT_STARTUP_TIMEOUT');
  expect(session.getSnapshot().report).toBeNull();
});
test('secure storage failures do not disclose vendor/private messages', async () => {
  const { port, session } = harness();
  port.read.mockRejectedValue(new Error('private credential'));
  await session.ensure();
  expect(JSON.stringify(session.getSnapshot())).not.toContain(
    'private credential',
  );
});
test('recognized licenses and downloads cannot substitute for installed coverage or guidance', async () => {
  const { session, port } = harness();
  await session.ensure();
  expect(embeddedStatus(session.getSnapshot())).toContain('coverage required');
  port.maps.mockResolvedValue({ selectedCoverageInstalled: true });
  await session.refreshMaps();
  expect(embeddedStatus(session.getSnapshot())).toContain(
    'truck guidance verification required',
  );
});
test('map inventory query failure clears previously verified map status', async () => {
  const { session, port } = harness();
  port.maps.mockResolvedValue({ selectedCoverageInstalled: true });
  await session.ensure();
  port.maps.mockRejectedValue(new Error('unavailable'));
  await session.refreshMaps();
  expect(session.getSnapshot().maps).toBeNull();
});

test('stale license evidence and failed status queries cannot report readiness', async () => {
  const { session, port } = harness();
  await session.ensure();
  port.maps.mockResolvedValue({
    readinessSource: 'WAITING_FOR_LICENSE',
    selectedCoverageInstalled: false,
  });
  await session.refreshMaps();
  expect(embeddedStatus(session.getSnapshot())).toContain(
    'license verification required',
  );
  port.maps.mockRejectedValue(new Error('private vendor message'));
  await session.refreshMaps();
  expect(embeddedStatus(session.getSnapshot())).toContain(
    'COPILOT_STATUS_UNAVAILABLE',
  );
  port.maps.mockResolvedValue({
    readinessSource: 'AMS_LICENSED',
    selectedCoverageInstalled: true,
  });
  await session.refreshMaps();
  expect(session.getSnapshot().error).toBeNull();
  expect(embeddedStatus(session.getSnapshot())).toContain(
    'truck guidance verification required',
  );
});
