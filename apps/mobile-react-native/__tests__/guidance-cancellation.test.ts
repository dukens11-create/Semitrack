import { GuidanceSession } from '../src/features/navigation/GuidanceSession';
import {
  UnavailableNavigationEngine,
  type NavigationState,
} from '../src/services/guidance/NavigationEngine';
import { route, truck, deferred } from './fixtures';
const plan = {
  stops: [],
  destination: { id: 'd', name: 'Destination', lat: 40, lng: -100 },
};
function fixture(phase: NavigationState['phase'] = 'idle') {
  let state: NavigationState = {
    phase,
    routeId: phase === 'idle' ? undefined : 'test-route',
  };
  const engine = Object.assign(new UnavailableNavigationEngine(), {
    initialize: jest.fn(async () => ({ available: true })),
    setTruckProfile: jest.fn(async () => {}),
    setRoute: jest.fn(async () => {}),
    abortNavigationPreparation: jest.fn(async () => {}),
    startNavigation: jest.fn(async () => {
      state = { phase: 'navigating', routeId: 'test-route' };
    }),
    pauseNavigation: jest.fn(async () => {
      state = { ...state, phase: 'paused' };
    }),
    resumeNavigation: jest.fn(async () => {
      state = { ...state, phase: 'navigating' };
    }),
    stopNavigation: jest.fn(async () => {
      state = { phase: 'idle' };
    }),
    getNavigationState: () => state,
  });
  return { engine, session: new GuidanceSession(engine) };
}
test('preview cancellation does not initialize or stop SemiTraX', async () => {
  const { engine, session } = fixture();
  expect(await session.cancel()).toBe(true);
  expect(engine.initialize).not.toHaveBeenCalled();
  expect(engine.stopNavigation).not.toHaveBeenCalled();
  expect(session.acceptsEvents).toBe(false);
});
test('unavailable startup cancels without ever calling stop', async () => {
  const { engine, session } = fixture();
  engine.initialize.mockResolvedValue({ available: false });
  expect(await session.start(route(), plan, truck, () => true)).toBe(
    'unavailable',
  );
  await session.cancel();
  expect(engine.startNavigation).not.toHaveBeenCalled();
  expect(engine.stopNavigation).not.toHaveBeenCalled();
});
test('failed startup releases preparation without stopping an unrelated session', async () => {
  const { engine, session } = fixture();
  engine.startNavigation.mockRejectedValue(
    new Error('provider startup rejected'),
  );
  await expect(
    session.start(route(), plan, truck, () => true),
  ).rejects.toThrow();
  await session.cancel();
  expect(engine.stopNavigation).not.toHaveBeenCalled();
  expect(engine.abortNavigationPreparation).toHaveBeenCalledTimes(1);
});
test.each(['navigating', 'paused', 'rerouting', 'arrived'] as const)(
  '%s cancellation stops the real session once and suppresses late events',
  async phase => {
    const { engine, session } = fixture(phase);
    expect(await session.cancel()).toBe(true);
    await session.cancel();
    expect(engine.stopNavigation).toHaveBeenCalledTimes(1);
    expect(session.acceptsEvents).toBe(false);
  },
);
test('active session pauses, resumes and stops', async () => {
  const { engine, session } = fixture();
  expect(await session.start(route(), plan, truck, () => true)).toBe('started');
  await session.pauseOrResume();
  expect(engine.getNavigationState().phase).toBe('paused');
  await session.pauseOrResume();
  expect(engine.getNavigationState().phase).toBe('navigating');
  await session.cancel();
  expect(engine.getNavigationState().phase).toBe('idle');
});
test('cancel while checking capability prevents late setRoute/start', async () => {
  const { engine, session } = fixture();
  const wait = deferred<{ available: boolean }>();
  engine.initialize.mockReturnValue(wait.promise);
  const start = session.start(route(), plan, truck, () => true);
  await Promise.resolve();
  const stop = session.cancel();
  expect(session.acceptsEvents).toBe(false);
  wait.resolve({ available: true });
  expect(await start).toBe('cancelled');
  await stop;
  expect(engine.setRoute).not.toHaveBeenCalled();
  expect(engine.startNavigation).not.toHaveBeenCalled();
  expect(engine.stopNavigation).not.toHaveBeenCalled();
});
test('late native start is stopped after successful completion, never before', async () => {
  const { engine, session } = fixture();
  const wait = deferred<void>();
  const reached = deferred<void>();
  engine.startNavigation.mockImplementation(async () => {
    reached.resolve();
    await wait.promise;
  });
  const start = session.start(route(), plan, truck, () => true);
  await reached.promise;
  const stop = session.cancel();
  expect(engine.stopNavigation).not.toHaveBeenCalled();
  wait.resolve();
  expect(await start).toBe('cancelled');
  expect(await stop).toBe(true);
  expect(engine.stopNavigation).toHaveBeenCalledTimes(1);
});
test('stop follows an in-flight resume so late resume cannot reactivate cancellation', async () => {
  const { engine, session } = fixture('paused');
  const wait = deferred<void>();
  engine.resumeNavigation.mockReturnValue(wait.promise);
  const resume = session.pauseOrResume();
  await Promise.resolve();
  const stop = session.cancel();
  expect(engine.stopNavigation).not.toHaveBeenCalled();
  wait.resolve();
  await resume;
  await stop;
  expect(engine.stopNavigation).toHaveBeenCalledTimes(1);
});
test('stop failure stays explicit and blocks another start until cleanup succeeds', async () => {
  const { engine, session } = fixture('navigating');
  engine.stopNavigation.mockRejectedValueOnce(new Error('native stop failed'));
  expect(await session.cancel()).toBe(false);
  expect(await session.start(route(), plan, truck, () => true)).toBe(
    'stop-unconfirmed',
  );
  expect(engine.startNavigation).not.toHaveBeenCalled();
  expect(await session.cancel()).toBe(true);
  expect(await session.start(route(), plan, truck, () => true)).toBe('started');
});

