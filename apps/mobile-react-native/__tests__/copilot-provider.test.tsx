import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  CopilotProvider,
  useCopilotSetup,
} from '../src/services/copilot/CopilotProvider';
let mockInitialized = false;
const mockConfigure = jest.fn(async () => {});
jest.mock('../src/services/copilot/CoPilotHost', () => ({
  coPilotHost: () => ({ configureDevice: mockConfigure }),
}));
jest.mock('../src/native/navigation/NativeLocationProvider', () => ({
  NativeLocationProvider: class {
    async permissionStatus() {
      return 'granted';
    }
  },
}));
jest.mock('../src/services/copilot/CopilotRuntime', () => ({
  createCopilotRuntime: () => ({}),
}));
jest.mock('../src/services/copilot/CopilotLifecycle', () => {
  const actual = jest.requireActual('../src/services/copilot/CopilotLifecycle');
  return {
    ...actual,
    CopilotLifecycle: class {
      constructor(
        _port: unknown,
        private mockChanged: (value: unknown) => void,
      ) {}
      async start() {
        this.mockChanged(this.snapshot());
      }
      snapshot() {
        return {
          ...actual.initialCopilotState(),
          initialized: mockInitialized,
          phase: 'ERROR',
          error: mockInitialized
            ? 'COPILOT_NOT_READY'
            : 'COPILOT_NOT_INITIALIZED',
        };
      }
      dispose() {}
    },
  };
});
let setup: ReturnType<typeof useCopilotSetup>;
function Probe() {
  setup = useCopilotSetup();
  return null;
}
let screen: ReactTestRenderer;
afterEach(async () => {
  await act(async () => screen.unmount());
});
test('successful native startup remains saved while readiness checks are pending', async () => {
  mockInitialized = true;
  await act(async () => {
    screen = create(
      <CopilotProvider>
        <Probe />
      </CopilotProvider>,
    );
  });
  await act(async () => {
    await expect(
      setup.configure(' COMPANY ', ' Device '),
    ).resolves.toBeUndefined();
  });
  expect(mockConfigure).toHaveBeenCalledWith(
    'COMPANY',
    'Device',
    'NORTH_AMERICA_California',
  );
});
test('failed native startup cannot report saved-and-started success', async () => {
  mockInitialized = false;
  await act(async () => {
    screen = create(
      <CopilotProvider>
        <Probe />
      </CopilotProvider>,
    );
  });
  await act(async () => {
    await expect(setup.configure('COMPANY', 'Device')).rejects.toThrow(
      'CoPilot startup did not complete.',
    );
  });
});
