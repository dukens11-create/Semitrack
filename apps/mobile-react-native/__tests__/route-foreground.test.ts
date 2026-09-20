import { AppState } from 'react-native';
import { waitForRouteForeground } from '../src/features/routing/routeForeground';
let originalState: typeof AppState.currentState;
let originalListener: typeof AppState.addEventListener;
const listeners = new Set<() => void>();
beforeEach(() => {
  jest.useFakeTimers();
  originalState = AppState.currentState;
  originalListener = AppState.addEventListener;
  AppState.addEventListener = (_event, listener) => {
    const callback = listener as () => void;
    listeners.add(callback);
    return {
      remove: () => {
        listeners.delete(callback);
      },
    };
  };
});
afterEach(() => {
  AppState.currentState = originalState;
  AppState.addEventListener = originalListener;
  listeners.clear();
  jest.useRealTimers();
});
function state(next: typeof AppState.currentState) {
  AppState.currentState = next;
  listeners.forEach(listener => listener());
}
test('known foreground is immediate and does not register a listener', async () => {
  state('active');
  await waitForRouteForeground(new AbortController().signal);
  expect(listeners.size).toBe(0);
});
test.each(['unknown', 'inactive'] as const)(
  '%s waits for confirmed foreground and cleans up',
  async initial => {
    state(initial);
    const resolved = jest.fn();
    const pending = waitForRouteForeground(new AbortController().signal).then(
      resolved,
    );
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    state('active');
    await pending;
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  },
);
test('unresolved lifecycle produces an explicit bounded error, never assumed foreground', async () => {
  state('unknown');
  const pending = waitForRouteForeground(new AbortController().signal).catch(
    error => error,
  );
  jest.advanceTimersByTime(3000);
  expect(await pending).toMatchObject({ code: 'ROUTE_APP_NOT_ACTIVE' });
  expect(listeners.size).toBe(0);
});
test('background is rejected rather than queued for automatic later routing', async () => {
  state('background');
  await expect(
    waitForRouteForeground(new AbortController().signal),
  ).rejects.toMatchObject({ code: 'ROUTE_APP_NOT_ACTIVE' });
  state('active');
  expect(listeners.size).toBe(0);
});
test('entering background during transition rejects and removes the pending request', async () => {
  state('inactive');
  const pending = waitForRouteForeground(new AbortController().signal).catch(
    error => error,
  );
  state('background');
  expect(await pending).toMatchObject({ code: 'ROUTE_APP_NOT_ACTIVE' });
  expect(listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});
test('closing the planner cancels the lifecycle wait; later foreground cannot resume it', async () => {
  state('unknown');
  const controller = new AbortController();
  const pending = waitForRouteForeground(controller.signal).catch(
    error => error,
  );
  controller.abort();
  state('active');
  expect(await pending).toMatchObject({ code: 'REQUEST_CANCELLED' });
  expect(listeners.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});
test('already cancelled route is rejected even in the foreground', async () => {
  state('active');
  const controller = new AbortController();
  controller.abort();
  await expect(waitForRouteForeground(controller.signal)).rejects.toMatchObject(
    { code: 'REQUEST_CANCELLED' },
  );
});