test('cancel during route loading cleans up after the pending handoff settles', async () => {
  const { engine, session } = fixture();
  const wait = deferred<void>();
  const reached = deferred<void>();
  engine.setRoute.mockImplementation(async () => {
    reached.resolve();
    await wait.promise;
  });
  const start = session.start(route(), plan, truck, () => true);
  await reached.promise;
  const cancel = session.cancel();
  expect(engine.abortNavigationPreparation).not.toHaveBeenCalled();
  wait.resolve();
  expect(await start).toBe('cancelled');
  expect(await cancel).toBe(true);
  expect(engine.startNavigation).not.toHaveBeenCalled();
  expect(engine.abortNavigationPreparation).toHaveBeenCalledTimes(1);
});
test('partially failed route handoff releases owned preparation', async () => {
  const { engine, session } = fixture();
  engine.setRoute.mockRejectedValueOnce(new Error('native route failed'));
  await expect(session.start(route(), plan, truck, () => true)).rejects.toThrow(
    'native route failed',
  );
  expect(engine.abortNavigationPreparation).toHaveBeenCalledTimes(1);
  expect(engine.startNavigation).not.toHaveBeenCalled();
  expect(session.acceptsEvents).toBe(false);
});
test('failed preparation cleanup blocks the next start until cancellation succeeds', async () => {
  const { engine, session } = fixture();
  engine.setRoute.mockRejectedValueOnce(new Error('native route failed'));
  engine.abortNavigationPreparation.mockRejectedValueOnce(
    new Error('cleanup failed'),
  );
  expect(await session.start(route(), plan, truck, () => true)).toBe(
    'stop-unconfirmed',
  );
  expect(await session.start(route(), plan, truck, () => true)).toBe(
    'stop-unconfirmed',
  );
  expect(engine.setRoute).toHaveBeenCalledTimes(1);
  expect(await session.cancel()).toBe(true);
  expect(await session.start(route(), plan, truck, () => true)).toBe('started');
});
