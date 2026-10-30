import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, DeviceEventEmitter } from 'react-native';
import { useEngineMapSnapshot } from '../src/features/map/useEngineMapSnapshot';
const mockRead = jest.fn();
jest.mock('../src/services/copilot/CoPilotHost', () => ({
  coPilotHost: () => ({ guidanceMapSnapshot: mockRead }),
}));
let state: ReturnType<typeof useEngineMapSnapshot>;
let screen: ReactTestRenderer;
function Probe() {
  state = useEngineMapSnapshot();
  return null;
}
const sample = (revision: number) => ({
  sequence: 1,
  routeRevision: revision,
  observedAt: Date.now(),
  available: true,
  gpsFresh: true,
  fixAt: Date.now(),
  hasDestination: true,
  routeStatus: 'ready',
  routeCoordinates: [
    [-119, 39],
    [-118, 40],
  ],
});
beforeEach(() => {
  AppState.currentState = 'active';
  jest.useFakeTimers();
  mockRead.mockReset();
});
afterEach(async () => {
  await act(async () => screen.unmount());
  jest.useRealTimers();
});
test('recalculation clears geometry immediately and rejects a late previous-route response', async () => {
  mockRead.mockResolvedValueOnce(sample(1));
  await act(async () => {
    screen = create(<Probe />);
  });
  expect(state.sample?.routeRevision).toBe(1);
  let resolve!: (value: unknown) => void;
  mockRead.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  await act(async () => {
    DeviceEventEmitter.emit('SemiTraxCoPilotGuidance', {
      ...sample(2),
      routeStatus: 'calculating',
    });
  });
  expect(state.sample).toBeUndefined();
  await act(async () => {
    resolve(sample(1));
  });
  expect(state.sample).toBeUndefined();
  mockRead.mockResolvedValueOnce(sample(2));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(state.sample?.routeRevision).toBe(2);
});
test('read failures clear the last displayed engine route', async () => {
  mockRead.mockResolvedValueOnce(sample(1));
  await act(async () => {
    screen = create(<Probe />);
  });
  expect(state.sample).toBeDefined();
  mockRead.mockRejectedValueOnce(new Error('bridge unavailable'));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(state.sample).toBeUndefined();
});

test('polling recovers a newer route after a missed recalculation event', async () => {
  mockRead.mockResolvedValueOnce(sample(1));
  await act(async () => {
    screen = create(<Probe />);
  });
  mockRead.mockResolvedValueOnce(sample(2));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(state.sample?.routeRevision).toBe(2);
  mockRead.mockResolvedValueOnce(sample(1));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(state.sample).toBeUndefined();
  mockRead.mockResolvedValueOnce(sample(2));
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  expect(state.sample?.routeRevision).toBe(2);
});
